// 时间上下文/出口校验回归（固定时钟，不依赖真实模型、不发 QQ 消息）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { formatClock, formatAnchors, guardTimeClaims, needsTimeDetail } from '../src/time-context.js';

const at = (s) => new Date(s);
const now = at('2026-11-02T23:11:32+08:00');

// 时钟格式：显式 Asia/Shanghai + 周一 + 秒
const clock = formatClock(now);
assert.match(clock, /2026-11-02 23:11:32/);
assert.match(clock, /周一/);
assert.match(clock, /Asia\/Shanghai/);

// 锚点：23:30 还有 18 分 28 秒；00:00 还有 48 分 28 秒
const anchors = formatAnchors(now);
assert.match(anchors, /23:30 还有 18 分 28 秒/);
assert.match(anchors, /00:00 还有 48 分 28 秒/);

// 案例：23:11 说“还有六分钟就十一点半” → 18 分钟
const bad = guardTimeClaims('还有六分钟就十一点半了', now);
assert.equal(bad.changed, true);
assert.match(bad.text, /还有18分钟就十一点半了/);

// 12 小时制：23:11 的“十二点”应映射到次日 00:00，约 48 分钟
const midnight = guardTimeClaims('还有六分钟就十二点', now);
assert.match(midnight.text, /还有48分钟就十二点/);

// 24 小时制时钟说错 → 直接改回服务器时间
const wrongClock = guardTimeClaims('现在 23:24，该睡了', now);
assert.match(wrongClock.text, /现在 23:11，该睡了/);

// 正确的时钟/历史/计划句不动
assert.equal(guardTimeClaims('现在是23:11', now).changed, false);
assert.equal(guardTimeClaims('昨晚还有六分钟就十一点半了', now).changed, false);
assert.equal(guardTimeClaims('明天还有六分钟就十一点半', now).changed, false);

// 正常聊天不误改
assert.equal(guardTimeClaims('我去睡了，晚安', now).changed, false);
assert.equal(guardTimeClaims('还有六分钟下班', now).changed, false);

// 意图判断
assert.equal(needsTimeDetail('现在几点了'), true);
assert.equal(needsTimeDetail('老大早点躺下吧'), false);

// 极端输入 fail-open
for (const input of ['', '还有……分钟就……', '现在 :']) {
  const r = guardTimeClaims(input, now);
  assert.equal(r.changed, false);
  assert.equal(typeof r.text, 'string');
}

console.log('✅ time-context: clock/anchors/guard 全部通过');


// 回归：v0.8.8 合并时 bridge 丢了 time-context import，导致私聊在 withSlangContext 抛
// ReferenceError，消息到桥接但不进 DSH。这里静态守住 import 不被再次覆盖掉。
const bridgeSource = fs.readFileSync(new URL('../src/bridge.js', import.meta.url), 'utf8');
assert.match(
  bridgeSource,
  /import\s*\{[^}]*\bguardTimeClaims\b[^}]*\}\s*from\s*['"]\.\/time-context\.js['"]/s,
  'src/bridge.js 必须导入 time-context 的 guardTimeClaims',
);
// 2026-11-07：按「冲突优先上游」恢复上游的 prompt 时间注入；fork 只保留出口 guard。
assert.match(bridgeSource, /【当前时间】/, 'src/bridge.js 应使用上游的【当前时间】注入');
assert.doesNotMatch(bridgeSource, /【钟】/, 'src/bridge.js 不应再使用 fork 的【钟】注入');
