// 只读的 NAS 状态采集器：给 QQ 侧提供一个「问一句就能知道机器现在什么情况」的工具。
//
// 设计约束（改动前请先读）：
//   1. **只读**：只读 /proc、/sys 和 fs.statfs，最多再做一次 127.0.0.1 端口的 TCP 连通性探测。
//      不执行任何外部命令（不 spawn、不 shell），因此没有命令注入面，也不依赖 PATH。
//   2. **不碰敏感数据**：不读 config.json、.secrets/、state/console-token 等；不返回任何
//      token / cookie / 订阅地址；路径只到挂载点（/、/vol1），不下钻到用户目录。
//   3. **输出可控**：整段固定形状、约 10 行，方便模型转述；不做分页、不接受参数。
//   4. **失败降级**：任何一项读不到就不输出那一行，绝不抛错 —— 这个工具跑在 MCP 子进程里，
//      抛异常会让整次工具调用失败。
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';

const PORT_TIMEOUT_MS = 800;

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function readNumber(file) {
  const n = Number(readText(file).trim());
  return Number.isFinite(n) ? n : null;
}

function memInfo() {
  const text = readText('/proc/meminfo');
  const pick = (key) => {
    const m = new RegExp(`^${key}:\\s+(\\d+)`, 'm').exec(text);
    return m ? Number(m[1]) * 1024 : 0;
  };
  return {
    total: pick('MemTotal'),
    avail: pick('MemAvailable'),
    swapTotal: pick('SwapTotal'),
    swapFree: pick('SwapFree')
  };
}

function diskUsage(mount) {
  try {
    const s = fs.statfsSync(mount);
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    const used = Math.max(0, total - free);
    if (!total) return null;
    return { mount, total, used, pct: Math.round((used / total) * 100) };
  } catch {
    return null;
  }
}

function thermalTemps() {
  let dirs = [];
  try {
    dirs = fs.readdirSync('/sys/class/thermal').filter((d) => d.startsWith('thermal_zone'));
  } catch {
    return [];
  }
  const list = [];
  for (const dir of dirs) {
    const base = `/sys/class/thermal/${dir}`;
    const milli = readNumber(`${base}/temp`);
    if (milli == null || milli <= 0) continue;
    const type = readText(`${base}/type`).trim() || dir;
    list.push({ type, c: Math.round(milli / 1000) });
  }
  list.sort((a, b) => b.c - a.c);
  return list.slice(0, 3);
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    const finish = (ok) => {
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      resolve(ok);
    };
    socket.setTimeout(PORT_TIMEOUT_MS, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

function gb(bytes) {
  return `${(bytes / 1024 ** 3).toFixed(1)}G`;
}

function duration(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}天${h}小时`;
  if (h > 0) return `${h}小时${m}分`;
  return `${m}分`;
}

function lanAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const [name, list] of Object.entries(ifaces)) {
    for (const item of list ?? []) {
      if (item.family !== 'IPv4' || item.internal) continue;
      const name_l = name.toLowerCase();
      if (name_l.startsWith('docker') || name_l.startsWith('veth') || name_l.startsWith('br-')) continue;
      out.push(`${name} ${item.address}`);
    }
  }
  return out;
}

/**
 * 采集一份快照。任何一项失败都只是缺少那一行，不会整体失败。
 * @returns {Promise<{ lines: string[], ports: Record<string, boolean> }>}
 */
export async function collectNasStatus() {
  const lines = [];

  // 1. 系统
  let osName = 'Linux';
  try {
    const osRelease = readText('/etc/os-release');
    const pretty = /^PRETTY_NAME="?([^"\n]+)"?/m.exec(osRelease)?.[1];
    if (pretty) osName = pretty;
  } catch {
    /* ignore */
  }
  const cpus = os.cpus().length;
  const load = os.loadavg().map((n) => n.toFixed(2)).join(' ');
  lines.push(`系统 ${os.hostname()}（${osName}，内核 ${os.release()}）已运行 ${duration(os.uptime())}`);
  lines.push(`CPU ${cpus} 线程，负载 ${load}`);

  // 2. 温度（读得到才写）
  const temps = thermalTemps();
  if (temps.length) {
    lines.push(`温度 ${temps.map((t) => `${t.type} ${t.c}°C`).join('，')}`);
  }

  // 3. 内存
  const mem = memInfo();
  if (mem.total) {
    const swap = mem.swapTotal
      ? `，交换 ${gb(mem.swapTotal)} 总/剩 ${gb(mem.swapFree)}`
      : '，无交换';
    lines.push(`内存 ${gb(mem.total)} 总/可用 ${gb(mem.avail)}${swap}`);
  }

  // 4. 磁盘
  const disks = ['/', '/vol1'].map(diskUsage).filter(Boolean);
  if (disks.length) {
    lines.push(
      `磁盘 ${disks.map((d) => `${d.mount} ${gb(d.total)} 用 ${gb(d.used)}（${d.pct}%）`).join('，')}`
    );
  }

  // 5. 网络
  const addrs = lanAddresses();
  if (addrs.length) lines.push(`网络 ${addrs.join('，')}`);

  // 6. 服务端口（只探回环，不探外部）
  const probes = [
    ['DSH', 3080],
    ['桥接控制台', 3100],
    ['SnowLuma 面板', 5099],
    ['noVNC', 6081],
    ['OneBot HTTP', 3000],
    ['OneBot WS', 3001],
    ['代理', 7890]
  ];
  const ports = {};
  await Promise.all(
    probes.map(async ([label, port]) => {
      ports[port] = await portOpen(port);
    })
  );
  lines.push(
    `服务 ${probes.map(([label, port]) => `${label}${ports[port] ? '✓' : '✗'}`).join(' ')}`
  );

  return { lines, ports };
}

/**
 * 渲染成给人/给模型看的多行文本。
 */
export async function renderNasStatus() {
  const { lines } = await collectNasStatus();
  return lines.join('\n');
}
