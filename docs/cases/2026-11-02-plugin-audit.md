# 2026-11-02 SurfCore Linux 插件全面排查

## 范围与方法

- 全量语法检查：`plugins/surfcore`、`src`、`scripts` 共 394 个 `.js/.mjs`，`node --check` 全过；
- 插件测试：`cd plugins/surfcore && npm test`（45 组左右）；
- 仓库门禁：`npm run test:audit`（109 项）；
- 客户端 API 扫描：提取 `client.js` 的 72 个 API 路径，逐个 GET 验证 404/405；
- Windows-only 入口清单：`process.platform`、`powershell`、`explorer.exe`、`.bat`、`taskkill` 等；
- 监听/调度、语音包、更新助手、路径选择器、主人审计逐段读代码。

## 本轮发现并修复

| # | 问题 | 位置 | 修法 |
| --- | --- | --- | --- |
| 1 | Linux 上 `helperSpawnEnv('C:\\nodejs\\node.exe')` 把整个路径当 basename，误加 `ELECTRON_RUN_AS_NODE`；插件测试因此失败 | `plugins/surfcore/lib/updates.js` | 按 `[\\/]` 取最后一段，兼容 Windows/POSIX |
| 2 | 夜间窗口 `23:00–02:00` 这类跨午夜配置永远匹配不到 | `plugins/surfcore/lib/scheduler.js` `inWindow()` | `start > end` 时按 `m>=s || m<e` 判 |
| 3 | `comment-digest --only-unread` 用 reply 的 `lastView` 过滤 @，@ 会被全部误删 | `plugins/surfcore/tools/commands/comment-digest.mjs` | 按 `kind` 分别用各自 `lastView` |
| 4 | Linux 取消语音包安装仍调用 `taskkill`，子进程可能继续下载 | `src/voice-packs.js` `cancelInstall()` | POSIX 用 `child.kill('SIGKILL')` + 进程组兜底 |
| 5 | 语音自检提示仍让 Linux 用户跑 `voice-local\run.bat` | `plugins/surfcore/lib/index.js` | 按平台给 `python -m voxd --config config.toml` |
| 6 | 路径选择器文件模式切目录后仍保留旧 `selected`，可能把旧路径交回字段 | `plugins/surfcore/lib/client.js` `PathPickerModal` | 每次 load 重置 `selected` |
| 7 | 主人审计打开目录客户端请求 `/owner-audit/open`（服务端无此路由） | `plugins/surfcore/lib/client.js` | 改用 `/owner-audit` + `action:open`（已在 #11 修复） |
| 8 | 监听的 TDZ 错误 | `scheduler.js` `listenTick` | 已在 #13 修复 |

## 验证

- `cd plugins/surfcore && npm test` → **0 失败**；
- `npm run test:audit` → **109/109**；
- `GET /api/browse/list`、`/owner-audit`、`/browse` 等 404 扫描：无新增 404；
- 监听真实回复、路径选择器 API 均已在前面验证。

## 仍然存在的设计限制（记录在 Issue #12）

- SnowLuma 原生启动、语音包启停仍为 Windows-only（Linux 用 Docker / 手动 python）；
- 宠物/Electron 组件 Linux 不提供；
- 打开文件夹/网盘在 Linux 只返回路径/URL，没有“复制”按钮；
- 真实全量应用更新尚未在飞牛 OS 走一遍。
