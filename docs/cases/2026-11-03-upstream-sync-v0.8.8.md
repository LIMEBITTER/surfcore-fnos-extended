# 2026-11-03 · 同步上游 v0.8.8，保留 Linux fork 特性

## 现象

- 上游 `Mieksido/surfcore` 在 v0.8.6 之后连续发布 `v0.8.7`、`v0.8.8`。
- 本 fork 的 `linux` 分支停在 `2564008`（`0.8.6-linux`），需要在不丢 Linux/fork 特性的前提下同步。

## 环境

| 项 | 值 |
| --- | --- |
| 生产仓库 | `/home/baiyu/surfcore` |
| 同步试合并 | `/home/baiyu/surfcore-sync-test`（临时 worktree） |
| fork | `LIMEBITTER/surfcore-fnos-extended`，分支 `linux` |
| 上游 | `Mieksido/surfcore`，`main` = `0deb826`（v0.8.8） |
| 本 fork 基线 | `2564008`（`0.8.6-linux`） |
| 备份分支 | `backup-before-upstream-v0.8.8-20261103-225514` |

## 根因/差异

- 上游只新增两个 release commit（`90872a7`、`0deb826`），但 v0.8.7 是大版本：
  人格语气层、群刷屏过滤、B站 @ 楼层、QQ 晚注册工具限制、模型跟随、唤醒额度、outbox、语音/更新/记忆等。
- `git merge -X theirs upstream/main` 自动合并无冲突；代价是上游整体替换了部分 fork 文档：
  - `AGENTS.md` 缺少 fork 边界；
  - `README.md` 版本/平台/目标 DSH 回到上游值；
  - `docs/cases/README.md` 丢失 7 条 fork 案例索引；
  - 版本回到 `0.8.8`，manifest 是上游清单。
- 代码层的 fork 特性（扫码浏览器发现、Linux 打开链接、browse/list、路径选择器、语音/更新 Linux 分支、
  `time-context`、`resolveBiliAid`、`qq_bili_*`）在自动合并中保留。

## 修法

- 版本改为 `0.8.8-linux`（root/plugin/lock），README 平台改 Linux/fnOS、目标 DSH 写 rc.5。
- `AGENTS.md` 增加 fork 边界：只写本仓库、不回流上游、唯一 `linux` 分支、冲突优先上游、编辑会话不发布。
- `docs/cases/README.md` 合并上游新行与 fork 的 7 条旧行；新增本案例索引。
- `docs/HANDOFF.md` 增加同步快照；`docs/RELEASE-QUEUE.md` 增加待发布批次。
- 合并后重生成 `release/install-manifest.json`，并恢复本机未提交的 `plugins/surfcore/lib/http-guard.js` 补丁。
- `plugins/surfcore/scripts/test-platform-start-host.mjs`：临时 `DSH_HOME` 之外再加临时 `SURFCORE_QQBOT_ROOT`（`config.json` 的 `consolePort=39999` + 空 `src/bridge.js`），避免本机生产桥接在 3100 监听时测试误连；`stop-selected` 的 voice 项因此走「未运行」幂等分支，而不是触发 Linux `PLATFORM_UNSUPPORTED`。

## 验证

- `npm run test:audit`：**144/145**，唯一失败 `test-release-manifest`；重生成清单后应为 **145/145**（待提交后复核）。
- `npm run test:regressions`：全部通过。
- `cd plugins/surfcore && npm test`：全部通过（含 `test-platform-start-host`；测试已隔离生产桥接）。
- `node scripts/test-version.mjs`：通过，版本 `0.8.8-linux`。
- `node scripts/release-manifest.mjs --verify-ref HEAD`：待清单重生成后跑。
- 关键 fork 特性 grep（已做）：`SURFCORE_BROWSER`、`xdg-open`、`/browse/list`、`PathPickerModal`、
  `PLATFORM_UNSUPPORTED`、`guardTimeClaims`、`resolveBiliAid`、`qq_bili_`。

## 影响面

- QQ/B站运行时行为跟随上游 v0.8.7/v0.8.8；fork 只保留 Linux 适配与 QQ B站手动工具。
- 本机 Host 白名单补丁不在 git 中，部署后必须重新应用，否则公网访问会失效。

## 回滚

- 代码回滚：`git reset --hard backup-before-upstream-v0.8.8-20261103-225514`（仅本地/未推送时）。
- 生产部署前保留 `/home/baiyu/surfcore` 的 `state/` 和 `config.json`；更新器不会覆盖它们。
