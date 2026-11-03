# QQ 私聊「晚安」没有回复：bridge 丢失 time-context import

## 现象

- 用户 2026-11-03 23:49 在 QQ 私聊发「晚安」，消息已到 SnowLuma，但没有任何回复。
- `state/bridge.log` 同一秒出现：
  `23:49:18 [bridge] 处理私聊消息出错: needsTimeDetail is not defined`
- 影响面：所有走到 `withSlangContext()` 的 QQ 消息都会在进入 DSH 前抛 `ReferenceError`；消息不丢在 QQ 侧，但不会产生回复。

## 环境

| 项 | 值 |
| --- | --- |
| 系统 / DSH 版本 | fnOS Linux / DSH 0.2.1-rc.5 |
| SurfCore 版本 | 0.8.8-linux（HEAD `dcea02f`） |
| 安装方式 | git（生产 `/home/baiyu/surfcore`） |
| 其它相关版本 | SnowLuma v2.4.0，OneBot HTTP 3000 / WS 3001 |

## 根因

- 代码位置：`src/bridge.js:3144`（`withSlangContext` 调用 `needsTimeDetail`、`formatClock`、`formatAnchors`），`src/bridge.js:9702`（`sendToQQ` 调用 `guardTimeClaims`）。
- 问题链条：v0.8.8 上游合并时，`src/bridge.js` 顶部的 `import { ... } from './time-context.js'` 被覆盖丢失；`src/time-context.js` 模块本身存在且导出正常。私聊消息进入 `withSlangContext()` 后第一个 `needsTimeDetail(...)` 就抛 `ReferenceError`，bridge 捕获后只记日志，没有把 prompt 送进 DSH。
- 为什么之前没发现：现有 `scripts/test-time-context.mjs` 只测 `src/time-context.js` 的纯函数，没有覆盖 bridge 对这个模块的引用；合并后的 audit 也没有真实 QQ 私聊链路。

## 完整逻辑（给用户看的那一遍）

- **链路**：SnowLuma OneBot → `src/bridge.js` 私聊处理 → `withSlangContext()` → DSH `session.prompt` → 回复 → `sendToQQ()`。时间上下文是 fork 在 v0.8.6 加的特性：prompt 末尾拼当前时钟，出站前纠正错误时间表达。
- **机制**：`withSlangContext()` 依赖 `needsTimeDetail/formatClock/formatAnchors`；`sendToQQ()` 依赖 `guardTimeClaims`。四个函数都在 `src/time-context.js`，但 bridge 没有 import，运行时按未声明变量处理。
- **爆炸半径**：1 个 bridge 进程 × 所有 QQ 消息路径；静默失败（只写日志）= 3 分；不碰用户数据/密钥，但会让用户以为机器人“已读不回”。
- **取舍**：补 import 是最小修复；不改成动态 import，也不把函数复制进 bridge。另加静态回归测试，防止下次合并再次丢 import。
- **生效与重启**：bridge 由 `dsh.service` 拉起；改完必须重启 DSH（会连带重启 bridge）。

## 修法

- 在 `src/bridge.js` 的 import 区补：
  `import { formatClock, formatAnchors, needsTimeDetail, guardTimeClaims } from './time-context.js';`
- 在 `scripts/test-time-context.mjs` 末尾加静态断言：`src/bridge.js` 必须从 `./time-context.js` 导入这四个符号。
- 回滚方式：`git revert` 该提交；生产上只需恢复旧 `src/bridge.js` 并重启 DSH。

## 验证

- 自动化：`node --check src/bridge.js`；`node scripts/test-time-context.mjs`；`npm run test:audit`（最终 146/146，新增案例/清单后）。
- 手工：`sudo systemctl restart dsh` 后 bridge 于 `23:51:24` 启动，SnowLuma 连接、DSH ready、`mode=chat`；日志无 `needsTimeDetail is not defined`。
- 没验证到的部分：用户修复前那条「晚安」没有自动补发；需要用户重发一条，确认 bridge 正常处理并产生回复。

## 遗留 / 后续

- 需要补的测试：真实的 bridge 私聊集成测试（当前只有静态 import 断言）。
- 需要改的文档：本案例已登记；发布时补 RELEASE-QUEUE 交接块。
