#!/usr/bin/env node
// 外部 Embedding 服务（discovery 文件）必须让面板显示"已安装/运行中"。
// 背景：本机用 llama.cpp 跑 bge-m3，没有 state/embedding-packs/runtime 目录，
// 若不把 discovery 服务映射成 externalRuntime，面板会一直显示"未安装"。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  if (!ok) console.log(`❌ ${name}${detail ? `：${detail}` : ''}`);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'surfcore-ext-emb-'));
const dshHome = path.join(tmp, 'dsh');
fs.mkdirSync(path.join(dshHome, 'surfcore'), { recursive: true });
process.env.DSH_HOME = dshHome;

const file = path.join(dshHome, 'surfcore', 'embedding-service.json');
fs.writeFileSync(file, JSON.stringify({ port: 11434, apiVersion: 'v1', token: '' }));

const mod = await import('../plugins/surfcore/lib/embedding-packs.js');

const withService = mod.embeddingPacksStatus();
check('discovery 服务被识别为 ok', withService.service?.ok === true, JSON.stringify(withService.service));
check('无本地 runtime 包时给出 externalRuntime', Boolean(withService.externalRuntime), JSON.stringify(withService.externalRuntime));
check('externalRuntime 指向 discovery 地址', String(withService.externalRuntime?.url ?? '').includes('11434/v1/embeddings'), withService.externalRuntime?.url);
check('externalRuntime 标记 external', withService.externalRuntime?.external === true);
check('installed 为 true（总览不再显示"未安装"）', withService.installed === true);
check('hint 说明在用外部服务', String(withService.hint ?? '').includes('外部 Embedding 服务'), withService.hint);
check('runtime 字段仍为 null（没有本地包）', withService.runtime === null);

fs.rmSync(file);
const withoutService = mod.embeddingPacksStatus();
check('没有 discovery 文件时 externalRuntime 为空', !withoutService.externalRuntime);
check('没有服务时 installed 为 false', withoutService.installed === false);
check('没有服务时 hint 提示安装', String(withoutService.hint ?? '').includes('还没有安装 Embedding 包'), withoutService.hint);

// ── 切回本地：云端模式靠 runtime 转发，外部服务用不了，必须有一条明确的回退路径 ──
fs.writeFileSync(file, JSON.stringify({ port: 11434, apiVersion: 'v1', token: '' }));
mod.saveCloudPackConfig({ provider: 'siliconflow', endpoint: 'https://api.siliconflow.cn/v1', model: 'BAAI/bge-m3', modelSpace: 'bge-m3@1024-cloud-v1', apiKey: 'sk-test-not-real' });
const toCloud = mod.embeddingPacksStatus();
check('保存云端后 provider 变 cloud', toCloud.config?.provider === 'cloud', String(toCloud.config?.provider));
const back = mod.activateLocalProvider();
check('切回本地：ok', back.ok === true);
check('切回本地：provider 变 local', back.config?.provider === 'local', String(back.config?.provider));
check('切回本地：packId 清空', String(back.config?.packId ?? 'x') === '', String(back.config?.packId));
check('切回本地后模型空间仍是 bge-m3', String(back.config?.modelSpace ?? '') === 'bge-m3@1024-f16-v1', String(back.config?.modelSpace));
check('切回本地后仍识别外部服务', back.status?.installed === true && Boolean(back.status?.externalRuntime), String(back.status?.installed));

// ── 没有本地 runtime 包 + 外部服务可达时，"启动 / 一键启动"不能再报 pack.runtime-missing ──
const http = await import('node:http');
const stub = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      object: 'list',
      model: 'bge-m3',
      data: [{ object: 'embedding', index: 0, embedding: Array.from({ length: 1024 }, (_, i) => Math.sin(i) / 2) }],
      usage: { prompt_tokens: 5, total_tokens: 5 },
    }));
  });
});
await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve));
const stubPort = stub.address().port;
fs.writeFileSync(file, JSON.stringify({ port: stubPort, apiVersion: 'v1', token: '' }));

const started = await mod.startEmbeddingRuntime();
check('外部服务模式下"启动"返回 ok', started.ok === true, String(started.error ?? ''));
check('外部服务模式下标记 external', started.external === true);
check('外部服务模式下 already 为 true（不重复拉进程）', started.already === true);
check('外部服务模式下 registration 为空数组', Array.isArray(started.registration) && started.registration.length === 0);
check('外部服务模式下 hint 说明不需要 runtime 包', String(started.hint ?? '').includes('不需要本地运行时包'), started.hint);
check('外部服务模式下自检跑通并报 1024 维', started.verified === true && started.verification?.dimension === 1024, String(started.verification?.dimension));
check('外部服务模式下 status.installed 为 true', started.status?.installed === true);

await new Promise((resolve) => stub.close(resolve));
fs.rmSync(file);
const missingRuntime = await mod.startEmbeddingRuntime();
check('外部服务不可达时仍报 pack.runtime-missing', missingRuntime.ok === false && missingRuntime.code === 'pack.runtime-missing', String(missingRuntime.code));

fs.rmSync(tmp, { recursive: true, force: true });

const failed = checks.filter((c) => !c.ok);
if (failed.length) {
  console.log(`❌ external-embedding-status: ${failed.length}/${checks.length} 项失败`);
  process.exit(1);
}
console.log(`✅ external-embedding-status: ${checks.length} 项通过（外部服务映射为 externalRuntime）`);
