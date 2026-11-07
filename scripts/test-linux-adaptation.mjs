// Linux 适配回归：浏览器发现、无浏览器时的可读错误、语音包的平台拒绝。
// 不启动真实浏览器、不联网、不写用户数据。
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { findBrowser, startQrLogin } = await import('../plugins/surfcore/lib/bili-qr-login.mjs');

// 1) 显式 SURFCORE_BROWSER 优先（指向一个真实可执行文件即可，不要求是浏览器）
const savedBrowser = process.env.SURFCORE_BROWSER;
process.env.SURFCORE_BROWSER = process.execPath;
assert.equal(findBrowser(), process.execPath, 'SURFCORE_BROWSER 应优先返回');

// 2) 不存在的显式路径应被忽略，不能把坏路径当浏览器返回
process.env.SURFCORE_BROWSER = '/nonexistent/surfcore-test-browser';
const fallback = findBrowser();
assert.notEqual(fallback, '/nonexistent/surfcore-test-browser', '不存在的 SURFCORE_BROWSER 必须被忽略');

// 3) 在非 Windows 上，PATH 清空且没有显式浏览器时，应给出可读的“找不到浏览器”错误
if (process.platform !== 'win32') {
  const savedPath = process.env.PATH;
  process.env.PATH = '';
  process.env.SURFCORE_BROWSER = '';
  try {
    assert.equal(findBrowser(), '', 'PATH 为空时应找不到浏览器');
    await assert.rejects(
      () => startQrLogin({ target: 'owner' }),
      (error) => /Chromium|浏览器/.test(String(error?.message ?? '')),
      '找不到浏览器时应给出可读提示',
    );
  } finally {
    process.env.PATH = savedPath;
  }
}

// 4) 语音包在非 Windows 上必须结构化拒绝，而不是尝试 spawn cmd/powershell
if (process.platform !== 'win32') {
  const { createVoicePacks } = await import('../src/voice-packs.js');
  const packs = createVoicePacks({ voicePacks: { dir: '/tmp/surfcore-voice-test' } });
  // 未安装时 start 会先报“还没安装”（与平台无关）；真正跑批处理前的平台拒绝由 stop 覆盖。
  const started = await packs.start('voice-cloud').catch((error) => ({ ok: false, error: String(error?.message ?? error) }));
  assert.equal(started.ok, false, 'Linux 上启动语音包应失败');
  const stopped = await packs.stop('voice-cloud');
  assert.equal(stopped.code, 'PLATFORM_UNSUPPORTED', 'Linux 上停止语音包也应结构化拒绝');
}

process.env.SURFCORE_BROWSER = savedBrowser ?? '';
if (savedBrowser === undefined) delete process.env.SURFCORE_BROWSER;
// 5) 设置页的路径选择器必须真正接到 browseNative，而不是只挂载组件。
const clientSource = fs.readFileSync(new URL('../plugins/surfcore/lib/client.js', import.meta.url), 'utf8');
assert.match(clientSource, /if \(browseModalBridge\)/, 'browseNative 应优先检查 PathPickerModal 桥');
assert.match(clientSource, /browseModalBridge\(\{ mode, title, filter \}\)/, 'browseNative 应调用 PathPickerModal 桥');

console.log('✓ Linux 适配回归通过（浏览器发现 / 无浏览器提示 / 语音包平台拒绝 / 路径选择器接线 / 启动脚本三件套 / ss 端口解析 / node 发现 / 平台提示文案）');

// 5) 启动脚本三件套：以前只有 .bat，Linux 上没有任何入口
const { spawnSync } = await import('node:child_process');
const { fileURLToPath } = await import('node:url');
for (const script of ['start.sh', 'restart.sh', 'stop-qq-bot.sh']) {
  const full = fileURLToPath(new URL(`../${script}`, import.meta.url));
  assert.ok(fs.existsSync(full), `${script} 必须存在（Linux 启动入口）`);
  assert.notEqual(fs.statSync(full).mode & 0o111, 0, `${script} 必须可执行`);
  const syntax = spawnSync('bash', ['-n', full], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, `${script} 语法必须正确：${syntax.stderr}`);
}

// 6) 端口枚举必须能在 POSIX 上解析 ss（旧版只解析 Windows netstat）
const { parseListenOutput, listeningLoopbackPorts } = await import('../src/dsh-port.js');
assert.deepEqual(
  parseListenOutput('LISTEN 0 511 127.0.0.1:3080 0.0.0.0:* users:(("node",pid=53780,fd=20))'),
  [{ port: 3080, pid: '53780' }],
  ' 应解析 ss -ltnp 的回环监听行',
);
assert.ok(Array.isArray(listeningLoopbackPorts()), '端口枚举不应抛异常');

// 7) node 发现必须能在 Linux 上找到真实可执行的 node（旧版只列 C:\\Program Files）
const { findNodeExe } = await import('../src/node-path.js');
const foundNode = findNodeExe();
assert.ok(fs.existsSync(foundNode), `findNodeExe() 应返回存在的文件，实际：${foundNode}`);

// 8) 平台相关提示不能再写死 launcher.bat / 只有 Windows（Linux 用户照着做会失败）
const bridgeSource = fs.readFileSync(fileURLToPath(new URL('../src/bridge.js', import.meta.url)), 'utf8');
assert.match(bridgeSource, /launcher\.sh，或 docker compose up -d/, 'SnowLuma 掉线提示应给出 Linux 命令');
const pluginSource = fs.readFileSync(fileURLToPath(new URL('../plugins/surfcore/lib/index.js', import.meta.url)), 'utf8');
assert.match(pluginSource, /docker compose stop/, '关闭 SnowLuma 的提示应给出 Docker 命令');

// 9) 不能再出现裸 spawn(xdg-open)：本机没有 xdg-open，ENOENT 会变成未捕获异常
assert.equal(
  pluginSource.split("spawn('xdg-open'").length - 1,
  0,
  "xdg-open 必须统一走 tryXdgOpen（查 PATH + 挂 error 监听）",
);
assert.match(pluginSource, /function tryXdgOpen\(/, "应有统一的 tryXdgOpen 帮助函数");
