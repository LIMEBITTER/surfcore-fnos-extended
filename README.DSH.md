# README.DSH.md · 部署 runbook

> 给正在执行部署的 DSH agent 用。目标不是“把仓库拉下来”，而是让 SurfCore 出现在**正确的 profile** 里，并且知道怎么验收、怎么不把用户数据弄坏。
>
> 原则：先检查、再动手；每一步都有验收；不猜、不覆盖、不碰 upstream。

## 0. 先判断场景

| 现场 | 走哪条 |
| --- | --- |
| 机器上没有仓库 | §3.1 全新安装 |
| 已有仓库，升级或修配置 | §3.2 已有安装 |
| 已经装好，只做验收 | §6 验收 |
| 你正跑在将被重启的 DSH 里 | 先读 §5，不要直接重启 |

## 1. 硬约束

- 只支持 Linux（fnOS / Debian 优先）；不要用 PowerShell、`robocopy`、`Expand-Archive`、`D:\` 路径。
- Node ≥ 22.13，用 `bash` 跑脚本，不要用 `sh`。
- 不要用 root 跑 `npm install`。DSH 属于哪个用户，就用哪个用户装。
- SnowLuma 不随仓库分发。没有就先让用户用 Docker 启动并登录，本仓库只负责接入。
- 必须确认 profile。默认的 `web` 只是兜底；装错 profile，重启后设置页里看不到 SurfCore。
- `config.json`、`state/console-token`、SnowLuma token、B站 Cookie 都是敏感文件：不要打印，不要提交。
- 不要 `git push upstream`，不要向上游提 Issue/PR。
- 不要用 `git reset --hard` / `git clean -fdx` 清理现场；有未提交改动先问用户。
- 某一步失败就停下，把原始错误贴出来；不要“再试一次”掩盖问题。

## 2. 30 秒检查

```bash
node -v
bash --version | head -1
command -v git curl tar unzip
ss -ltn 2>/dev/null | grep -E ':(3000|3001)([[:space:]]|$)' || true
ls "$DSH_HOME/profiles" 2>/dev/null || ls ~/.dsh/profiles
```

期望：

- Node ≥ `v22.13.0`
- `git / curl / tar / unzip` 都有
- `3000/3001` 至少有一个在听（SnowLuma 没起也能装，但 QQ 连不上）
- profile 目录真实存在；如果 DSH 从没打开过，先让用户打开一次

缺什么补什么。不要为了“先跑起来”去 `chmod -R 777`；权限问题修所有者，不是放大权限。

## 3. 安装

### 3.1 全新安装

```bash
curl -fsSL https://raw.githubusercontent.com/LIMEBITTER/surfcore-fnos-extended/linux/scripts/bootstrap.sh -o /tmp/surfcore-bootstrap.sh
bash /tmp/surfcore-bootstrap.sh --check
bash /tmp/surfcore-bootstrap.sh
```

脚本会：

1. 检查 Node、DSH profile、git、常用端口；
2. `git clone --branch linux` 到 `~/surfcore`（`SURFCORE_DIR` 可覆盖）；
3. `npm install`（含 `patch-snowluma-sdk.mjs`）；
4. `node scripts/setup-dsh.mjs <profile>` 注册 bundle / preset / MCP；
5. 生成 `config.json`（已存在则不动）。

它**不会**自动重启 DSH。

### 3.2 已有安装

```bash
cd ~/surfcore
git status --porcelain
git pull --ff-only origin linux
npm install
node scripts/setup-dsh.mjs <profile>
```

`git status` 不干净时先停：不要覆盖用户改动，先确认是保留、commit 还是 stash。

### 3.3 手动安装（脚本失败时）

```bash
git clone --branch linux https://github.com/LIMEBITTER/surfcore-fnos-extended.git ~/surfcore
cd ~/surfcore
npm install
node scripts/detect-profile.mjs
node scripts/setup-dsh.mjs <profile>
```

`setup-dsh.mjs` 失败会回滚 profile 改动；不要手工改 DSH 的 `cordis.patch.yml` 绕过。

## 4. 安装后必须让用户做

1. **启动 SnowLuma**：Docker 容器运行，WebUI 打开 `http://<host>:5099`，登录 QQ。
2. **确认 OneBot**：`127.0.0.1:3000` / `3001` 有监听；token 在 SnowLuma 的 `data/config/onebot_<uin>.json`。
3. **填配置**：至少核对 `dsh.baseUrl`、`snowluma.homeDir`、`ownerQQ`、`allow.private`；不要把 `0.0.0.0` 写进端点。
4. **重启 DSH**（见 §5），让插件加载。

