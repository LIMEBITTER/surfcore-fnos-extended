# 2026-11-01 QQ B站 评论报 `usage: --oid ...`（BV 号被大写 + 缺 aid）

## 现象

- 在 QQ 私聊让 agent 在视频 `BV1xH4y1g7kn` 下发一条评论；
- agent 调 `qq_bili_post` 返回：`usage: --oid <aid|comment_id_str> ...`；
- 重试、`dryRun` 都一样失败，用户只看到「B站发布失败：usage…」。

## 环境

| 项 | 值 |
| --- | --- |
| 系统 / DSH | 飞牛 OS（Debian 12）/ DSH 0.2.1-rc.5 |
| SurfCore | 0.8.4-linux（QQ 私聊 B站 工具） |
| 触发 | QQ 私聊 → `mcp__snowluma__qq_bili_post`（kind=comment） |

## 根因

1. `comment.mjs` 的 CLI 契约要求 `--oid <aid>`，`--bvid` 只是可选辅助；bridge 的 `qq_bili_post` 只传了 `--bvid`，直接命中 usage 分支；
2. 修第一版时用 `bvid.toUpperCase()` 做 aid 解析（想统一缓存 key），但 **B站 BV 号大小写敏感**：`BV1xH4y1g7kn` → `BV1XH4Y1G7KN` 后 `view` 接口返回 `-404 啥都木有`；
3. `comment.mjs` 自己不做 BV→aid，所以必须由调用方补全。

## 修法

`src/bridge.js` 的 `qq_bili_post`（kind=comment）：

- 保留 bvid 原始大小写（不再 `toUpperCase`）；
- 先调已封装的 `bili.mjs recon <BV>` 解析 `aid(oid)`（复用 B站 工具链的 UA/referer/风控处理），失败才回退到公开 `view` API；
- 把 `--oid <aid>` 和 `--bvid <BV>` 一起传给 `comment.mjs`；
- 解析失败返回结构化错误 `code: BILI_AID_RESOLVE_FAILED`，不再只抛 usage。

## 验证

- 修复前：`qq_bili_post` → `usage: --oid ...`（日志 03:04:58Z / 03:06:33Z 两次失败）；
- 修复后（dryRun，不发布）：
  ```
  ok True
  body: type=1&oid=1054433785&message=...&csrf=***
  [dry] 未发送。
  ```
- 真发评论未执行（避免未经确认的公开操作）；用户可在 QQ 里再次触发。
- 回归：`npm run test:audit` 108/108；安装清单 verify 0。

## 遗留

- 若 B站 后续要求 WBI/风控更严，`recon` 是唯一解析入口，回退的公开 API 仅作兜底；
- 评论被 B站 折叠/吞掉时仍以 CLI 输出为准（本修复只解决参数层）。
