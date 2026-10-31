# QQ 手动 B站 工具（本机补丁）

让 QQ 私聊里的 Agent 直接操作 B站 账号：搜索、看视频、选题、点赞、发动态、发评论。

## 工具

| 工具 | 作用 | 写操作 |
| --- | --- | --- |
| `qq_bili_search` | 搜索视频 | 否 |
| `qq_bili_video` | 视频详情（元信息/字幕） | 否 |
| `qq_bili_feed` | 按偏好选题 | 否 |
| `qq_bili_like` | 点赞 | 是（可逆） |
| `qq_bili_post` | 发动态 / 评论（`dryRun` 可只预览） | 是（不可逆） |

## 开关

设置 → SurfCore → B站 → **QQ 手动工具（B站）**：

- 默认关闭；打开后 QQ 私聊里的这 5 个工具才会执行。
- 关闭后工具调用返回 403，不影响聊天。
- 配置落在根 `config.json` 的 `biliBridge.manual.enabled`。

## 安全边界

- 只允许主人私聊：bridge 校验 `key === private:<ownerQQ>`。
- 不开放 shell / 文件权限；不改变 QQ 工具白名单（工具在 `mcp__snowluma__` 前缀下）。
- 发布复用 SurfCore 原有逻辑：四本账额度、出站身份闸（QQ 号/mid 不出去）、评论/动态记账。
- 手动发布频率上限：动态/评论 10 次/天，点赞 50 次/天。
- 审计：`state/bili-manual-log.jsonl`（设置页可看最近 30 条）。

## 已知限制

- 取消赞：B站 `archive/like` 的 like=0 稳定返回 -400，工具不提供取消赞。
- 评论被 B站 风控吞掉时，结果会如实回显失败。