不要替用户扫码登录 QQ 或 B站；不要把 token 写进聊天记录。

## 5. 重启 DSH

先确认当前会话是不是跑在将被重启的 DSH 里。

```bash
# 常见：systemd 用户服务（服务名以现场为准）
systemctl --user restart ai-deploy.service
# 或 dsh.service / 宿主自己的服务名
```

没有 systemd 时，按宿主方式停掉 DSH 进程再启动；不要 `pkill -f dsh` 这种会误杀自身 shell 的写法。

重启后等 5–10 秒，再跑 §6。

## 6. 验收

```bash
# 1) DSH 在听（401/200 都正常，401 表示要 token）
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3080/

# 2) 控制台状态
TOKEN=$(cat ~/surfcore/state/console-token)
curl -s -H "x-console-token: $TOKEN" http://127.0.0.1:3100/api/status

# 3) 进程
pgrep -af 'src/bridge.js|mcp-snowluma|mihomo|lan-proxy' || true

# 4) SnowLuma 容器与端口
docker ps --filter name=snowluma
ss -ltn | grep -E ':(3000|3001|3100|3080|5099|6081)([[:space:]]|$)'

# 5) 测试
cd ~/surfcore && node scripts/self-test.js
cd plugins/surfcore && npm test
```

通过标准：

- `/api/status`：`dshReady=true`、`snowluma.connected=true`、`accountOnline=true`、`good=true`
- 桥接日志有 `SnowLuma 已连接`
- DSH Web 设置里能看到 SurfCore；控制台能打开
- 端口没有 `0.0.0.0` 暴露（容器端口映射到回环）

## 7. 故障速查

| 症状 | 先查 |
| --- | --- |
| 设置页看不到 SurfCore | profile 是否装对；`dsh --profile <name> --dump-config` 里有没有 `surfcore`；重启 DSH |
| `dsh plugin install` 127 | pnpm 是否安装；`command -v pnpm` |
| `Cannot find module '@deepseek-ai/schemastery'` | 先 `npm install`，再 `setup-dsh` |
| 控制台 403 | `SURFCORE_TRUSTED_HOSTS` 是否包含当前 Host:Port |
| SnowLuma 1006 / 连不上 | `snowluma.homeDir`、OneBot token、`:3000/:3001` 是否在听 |
| 3100 被占 / 桥接两份 | 先停旧 `src/bridge.js`，再重启 DSH |
| B站 扫码无浏览器 | 安装 Chromium 或设 `SURFCORE_BROWSER` |
| 更新后版本没变 | 需要完全退出 DSH 再打开；zip 更新还要校验 manifest |

## 8. 交付与回滚

- 安装前记录：仓库路径、profile、DSH 版本、Node 版本、SnowLuma 容器名。
- 升级前备份：`config.json`、`$DSH_HOME/surfcore/`、`state/console-token`。
- 回滚：`git checkout <上一个提交>` + `npm install` + 重启 DSH；不要删除用户数据目录。
- 最后给用户一句短消息：

```
SurfCore 已安装/更新到 <版本>，profile=<name>。
请打开 SnowLuma WebUI 登录 QQ，然后重启 DSH。
重启后我帮你验收 /api/status 和桥接日志。
```

## 9. 边界

- 不碰 upstream；不向上游提交 Issue/PR。
- 不替用户做账号安全决策（扫码、Cookie、token）。
- 不把 `config.json` 或记忆数据复制进仓库。
- 不在未验证时宣称“已恢复/已发版”；以 `/api/status`、日志和测试结果为准。
