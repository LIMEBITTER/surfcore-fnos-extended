// SnowLuma 安装位置识别：设置页「检测已安装的 SnowLuma」和「浏览…」共用这一套规则。
//
// 背景（2026-10-29 用户反馈）：装好 SnowLuma2 后点检测仍然「没找到」。
// 旧实现只在一组**写死的常见目录**里猜（见 findSnowLumaInstall），用户把包解压到
// D:\软件\SnowLuma2 这类自定义位置时永远猜不到；而手动填路径的入口藏在 QQ 页高级设置里。
//
// 2026-11-07 追加（Linux / Docker 一律检测不到）：旧规则只认 Windows 的 launcher.bat /
// SnowLuma.exe，Linux 上无论原生包还是官方 Docker 镜像都必然「没找到」。现在识别三类布局：
//   windows：<root>/app/launcher.bat、<root>/launcher.bat、<root>/SnowLuma.exe
//   linux  ：<root>/launcher.sh（官方 Linux 包）、<root>/index.mjs（带 EULA.md / native 才算）
//   data   ：<root>/config/runtime.json（Docker 镜像挂出来的 /app/data，WebUI/OneBot 配置都在这）
//
// 这里的规则分两层：
//   1. 归一（normalize）：一个路径可能是「根目录 / app 目录 / app\launcher.bat / SnowLuma.exe /
//      launcher.sh / data 目录」，统一还原成 { root, launcher, kind }；目录里只有唯一子目录时
//      再往下看一层（zip 常带顶层文件夹）。
//   2. 候选（candidates）：显式路径 > 配置里的 launcherPath/homeDir > 环境变量 > 常见位置。
// 不猜注册表、不扫盘：用户手动选的路径优先，猜只是省一步。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { QQBOT_ROOT } from './paths.js';

/** 包根目录下可能的启动文件（按优先级）。kind 决定检测成功后往哪个配置项写。 */
const LAUNCHERS = [
  { rel: path.join('app', 'launcher.bat'), kind: 'windows' },
  { rel: 'launcher.bat', kind: 'windows' },
  { rel: 'SnowLuma.exe', kind: 'windows' },
  { rel: 'launcher.sh', kind: 'linux' },
  { rel: path.join('app', 'launcher.sh'), kind: 'linux' },
  // index.mjs 太常见，必须同时看到 Linux 包的伴生文件才认（避免把随便一个 node 项目当 SnowLuma）。
  { rel: 'index.mjs', kind: 'linux', also: ['EULA.md', 'native', 'client'] },
];

/** 数据目录标记：SnowLuma 的 WebUI / OneBot 配置都写在这里（Docker 里是 /app/data）。 */
const DATA_MARKERS = [
  path.join('config', 'runtime.json'),
  path.join('config', 'webui.json'),
];

function statOf(p) {
  try { return fs.statSync(p); } catch { return null; }
}

