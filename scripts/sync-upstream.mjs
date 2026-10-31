#!/usr/bin/env node
/**
 * 同步上游 Mieksido/surfcore 到本仓库的 main。
 *
 * 背景：2026-11-01 本仓库已 Leave fork network（不再是 GitHub 意义上的 fork），
 * 网页上的「Sync fork」按钮不存在了，但 git 层面的 fetch/merge 完全不受影响。
 *
 * 用法：
 *   node scripts/sync-upstream.mjs                # fetch → 合并 → 推 origin/main
 *   node scripts/sync-upstream.mjs --dry-run      # 只看上游有哪些新提交，不动工作区
 *   node scripts/sync-upstream.mjs --no-push      # 合并但不推
 *   node scripts/sync-upstream.mjs --branch main  # 换同步的目标分支（默认 main）
 *
 * 退出码：
 *   0  已是最新，或合并并推送成功
 *   1  前置条件不满足（不在仓库里 / 工作区不干净 / 当前分支不对 / 有未完成的合并）
 *   2  合并冲突：脚本停下并把工作区留在冲突态，按打印的步骤解决后自己 commit + push
 *
 * 规则（见 AGENTS.md §1.9）：只写 origin，upstream 只读——本脚本会把 upstream 的
 * push 地址设成 no_push，误推直接失败。
 */
import { execFileSync } from 'node:child_process';
import process from 'node:process';

const UPSTREAM_REMOTE = 'upstream';
const UPSTREAM_URL = 'https://github.com/Mieksido/surfcore.git';
const UPSTREAM_BRANCH = 'main';
const ORIGIN_REMOTE = 'origin';

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const opt = (flag, fallback) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const DRY_RUN = has('--dry-run');
const NO_PUSH = has('--no-push');
const TARGET_BRANCH = opt('--branch', 'main');

let step = 0;
const say = (msg = '') => console.log(msg);
const head = (msg) => { step += 1; say(`\n[${step}] ${msg}`); };
const die = (msg, hint = '') => {
  console.error(`\n✖ ${msg}`);
  if (hint) console.error(`  ${hint}`);
  process.exit(1);
};

/** 跑一条命令；allowFail 时把非零退出当成数据而不是异常。 */
function run(cmd, args, { allowFail = false } = {}) {
  try {
    const out = execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, code: 0, out: (out ?? '').trim(), err: '' };
  } catch (err) {
    const result = {
      ok: false,
      code: typeof err.status === 'number' ? err.status : 1,
      out: String(err.stdout ?? '').trim(),
      err: String(err.stderr ?? '').trim(),
    };
    if (!allowFail) throw new Error(`${cmd} ${args.join(' ')} 失败（exit ${result.code}）：${result.err || result.out}`);
    return result;
  }
}

const git = (args, opts) => run('git', args, opts);

// ── 0. 基本检查 ──────────────────────────────────────────────
head('检查仓库状态');

const root = git(['rev-parse', '--show-toplevel'], { allowFail: true });
if (!root.ok) die('这里不是 git 仓库', '请在 surfcore-linux 仓库目录里运行');
say(`  ${root.out}`);

const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).out;
if (branch !== TARGET_BRANCH) {
  die(`当前在分支 ${branch}，同步目标是 ${TARGET_BRANCH}`, `先执行：git switch ${TARGET_BRANCH}`);
}

if (git(['rev-parse', '--git-path', 'MERGE_HEAD'], { allowFail: true }).code === 0) {
  const merged = git(['rev-parse', '--verify', '--quiet', 'MERGE_HEAD'], { allowFail: true });
  if (merged.ok) die('有未完成的合并', '先解决冲突并 git commit，或 git merge --abort 放弃');
}

const dirty = git(['status', '--porcelain']).out;
if (dirty) {
  die('工作区不干净，拒绝自动合并', `先提交或 stash：\n${dirty.split('\n').slice(0, 10).map((l) => `    ${l}`).join('\n')}`);
}
say('  工作区干净');

// ── 1. upstream 远端（只读） ──────────────────────────────────
head('确认 upstream 远端（只读）');
const hasRemote = git(['remote', 'get-url', UPSTREAM_REMOTE], { allowFail: true }).ok;
if (!hasRemote) {
  git(['remote', 'add', UPSTREAM_REMOTE, UPSTREAM_URL]);
  say(`  已添加 ${UPSTREAM_REMOTE} → ${UPSTREAM_URL}`);
} else {
  say(`  ${UPSTREAM_REMOTE} → ${git(['remote', 'get-url', UPSTREAM_REMOTE]).out}`);
}
git(['remote', 'set-url', '--push', UPSTREAM_REMOTE, 'no_push'], { allowFail: true });
say('  push 地址锁定为 no_push（误推会失败）');

