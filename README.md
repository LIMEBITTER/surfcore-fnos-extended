# SurfCore Linux（飞牛 OS 分支）

> 给 DSH agent 一个真实身份：**QQ × B站 × 记忆 × 作息**，专为 Linux / 飞牛 OS 适配。

本仓库是 [Mieksido/surfcore](https://github.com/Mieksido/surfcore) 的 **Linux-only fork**，已脱离 fork 网络、独立维护；上游只读，不回流。
本分支在保留 SurfCore 全部非桌宠能力的基础上，补齐了 Linux 运行所需的适配，并把 QQ 与 B站 的日常操作接进 QQ 私聊。

| 项 | 值 |
| --- | --- |
| 版本 | `0.8.4-linux` |
| 平台 | **Linux x86_64**（飞牛 OS / Debian 12 实测） |
| DSH | `0.2.1-rc.2+`（rc.5 实测） |
| Node | `>= 22.13` |
| SnowLuma | 第三方，Docker 部署（实测 2.2.1） |
| 许可 | MIT（SnowLuma 为第三方专有运行时，不随本仓库分发） |
| 上游 | [Mieksido/surfcore](https://github.com/Mieksido/surfcore) |

## 这个分支有什么

- **Linux 单平台**：不再保留 Windows 兼容层（`cmd` / PowerShell / robocopy / `.bat` 启动逻辑已移除或按 Linux 重写）。
- **B站 扫码登录可在 Linux 用**：自动找本机 `chromium / chrome / edge / brave`（也支持 `SURFCORE_BROWSER` 指定），headless 取二维码，不需要 Edge。
- **QQ 私聊可直接操作 B站**（`qq_bili_*` 工具，仅主人私聊）：
  - `qq_bili_search` 搜视频、`qq_bili_video` 看详情、`qq_bili_feed` 按偏好选题
  - `qq_bili_like` 点赞
  - `qq_bili_post` 发动态 / 发评论（默认直接发布，`dryRun` 可预览）
  - 发布复用 SurfCore 的四本账额度、出站身份闸与审计（`state/bili-manual-log.jsonl`）
- **语音/更新适配 Linux**：语音包启动/停止在 Linux 给出结构化提示（手动 `python -m voxd`）；更新解压用 `unzip`、应用更新用递归复制。
- **设置页新增「QQ 手动工具（B站）」卡片**：总开关、工具说明、最近操作记录。
- 其余能力与上游一致：QQ 群/私聊桥接、人格分层、衰减/全量记忆卡、主动搭话、对话收尾、多角色、Token 统计、MCP、Agent Preset、管理控制台。

> 上游的功能介绍、架构与完整文档见：[Mieksido/surfcore README](https://github.com/Mieksido/surfcore#readme) 与 [`docs/guides/`](docs/guides/)。

## 在飞牛 OS 上部署

前置：Node ≥ 22.13、DSH 已安装并能打开 Web GUI、SnowLuma 用 Docker 跑起来（OneBot 3000/3001）、Chromium（扫码登录用）。

```bash
# 1. 拉仓库
git clone https://github.com/LIMEBITTER/surfcore-linux.git ~/surfcore
cd ~/surfcore

# 2. 装依赖（必须先装依赖，再用 setup 注册进 DSH）
npm install

# 3. 注册 bundle / MCP / preset
node scripts/setup-dsh.mjs nas     # 或你的 DSH profile 名

# 4. 重启 DSH
sudo systemctl restart dsh
```

之后：DSH → 设置 → **SurfCore** → 诊断 → 一键安装；B站 扫码登录前先装 Chromium：

```bash
sudo apt install chromium
```

> 如果你让 DSH 自己装：务必按「`npm install` → `setup-dsh` → 重启」的顺序，否则会报 `Cannot find module '@deepseek-ai/schemastery'`。

## 配置与数据

| 内容 | 路径 |
| --- | --- |
| 插件运行配置 | `~/surfcore/config.json`（600，本机） |
| B站 配置 | `~/.dsh/surfcore/bili.config.json` |
| 角色 / 人格 / 记忆 / B站 账本 | `~/.dsh/surfcore/characters/<角色ID>/` |
| QQ 手动 B站 操作审计 | `~/surfcore/state/bili-manual-log.jsonl` |
| 角色卡示例 | `roles/`（脱敏） |

本仓库**不含任何真实账号、群号、Cookie 或记忆数据**；运行时数据只在本机。

## 常用检查

```bash
npm run test:audit                 # 全量回归（当前 108/108）
node scripts/release-manifest.mjs --verify-ref HEAD
node scripts/setup-dsh.mjs nas     # 重新注册到 DSH
```

诊断页：DSH → 设置 → SurfCore → 诊断；B站 工具总开关：设置 → SurfCore → B站 → **QQ 手动工具（B站）**。

## 文档

- [部署与运维](docs/guides/INSTALL.md)、[架构](docs/guides/ARCHITECTURE.md)、[B站 子系统](docs/guides/SUBSYSTEM-BILI.md)
- [踩坑记录](docs/PITFALLS.md)、[改动案例](docs/cases/README.md)
- Linux 适配案例：[2026-11-01-linux-adaptation](docs/cases/2026-11-01-linux-adaptation.md)

## 安全与边界

- QQ 工具只允许**主人私聊**使用；群聊/其他人一律拒绝。
- B站 发布走原有额度闸 + 出站身份闸（不泄露 QQ 号 / B站 mid），手动操作有日上限与审计。
- 不包含桌宠/Electron 组件；不代扫码、不代替用户登录。
- AI 发语音默认关闭（`socialV2.voice.enabled=false`）；语音工具 `qq_send_voice` / `qq_list_voices` 仅在启用后可用，Linux 下语音包需手动启动，见 `docs/VOICE-PACKS.md`。
- 本机公网访问（Lucky 反代 + `SURFCORE_TRUSTED_HOSTS`）属于**部署侧补丁**，不在仓库默认代码里。

## 上游与许可

- 上游：[Mieksido/surfcore](https://github.com/Mieksido/surfcore)（MIT）
- 本仓库：Linux 适配与 QQ↔B站 工具改动；同样以 MIT 发布，保留上游版权声明。
