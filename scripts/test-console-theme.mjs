// 控制台主题回归：深色模式必须能读到 DSH 的 --dsw-* token。
//
// 背景（2026-11-07）：控制台把 --qbw-* 语义层写在 `:root{}` 上，而 DSH 的
// --dsw-alias-* 是定义在 `body{}` / `body[data-ds-dark-theme]{}` 上的。自定义属性
// 只向下继承，`:root` 里的 var(--dsw-…) 永远取不到值 → 全部退回硬编码浅色，
// 于是浅色下看着正常、一切到深色就有大片浅底/深字。这里把「必须挂在 body 上」钉住。
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../plugins/surfcore/lib/client.js', import.meta.url), 'utf8');

const start = src.indexOf('const CSS = `');
assert.ok(start > 0, 'client.js 里应有 const CSS = ` 模板');
const end = src.indexOf('\n`;', start);
assert.ok(end > start, 'CSS 模板应以反引号结束');
const css = src.slice(start, end);

// 1. 语义层不能写在 :root（DSH 的 token 在 body 上，:root 拿不到）
assert.ok(!/:root\s*\{/.test(css), 'CSS 里不应再出现 :root{…}：--qbw-* 必须定义在 body 上');
assert.match(css, /body\s*\{\s*\/\*[^]*?--qbw-surface:/, '--qbw-* 调色板应定义在 body 上');

// 2. 调色板里的每一项都要真的指向 DSH token（不能只剩硬编码）
for (const name of ['--qbw-surface', '--qbw-text', '--qbw-muted', '--qbw-line', '--qbw-brand', '--qbw-on-brand']) {
  const decl = new RegExp(`${name}:\\s*([^;]+);`).exec(css);
  assert.ok(decl, `${name} 应有声明`);
  assert.match(decl[1], /var\(--dsw-alias-/, `${name} 应回落到 var(--dsw-alias-…)，而不是纯硬编码颜色`);
}

// 3. 用到的每个 var(--qbw-*) 都必须有声明（拼错会静默失效成灰色）
const declared = new Set([...css.matchAll(/(--qbw-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
const used = new Set([...css.matchAll(/var\((--qbw-[a-z0-9-]+)/g)].map((m) => m[1]));
for (const u of used) assert.ok(declared.has(u), `用了未声明的 ${u}`);

// 4. CSS 里除了语义颜色，不应再有写死的浅色底（二维码白底在 JS 里，不算）
const hexInCss = [...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
for (const h of hexInCss) {
  assert.ok(/^#(ffffff|fff|f2f4f7|1f2328|5b6472|d0d5dd|e3e6ee|2f6fed|2fbf71|b97800|e5484d|000)$/i.test(h),
    `CSS 里出现了意料之外的颜色 ${h}`);
}

console.log('✅ console-theme: 调色板挂在 body、全部走 --dsw-* token、无写死浅色');
