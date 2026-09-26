# ADR-0003: 引文作为普通 user 消息投递，卡片只存在于 composer

- 状态：已采纳
- 日期：2026
- 涉及：dsh-quote（引文工具）
- 取代：ADR-0001 的「引文 = 插件来源的注入上下文」；废止 ADR-0002 的「回执卡」方案

## 背景

用户提出三条需求：

1. **引用到对话的卡片要显示在聊天窗里**；
2. **发送消息后，聊天窗中的引用卡片立即消失**；
3. **引用内容当成 user message，显示在上方**。

这三条一起推翻了前两版 ADR 的前提。

### 为什么 ADR-0001/0002 的路线走不通

ADR-0002 已经查明：宿主在渲染前就用 `ui-chat` 的 `isVisibleChatNode` 把**普通注入上下文行**（`kind: 'context'`）滤掉了——只有携带工具增删的 `context` 节点才可见。ADR-0002 由此得出结论「转录区卡片不可实现」，转而把可见面全部放进 composer，并加了一张**回执卡**来补偿"用户看不见引文进没进去"。

这个结论**只在"引文必须是注入上下文"的前提下成立**。而那个前提来自 ADR-0001，不是 DSH 的硬约束。

### 关键事实：可见性由 `source.kind` 决定，不由「注入」这个动作决定

`dsh-client-ui-chat` 的会话节点投影里（`lib/client.js`，`messageDefinition.start`）：

```js
if (event.data.source.kind !== "user") {
  return { ...contextMessage(event, event.data), waking: ... }   // → kind: 'context'，被隐藏
}
return ... { kind: "user", ... }                                  // → kind: 'user'，正常气泡
```

即：一条 `user/message` 事件**当且仅当 `source.kind === 'user'` 时**渲染成可见的用户气泡；任何其它 kind（包括插件自定义 kind）都被归为 `context` 并在 `isVisibleChatNode` 处被滤掉。

**所以「引文在转录区可见」和「引文是独立注入上下文」二者只能取其一。** 插件私有 kind 的注入消息，注定一行都不产生。

## 决策

**引文以普通 `source.kind === 'user'` 消息投递，作为独立的一条 user 消息排在用户自己的消息之前；composer 只保留"待发送"这一种卡片，发送即消失，不再有回执。**

1. **投递形态**：`buildContextUserMessage` 用 `createUserMessage({ content, source: { kind: 'user' } })`。这是 GUI 渲染气泡的唯一途径。
2. **位置**：折叠把引文插在**该步最后一条真实用户消息之前**（`lastUserIndex`，不是 `+1`），
   于是阅读顺序是「引文 → 我自己的问题」。引文消息自身也是 `kind: 'user'`，因此锚点在**未修改的** `decision.messages` 上解析，绝不会落到引文自己身上。
3. **与用户消息分离**：引文仍是一条**独立消息**，绝不拼进用户消息正文——这一点 ADR-0001 的核心意图被完整保留。模型看到的是两条消息：先引文、后问题。
4. **composer 只有一种卡片**：待生效引用（`conversation.input.overlay` 里的 rail）。
5. **发送即消失，且不可复活**：见下。

### 发送即清除：为什么必须记住 id，而不是等一段时间

旧实现用一个**时间窗**（`SEND_GRACE_MS`）压制轮询，等宿主把队列排空。这是缺陷根源：

- agent 忙时发送**不会开始新回合**（消息排队，agent 继续干活）；
- 引用在宿主侧因此**合法地**仍是 pending，可能持续数十秒；
- 时间窗一过，轮询如实地把卡片**刷回来**，并一直停到排队消息被处理——用户明明已经发出去了。

现在改为**记住已提交的 id**：发送瞬间把当前所有 staged 引文的 id 记进 `submittedRef` 并清空 rail；此后**每一次**轮询结果都先滤掉这些 id。这不依赖任何时序，因此不可能复活。宿主侧 `claim` 仍保留为权威半边，等它的 `list` 不再报告这些 id 后，本地记录随之回收，集合不会无界增长。

**注意：这只改呈现，不丢引文**——引用仍留在 store 里，折叠照常注入。

### 回执卡被删除

回执卡（`SentReceipt`、`SentQuoteStore`、`/dsh-quote/api/sent`）存在的唯一理由是"转录区不会显示引文"。引文现在**就是**一条可见的 user 气泡，回执因此完全冗余——而它恰恰是用户报告的"发送后不消失的卡片"：staged 卡消失后，回执卡在**同一个 composer 位置**顶上来并停留 12 秒。删除它同时满足需求 2 和需求 1。

## 实测

真实 Chrome + 隔离 profile（`qtest`），真实鼠标划选：

```
STAGED: {"railCards":1,"inComposer":true}
按下 Enter 后：CLEARED AFTER: 12ms
转录区 user 行：
  [0] 请写一段超过四十个字的说明文字…      ← 用户自己的消息
  [1] MARKER 我的问题正文                  ← 用户自己的问题
  [2] through the credentials service…     ← 引文（独立 user 气泡）
```

发送后 composer **再无任何卡片**（rail 与 receipt 均为 0）。

## 备选方案与取舍

| 方案 | 结论 | 理由 |
|---|---|---|
| 保持插件私有 kind 的注入上下文 | 拒绝 | `isVisibleChatNode` 使其恒不可见；这就是需求 1 无法满足的原因 |
| 私有 kind + 回执卡补偿 | 拒绝 | 回执顶在同一个位置并停留 12s，正是用户报告的"卡片不消失" |
| 引文拼进用户消息正文 | 拒绝 | 污染用户消息，引用与追问边界模糊（ADR-0001 的原始理由仍然成立） |
| 用时间窗压制轮询 | 拒绝 | agent 忙时等待无界，窗一过卡片必然复活 |
| 让引文携带 tool-addition block 骗过可见性 | 拒绝 | 向模型伪造工具变更语义，用污染换取装饰效果（ADR-0002 已否决） |
| 回执常驻直到用户关闭 | 拒绝 | 报告的是已完成的一次性事件；且现在转录区已经给了确认 |

## 影响

- `src/quote-context.ts`：投递为 `source.kind: 'user'`；删除 `MessageSourceMap` 增强与 `quote-context` kind；
- `src/source-kind.ts`：只留 `PLUGIN_NAME`，零依赖叶子不再承载 source kind；
- `src/quote-fold.ts`：插入点由 `lastUserIndex + 1` 改为 `lastUserIndex`；
- 删除 `src/client/sent-quotes.ts`、`SentReceipt`、`SentQuoteStore`、`/sent` 路由与 `[data-dsh-quote-receipt]` 样式段；
- client 发送清除由"时间窗"改为"记住已提交 id"；
- ADR-0001 的注入机制（`agent/pre-step` 折叠 + 一次性 + 队列清空）**不变**，只改投递形态；ADR-0002 对 `isVisibleChatNode` 的实测分析仍然有效，但其"转录区不可实现"的结论**被本 ADR 取代**——不可实现的只是「私有 kind 的注入行」。
