# SurfCore · fnOS Extended

DSH（DeepSeek Harness）上的 QQ / B站 agent 插件。本仓库是 [Mieksido/surfcore](https://github.com/Mieksido/surfcore) 的 `linux` 分支：保留上游的人格、记忆、QQ 桥接与 B站 能力，只替换掉「只能在 Windows 成立」的那部分，并把飞牛 OS（fnOS）上的部署经验固化成脚本与文档。

上游文档仍然有效；这里只写本分支的差异、部署方式和踩过的坑。

| 项 | 值 |
| --- | --- |
| 版本 | `0.8.9-linux`（见 `plugins/surfcore/package.json`） |
| DSH | 实机验证 `0.2.2-rc.1`；兼容基线 `0.2.1-rc.5` |
| Node | ≥ 22.13（`engines.node`） |
| 平台 | Linux x64 / fnOS；Windows 不是本分支目标平台 |
| 许可 | MIT（SnowLuma 为第三方专有运行时，不随本仓库分发） |
| 配套 | [surfvoicelocal](https://github.com/Mieksido/surfvoicelocal) · [surfvoicecloud](https://github.com/Mieksido/surfvoicecloud) · [surfpet](https://github.com/Mieksido/surfpet) |

---

## 1. 它由哪些进程组成

`surfcore` 不是一个独立服务，而是一个 **DSH profile bundle**：DSH 启动时加载它，它再拉起桥接进程、注册 MCP server、挂一个控制台页面。

```
QQ 用户
  │  QQ 协议
  ▼
SnowLuma（容器，注入 Linux QQ NT）      WebUI :5099   noVNC :6081
  │  OneBot v11：HTTP :3000 / WS :3001（容器内监听 0.0.0.0，宿主只发布到 127.0.0.1）
  ▼
src/bridge.js（QQ 桥接：唤醒、预设、额度、时间校验、B站 工具）
  │  DSH Web API（会话 / 模型 / 事件）
  ▼
DSH（profile `feiyu`）  Web UI :3080
  ├─ MCP server：mcp-snowluma-safe / mcp-snowluma-host / mcp-web-search-safe（stdio 子进程）
  └─ 控制台 API  :3100（console-token 鉴权）
```

三个要点：

1. **桥接进程由 DSH 插件自己拉起**（`plugins/surfcore/lib/bridge.js` 里 `spawn(node, ['src/bridge.js'], { detached: true })`）。不需要手工 `npm start`；外部再起一份只会抢 `state/bridge.lock` 和 3100 端口。
2. **SnowLuma 必须在容器内监听 `0.0.0.0`**，因为宿主 `127.0.0.1:3000/3001` 是 docker-proxy 转发到容器网段的。宿主机只发布到回环，隔离由端口映射完成。
3. **QQ 侧的工具面被收窄**：`plugins/surfcore/qq-tool-restrict.mjs` 用「前缀白名单 + 精确名单」限制 QQ 会话能调用的工具，只有 `mcp__snowluma__*` / `mcp__snowluma-host__*` / `mcp__web-search-safe__*` 和少数内置工具可用。

---

## 2. 前置条件

| 依赖 | 说明 |
| --- | --- |
| Node ≥ 22.13 | 用户级安装即可，不需要 root |
| DSH + 一个 profile | `dsh --profile <name> --dump-config` 能跑通 |
| pnpm | `dsh plugin --profile <name> install` 需要它，缺了会 `退出码 127` |
| SnowLuma | 官方 Docker 镜像 `motricseven7/snowluma:latest`（含 Linux QQ + Xvfb + noVNC） |
| Chromium/Chrome | 仅 B站 扫码登录需要；可用 `SURFCORE_BROWSER` 指定绝对路径 |

---

## 3. 安装

### 3.1 一键

```bash
curl -fsSL https://raw.githubusercontent.com/LIMEBITTER/surfcore-fnos-extended/linux/scripts/bootstrap.sh -o /tmp/surfcore-bootstrap.sh
bash /tmp/surfcore-bootstrap.sh --check    # 只体检，不装
bash /tmp/surfcore-bootstrap.sh            # 真装
```

脚本按顺序做五件事：检查 Node / `$DSH_HOME/profiles` / git / 3000、3001 端口 → `git clone --branch linux` 到 `~/surfcore`（可用 `SURFCORE_DIR` 覆盖）→ `npm install`（顺带跑 `patch-snowluma-sdk.mjs`）→ `node scripts/setup-dsh.mjs <profile>` → 生成 `config.json`（已存在则不动）。

它**不会重启 DSH**，重启留给你。

### 3.2 手动

```bash
git clone --branch linux https://github.com/LIMEBITTER/surfcore-fnos-extended.git ~/surfcore
cd ~/surfcore

npm install
node scripts/detect-profile.mjs          # 拿 profile 名
node scripts/setup-dsh.mjs <profile>     # 注册 bundle / preset / MCP，并跑 dsh plugin install
```

顺序不能反：**先 `npm install`，再 `setup-dsh`，最后重启 DSH**。反过来容易报 `Cannot find module '@deepseek-ai/schemastery'`。

`setup-dsh.mjs` 会写这些地方：

- `<profile>/package.json`：`dsh.profile.bundles` 追加 `surfcore`，`dependencies` 加 `link:` 
- `<profile>/cordis.patch.yml`：写入 3 条 MCP（带 `# === qq-bridge MCP BEGIN/END ===` 标记，可重复执行）
- `$DSH_HOME/plugins/surfcore`：指向本仓库 `plugins/surfcore` 的软链

---

## 4. 配置

运行时配置是 `config.json`（仓库只给 `config.example.json`，**不要整体覆盖**用户数据）。

| 键 | 作用 | 备注 |
| --- | --- | --- |
| `dsh.baseUrl` | DSH Web API 地址 | 默认 `http://127.0.0.1:3080` |
| `snowluma.wsUrl` / `httpUrl` | OneBot 端点 | 容器部署写 `127.0.0.1`，不要写 `0.0.0.0` |
| `snowluma.homeDir` | SnowLuma 数据目录 | Docker 部署指向挂出来的 `data/`，桥接靠它找 `config/onebot_<uin>.json` 的 token |
| `snowluma.followDiscoveredEndpoint` | 是否跟随发现到的端点 | 容器部署建议 `false`，否则会把 `ws://0.0.0.0:3001` 写回配置 |
| `ownerQQ` / `allow.private` / `allow.groups` | 谁能用 | `allow.groups` 留空 = 不接群聊；`allowAllWhenEmpty` 保持 `false` |
| `consolePort` / `consoleToken` | 控制台 | token 留空则自动生成到 `state/console-token` |
| `biliBridge.manual.enabled` | QQ 里手动用 B站 工具 | 默认关；关着一律 403 |
| `chat.proactive.enabled` / `social.proactiveEnabled` | 主动搭话 | 默认建议关 |
| `purpose.enabled` | 主动找话题引擎 | 默认关 |

环境变量：

| 变量 | 用途 |
| --- | --- |
| `SURFCORE_BROWSER` | 扫码登录用的浏览器绝对路径 |
| `SURFCORE_TRUSTED_HOSTS` | 控制台 API 的额外合法 Host（逗号分隔，含端口，精确匹配） |
| `SNOWLUMA_HOME` | 覆盖 SnowLuma 目录（等价于 `snowluma.homeDir`，双保险） |
| `DSH_HOME` / `DSH_PROFILE` | DSH 目录与 profile 名 |
| `DSH_INSTALL_MODULES` | 校验脚本用的 DSH 依赖目录 |

敏感文件统一收紧到 600（`config.json`、`state/console-token`、SnowLuma 的 `onebot_*.json`、B站 凭据）：

```bash
npm run harden-acl      # 幂等，Windows 走 icacls，Linux 走 chmod
```

---

## 5. Linux 上具体改了什么

| 能力 | 上游（Windows） | 本分支（Linux） |
| --- | --- | --- |
| 启动 / 重启 / 停止 | `start.bat` / `restart.bat` / PowerShell | `start.sh`（带崩溃重启循环）、`restart.sh`（防双实例）、`stop-qq-bot.sh [--all]` |
| 扫码浏览器 | `chrome.exe` 固定路径 | 依次探测 `chromium` / `chromium-browser` / `chrome` / `edge` / `brave` / `/snap/bin/chromium`，可用 `SURFCORE_BROWSER` 覆盖 |
| 打开链接 | `start` / `rundll32` | `xdg-open`，**先查存在性再 spawn**，并对子进程挂 `error` 监听（否则 ENOENT 会带走桥接进程） |
| 端口 / 进程发现 | `netstat -ano` + `tasklist` | `ss -ltnp` → `netstat -ltnp` → `netstat -ltn`；进程名读 `/proc/<pid>/comm` 与 `/proc/<pid>/cmdline` |
| Node 发现 | `C:\Program Files\nodejs\node.exe` | `PATH` → `/usr/bin` → `/usr/local/bin` → `~/.local/{bin,node/bin}` → `~/.nvm/current/bin` |
| 文件权限 | `icacls` | `chmod 700/600`，失败降级并打印手动命令 |
| 更新落地 | PowerShell + robocopy | `unzip` + 递归复制 |
| 语音包 | Windows venv + `.bat` | 安装用 `tar` + `chmod`；启停在 Linux 明确返回 `PLATFORM_UNSUPPORTED` 并给手动命令 |
| 行尾 | — | `.gitattributes` 固定 `*.sh eol=lf` / `*.bat|cmd|ps1 eol=crlf` |

控制台样式有一条约定的规则：**主题色板必须挂在 `body` 上**。DSH 的 `--dsw-alias-*` 定义在 `body` / `body[data-ds-dark-theme]`，写在 `:root` 里会取不到值、退回硬编码浅色（深色主题下就是白底深字）。`scripts/test-console-theme.mjs` 会把这条钉死。

---

## 6. 运维

| 项 | 值 |
| --- | --- |
| DSH Web UI | `127.0.0.1:3080`（需要一次性 token 链接换 Cookie） |
| 控制台 API | `127.0.0.1:3100`（`x-console-token`） |
| SnowLuma WebUI / noVNC | `:5099` / `:6081` |
| OneBot | `127.0.0.1:3000`（HTTP）/ `127.0.0.1:3001`（WS） |
| 桥接日志 | `state/bridge.log` |
| 手动操作审计 | `state/bili-manual-log.jsonl` |
| 状态接口 | `GET /api/status`（控制台 token） |

```bash
./start.sh                 # 前台监护（崩了 5 秒后重启，退出码 2 = 已有实例）
./restart.sh               # 先停干净再拉起，残留则中止
./stop-qq-bot.sh --all     # 停桥接 + 顺带停 SnowLuma

npm run verify:adaptation  # 与 DSH 版本逐项对表
node scripts/test-linux-adaptation.mjs
node scripts/test-console-theme.mjs
cd plugins/surfcore && npm test
```

`npm run verify:adaptation` 里那 6 项红字是**仓库侧漂移**，不影响功能：preset suffix 少了 `{{cwd}}`（DSH 0.2.1-rc.2 之后不再注册该变量）、守卫名单里含 DSH 已改名的工具、3 个 MCP 的 `serverInfo.version` 还写着 `0.2.0-r4`。

---

## 7. 数据都在哪

| 内容 | 路径 |
| --- | --- |
| 插件运行配置 | `~/surfcore/config.json`（600） |
| 控制台 token | `~/surfcore/state/console-token` |
| B站 配置 / 凭据 | `~/.dsh/surfcore/bili.config.json`、`~/.dsh/surfcore/bili/credentials.json`（600） |
| 角色 / 人格 / 记忆 / 账本 | `~/.dsh/surfcore/characters/<角色ID>/` |
| 角色卡示例 | `roles/`（脱敏） |

仓库**不含**真实账号、群号、Cookie 或记忆数据；运行时数据只在本机。

---

## 8. B站 × QQ

入口：DSH → 设置 → SurfCore → B站 → 「QQ 手动工具（B站）」。总开关 `biliBridge.manual.enabled`，只有**主人私聊**能用。

| 工具 | 能力 | 写操作 |
| --- | --- | --- |
| `qq_bili_search` | 搜索视频 | 否 |
| `qq_bili_video` | 视频详情 / 字幕 | 否 |
| `qq_bili_feed` | 按偏好选题 | 否 |
| `qq_bili_like` | 点赞 | 是（可逆） |
| `qq_bili_post` | 发动态 / 评论 | 是（`dryRun` 可预览） |

额度与审计：发布 10 次/天、点赞 50 次/天，全部落 `state/bili-manual-log.jsonl`。评论会先把 BV 解析成 `aid(oid)` 再提交，失败返回结构化错误。

扫码登录走本机浏览器 + CDP：打开 `passport.bilibili.com/login`，取**可见**二维码，轮询 `SESSDATA / bili_jct / DedeUserID`，写进凭据文件（`target=fish` 与 `target=owner` 分开存）。二维码约 170 秒过期。

---

## 9. 故障排查

| 症状 | 原因 | 处理 |
| --- | --- | --- |
| 控制台「只接受本机回环访问」403 | 经反代/局域网访问，Host 不在白名单 | 设 `SURFCORE_TRUSTED_HOSTS=<host:port>` 后重启 DSH |
| `dsh plugin ... 退出码 127` / `spawn pnpm ENOENT` | 没装 pnpm | `npm i -g pnpm` 后重跑 `setup-dsh.mjs` |
| `Cannot find module '@deepseek-ai/schemastery'` | 装了插件没装依赖，或顺序反了 | 先 `npm install`，再 `setup-dsh`，最后重启 |
| 3100 被占 / 桥接起两份 | 旧的 `src/bridge.js` 还活着 | `./stop-qq-bot.sh` 后 `./start.sh` |
| `SnowLuma 连接断开（code=1006）` | token 读不到：`homeDir` 指错，或端点被写成 `0.0.0.0` | `snowluma.homeDir` 指向 `data/`；`followDiscoveredEndpoint=false` |
| 「检查更新」显示「本地有未提交改动」 | 自动检查的快照（启动 20 秒后一次，之后每 6 小时） | 提交后手动点一次「检查更新」 |
| 扫码登录找不到浏览器 | 机器上没有 Chromium | 装 Chromium 或设 `SURFCORE_BROWSER` |
| 深色主题白底深字 | 色板写在 `:root`，取不到 `body` 上的 `--dsw-*` | 挂 `body`，跑 `test-console-theme.mjs` |

---

## 10. 开发约定

- 只在本仓库提 Issue / PR；**不向上游 `Mieksido/surfcore` 提交任何 Issue 或 PR**，`upstream` 只读。
- 分支：`linux`。同步上游用 `npm run sync:upstream`（默认走 `fork/linux`）。
- 提交信息：`fix(scope): …` / `feat(scope): …` / `docs: …`，正文写清「现象 → 根因 → 修复 → 验证」。
- 改行为就要带回归测试；改控制台样式必须跑 `node scripts/test-console-theme.mjs` 与 `plugins/surfcore` 的 `npm test`。
- 版本号后缀 `-linux`，发版按 `docs/RELEASE.md`。

---

## 11. 更多文档

- 交给 agent 自己部署：[`README.DSH.md`](README.DSH.md)（检查 → 安装 → 重启 → 验收的 runbook）
- 部署与运维细节：`docs/guides/INSTALL.md`
- 架构：`docs/guides/ARCHITECTURE.md`；B站 子系统：`docs/guides/SUBSYSTEM-BILI.md`
- 踩坑记录：`docs/PITFALLS.md`；变更案例：`docs/cases/`

---

## 12. 许可

MIT，保留上游版权声明。上游：[Mieksido/surfcore](https://github.com/Mieksido/surfcore)。