// ── 2. 对齐 origin（云端定时同步可能已经推过一版） ────────────
head(`对齐 ${ORIGIN_REMOTE}/${TARGET_BRANCH}`);
git(['fetch', ORIGIN_REMOTE, '--quiet']);
const behindOrigin = Number(git(['rev-list', '--count', `HEAD..${ORIGIN_REMOTE}/${TARGET_BRANCH}`]).out);
if (behindOrigin > 0) {
  say(`  本地落后 ${ORIGIN_REMOTE}/${TARGET_BRANCH} ${behindOrigin} 个提交，先快进`);
  const ff = git(['merge', '--ff-only', `${ORIGIN_REMOTE}/${TARGET_BRANCH}`], { allowFail: true });
  if (!ff.ok) {
    die(
      `无法快进到 ${ORIGIN_REMOTE}/${TARGET_BRANCH}`,
      `本地可能还有未推送的提交，先执行 git pull --no-rebase ${ORIGIN_REMOTE} ${TARGET_BRANCH} 再重试`,
    );
  }
  say(`  已快进到 ${git(['rev-parse', '--short', 'HEAD']).out}`);
} else {
  say('  已与远端一致（或本地领先）');
}

// ── 3. fetch ─────────────────────────────────────────────────
head(`fetch ${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}`);
git(['fetch', UPSTREAM_REMOTE, '--prune', '--quiet']);
const upstreamRev = git(['rev-parse', `refs/remotes/${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}`]).out;
const upstreamDate = git(['log', '-1', '--format=%ad', '--date=short', upstreamRev]).out;
say(`  上游 HEAD：${upstreamRev.slice(0, 7)}（${upstreamDate}）`);

const behind = Number(git(['rev-list', '--count', `HEAD..${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}`]).out);
const ahead = Number(git(['rev-list', '--count', `${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}..HEAD`]).out);
say(`  落后上游 ${behind} 个提交，领先上游 ${ahead} 个提交（本地改动）`);

if (behind === 0) {
  say('\n✔ 已经是最新，无需同步');
  process.exit(0);
}

head(`上游新增 ${behind} 个提交`);
const list = git(['log', '--oneline', `HEAD..${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}`]).out.split('\n');
for (const line of list.slice(0, 15)) say(`  ${line}`);
if (list.length > 15) say(`  … 还有 ${list.length - 15} 个`);

if (DRY_RUN) {
  say('\n(dry-run) 未执行合并。去掉 --dry-run 即会合并并推送。');
  process.exit(0);
}

// ── 4. merge ─────────────────────────────────────────────────
head(`合并 ${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH} → ${TARGET_BRANCH}`);
const merge = git(['merge', `refs/remotes/${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}`, '--no-edit'], { allowFail: true });
if (!merge.ok) {
  // 只有真的进入合并态（存在 MERGE_HEAD）才算冲突；否则是别的原因（没配 git 身份、索引锁……）。
  const inMerge = git(['rev-parse', '--verify', '--quiet', 'MERGE_HEAD'], { allowFail: true }).ok;
  if (!inMerge) die('合并失败（不是冲突，工作区没有进入合并态）', merge.err || merge.out);
  const conflicts = git(['diff', '--name-only', '--diff-filter=U'], { allowFail: true }).out;
  console.error('\n✖ 合并冲突，脚本已停下（工作区保留冲突现场）');
  if (conflicts) {
    console.error('  冲突文件：');
    for (const f of conflicts.split('\n')) console.error(`    ${f}`);
  }
  console.error('\n  解决步骤：');
  console.error('    1) 编辑上面这些文件，删掉 <<<<<<< / ======= / >>>>>>> 标记');
  console.error('    2) git add <文件>');
  console.error('    3) git commit --no-edit');
  console.error(`    4) git push ${ORIGIN_REMOTE} ${TARGET_BRANCH}`);
  console.error('  放弃这次合并：git merge --abort');
  process.exit(2);
}
const headAfter = git(['rev-parse', '--short', 'HEAD']).out;
say(`  合并完成：${headAfter}`);

// ── 5. push origin ───────────────────────────────────────────
if (NO_PUSH) {
  say('\n✔ 已合并（--no-push：未推送）');
  process.exit(0);
}

head(`推送到 ${ORIGIN_REMOTE}/${TARGET_BRANCH}`);
const push = git(['push', ORIGIN_REMOTE, TARGET_BRANCH], { allowFail: true });
if (!push.ok) die(`推送失败：${push.err || push.out}`, '网络或权限问题；合并结果已在本地，修好后手动 git push 即可');
say(`  ${push.out || 'ok'}`);

say(`\n✔ 同步完成：合入上游 ${behind} 个提交，本地 HEAD = ${headAfter}`);
