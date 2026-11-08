// 回归：Btn 自动反馈（成功 / 无结果 / 同步 API / 显式 toast / 异常 / cancelled / {ok:false}）
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync('lib/client.js', 'utf8');
const start = src.indexOf('    function buttonText');
const end = src.indexOf('\n    // ── 管理员卡片', start);
if (start < 0 || end < 0) throw new Error('extract failed');
const code = src.slice(start, end);

const toasts = [];
const sandbox = {
  window: { __surfcoreToast: (m) => { toasts.push(m); sandbox.window.__surfcoreToastSeq = (sandbox.window.__surfcoreToastSeq || 0) + 1; } },
  h: (type, props, ...children) => ({ type, props, children }),
  useState: (init) => [init, () => {}],
  setTimeout,
  clearTimeout,
  Number,
  String,
  Promise,
  Math,
  console,
};
vm.createContext(sandbox);
globalThis.window = sandbox.window;
vm.runInContext(code + '\nthis.Btn = Btn;', sandbox);
const Btn = sandbox.Btn;

const click = async (onClick, children = '保存') => {
  const t0 = Date.now();
  toasts.length = 0;
  const el = Btn({ children, onClick });
  await el.props.onClick({});
  await new Promise((r) => setTimeout(r, 20));
  return toasts.slice();
};

const fakeApi = async (ctx, value, fail = false) => {
  ctx.sawApi = true;
  ctx.pending = (ctx.pending || 0) + 1;
  try {
    await new Promise((r) => setTimeout(r, 5));
    if (fail) throw new Error('网络失败');
    ctx.failed = value?.ok === false ? new Error(value?.message || '失败') : null;
    ctx.lastData = value;
    return value;
  } catch (e) {
    ctx.failed = e;
    throw e;
  } finally {
    ctx.pending--;
    if (!ctx.pending && ctx.onIdle) ctx.onIdle();
  }
};

const results = {};
results.message = await click(async () => ({ ok: true, message: '已保存' }));
results.none = await click(async () => undefined);
results.syncApi = await click(() => {
  fakeApi(window.__surfcoreClickCtx, { ok: true });
});
results.explicit = await click(async () => {
  window.__surfcoreToast('✓ 自定义提示');
  return { ok: true, message: '不应重复' };
});
results.error = await click(async () => { throw new Error('权限不足'); });
results.cancelled = await click(async () => ({ cancelled: true }));
results.failData = await click(async () => {
  const ctx = window.__surfcoreClickCtx;
  return fakeApi(ctx, { ok: false, error: '后端拒绝' }).catch(() => undefined);
});
console.log(JSON.stringify(results, null, 2));
const assert = (cond, msg) => { if (!cond) { console.error('FAIL', msg); process.exitCode = 1; } };
assert(results.message[0] === '✓ 已保存', 'message');
assert(results.none.length === 0, 'no result no toast');
assert(results.syncApi[0] === '✓ 保存完成', 'sync api');
assert(results.explicit.length === 1 && results.explicit[0] === '✓ 自定义提示', 'explicit');
assert(results.error[0]?.startsWith('✗ 保存失败：'), 'error');
assert(results.cancelled.length === 0, 'cancelled');
assert(results.failData[0]?.startsWith('✗ 保存失败：'), 'fail data');
