# SurfCore · fnOS Extended

> 一台 NAS，一个住在 DSH 里的 agent，和两个它常去的入口：QQ 与 B站。

这是 [Mieksido/surfcore](https://github.com/Mieksido/surfcore) 的 Linux / 飞牛 OS 分支。

上游把“人格、记忆、QQ 桥接”这些通用能力做得挺完整；这个仓库做的事更具体一点：让它在飞牛的角落里真的住下来——能扫码登录，能打开链接，能更新，能在 QQ 里聊着聊着顺手去 B站点个赞。

**先说清楚**：这是自用分支，不是上游的替代品。通用问题优先看上游文档；这个仓库只负责 Linux 上多出来的那部分，以及我自己踩过的坑。

| 项 | 值 |
| --- | --- |
| 版本 | `0.8.9-linux` |
| 目标 DSH | `0.2.1-rc.5`（已实测；`npm run verify:adaptation` 可逐项复核） |
| 平台 | Linux / 飞牛 OS |
| 许可 | MIT（SnowLuma 是第三方专有运行时，**不随本仓库分发**） |
| 配套仓库 | [surfvoicelocal](https://github.com/Mieksido/surfvoicelocal) · [surfvoicecloud](https://github.com/Mieksido/surfvoicecloud) · [surfpet](https://github.com/Mieksido/surfpet) |

## 这一版有什么

`0.8.9-linux` 跟上了上游 v0.8.9，也保留了 fork 自己的东西。

- **向量记忆**：本地 runtime 或云端 embedding，多模型独立索引，记忆库可读可搜；本地模型有 bge-small、qwen3、bge-m3 几档。
- **会话滚动**：上下文太长时在下一轮投递前换会话，默认关闭，开了会先告诉你代价。
- **Token 账本**：QQ、B站、黑话、子会话分开记账，额度和提醒都落在本地。
- **唤醒过滤 / 批量**：减少不必要的唤醒，也减少“明明没事却被叫起来”的情况。
- **SnowLuma 启动**：脱离 DSH Job，DSH 更新不会顺手把它带走。
- **Linux 适配**：扫码浏览器发现、`xdg-open`、`unzip` 更新、递归复制、语音包平台拒绝，都是为这台机器改的。

合并上游时有个原则：**同一个功能如果上游已经有一版，优先用上游**；fork 只留 Linux 必需的适配，和上游确实没有的增量。上一轮就把 prompt 的时间注入换回了上游写法，本地只保留发送前的 `time-guard` 兜底。不是赌气重写，是尽量少养一套自己的分支逻辑。

## Linux 上具体改了什么

- **扫码登录**：自动找 `chromium / chrome / edge / brave / snap`，也可以用 `SURFCORE_BROWSER` 指定；`--headless=new` 不行就退回 `--headless`；浏览器按进程组退出，不留孤儿。
- **打开链接**：只走 `xdg-open`。NAS 没桌面时它会安静地失败，不会把进程带崩。
- **语音包**：安装用 `tar` + `chmod`；启动/停止在 Linux 返回 `PLATFORM_UNSUPPORTED`，并给出手动 `python -m voxd` 的命令。
- **更新**：解压用 `unzip`，应用更新用递归复制。不再依赖 PowerShell 和 robocopy。
- **路径选择**：设置页里的“浏览…”走页面内选择器，不依赖 Windows 原生文件对话框；也可以直接粘贴绝对路径。

Windows 不是这个分支的目标平台。仓库里可能还留着上游的 PowerShell 脚本，但主线只保证 Linux。

## B站 × QQ

QQ 私聊里可以直接让 agent 操作 B站。只允许主人私聊，复用现有额度账本、出站身份闸和审计。

| 工具 | 能做什么 |
| --- | --- |
| `qq_bili_search` | 搜视频 |
| `qq_bili_video` | 视频详情 / 字幕 |
| `qq_bili_feed` | 按偏好选题 |
| `qq_bili_like` | 点赞 |
| `qq_bili_post` | 发动态 / 发评论，`dryRun` 可预览 |

入口在：设置 → SurfCore → B站 → **「QQ 手动工具（B站）」**。总开关、工具说明、最近操作记录都在那里。

评论会先把 BV 解析成 `aid(oid)` 再提交；失败返回结构化错误，不把 CLI 的 usage 直接甩给用户。

## 时间这件事

时间错了，比“不知道”更麻烦。所以这里有两层：

1. prompt 里的时间用上游的 `【当前时间】…`，跟着环境时区走；
2. 发送前本地再过一遍 `time-guard`：识别“还有 X 分钟到 H 点半”“现在 HH:MM”这类表达，用服务器时间重算。错的就地改写，历史/计划句跳过，校验异常就 fail-open，不拦消息。

不做时间工具、不二次调模型、不自动重试。零额外模型调用，零网络，图的就是稳。

## 怎么装

> 如果你是把仓库交给 DSH 自己部署，让它先读 [`README.DSH.md`](README.DSH.md)：那是一份按“检查 → 安装 → 重启 → 验收”写的 agent runbook。

前置：Node ≥ 22.13、DSH 能打开 Web GUI、SnowLuma 已经用 Docker 跑起来、装一个 Chromium（扫码登录用）。

### 一键（推荐）

```bash
curl -fsSL https://raw.githubusercontent.com/LIMEBITTER/surfcore-fnos-extended/linux/scripts/bootstrap.sh | bash
```

它会检查 Node、DSH profile、SnowLuma 端口，拉代码、装依赖、执行 `setup-dsh.mjs`，最后生成 `config.json`。它**不会**替你重启 DSH，重启这一步留给你。

只想先看看环境对不对：

```bash
bash scripts/bootstrap.sh --check
```

### 手动

```bash
git clone --branch linux https://github.com/LIMEBITTER/surfcore-fnos-extended.git ~/surfcore
cd ~/surfcore

npm install
node scripts/setup-dsh.mjs nas       # 换成你的 DSH profile 名
```

然后按你的 DSH 安装方式重启 DSH。重启后：DSH → 设置 → **SurfCore** → 诊断 → 一键安装。

```bash
sudo apt install chromium            # B站扫码登录前置
```

> 顺序别反：先 `npm install`，再 `setup-dsh`，最后重启。否则容易报 `Cannot find module '@deepseek-ai/schemastery'`。

## 装完怎么确认

```bash
npm run verify:adaptation
npm run test:audit
npm run test:regressions
cd plugins/surfcore && npm test
```

当前基线：`test:audit` **155/155**，回归和插件测试全过，`release/install-manifest` 769 个文件、0 问题。

设置页 → SurfCore → 诊断，也能一项项看。QQ 和 B站的开关在 B站 页的「QQ 手动工具（B站）」里。

## 数据都放在哪

| 内容 | 路径 |
| --- | --- |
| 插件运行配置 | `~/surfcore/config.json`（600，本机） |
| B站 配置 | `~/.dsh/surfcore/bili.config.json` |
| 角色 / 人格 / 记忆 / B站 账本 | `~/.dsh/surfcore/characters/<角色ID>/` |
| B站 手动操作审计 | `~/surfcore/state/bili-manual-log.jsonl` |
| 角色卡示例 | `roles/`（脱敏） |

常用环境变量：

- `SURFCORE_BROWSER`：指定扫码用浏览器
- `SURFCORE_TRUSTED_HOSTS`：公网反代的 Host 白名单（仓库提供精确匹配支持，具体 Host 由部署环境变量提供）
- `SURFCORE_SKIP_AUTOSTART=1`：跳过自动打开浏览器

仓库里**不含**任何真实账号、群号、Cookie 或记忆数据。运行时数据只在本机。

## 钱、限额和压缩

> 这一节是自用部署的备忘，不是仓库默认值。换机器或重装 DSH 后要重新设。

- **DSH 自动压缩**：`~/.dsh/profiles/<profile>/cordis.patch.yml`
  ```yaml
  - id: compaction-basic
    config:
      thresholdRatio: 0.35   # 约 36.7 万触发（窗口 1,048,576）
      retainRatio: 0.1       # 保留约 10.5 万
  ```
  QQ 会话大约 20 万，低于阈值，不会被压缩；B站长会话 34–58 万，会触发。
- **B站回复限额**：`~/.dsh/surfcore/bili.config.json`
  - `limits.replyDaily: 10`（回复总量/天）
  - `listen.oncePerPerson: true`（同一人每天最多 1 条）
  - `listen.dmScope: "owner"`（私信只叫醒主人）
  - `dynamics` / `share` 不在这条线里，保持原设置。
- **时间准确性**：prompt 用上游注入，发送前保留 `time-guard`；细节在 `docs/cases/2026-11-02-time-accuracy.md`。

## 常用命令

```bash
npm run test:audit                              # 全量回归
npm run test:regressions                        # 关键回归
node scripts/release-manifest.mjs --verify-ref HEAD
node scripts/setup-dsh.mjs nas                  # 重新注册到 DSH
node scripts/sync-upstream.mjs --dry-run        # 只看上游有没有新东西
```

- 诊断页：DSH → 设置 → SurfCore → 诊断
- 审计：`tail -f state/bili-manual-log.jsonl`
- 上游同步：`npm run sync:upstream`；默认走 `fork/linux`，不碰 `upstream` 的 push 地址

## 文档

- 部署与运维：`docs/guides/INSTALL.md`
- 架构：`docs/guides/ARCHITECTURE.md`
- B站 子系统：`docs/guides/SUBSYSTEM-BILI.md`
- 踩坑记录：`docs/PITFALLS.md`
- 改动案例：`docs/cases/README.md`
- Linux 适配案例：`docs/cases/2026-11-01-linux-adaptation.md`

## 安全与边界

- QQ B站 工具只允许**主人私聊**；群聊和其他人一律拒绝。
- B站 发布走额度闸 + 出站身份闸，不泄露 QQ 号 / B站 mid；手动操作有日上限和审计。
- AI 发语音默认关闭（`socialV2.voice.enabled=false`）；`qq_send_voice` / `qq_list_voices` 只有启用后才可用。
- 不含桌宠 / Electron 组件；不代扫码、不代替用户登录。
- 公网访问（Lucky 反代 + `SURFCORE_TRUSTED_HOSTS`）仓库提供精确 Host 匹配支持，默认不启用；具体值放在部署环境里，不写进仓库。

## 仓库规则

- 这是 `LIMEBITTER` 的独立 fork；**只在本仓库提 Issue/PR，不向上游 `Mieksido/surfcore` 提交任何 Issue 或 PR**。
- 上游只读：`git push upstream` 已禁用；同步上游用 `scripts/sync-upstream.mjs` 手动执行。
- 版本号后缀 `-linux`；发版按 `docs/RELEASE.md` 处理。

## 许可

MIT，保留上游版权声明。上游：[Mieksido/surfcore](https://github.com/Mieksido/surfcore)。

如果这个分支帮你少踩了一个坑，那就够了。
