import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function isNodeExe(file) {
  return /^node(\.exe)?$/i.test(path.basename(String(file ?? '')));
}

/**
 * PATH 里第一个 node（Linux/macOS 常见：/usr/bin/node、~/.nvm/...、~/.local/bin/node）。
 * Windows 上 PATH 里通常是 `node.exe`，同样能命中；查不到就返回空串。
 */
function nodeOnPath(env) {
  const sep = process.platform === 'win32' ? ';' : ':';
  for (const dir of String(env.PATH ?? '').split(sep)) {
    if (!dir) continue;
    for (const name of ['node', 'node.exe']) {
      const candidate = path.join(dir, name);
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
      } catch {}
    }
  }
  return '';
}

/**
 * 找到真正能跑 .mjs 的 node。
 *
 * DSH Desktop 的 process.execPath 是 Harness.exe，真正的 node 可能只在
 * <install>/resources/runtime/primary-runtime/dependencies/node/bin/node(.exe)。
 * 这里把安装目录候选放在用户缓存/Program Files 之前，但保留所有旧入口；
 * 找不到时仍返回 process.execPath，让调用方给出明确错误，而不是静默换程序。
 *
 * 2026-11-07：补上 Linux/macOS 的常见位置与 PATH 扫描——以前只列了 Windows 的
 * `C:\Program Files\nodejs\node.exe`，在 NAS 上（node 装在 ~/.local/node）会退回
 * Harness/Electron 的 execPath，子进程一跑 .mjs 就报 "not a node binary"。
 */
export function findNodeExe({
  execPath = process.execPath,
  env = process.env,
  home = env.HOME || env.USERPROFILE || os.homedir(),
  dshHome = env.DSH_HOME || path.join(home, '.dsh'),
  programFiles = process.platform === 'win32' ? 'C:\\Program Files\\nodejs\\node.exe' : '/usr/bin/node',
} = {}) {
  const exeDir = path.dirname(String(execPath || process.execPath));
  const candidates = [
    env.DSH_NODE,
    // DSH Desktop 安装目录布局（PR #3）；Windows 和类 Unix 各一份，按存在性选。
    path.join(exeDir, 'resources', 'runtime', 'primary-runtime', 'dependencies', 'node', 'bin', 'node.exe'),
    path.join(exeDir, 'resources', 'runtime', 'primary-runtime', 'dependencies', 'node', 'bin', 'node'),
    // 旧的用户缓存布局。
    path.join(dshHome, 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'node', 'bin', 'node.exe'),
    path.join(dshHome, 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'node', 'bin', 'node'),
    path.join(home, '.dsh', 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'node', 'bin', 'node.exe'),
    path.join(home, '.dsh', 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'node', 'bin', 'node'),
    // 用户级安装（本仓在 fnOS 上的布局：~/.local/node/bin/node，软链到 .local/bin/node）。
    path.join(home, '.local', 'bin', 'node'),
    path.join(home, '.local', 'node', 'bin', 'node'),
    path.join(home, '.nvm', 'current', 'bin', 'node'),
    programFiles,
    '/usr/local/bin/node',
    '/opt/homebrew/bin/node',
    nodeOnPath(env),
  ];
  for (const candidate of [...new Set(candidates.filter(Boolean))]) {
    try {
      if (isNodeExe(candidate) && fs.existsSync(candidate)) return candidate;
    } catch {}
  }
  return execPath;
}