function existsOf(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

function launcherHit(dir, item) {
  const file = path.join(dir, item.rel);
  if (!statOf(file)?.isFile()) return null;
  if (Array.isArray(item.also) && !item.also.some((name) => existsOf(path.join(dir, name)))) return null;
  const root = path.basename(dir).toLowerCase() === 'app' ? path.dirname(dir) : dir;
  return { root, launcher: file, kind: item.kind };
}

/**
 * 把一个路径归一到 SnowLuma 安装根目录。
 * 接受：根目录（里面有 app）、app 目录、启动文件（launcher.bat / SnowLuma.exe / launcher.sh / index.mjs）、
 * 以及 Docker 挂出来的 data 目录（里面有 config/runtime.json）。
 * 返回 { root, launcher, kind }；认不出返回 null。
 */
export function normalizeSnowLumaInstall(raw) {
  const text = String(raw ?? '').trim().replace(/^"(.*)"$/, '$1');
  if (!text) return null;
  const abs = path.resolve(text);

  // ① 直接选了启动文件
  const st = statOf(abs);
  if (st?.isFile()) {
    const base = path.basename(abs).toLowerCase();
    const kind = base === 'launcher.sh' ? 'linux'
      : (base === 'index.mjs' ? 'linux' : (base === 'launcher.bat' || base === 'snowluma.exe' ? 'windows' : ''));
    if (!kind) return null;
    const dir = path.dirname(abs);
    const root = path.basename(dir).toLowerCase() === 'app' ? path.dirname(dir) : dir;
    return { root, launcher: abs, kind };
  }
  if (!st?.isDirectory()) return null;

  // ② 目录里直接有启动文件（Windows：<root>/app/launcher.bat；Linux：<root>/launcher.sh）
  for (const item of LAUNCHERS) {
    const hit = launcherHit(abs, item);
    if (hit) return hit;
  }

  // ③ 解压多了一层（zip 里带顶层文件夹）：只在「唯一子目录」里再找一层，避免乱猜
  let children = [];
  try { children = fs.readdirSync(abs, { withFileTypes: true }).filter((e) => e.isDirectory()); } catch { children = []; }
  if (children.length === 1) {
    const inner = path.join(abs, children[0].name);
    for (const item of LAUNCHERS) {
      const hit = launcherHit(inner, item);
      if (hit) return hit;
    }
  }

  // ④ Docker / 容器部署：这里不是程序目录，而是被挂进容器的 data 目录
  for (const rel of DATA_MARKERS) {
    if (statOf(path.join(abs, rel))?.isFile()) return { root: abs, launcher: '', kind: 'data' };
  }
  if (children.length === 1 && children[0].name.toLowerCase() === 'data') {
    const inner = path.join(abs, 'data');
    for (const rel of DATA_MARKERS) {
      if (statOf(path.join(inner, rel))?.isFile()) return { root: inner, launcher: '', kind: 'data' };
    }
  }
  return null;
}

/** 候选位置：显式路径 → 配置 → 环境变量 → 常见安装位置。 */
export function snowLumaCandidates({ snowluma = {}, extraPaths = [] } = {}) {
  const out = [];
  const add = (value) => {
    const text = String(value ?? '').trim();
    if (text && !out.includes(text)) out.push(text);
  };
  for (const item of explicitList(extraPaths)) add(item);
  add(snowluma.launcherPath);
  add(snowluma.homeDir);
  add(process.env.SNOWLUMA_HOME);
  add(process.env.SNOWLUMA_DIR);
  add(process.env.SNOWLUMA_DATA);

  const home = os.homedir();
  const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const programFiles = process.env.ProgramFiles || 'C:/Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)';
  const appRoot = path.dirname(QQBOT_ROOT);
  for (const base of [
    // Linux 原生包 / 官方 Docker 目录（2026-11-07 追加）
    path.join(appRoot, 'snowluma'),
    path.join(appRoot, 'snowluma-docker', 'data'),
    path.join(home, 'snowluma'),
    path.join(home, 'snowluma-docker', 'data'),
    '/opt/SnowLuma',
    '/opt/snowluma',
    '/app/data',
    // Windows
    path.join(home, 'SnowLuma2'),
    path.join(home, 'SnowLuma'),
    path.join(home, 'Desktop', 'SnowLuma2'),
    path.join(home, 'Desktop', 'SnowLuma'),
    path.join(home, 'Downloads', 'SnowLuma2'),
    path.join(home, 'Downloads', 'SnowLuma'),
    path.join(localAppData, 'Programs', 'SnowLuma2'),
    path.join(localAppData, 'Programs', 'SnowLuma'),
    path.join(appRoot, 'SnowLuma2'),
    path.join(programFiles, 'SnowLuma2'),
    path.join(programFiles, 'SnowLuma'),
    path.join(programFilesX86, 'SnowLuma2'),
    path.join(programFilesX86, 'SnowLuma'),
  ]) add(base);
  return out;
}

function explicitList(list) {
  if (!list) return [];
  return Array.isArray(list) ? list : [list];
}

/**
 * 检测失败时给用户的**结构化报告**：code（机器可读）/ title / error / hint（下一步）。
 * 规则见 AGENTS 1.7：失败必须可见、必须带可执行建议，不能只写日志或一句"失败"。
 */
export function snowLumaMissingReport({ picked = '', tried = [] } = {}) {
  const target = String(picked || '').trim();
  if (target) {
    return {
      code: 'snowluma_path_invalid',
      title: '这个路径里没有 SnowLuma',
      error: `没认出 SnowLuma：${target}`,
      hint: '要能在这里找到 app/launcher.bat、launcher.bat、SnowLuma.exe（Windows）或 launcher.sh（Linux 原生包）；'
        + 'Docker 部署请选容器挂出来的 data 目录（里面有 config/runtime.json，一般是 snowluma-docker/data）。',
      tried,
    };
  }
  return {
    code: 'snowluma_not_found',
    title: '没找到 SnowLuma',
    error: '常见位置里都没有 SnowLuma（可能还没解压，或装在了别的目录）。',
    hint: '点「浏览…」选 SnowLuma2 解压出来的根目录（里面有 app）、Linux 包的 launcher.sh 所在目录，'
      + '或 Docker 部署的 data 目录（里面有 config/runtime.json）；还没装就点「打开官方下载页」。',
    tried,
  };
}

/**
 * 找 SnowLuma 安装位置。
 * @returns {{ok:true, root:string, launcher:string, kind:string, tried:Array}|{ok:false, tried:Array}}
 *   tried 里带上每个候选和是否命中，检测失败时可直接告诉用户「试过哪些地方」。
 */
export function findSnowLumaInstall({ snowluma = {}, extraPaths = [] } = {}) {
  const tried = [];
  for (const candidate of snowLumaCandidates({ snowluma, extraPaths })) {
    const hit = normalizeSnowLumaInstall(candidate);
    tried.push({ path: candidate, ok: Boolean(hit) });
    if (hit) return { ok: true, ...hit, tried };
  }
  return { ok: false, tried };
}
