# 2026-11-02 评论区监听不回复（@ 小号无反应）

## 现象

- SurfCore → B站 → 高级设置 → 倾听：已开启「评论区监听」；
- 主人在 `BV1Q94y1s7PK` 的评论里 `@鲸鲸巡逻中 肥鱼在不在`（00:40）；
- 监听没有回复；DSH 日志反复出现：
  ```
  [bili-whale] 监听失败：Cannot access 'L' before initialization
  ```

## 根因（四层叠在一起）

1. **TDZ 致命错误**：`scheduler.js` 的 `listenTick()` 里函数级有 `const L = cfg.listen`，
   `try` 块内又写了 `const L = limitsNow()`。块级 `L` 在声明前被引用，每次命中都抛
   `Cannot access 'L' before initialization` —— 监听功能实际上**永远走不到叫醒**。
2. **范围默认只回「回复」**：`listen.scope` 默认 `reply`，只拉 `/msgfeed/reply`；
   用户是 `@` 小号，属于 `/msgfeed/at`，不会进监听。
3. **不在监听时段**：`listen.allDay=false`，夜间窗口 `20:00–23:00`；
   用户 00:40 测试，监听直接 return（设置页没有明显提示）。
4. **保存后基线吞消息**：`invalidate()` 把 `whale-listen.json` 重置为 `{}`；
   下一次 tick 把"现在"当基线，保存后立刻 @ 的那条会被当历史忽略。

附带问题：

- `comment-digest` 的 `@` 条目只打印位置，**没有坐标** → 叫醒后 agent 不知道回哪条；
- 同一 UP 10 分钟只能回 1 条；一次命中两条同 UP 的 @ 时，先回了旧的那条，新的被限额挡住。

## 修法

- `listenTick()`：`const L = limitsNow()` 改名 `const limits`，消除 TDZ；
- 基线：首次/重置后给 **120 秒宽限**（只回看最近 2 分钟），不再吞掉刚发的测试消息；
- `comment-digest`：`@` 条目补 `type/oid/bvid/root/parent`（视频 @ 用 `root=parent=评论 rpid`）；
- 监听提示：多条同时到达时**先回最新**；被限额拒绝时不要刷，≥10 分钟后再回；
- 设置页文案：「只回复我」明确标注**不含 @**；
- 本机配置（临时测试）：`listen.scope=both`、`listen.allDay=true`。

## 验证

- 修复后日志：`监听命中 1 条（白榆忘舒（@））→ 已叫醒`、`监听命中 2 条（白榆忘舒（@）、白榆忘舒（@））`；
- `comment-digest --hours 2` 的 @ 条目已输出：
  `坐标：type=1 oid=363158669 bvid=BV1Q94y1s7PK root=322645746496 parent=322645746496`；
- agent 已回复 `BV1S6xY65Eey` 的 @（rpid=322646937872）；
- `BV1Q94y1s7PK` 已在 00:58 补回：评论 `rpid=318922245649`（thread root=322645746496），
  链接：https://www.bilibili.com/video/BV1Q94y1s7PK/#reply318922245649
- 同批的另一条 @（BV1S6xY65Eey）也已回复：`rpid=322646937872`。

## 影响面

- 监听/回复链路；不改配置格式，不涉及 QQ 桥接与发布额度；
- 修复后监听才真正可达；此前所有监听命中都会静默失败（日志有 TDZ 报错）。
