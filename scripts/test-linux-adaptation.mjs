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

console.log('✓ Linux 适配回归通过（浏览器发现 / 无浏览器提示 / 语音包平台拒绝 / 路径选择器接线）');
