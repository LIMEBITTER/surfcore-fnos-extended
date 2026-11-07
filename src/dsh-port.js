// 找到「当前正在运行的那只 DSH」的 Web 地址。
//
// 为什么需要独立模块：DSH 桌面端每次启动会挑一个空闲回环端口（实测 28918 → 15016 →
// 41742 → 42212），而桥接铸造的会话 Cookie 把 host:port 绑进签名载荷，端口错只会 401。
// 正常路径有两条：DSH 拉起桥接时带 `DSH_WEB_URL`，或 `start-with-dsh-port.bat` 先跑
// `scripts/sync-dsh-port.mjs`。但直接 `npm start` / `node src/bridge.js` 时两条都没走，
// config.json 里的旧端口会让桥接一直 401/超时——表现却是「QQ 有消息、DSH 没反应」，
// 极难自查。所以这里把探测抽成共用逻辑：脚本用它写回配置，桥接启动时用它兜底。
//
// 平台（2026-11-07 起三平台都枚举进程，不再只支持 Windows）：
//   Windows  netstat -ano -p TCP        + tasklist
//   Linux    ss -ltnp（回退 netstat）    + /proc/<pid>/{comm,cmdline}
//   macOS    netstat -ltn              + ps
// 全都拿不到时退化成「只按端口做 HTTP 探活」，仍然不会误连别的服务。
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const isWin = process.platform === 'win32';

/**
 * 解析 `ss -ltnp` / `netstat -ltnp` 的输出，取出「监听在回环地址上的端口 + 进程号」。
 *
 * ss 示例：`LISTEN 0 511 127.0.0.1:3080 0.0.0.0:* users:(("node",pid=53780,fd=20))`
 * netstat 示例：`tcp 0 0 127.0.0.1:3080 0.0.0.0:* LISTEN 53780/node`
 *
 * 导出的目的是给回归测试用（`scripts/test-linux-adaptation.mjs`）。
 */
export function parseListenOutput(out) {
  const rows = [];
  for (const raw of String(out ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const cols = line.split(/\s+/);
    const local = cols.find((c) => /^(127\.0\.0\.1|\[::1\]|0\.0\.0\.0|\*):\d+$/.test(c));
    if (!local) continue;
    const m = local.match(/:(\d+)$/);
    if (!m) continue;
    const host = local.slice(0, local.lastIndexOf(':'));
    // 只听 0.0.0.0 的进程对本机回环同样可见（DSH 默认绑 127.0.0.1，但允许用户显式放开）。
    if (!/^(127\.0\.0\.1|\[::1\]|0\.0\.0\.0|\*)$/.test(host)) continue;
    let pid = '';
    const fromSs = line.match(/pid=(\d+)/);
    if (fromSs) pid = fromSs[1];
    if (!pid) {
      const fromNetstat = line.match(/\s(\d+)\/\S+\s*$/);
      if (fromNetstat) pid = fromNetstat[1];
    }
    rows.push({ port: Number(m[1]), pid });
  }
  return rows;
}

function runQuiet(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

/** 列出回环上正在监听的端口（含进程号；拿不到 pid 时为空串）。 */
export function listeningLoopbackPorts() {
  if (isWin) {
    const out = runQuiet('netstat -ano -p TCP');
    const rows = [];
    for (const line of out.split(/\r?\n/)) {
      if (!line.includes('LISTENING')) continue;
      const cols = line.trim().split(/\s+/);
      const local = cols[1] ?? '';
      const pid = cols[4] ?? '';
      if (!/^(127\.0\.0\.1|0\.0\.0\.0):\d+$/.test(local)) continue;
      rows.push({ port: Number(local.split(':').pop()), pid });
    }
    return rows;
  }
  // Linux/BSD：ss 输出更稳，netstat 作回退（macOS 只有 netstat）。
  const text = runQuiet('ss -ltnp 2>/dev/null') || runQuiet('netstat -ltnp 2>/dev/null') || runQuiet('netstat -ltn 2>/dev/null');
  return parseListenOutput(text);
}

/**
 * 进程的「身份串」：名字 + 命令行。
 *
 * Windows 上任务名就是 Harness.exe；Linux 上跑的是 `node /path/to/dsh`，
 * 只看 comm（node）永远匹配不到 dsh，所以必须把 cmdline 一起带上。
 */
function processSignature(pid) {
  const id = String(pid ?? '').trim();
  if (!id) return '';
  if (isWin) {
    const out = runQuiet('tasklist /fo csv /nh');
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/^"([^"]+)","(\d+)"/);
      if (m && m[2] === id) return m[1];
    }
    return '';
  }
  try {
    const comm = fs.readFileSync(`/proc/${id}/comm`, 'utf8').trim();
    const cmd = fs.readFileSync(`/proc/${id}/cmdline`, 'utf8').replace(/\0/g, ' ').trim();
    return `${comm} ${cmd}`;
  } catch { /* 不是 Linux，或进程已退出 */ }
  return runQuiet(`ps -p ${Number(id)} -o command=`);
}

/** DSH 的 Web 服务对未鉴权请求返回 401（有时 200），并带自己的响应头。 */
export async function looksLikeDsh(port, timeoutMs = 1500) {
  return probeDshBaseUrl(`http://127.0.0.1:${port}`, timeoutMs);
}

/** 枚举本机正在监听的 DSH，返回 `http://127.0.0.1:<port>`；找不到返回 null。 */
export async function discoverDshBaseUrl() {
  const candidates = listeningLoopbackPorts()
    .filter(({ pid }) => /harness|dsh/i.test(processSignature(pid)))
    .map(({ port }) => port)
    .filter((port, i, all) => all.indexOf(port) === i);
  for (const port of candidates) {
    if (await looksLikeDsh(port)) return `http://127.0.0.1:${port}`;
  }
  return null;
}

/**
 * 这个地址上是否有一个活着的 DSH。
 *
 * 401 = 教科书式的「DSH 在，但要鉴权」；200 只有 Server 头或 /api/status
 * 的 JSON 形状像 DSH 时才认——否则回环上任何一个别的 Web 服务（开发服务器、
 * 别的控制台）都会被当成 DSH，桥接就会把消息投给错误的目标。
 */
export async function probeDshBaseUrl(baseUrl, timeoutMs = 2000) {
  const base = String(baseUrl ?? '').trim().replace(/\/+$/, '');
  if (!base) return false;
  const probe = async (path, readJson = false) => {
    try {
      const res = await fetch(`${base}${path}`, { method: 'GET', signal: AbortSignal.timeout(timeoutMs) });
      if (res.status === 401) { await res.body?.cancel?.(); return true; }
      if (res.status !== 200) { await res.body?.cancel?.(); return false; }
      if (readJson) {
        const body = await res.json().catch(() => null);
        const looks = body && typeof body === 'object'
          && ('modelConnection' in body || 'latestEventCursor' in body || 'sessions' in body);
        if (looks) return true;
      } else {
        const server = String(res.headers.get('server') ?? '');
        await res.body?.cancel?.();
        if (/dsh/i.test(server)) return true;
      }
    } catch {}
    return false;
  };
  // 桌面内嵌宿主可能没有 `server: dsh` 头，但 /api/status 一定存在；
  // 先看 API 形状，再看旧版根路径头，避免把「HTTP 通但缺 remote.mux」误报成连不上。
  if (await probe('/api/status', true)) return true;
  return probe('/', false);
}

/** 只对回环地址做「端口漂移」兜底；远程 DSH 由用户显式配置，不能被本地探测覆盖。 */
export function isLoopbackBaseUrl(baseUrl) {
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/i.test(String(baseUrl ?? '').trim());
}
