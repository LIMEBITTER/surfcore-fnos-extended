# 2026-11-01 Linux（fnOS）适配：扫码登录 / 语音 / 更新 / 测试

## 现象

- 飞牛 OS（Debian 12）上点 B站 扫码登录：`找不到 Edge（可设 SURFCORE_EDGE 指向 msedge.exe）`；
- 语音包启动/停止在 Linux 直接失败（`cmd` / `powershell` / `.venv\Scripts\python.exe` 都是 Windows 布局）；
- 更新包解压依赖 PowerShell `Expand-Archive`，应用更新依赖 `robocopy`；
- 干净 clone 下 `npm run test:audit` 只有 73/108：
  - 未装依赖（js-yaml / zod / MCP SDK）→ 环境问题；
  - `start.bat` 在 Linux checkout 被 LF 化；
  - `chcp` / `zip` / `config.json` 等 Windows/开发机假设。

## 环境

| 项 | 值 |
| --- | --- |
| 系统 / DSH 版本 | fnOS（Debian 12 bookworm）/ DSH 0.2.1-rc.5 |
| SurfCore 版本 | 0.8.4（fork `LIMEBITTER/surfcore-linux`） |
| 安装方式 | git clone + npm install + `scripts/setup-dsh.mjs` |
| 其它 | Chromium 156.0.8078.47（apt install chromium）；Node 24.22.1 |

## 根因

- `plugins/surfcore/lib/bili-qr-login.mjs`
  - `findEdge()` 只列 Windows Edge 路径；
  - `startQrLogin` 只传 `--headless=new`，老 Chromium 不认；
  - `killEdge` 只走 `taskkill`。
- `plugins/surfcore/lib/index.js`
  - `openLocalUrl` 只 `cmd.exe start`，且 spawn 无 `error` 监听（Linux ENOENT 会成未捕获异常）；
  - SnowLuma 启动固定找 `launcher.bat` / `SnowLuma.exe`。
- `src/voice-packs.js`：安装/启动/停止硬编码 `cmd`、`powershell`、`.venv\Scripts\python.exe`、`taskkill`、`attrib`。
- `plugins/surfcore/lib/updates.js`：解压只走 PowerShell `Expand-Archive`。
- `scripts/apply-update.mjs`：复制只用 `robocopy`（Windows 自带）。
- 仓库测试：`start.bat` 缺 `.gitattributes` 导致 Linux checkout 变 LF；`test-stickers` 强依赖被 gitignore 的 `config.json`；`chcp` 是 Windows 命令。

## 完整逻辑（给用户看的那一遍）

- **链路**：扫码登录在插件进程里 `spawn` 浏览器（CDP）→ 读登录页二维码 → 轮询 cookie；语音由 bridge/插件 `spawn` `.bat`；更新由 DSH 退出后的 helper 进程复制 staging 到安装目录。
- **机制**：Windows 专属可执行文件/命令在 Linux 上返回 ENOENT；没有 `error` 监听的 spawn 会抛未捕获异常，把插件进程带崩；批处理的 LF/CRLF 在 cmd 下语义不同。
- **爆炸半径**：插件进程 1 个；读者 = 设置页 UI + CLI + 测试；静默失败=3 分（用户只看到"打不开"）；不碰用户数据/密钥，不花钱。
- **取舍**：
  - A：只把错误文案改清楚（最省，但 Linux 仍不可用）；
  - B（选）：抽 `findBrowser()` + 平台分支 + 测试，保持 Windows 行为不变；
  - C：要求装 Edge for Linux（体积大、发行版未必有）。
- **生效与重启**：扫码登录下一次点击即生效；语音/更新改动需重启 DSH（bridge 由插件拉起）；`.gitattributes` 需重新 checkout 才重写 CRLF。

## 修法

- 扫码登录：`findBrowser()` 支持 `SURFCORE_BROWSER`（兼容 `SURFCORE_EDGE`）→ Windows Edge/Chrome → macOS /Applications → Linux PATH（chromium/chrome/edge/brave + `/snap/bin/chromium`）；`--headless=new` 失败回退 `--headless`；POSIX 用 `SIGKILL` 兜底；root/容器加 `--no-sandbox`、`--disable-dev-shm-usage`。
- `index.js`：`openLocalUrl` 按平台（cmd / open / xdg-open）且 spawn 挂 `error`；SnowLuma 启动在非 Windows 返回 `PLATFORM_UNSUPPORTED` + Docker 提示；语音诊断提示按平台。
- 语音包：安装去掉平台拦截（tar 解压跨平台），`attrib` 在非 Windows 换 `chmod -R u+rwX`；启动在凭据/安装检查之后结构化拒绝，停止直接拒绝（都带 `code` + `hint`）。
- 更新：非 Windows 用 `unzip -o -q`；`apply-update.mjs` 非 Windows 用递归复制（只覆盖不删除，排除 config/state 等）。
- 测试/仓库：新增 `scripts/test-linux-adaptation.mjs`；`chcp` 断言仅 Windows；`zip` CLI 造包；`config.json` 缺失回退 `config.example.json`；`.gitattributes` 强制 `*.bat/*.cmd/*.ps1` 为 CRLF；重新生成安装清单。

## 验证

- `npm run test:audit`：**108/108**（修完后）
- 真机扫码：`startQrLogin({ target: 'owner' })` 用 `/usr/bin/chromium` 2 秒返回 `data:image/png`（7882 字节），不扫码、不写凭据；`closeAllQrLogins()` 清理临时 profile。
- 语音：Linux 下 `stop()` 返回 `PLATFORM_UNSUPPORTED` + hint；`start()` 在未安装/缺密钥时仍先报原来的业务错误。
- 更新：`test-update-apply-result` 通过（zip 造包 + 递归复制分支）。
- 未验证：macOS；真实 B站 扫码确认（需要人拿手机扫）；更新在 Linux 上的完整应用（只测了 helper）；桌宠（本就不在 Linux 范围）。

## 遗留 / 后续

- 设置页个别静态文案仍写 `run.bat` / `launcher.bat`（诊断已按平台改，纯文案未清）；
- macOS 分支没有真机验证；
- 若要把语音做成 Linux 原生，应按 `docs/VOICE-PACKS.md` 的 python 方案单独做服务化，不在本次范围。
