# ADR-0004: 引文以自己的 Chat Node kind 渲染成可见的注入行

- 状态：已采纳
- 日期：2026-09-26
- 涉及：dsh-quote（引文工具）
- 取代：ADR-0003 的「引文 = 普通 user 消息」投递形态
- 沿用：ADR-0001 的注入机制（`agent/pre-step` 一次性折叠）

## 背景

前三版 ADR 在「引文怎么显示」上绕了一圈，每一版都是被上一条路的失败推过去的：

| 版本 | 做法 | 结果 |
|---|---|---|
| 0.2（ADR-0002 记录） | 给注入行打 `data-dsh-quote-context` 标记 + 改 CSS | **界面上什么都没有** |
| ADR-0003 | 投递成 `source.kind: 'user'`，借宿主的用户气泡 | 可见，但**与用户自己的消息完全一样** |
| ADR-0004（本文件） | 注册**自己的** Chat Node kind | 可见且可区分 |

ADR-0002/0003 的共同前提是「插件只能改**节点内部**的表现，改不了**节点类型**」。
这个前提是错的。

## 关键事实：可见性按 kind 黑名单判定，而 kind 空间对插件开放

`ui-chat` 的 `isVisibleChatNode` 是**黑名单**，只排三种：

```js
function isVisibleChatNode(node) {
  return node.visibility === "visible"
    && node.kind !== "system-prompt"
    && (node.kind !== "context" || /* 带 tool-addition/removal */)
    && !(node.kind === "command" && node.data.name === "permission");
}
```

**任何其它 kind 默认可见。** 而插件可以贡献自己的 kind，有三条公开路径：

1. **`ctx.uiConversation.events.register(definition)`** —— 官方自己在 `ui-chat` 里用了 16 处，是标准的 Conversation Node 注册口。
2. **`ChatNodeDataMap` 公开合并面** —— `ui-chat` 的 client 入口里注释写着 *"Public merge surface for Chat renderer payloads contributed by **other plugins**"*。
3. **`conversation.chat.node` 的 keyed seat** —— 按 kind 注册渲染器。

对比一下，官方的 `messageDefinition` 认领**每一个** append-surface `user/message`，并按 `source.kind` 分类：

- `kind === 'user'` → `user` 节点 → 普通用户气泡，**插件无法改造**；
- 其它任何 kind → `context` 节点 → 被 `isVisibleChatNode` **滤掉**。

**两条默认投影都对插件关闭。** 唯一出路是自己占一个 kind。

## 决策

**引文以本插件私有的 `source.kind` 投递；客户端注册一个 Conversation definition 认领它，产出自己的 `quote` 节点，并用自己的 keyed seat 渲染成一条注入风格的折叠行。**

1. **投递**：`buildContextUserMessage` 用 `source: { kind: QUOTE_CONTEXT_KIND, form: 'notice', summary }`。
   `summary` 是有界单行摘要（80 字符），供折叠态显示；正文仍以完整引文作为消息 content，模型读到全部内容。
2. **认领**：`createQuoteDefinition(kind)` 只 match `type === 'user/message'` **且** `surfaceOp === 'append'` **且** `source.kind === QUOTE_CONTEXT_KIND` 的事件。
   匹配面刻意收窄：放宽一点就会抢走用户自己的消息；收窄一点则一行都不渲染。
3. **渲染**：`QuoteRowView` 挂在 `conversation.chat.node` 的 `key: 'quote'` 上，折叠显示「引用上下文」标签 + 摘要，点击展开全文。
4. **纯度门**：definition 与 seat 都经**结构化 context 面**注册（与既有 `ctx.slots` 同款），不引入任何 `@deepseek-ai` 值导入。

## 决定性事实：为什么不会重复显示

官方的 `messageDefinition` **也**认领同一个事件（`contextsBySeq` 是 `Set`，允许多个 Context 并存）。但它的副本投影成 `context` 节点，在 `orderedVisibleChatNodes` 里被滤掉；只有我们的 `quote` 节点可见。

**实测**：`user bubble: 0`、`context row: 0`、`quote row: 1`。

## 已知边界：行会随回合结束被折进「回合过程」

这是**宿主行为，插件无法控制**：

```js
const TURN_PROCESS_INDEPENDENT_KINDS = new Set([
  "system-prompt", "user", "steering", "turn-trigger",
  "turn-process", "turn-error", "turn-max-tokens", "turn-tail"
])
const processMember = ... && !TURN_PROCESS_INDEPENDENT_KINDS.has(routedNode.kind)
                      && routedNode.anchorSeq >= processSpec.processStartSeq && ...
```

- `TURN_PROCESS_INDEPENDENT_KINDS` 是**宿主硬编码常量，无扩展点**；
- 引文在回合中注入，`anchorSeq` 必然 ≥ `turn.start.seq`。

**两条都命中 → 引文行必然落进回合过程折叠组。** 但折叠组的开合取决于回合状态：

```js
const liveProcess = processPresentation !== undefined && !processPresentation.turnClosed
const alwaysOpen  = liveProcess || interleavedInput || turnProcessAlwaysOpen(routedNode)
const outerHidden = foldCompleted && turnClosed === true && !alwaysOpen && ...
```

- **回合进行中**（`turnClosed === false`）→ `alwaysOpen` 为真 → 组展开，**行露在外面**（用户在 web profile 实测确认）；
- **回合结束后** → 组收起，行被一起折进去。

**取舍**：这是本方案唯一的体验代价。但它换来的是「引文与用户消息可区分」+「转录区可见」，
而 ADR-0003 的 `kind: 'user'` 方案虽然永远可见，代价是**引文伪装成用户自己说的话**。

## 备选方案与取舍

| 方案 | 结论 | 理由 |
|---|---|---|
| `kind: 'user'`（ADR-0003） | 被取代 | 可见但不可区分；且它让引文伪装成用户消息 |
| 私有 kind + 什么都不注册 | 拒绝 | 投影成 `context` → 被滤 → 一行都不渲染（0.2 的真实失败） |
| 携带 `tool-addition` 骗过可见性 | 拒绝 | 向模型伪造工具变更语义（ADR-0002 已否决） |
| 改宿主 `TURN_PROCESS_INDEPENDENT_KINDS` | 拒绝 | 需要改 DSH 源码，越界 |
| 本方案（自定义 kind） | **采纳** | 三条公开扩展点齐备，无需任何上游改动 |

## 影响

- `src/quote-context.ts`：投递私有 kind + `form: 'notice'` + 有界 `summary`；重新声明 `MessageSourceMap` 增强；
- `src/source-kind.ts`：新增 `QUOTE_CONTEXT_KIND`（host 与 client 共享的接缝常量）；
- 新增 `src/client/quote-row.ts`（definition）与 `src/client/quote-row-view.tsx`（渲染器）；
- `src/client/index.tsx`：`inject` 增加 `uiConversation`；注册 definition 与 `conversation.chat.node` seat；
- `src/client/styles.ts`：新增 `[data-dsh-quote-row]` 段；
- 浏览器验收新增 6 条 REQ3 断言（kind、不重复、标签、几何、宿主折叠归属、展开控件）；
- ADR-0003 的「转录区不可实现」结论**被本 ADR 取代**：不可实现的只是「**私有 kind 的 `context` 注入行**」，
  换个 kind 就可行。ADR-0002 对 `isVisibleChatNode` 的分析仍然成立。
