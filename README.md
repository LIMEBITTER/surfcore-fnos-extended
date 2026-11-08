# SurfCore · fnOS Extended

在 [DSH（DeepSeek Harness）](https://github.com/deepseek-ai/dsh) 上运行的 QQ / B站 agent 插件。本仓库是 [Mieksido/surfcore](https://github.com/Mieksido/surfcore) 的 Linux / fnOS 分支：保留人格、记忆、QQ 桥接和 B站 能力，替换掉只在 Windows 成立的启动、浏览器、路径和权限逻辑。

> 分支固定为 `linux`；更新只跟正式 Release，没有 dev 测试通道。

| 项 | 值 |
| --- | --- |
| 版本 | `0.8.9.1-linux`（见 `plugins/surfcore/package.json`） |
| DSH | 实机验证 `0.2.2-rc.1`；兼容基线 `0.2.1-rc.5` |
| Node | ≥ 22.13 |
| 平台 | Linux x64 / fnOS |
| 许可 | MIT；SnowLuma 为第三方专有运行时，不随本仓库分发 |

## 1. 它是什么

SurfCore 是 DSH 的一个 profile bundle，不是独立服务。DSH 启动后加载插件，插件再拉起 QQ 桥接、注册 MCP server，并在 DSH Web 里挂一个控制台页面。

```
QQ 用户
  │
  ▼
SnowLuma（Docker，Linux QQ + OneBot）
  │  HTTP :3000 / WebSocket :3001
  ▼
src/bridge.js（唤醒、预设、额度、B站 工具）
  │  DSH Web API
  ▼
DSH（profile 由你安装时指定）  Web UI :3080
  └─ 控制台 API :3100
```

桥接由插件自己拉起，**不要**再手工 `npm start` 一份；重复启动只会抢锁和端口。

## 2. 前置条件

| 依赖 | 说明 |
| --- | --- |
| Node ≥ 22.13 | 与运行 DSH 的用户一致，不要用 root 装 |
| DSH + profile | `dsh --profile <name> --dump-config` 能跑通 |
| pnpm | `dsh plugin install` 需要；缺了通常是退出码 127 |
| SnowLuma | Docker 镜像 `motricseven7/snowluma:latest`，需自行登录 QQ |
| Chromium/Chrome | 只有 B站 扫码登录需要，可用 `SURFCORE_BROWSER` 指定 |

## 3. 安装

### 3.1 一键

```bash
curl -fsSL https://raw.githubusercontent.com/LIMEBITTER/surfcore-fnos-extended/linux/scripts/bootstrap.sh -o /tmp/surfcore-bootstrap.sh
bash /tmp/surfcore-bootstrap.sh --check   # 只体检
bash /tmp/surfcore-bootstrap.sh           # 安装
```

脚本会检查 Node、DSH profile、git 和常用端口，克隆 `linux` 分支到 `~/surfcore`（可用 `SURFCORE_DIR` 覆盖），执行 `npm install`，再调用 `setup-dsh.mjs` 注册 bundle / preset / MCP。它不会自动重启 DSH。

### 3.2 手动

```bash
git clone --branch linux https://github.com/LIMEBITTER/surfcore-fnos-extended.git ~/surfcore
cd ~/surfcore
npm install
node scripts/detect-profile.mjs
node scripts/setup-dsh.mjs <profile>
```

`setup-dsh.mjs` 失败会回滚 profile 改动；把原始错误贴出来，不要连续重试。

### 3.3 SnowLuma

用 Docker 启动 SnowLuma，把 OneBot HTTP / WebSocket 和 WebUI 只发布到回环地址（或你的内网地址），并把 `data/` 挂出来：

- WebUI：`http://<host>:5099`
- OneBot HTTP：`127.0.0.1:3000`
- OneBot WebSocket：`127.0.0.1:3001`

首次启动后在 WebUI 里登录 QQ。SnowLuma 的 `data/config/onebot_<uin>.json` 里保存 OneBot token，SurfCore 会从 `snowluma.homeDir` 读取它。

## 4. 配置

运行时配置是仓库根目录的 `config.json`（仓库只提供 `config.example.json`，**不要整体覆盖用户数据**）。

| 键 | 作用 |
| --- | --- |
| `dsh.baseUrl` | DSH Web API，默认 `http://127.0.0.1:3080` |
| `snowluma.wsUrl` / `httpUrl` | OneBot 端点；容器部署写 `127.0.0.1`，不要写 `0.0.0.0` |
| `snowluma.homeDir` | SnowLuma 数据目录，桥接靠它找 OneBot token |
| `snowluma.followDiscoveredEndpoint` | 容器部署建议 `false`，避免把 `0.0.0.0` 写回配置 |
| `ownerQQ` / `allow.*` | 谁可以使用；`allow.groups` 留空表示不接群聊 |
| `consolePort` / `consoleToken` | 控制台；token 留空会自动生成到 `state/console-token` |
| `biliBridge.manual.enabled` | QQ 里能否手动使用 B站 工具，默认关 |

常用环境变量：

| 变量 | 用途 |
| --- | --- |
| `SURFCORE_BROWSER` | 扫码登录用的浏览器绝对路径 |
| `SURFCORE_TRUSTED_HOSTS` | 控制台额外合法 Host，逗号分隔，精确匹配 |
| `SNOWLUMA_HOME` | 覆盖 SnowLuma 目录 |
| `DSH_HOME` / `DSH_PROFILE` | DSH 目录与 profile 名 |

敏感文件统一收紧权限：

```bash
npm run harden-acl
```

## 5. 启动与验证

装好后重启 DSH，让插件重新加载。然后：

```bash
# DSH 本机 Web（通常需要一次性 token 换 Cookie）
curl -I http://127.0.0.1:3080/

# 控制台 API（token 在 state/console-token）
TOKEN=$(cat state/console-token)
curl -s -H "x-console-token: $TOKEN" http://127.0.0.1:3100/api/status

# 健康检查与测试
node scripts/self-test.js
cd plugins/surfcore && npm test
```

正常状态：

- DSH Web 能打开；侧栏的 Plugins / 设置里能看到 SurfCore。
- `:3100/api/status` 返回 `dshReady=true`、`snowluma.connected=true`、`accountOnline=true`、`good=true`。
- SnowLuma WebUI 能打开，QQ 已登录，OneBot `:3000/3001` 在听。
- 桥接进程存在，日志里能看到 `SnowLuma 已连接`。

## 6. 数据与日志

| 内容 | 路径 |
| --- | --- |
| 插件配置 | `~/surfcore/config.json`（600） |
| 控制台 token | `~/surfcore/state/console-token` |
| B站 配置 / 凭据 | `$DSH_HOME/surfcore/bili.config.json`、`$DSH_HOME/surfcore/bili/credentials.json` |
| 角色 / 人格 / 记忆 / 账本 | `$DSH_HOME/surfcore/characters/<角色ID>/` |
| 桥接日志 | `~/surfcore/state/bridge.log` |

仓库不含真实账号、群号、Cookie 或记忆数据；运行时数据只在本机。

## 7. B站 与生物钟

- B站 扫码登录、观看历史、动态、评论/私信监听、手动工具都在设置页的 B站 区域。
- 作息窗口支持按天配置：每个窗口可选「每天 / 工作日 / 周末」，也可以单独勾选星期；跨午夜窗口按开始日归属。
- 当前默认窗口按 DeepSeek 谷价时段安排：工作日 18:30–24:00，周末 08:00–24:00（00:00–01:00 单独一段）。峰价时段（工作日 09:00–12:00、14:00–18:00）不会主动唤醒。
- 每日唤醒总上限由 `night.maxWakesPerDay` 控制：0 表示当天不醒，上限 12。

## 8. 语音

SurfCore 提供两个 MCP 语音工具：`qq_send_voice`（把文本合成为语音并发送到当前 QQ 会话）与 `qq_list_voices`（列出可用音色）。两者都受 `sendVoice` 开关控制，未开启时不会暴露给模型。

**AI 发语音默认关闭**。需要本机已有可用的 TTS/voice-tool 依赖，并按 `docs/guides/` 的语音说明配置；没有配置时不要开启，否则只会得到失败提示。

## 9. 更新

- 只跟正式 Release；设置页不再提供 dev 测试通道。
- 版本号以根 `package.json` 为准，插件 `package.json` 必须一致。
- 源码安装可以直接 `git pull --ff-only origin linux` 后重启 DSH；zip 安装用设置页的「检查更新」。
- 更新完成后需要**完全退出 DSH 再打开**，只刷新页面不会应用。

## 10. 常见问题

| 症状 | 处理 |
| --- | --- |
| 控制台 403「只接受本机回环访问」 | 设置 `SURFCORE_TRUSTED_HOSTS=<host:port>` 后重启 DSH |
| `dsh plugin ... 退出码 127` / `spawn pnpm ENOENT` | 安装 pnpm 后重跑 `setup-dsh.mjs` |
| `Cannot find module '@deepseek-ai/schemastery'` | 先 `npm install`，再 `setup-dsh`，最后重启 |
| SnowLuma `code=1006` / 连不上 | 检查 `snowluma.homeDir`、OneBot token、`:3000/:3001` 是否只绑回环 |
| B站 扫码找不到浏览器 | 安装 Chromium，或设置 `SURFCORE_BROWSER` |
| 设置页按钮没有提示 | 0.8.9.1 起统一自动 toast；仍有问题请附 `state/bridge.log` 和浏览器控制台 |

## 11. 开发

```bash
# 分支固定为 linux
git checkout linux

# 改控制台/插件后
cd plugins/surfcore && npm test
cd ../.. && npm run test:audit

# 版本一致性
npm run test:version
```

- 不向上游 `Mieksido/surfcore` 提交 Issue / PR；`upstream` 只读。
- 提交信息用 `feat(scope): …` / `fix(scope): …` / `docs: …`。
- 发布流程见 `docs/RELEASE.md`；当前只发正式 Release。

## 12. 更多文档

- Agent 部署 runbook：[`README.DSH.md`](README.DSH.md)
- 安装与运维：`docs/guides/INSTALL.md`
- 架构与 B站 子系统：`docs/guides/ARCHITECTURE.md`、`docs/guides/SUBSYSTEM-BILI.md`
- 踩坑记录：`docs/PITFALLS.md`；变更案例：`docs/cases/`

## 13. 许可

MIT，保留上游版权声明。上游：[Mieksido/surfcore](https://github.com/Mieksido/surfcore)。
