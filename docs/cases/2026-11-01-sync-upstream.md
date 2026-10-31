# 2026-11-01 · 脱离 fork 网络后，怎么定期同步上游

## 现象

- 用户问：「以后如果说要定期同步上游仓库怎么办，因为现在上游仓库很活跃」。
- 背景：2026-11-01 本仓库执行了 GitHub 的 **Leave fork network**（为了不在上游的 Forks / PR / issue 里出现），
  网页上的 **Sync fork** 按钮随之消失；上游 `Mieksido/surfcore` 迭代很快（10-28～11-01 连发 0.8.1–0.8.4）。

## 环境

| 项 | 值 |
| --- | --- |
| 系统 | Windows 11 |
| 仓库 | `LIMEBITTER/surfcore-linux`（独立仓库，已不在 fork network） |
| 上游 | `Mieksido/surfcore`，`main` = `bbec146`（v0.8.4） |
| 本地 | `main` 领先上游 11 个提交（文档 4 + feat 5 + 合并 1 + 文档 1） |

## 根因

- **脱钩只影响 GitHub 的仓库关系**（Forks 列表、Network 图、Sync fork 按钮、compare / PR 入口），
  不影响 git 协议：上游是公开仓库，`git fetch` 匿名只读即可。
- 所以「不在上游出现」和「定期同步」不冲突；缺的只是把 fetch → merge → push 串成一条命令。

## 修法

- 新增 `scripts/sync-upstream.mjs`：检查干净 → 确保 `upstream` 远端且 push = `no_push` → `fetch` →
  打印落后/领先与上游新提交 → `merge`（生成合并提交，不重写 `main`）→ `push origin main`；
- 参数：`--dry-run` / `--no-push` / `--branch`；退出码 `0` / `1` / `2`（2 = 冲突，保留现场并打印四步）；
- `package.json` 增加 `npm run sync:upstream`；
- README §11.3 换成「一条命令 + 定期执行 + 手动等价命令」，AGENTS §1.9.6 同步。

## 完整逻辑

- **链路**：`scripts/sync-upstream.mjs` → `git` 子进程 → 本地仓库 → `origin`（SSH）。上游只出现在
  `git fetch` 的只读方向；没有任何路径会写 `Mieksido/surfcore`（`upstream` 的 push URL 是 `no_push`）。
- **机制**：`main` 有本地提交 ⇒ 每次同步必然是三方合并（产生 merge commit）。`--ff-only` 会永远失败，
  `rebase` 会改写已发布的 `main`（违反 AGENTS §1.9.4），所以选 merge。
- **爆炸半径**：只动 `main` 引用和工作区；先 merge 成功才 push，不会出现「推了一半」；
  冲突时停下、不提交、不推送。不碰用户数据与密钥。
- **取舍**：脚本 vs 纯手动 vs GitHub Actions 定时。脚本最可控、离线可用、冲突可见；
  Actions 需要写权限且冲突同样要人工处理，所以默认只做本地脚本。

## 验证

- `node scripts/sync-upstream.mjs --dry-run`（工作区有未跟踪文件时）→ `✖ 工作区不干净，拒绝自动合并`，exit 1；
- `--branch nope` → `✖ 当前在分支 main，同步目标是 nope`，exit 1；
- 提交脚本后 `--dry-run` → 打印上游 HEAD、落后 0 / 领先 N、`✔ 已经是最新`，exit 0。
- **没验证到的部分**：合并冲突分支（exit 2）和任务计划程序的注册步骤没有真跑（后者会改系统计划任务）。
  冲突分支的逻辑就是 `git merge` 非零 + `git diff --diff-filter=U` 列文件，与手动冲突一致。

## 遗留

- 想云端定时（电脑关机也同步）：加 `.github/workflows/sync-upstream.yml`，用 `GITHUB_TOKEN` 推送；
  冲突时 workflow 失败，仍需人工解决。
- `docs/RELEASE-QUEUE.md` 的交接块：本次是工具链改动，未走发布流程。
