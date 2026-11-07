# README.DSH.md · 给 DSH 的部署手册

> 这份文件不是给人从头读到尾的，是给正在执行部署的 DSH agent 当 runbook 用的。
>
> 目标：在 Linux 上把 SurfCore 装进**正确的 DSH profile**，让用户完成最后两步，并且知道怎么验证。
>
> 原则：先检查、再执行；每一步都有验收；不猜、不覆盖用户数据、不碰 upstream。

## 0. 先判断你属于哪种情况

| 情况 | 走哪条路 |
| --- | --- |
| 机器上没有 `~/surfcore` | [路径 A：全新安装](#3-路径-a全新安装) |
| 已经有仓库，只是升级/修配置 | [路径 B：已有安装](#4-路径-b已有安装) |
| 已经装好，只想确认有没有问题 | [路径 C：只验收](#6-验收清单) |
| 你正跑在**即将被重启的那个 DSH** 里 | 先读 [§5 重启 DSH](#5-重启-dsh)，不要直接重启 |

一句话版本（仓库已经在机器上）：

```bash
cd ~/surfcore && bash scripts/bootstrap.sh --check && bash scripts/bootstrap.sh
```

全新机器没有仓库，先看 [§3.1](#31-拿引导脚本) 把引导脚本下到 `/tmp`。

跑完不要停，继续看 [§5](#5-重启-dsh) 和 [§6](#6-验收清单)。

## 1. 硬约束（先看，省得返工）

- **只支持 Linux**。不要用 PowerShell、`robocopy`、`Expand-Archive`、`D:\` 路径；这个分支的脚本已经按 `unzip`/递归复制/`xdg-open` 改过。
- **Node ≥ 22.13**，用 `bash`，不要用 `sh` 跑脚本。
- **不要用 root 跑 `npm install`**。DSH 属于哪个用户，就用哪个用户装；装完文件所有者不对，后面全是权限坑。
- **SnowLuma 不随仓库分发**。没有就先让用户装好并登录；本仓库只负责接入，不代装。
- **Profile 必须确认**。默认的 `web` 只是兜底；装错 profile，重启后设置里根本看不到 SurfCore。
- **`config.json` 是用户数据**。可以改字段，但不要用 `config.example.json` 整个覆盖；不要把它提交进 git。
- **不要打印密钥**：`config.json`、`state/console-token`、SnowLuma token、B站 Cookie 都不要出现在日志/回复里。
- **不要碰 upstream**：不 `git push upstream`，不向上游提 Issue/PR。
- **不要用 `git reset --hard` / `git clean -fdx`** 清理现场；有未提交改动先问用户。
- **不要在失败后继续下一步**。setup 失败会自己回滚 profile；把原始错误贴出来，比“再试一次”有用。

## 2. 环境检查（30 秒）

```bash
node -v
bash --version | head -1
command -v git curl tar unzip
ss -ltn 2>/dev/null | grep -E ':(3000|3001)([[:space:]]|$)' || true
ls ~/.dsh/profiles
```

期望：

- `node -v` ≥ `v22.13.0`
- `git / curl / tar / unzip` 都有
- `3000/3001` 至少有一个在听（SnowLuma 没起也能装，但 QQ 连不上）
- `~/.dsh/profiles` 下有真实的 profile 目录（不是空）；如果 DSH 从没打开过，先让用户打开一次，别硬装到 `web`

缺什么补什么。**不要**为了“先跑起来”去 `chmod -R 777 ~/.dsh`；权限问题要修所有者，不是放大权限。

## 3. 路径 A：全新安装

### 3.1 拿引导脚本

```bash
curl -fsSL https://raw.githubusercontent.com/LIMEBITTER/surfcore-fnos-extended/linux/scripts/bootstrap.sh \
  -o /tmp/surfcore-bootstrap.sh
bash /tmp/surfcore-bootstrap.sh --check
```

`--check` 只检查，不写文件。确认输出里没有红色 `✖` 再继续。

### 3.2 执行

```bash
bash /tmp/surfcore-bootstrap.sh
```

默认装到 `~/surfcore`；要换位置：

```bash
SURFCORE_DIR=/opt/surfcore bash /tmp/surfcore-bootstrap.sh
```

它依次做五件事：

1. 检查 Node、DSH profile、SnowLuma 端口、git/curl；
2. clone `linux` 分支（没有 git 就下 tar.gz）；
3. `npm install`（含 SnowLuma SDK 的 postinstall 补丁）；
4. `node scripts/setup-dsh.mjs <profile>` 注册 bundle / preset / MCP，并跑一次 `dsh plugin --profile <profile> install`；
5. 从 `config.example.json` 生成 `config.json`（已存在则不覆盖）。

看到 `=== 6. 完成 ===` 才算脚本成功。失败时不要手工改 profile 硬凑，先看报错。

### 3.3 接下来必须让用户做

脚本不会替用户重启 DSH，也不会替用户填 QQ 白名单。把这三件事说清楚：

1. **完全退出 DSH，再打开**（不是刷新页面）；
2. 设置 → **SurfCore** → 诊断 → **一键安装（全部）**；
3. 弹窗里填**主人 QQ**、勾允许的群 → 开始安装；如果提示需要，再退出重开一次 DSH。

如果用户没有 GUI，走 [路径 B](#4-路径-b已有安装) 的配置部分。

## 4. 路径 B：已有安装

先看现场，不要上来就 pull：

```bash
cd ~/surfcore
git status --short
git branch --show-current
git log -1 --oneline
```

- 工作区有未提交改动：先问用户要不要保留；不要 `git checkout -- .`。
- 当前分支不是 `linux`：切回 `linux` 再操作，或明确告诉用户你在哪个分支。
- 远端不是 `fork`：先 `git remote -v` 确认，别把上游当 fork 推。

### 4.1 升级

```bash
cp -a config.json "config.json.bak-$(date +%F-%H%M)"
git fetch fork linux
git merge --ff-only fork/linux
npm install
PROFILE="$(node scripts/detect-profile.mjs | tail -n 1)"
node scripts/setup-dsh.mjs "$PROFILE"
```

`setup-dsh.mjs` 是幂等的，可以重复跑；它会备份并校验 profile，失败自动回滚。不要因为它“跑过了”就跳过——升级后 bundle/preset 可能需要重新物化。

### 4.2 无 GUI 配置（可选）

只有在用户明确给了 QQ 号/群号时才做。**不要猜号码，不要留空还继续。**

```bash
cd ~/surfcore
OWNER_QQ='123456789' \
ALLOW_GROUPS='123456,234567' \
SNOWLUMA_WS='ws://127.0.0.1:3001' \
SNOWLUMA_HTTP='http://127.0.0.1:3000' \
node - <<'NODE'
const fs = require('node:fs');
const p = 'config.json';
const c = JSON.parse(fs.readFileSync(p, 'utf8'));
c.snowluma ||= {};
c.snowluma.wsUrl = process.env.SNOWLUMA_WS || c.snowluma.wsUrl || 'ws://127.0.0.1:3001';
c.snowluma.httpUrl = process.env.SNOWLUMA_HTTP || c.snowluma.httpUrl || 'http://127.0.0.1:3000';
if (process.env.SNOWLUMA_TOKEN) c.snowluma.accessToken = process.env.SNOWLUMA_TOKEN;
c.ownerQQ = Number(process.env.OWNER_QQ);
c.allow ||= {};
c.allow.private = [Number(process.env.OWNER_QQ)];
c.allow.groups = String(process.env.ALLOW_GROUPS || '')
  .split(',').map((x) => Number(x.trim())).filter(Boolean);
if (!c.ownerQQ || !c.allow.private.length) {
  console.error('ownerQQ / allow.private 不能为空；白名单为空 = 谁都不理');
  process.exit(1);
}
fs.writeFileSync(p, JSON.stringify(c, null, 2) + '\n', { mode: 0o600 });
console.log('config.json updated: ownerQQ=%s private=%d groups=%d', c.ownerQQ, c.allow.private.length, c.allow.groups.length);
NODE
```

注意：

- `allowAllWhenEmpty` 默认是 `false`，所以 **白名单为空 = 谁都不理**，不是“全放行”。
- `consoleToken` 留空会自动生成到 `state/console-token`；不要手写一个弱 token。
- 配完启动 bridge（如果还没有跑）：

```bash
cd ~/surfcore
./start.sh                  # 推荐：崩了自动重启（等价 start.bat）
# 或者只要一次性前台/后台跑：
nohup npm start >> state/bridge.log 2>&1 &
```

其它两个脚本：`./restart.sh`（按 state/bridge.lock 的 PID + bridge.js 命令行重启，防双实例）、
`./stop-qq-bot.sh`（停桥接；加 `--all` 连 Docker 里的 SnowLuma 一起停）。

然后看 [§5](#5-重启-dsh) 重启 DSH，再验收。

## 5. 重启 DSH

先判断它是怎么跑的：

```bash
systemctl status dsh --no-pager 2>/dev/null || true
ps -eo pid,ppid,cmd | grep '[d]sh' | head
```

按实际情况选：

| 运行方式 | 命令 |
| --- | --- |
| systemd 系统服务 | `sudo systemctl restart dsh`（需要权限；拿不到就让用户来） |
| systemd 用户服务 | `systemctl --user restart dsh`（需要 linger） |
| 前台进程 | 给**准确的 DSH 主进程**发 `SIGTERM`，再按原命令启动；不要 `kill -9` |
| 桌面应用 | 完全退出再打开 |

**如果你自己就跑在这个 DSH 里**：

- 不要执行重启命令，也不要用 `kill -9` 杀掉自己；
- 把“需要重启 DSH”作为下一步交给用户；
- 用户重启后，从 [§6](#6-验收清单) 继续，不要重新装一遍。

重启后看设置里有没有 **SurfCore**。没有，八成是装错 profile，回到 §4 检查。

## 6. 验收清单

逐条打勾，别只看“命令没报错”。

```bash
cd ~/surfcore
PROFILE="$(node scripts/detect-profile.mjs | tail -n 1)"
echo "profile=$PROFILE"

PROFILE="$PROFILE" node - <<'NODE'
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const profile = process.env.PROFILE;
const p = path.join(os.homedir(), '.dsh', 'profiles', profile, 'package.json');
const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
const bundles = pkg?.dsh?.profile?.bundles || [];
const deps = pkg?.dependencies || {};
console.log('bundles:', bundles.join(', ') || '(empty)');
console.log('surfcore dependency:', deps.surfcore || '(missing)');
if (!bundles.includes('surfcore')) process.exit(2);
if (!deps.surfcore) process.exit(3);
NODE
```

把 `PROFILE` 传进去：

```bash
PROFILE="$PROFILE" node - <<'NODE'
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const p = path.join(os.homedir(), '.dsh', 'profiles', process.env.PROFILE, 'cordis.patch.yml');
const text = fs.readFileSync(p, 'utf8');
for (const id of ['mcp-snowluma', 'mcp-snowluma-host', 'mcp-web-search-safe']) {
  if (!text.includes(id)) { console.error('missing', id); process.exit(4); }
  console.log('ok', id);
}
NODE
```

功能和配置：

```bash
npm run verify:adaptation
node scripts/test-setup-dsh-idempotent.mjs
```

Bridge / SnowLuma：

```bash
cd ~/surfcore
TOKEN="$(cat state/console-token 2>/dev/null || true)"
test -n "$TOKEN" || echo '还没有 console-token：先启动 bridge'
curl -fsS -H "x-console-token: $TOKEN" http://127.0.0.1:3100/api/status \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log({dshReady:j.dshReady,snowluma:j.snowluma&&{connected:j.snowluma.connected,accountOnline:j.snowluma.accountOnline,good:j.snowluma.good},ownerQQ:j.ownerQQ})})"
```

期望：`dshReady: true`，`snowluma.connected/accountOnline/good` 都是 `true`，`ownerQQ` 是用户给的号码。

最后两件只能用户做：

1. QQ 里给 agent 发一句，确认能回；
2. 设置 → SurfCore → 诊断，确认没有红色项。

## 7. 故障速查

| 现象 | 先查 | 处理 |
| --- | --- | --- |
| 设置里没有 SurfCore | `detect-profile` 结果 | 装错 profile：重跑 `setup-dsh.mjs <正确profile>`，重启 |
| `cannot resolve profile bundle` | profile 的 `package.json` | `dsh plugin --profile <p> install` 或重跑 setup |
| `Cannot find module '@deepseek-ai/schemastery'` | 安装顺序 | 先 `npm install`，再 setup，再重启；不要反 |
| `dsh plugin install` 失败 | `command -v dsh` | 把 DSH 的 bin 加进 PATH，或从 DSH 安装目录调用 |
| SnowLuma 连不上 | `ss -ltn` 的 3000/3001 | 先启动 SnowLuma，确认端口/token/登录 |
| 谁都不回 | `config.json` 的 `allow` | 白名单为空；填 `ownerQQ` + `allow.private/groups` |
| 扫码浏览器找不到 | `command -v chromium` | 装 Chromium，或 `SURFCORE_BROWSER=/path/to/chrome` |
| 3100 被占 | `ss -ltnp | grep 3100` | 先停旧 bridge，再启动；不要直接 kill 不认识的进程 |
| 更新解压失败 | `command -v unzip` | `sudo apt install unzip`；这个分支不用 PowerShell |
| 权限被拒 | `ls -ld ~/.dsh ~/.dsh/profiles/<p>` | 修所有者；不要 `chmod -R 777` |

## 8. 回滚与交付

**回滚**：

- `setup-dsh.mjs` 失败会自动回滚它动过的 `package.json` / `cordis.patch.yml`；
- 升级前备份 `config.json`；仓库改动用 `git status`/`git log` 看，不要 `reset --hard`；
- 真要退回旧提交，先问用户，再 `git checkout <old-commit> -- <file>` 只回退单文件。

**交付时至少说清楚**：

- 安装目录、profile、当前 commit、版本（`0.8.9-linux`）；
- 执行了哪些命令，哪些检查通过/失败；
- 用户还需要做什么（重启 DSH、填 QQ/群、扫码登录 SnowLuma/B站）；
- 有没有未提交改动、有没有动 upstream。

不要用“应该可以了”结尾。给出下一步的具体动作。
