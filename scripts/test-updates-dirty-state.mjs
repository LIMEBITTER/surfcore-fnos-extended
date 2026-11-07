#!/usr/bin/env node
// 更新检查里的「本地有未提交改动」判定：
//   1) 未跟踪文件不算改动（备份文件/临时文件不该挡住更新）
//   2) 只有「确实有更新要拉」时才判 blocked；已是最新时本地有改动只是提醒
//   3) blocked 文案要带上文件名，不能只剩一句"本地有未提交改动"
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok });
  if (!ok) console.log(`❌ ${name}${detail ? `：${detail}` : ''}`);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'surfcore-updates-dirty-'));
process.env.DSH_HOME = path.join(tmp, 'dsh');
fs.mkdirSync(process.env.DSH_HOME, { recursive: true });

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const repo = path.join(tmp, 'repo');
const remote = path.join(tmp, 'remote.git');
const other = path.join(tmp, 'other');

fs.mkdirSync(repo);
git(repo, 'init', '-q');
git(repo, 'config', 'user.email', 'test@example.com');
git(repo, 'config', 'user.name', 'test');
fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
git(repo, 'add', 'a.txt');
git(repo, 'commit', '-q', '-m', 'init');
git(repo, 'branch', '-M', 'main');

fs.mkdirSync(remote);
git(remote, 'init', '-q', '--bare');
git(repo, 'remote', 'add', 'origin', remote);
git(repo, 'push', '-q', '-u', 'origin', 'main');

// 另一个克隆里造一个远端新提交，让 repo 落后 1 个提交
fs.mkdirSync(other);
git(other, 'clone', '-q', remote, '.');
try { git(other, 'checkout', '-q', 'main'); } catch {}
git(other, 'config', 'user.email', 'test@example.com');
git(other, 'config', 'user.name', 'test');
fs.writeFileSync(path.join(other, 'b.txt'), 'two\n');
git(other, 'add', 'b.txt');
git(other, 'commit', '-q', '-m', 'remote-update');
git(other, 'push', '-q', 'origin', 'main');

const { inspectGitComponent } = await import('../plugins/surfcore/lib/updates.js');
const component = { id: 'probe', name: '探针', dir: repo, kind: 'git', branch: 'main' };

// 1) 落后 1 个提交、工作区干净
let r = await inspectGitComponent(component, { fetch: true });
check('落后 1 个提交被识别', r.behind === 1, JSON.stringify({ behind: r.behind, ahead: r.ahead }));
check('干净仓库不判 blocked', r.status === 'update' && !r.blocked, JSON.stringify({ status: r.status, blocked: r.blocked }));

// 2) 只加一个未跟踪文件 —— 不该算改动
fs.writeFileSync(path.join(repo, 'scratch.bak'), 'tmp\n');
r = await inspectGitComponent(component, { fetch: false });
check('未跟踪文件不算 dirty', r.dirty === 0, JSON.stringify({ dirty: r.dirty, files: r.dirtyFiles }));
check('未跟踪文件仍判 update（不阻塞）', r.status === 'update' && !r.blocked, JSON.stringify({ status: r.status, blocked: r.blocked }));

// 3) 改一个已跟踪文件 —— 有更新时要判 blocked，且文案带文件名
fs.writeFileSync(path.join(repo, 'a.txt'), 'one-changed\n');
r = await inspectGitComponent(component, { fetch: false });
check('已跟踪改动算 dirty', r.dirty === 1, JSON.stringify({ dirty: r.dirty }));
check('有更新 + 本地改动 → blocked', r.status === 'blocked' && r.code === 'local-changes', JSON.stringify({ status: r.status, code: r.code }));
check('blocked 文案带文件名', String(r.blocked).includes('a.txt'), r.blocked);
check('blocked 文案不是光秃秃一句', String(r.blocked).length > 10, r.blocked);

// 4) 追平远端后，本地改动只是提醒，不再说"更新被阻止"
git(repo, 'stash', '-q', '-u');
git(repo, 'merge', '-q', '--ff-only', 'origin/main');
fs.writeFileSync(path.join(repo, 'a.txt'), 'one-changed-again\n');
r = await inspectGitComponent(component, { fetch: false });
check('已是最新时不判 blocked', r.status === 'latest' && !r.blocked, JSON.stringify({ status: r.status, blocked: r.blocked }));
check('已是最新但有本地改动 → 给 notice', r.dirty === 1 && String(r.notice).includes('未提交'), JSON.stringify({ dirty: r.dirty, notice: r.notice }));

fs.rmSync(tmp, { recursive: true, force: true });
const failed = checks.filter((c) => !c.ok);
if (failed.length) {
  console.log(`❌ updates-dirty-state: ${failed.length}/${checks.length} 项失败`);
  process.exit(1);
}
console.log(`✅ updates-dirty-state: ${checks.length} 项通过（未跟踪不算改动 / 有更新才 blocked / 文案带文件名）`);
