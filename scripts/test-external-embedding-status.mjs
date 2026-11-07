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

fs.rmSync(tmp, { recursive: true, force: true });

const failed = checks.filter((c) => !c.ok);
if (failed.length) {
  console.log(`❌ external-embedding-status: ${failed.length}/${checks.length} 项失败`);
  process.exit(1);
}
console.log(`✅ external-embedding-status: ${checks.length} 项通过（外部服务映射为 externalRuntime）`);
