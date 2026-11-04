# SurfCore · fnOS Extended

> 给 DSH agent 一个能长期相处的身份：**QQ × B站 × 记忆 × 作息**，为 Linux / 飞牛 OS 而改。

这是 [Mieksido/surfcore](https://github.com/Mieksido/surfcore) 的 Linux 分支，独立维护，不向上游回流。

上游负责“人格/记忆/QQ 桥接”的通用能力；这个仓库负责让它在 **飞牛 OS** 上真正跑起来，并把 B站 接进 QQ 私聊。

本分支仓库仅为自用，紧跟上游仓库commit，如有问题，请向**上游仓库**提交issue。

| 项 | 值 |
| --- | --- |
| 版本 | `0.8.8-linux` |
| 目标 DSH | `0.2.1-rc.5`（rc.5 已实测；`npm run verify:adaptation` 可逐项复核） |
| 平台 | Linux / 飞牛 OS（Windows 兼容层已移除） |
| 许可 | MIT（SnowLuma 是第三方专有运行时，**不随本仓库分发**） |
| 配套仓库 | [surfvoicelocal](https://github.com/Mieksido/surfvoicelocal) · [surfvoicecloud](https://github.com/Mieksido/surfvoicecloud) · [surfpet](https://github.com/Mieksido/surfpet) |

## 这个分支改了什么

### Linux 适配

- **扫码登录**：自动发现 `chromium / chrome / edge / brave / snap`，支持 `SURFCORE_BROWSER` 指定；`--headless=new` 失败回退 `--headless`；浏览器按进程组退出，不留孤儿。
- **打开链接**：只用 `xdg-open`（NAS 无桌面时静默失败，不崩进程）。
- **语音包**：安装用 `tar` + `chmod`；启动/停止在 Linux 返回 `PLATFORM_UNSUPPORTED` + 手动 `python -m voxd` 命令。
- **更新**：解压用 `unzip`，应用更新用递归复制（不再依赖 PowerShell / robocopy）。
- **Windows 兼容层已移除**：本仓库不保证 Windows 可用。

### B站 × QQ

QQ 私聊可直接让 agent 操作 B站（仅主人私聊，复用四本账额度、出站身份闸与审计）：

| 工具 | 能力 |
| --- | --- |
| `qq_bili_search` | 搜视频 |
| `qq_bili_video` | 视频详情 / 字幕 |
| `qq_bili_feed` | 按偏好选题 |
| `qq_bili_like` | 点赞 |
| `qq_bili_post` | 发动态 / 发评论（`dryRun` 可预览） |

设置页 → B站 → **「QQ 手动工具（B站）」**：总开关、工具说明、最近操作记录。
评论会先把 BV 解析成 `aid(oid)` 再提交；失败返回结构化错误，不把 CLI usage 直接甩给用户。

### 稳定性修复

- 诊断误报：SnowLuma 在线状态用桥接实时值；控制台令牌读 `state/console-token`；身份对齐表改为可选。
- 动态发布：`--dry` 之前先过身份闸；发布成功后写四本账。
- 评论：BV 号保留大小写 + 补 `--oid`，修复 `usage: --oid` 与 `-404`。

### 时间与可靠性

- 时钟注入在 prompt **末尾**（一行 `【钟】…`），避免每条消息的时间变化破坏前面静态 prompt 的缓存；
- 有“几点/多久/还有/睡/今天/明天”等意图时，才追加“距下一个整点/半点”和写前检查（省 token）；
- 发送前本地 `time-guard`：识别“还有 X 分钟到 H 点半”“现在 HH:MM”等表达，用服务器时间重算；
  错的就地改写，历史/计划句跳过，校验异常 fail-open，不阻断消息；
- 不做时间工具/二次模型/自动重试：零额外模型调用、零网络，适合高可用。

## 功能一览

- QQ 群 / 私聊桥接（SnowLuma OneBot HTTP 3000 / WS 3001）
- 人格分层、衰减 / 全量记忆卡、对话收尾、主动搭话、多角色
- B站 生物钟、直播间监看、视频/动态/评论工具链
- MCP 工具、Agent Preset、设置页、Token 统计、管理控制台
- QQ 与 B站 身份对齐（可选）

## 架构

```text
QQ ── SnowLuma(OneBot) ── bridge(3100) ── DSH plugin / MCP
                              │
                              ├── B站 CLI (tools/bili.mjs)
                              └── state/ (审计、额度、控制台令牌)

DSH ── ~/.dsh/surfcore/ (角色、记忆、B站配置、账本)
```

## 在飞牛 OS 上部署

前置：Node ≥ 22.13、DSH 可打开 Web GUI、SnowLuma 已用 Docker 跑起来、安装 Chromium（扫码登录用）。

```bash
git clone https://github.com/LIMEBITTER/surfcore-fnos-extended.git ~/surfcore
cd ~/surfcore

npm install
node scripts/setup-dsh.mjs nas       # 或你的 DSH profile 名
sudo systemctl restart dsh
```

然后：DSH → 设置 → **SurfCore** → 诊断 → 一键安装。

```bash
sudo apt install chromium            # B站 扫码登录前置
```

> 顺序很重要：先 `npm install`，再 `setup-dsh`，最后重启；否则会报 `Cannot find module '@deepseek-ai/schemastery'`。

## 配置与数据

| 内容 | 路径 |
| --- | --- |
| 插件运行配置 | `~/surfcore/config.json`（600，本机） |
| B站 配置 | `~/.dsh/surfcore/bili.config.json` |
| 角色 / 人格 / 记忆 / B站 账本 | `~/.dsh/surfcore/characters/<角色ID>/` |
| B站 手动操作审计 | `~/surfcore/state/bili-manual-log.jsonl` |
| 角色卡示例 | `roles/`（脱敏） |

常用环境变量：

- `SURFCORE_BROWSER`：指定扫码用浏览器可执行文件
- `SURFCORE_TRUSTED_HOSTS`：公网反代 Host 白名单（部署侧需要，默认代码不含）
- `SURFCORE_SKIP_AUTOSTART=1`：跳过自动打开浏览器

本仓库**不含任何真实账号、群号、Cookie 或记忆数据**；运行时数据只在本机。

## 成本与限额

> 以下是**本机部署配置**，不属于仓库默认值；换机器或重装 DSH 后要重新设置。

- **DSH 自动压缩**：`/home/baiyu/.dsh/profiles/nas/cordis.patch.yml`
  ```yaml
  - id: compaction-basic
    config:
      thresholdRatio: 0.35   # 约 36.7 万触发（窗口 1,048,576）
      retainRatio: 0.1       # 保留约 10.5 万
  ```
  - QQ 会话约 20 万，低于阈值，**不会被压缩**；
  - B站 长会话（34–58 万）会触发压缩，降低后台 token 成本；
  - 改动前备份：`/home/baiyu/surfcore-patches/cordis.patch.yml.bak-*`。
- **B站 回复限额**：`~/.dsh/surfcore/bili.config.json`
  - `limits.replyDaily: 10`（回复总量/天）
  - `listen.oncePerPerson: true`（同一人每天最多 1 条）
  - `listen.dmScope: "owner"`（私信只叫醒主人）
  - `dynamics` / `share` 不在此列，保持原设置。
- **时间准确性**：时钟在 prompt 末尾注入，发送前有本地 `time-guard`；见 `docs/cases/2026-11-02-time-accuracy.md`。

## 常用检查

```bash
npm run test:audit                              # 全量回归（当前 110/110）
node scripts/release-manifest.mjs --verify-ref HEAD
node scripts/setup-dsh.mjs nas                 # 重新注册到 DSH
```

- 诊断页：DSH → 设置 → SurfCore → 诊断
- QQ B站 开关：设置 → SurfCore → B站 → 「QQ 手动工具（B站）」
- 审计：`tail -f state/bili-manual-log.jsonl`

## 文档

- 部署与运维：`docs/guides/INSTALL.md`
- 架构：`docs/guides/ARCHITECTURE.md`
- B站 子系统：`docs/guides/SUBSYSTEM-BILI.md`
- 踩坑记录：`docs/PITFALLS.md`
- 改动案例：`docs/cases/README.md`
- Linux 适配案例：`docs/cases/2026-11-01-linux-adaptation.md`

## 安全与边界

- QQ B站 工具只允许**主人私聊**；群聊/其他人一律拒绝。
- B站 发布走额度闸 + 出站身份闸（不泄露 QQ 号 / B站 mid），手动操作有日上限与审计。
- AI 发语音默认关闭（`socialV2.voice.enabled=false`）；语音工具 `qq_send_voice` / `qq_list_voices` 仅在启用后可用。
- 不包含桌宠 / Electron 组件；不代扫码、不代替用户登录。
- 公网访问（Lucky 反代 + `SURFCORE_TRUSTED_HOSTS`）属于部署侧补丁，不在仓库默认代码里。

## 仓库规则

- 这是 `LIMEBITTER` 的独立 fork；**只在本仓库提 Issue/PR，不向上游 `Mieksido/surfcore` 提交任何 Issue 或 PR**。
- 上游只读：`git push upstream` 已禁用；同步上游用 `scripts/sync-upstream.mjs` 手动执行。
- 版本号后缀 `-linux`；发版由维护者按 `docs/RELEASE.md` 处理。

## 许可

MIT，保留上游版权声明。上游：[Mieksido/surfcore](https://github.com/Mieksido/surfcore)。
