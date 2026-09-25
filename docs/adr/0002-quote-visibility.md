# ADR-0002: 引文的可见性落在 composer，不在转录区

- 状态：已采纳
- 日期：2026
- 涉及：dsh-quote（引文注入工具）
- 取代：0.2 的「转录区注入卡片」方案（`src/client/context-rows.ts` + `styles.ts` 的 `[data-dsh-quote-context]` 段）

## 背景

0.2 试图把「这条引文被注入了」显示成转录区里的一张卡片。做法是：给宿主渲染的注入上下文行打一个 `data-dsh-quote-context` 标记（靠匹配 `[data-context-source]` 的文本 `quote-context`），再用 CSS 把它重扮成卡片。

用户报告：**界面上看不到这张卡片**。

实测复现（隔离 profile + 真实 Chrome，真实注入一次引文）：

- 引文**确实进了模型上下文**——助手回复里直接提到了引文内容（"现在注入的引文正文ABC"）；
- 但转录区**一行都没有产生**：`document.querySelectorAll('[data-dsh-quote-context]').length === 0`，且整个会话里**不存在任何 `data-chat-flow-kind="context"` 的行**。

## 根因

宿主在**渲染之前**就把普通注入上下文行过滤掉了，插件没有任何可标记、可着色的 DOM。

`packages/client/ui-chat/src/client/contract/chat-visibility.ts`：

```ts
export function isVisibleChatNode(node: ChatNode): boolean {
  return node.visibility === 'visible'
    && node.kind !== 'system-prompt'
    && (node.kind !== 'context'
      || node.data.content.some(block => block.type === 'tool-addition' || block.type === 'tool-removal'))
    && !(node.kind === 'command' && node.data.name === 'permission')
}
```

即：**只有携带工具增删的 `context` 节点才会在转录区出现**。引文是纯 text block，永远命中不了这个条件。`orderedVisibleChatNodes()`（同包 `conversation-nodes/chat-snapshot-builder.ts`）在排序前就 `nodes.filter(isVisibleChatNode)`，所以行根本不会进入可见 Chat 节点集合。

顺带澄清两个**不是**原因的东西，避免下次误判：

- `conversation.chat.node` 的 `context` renderer **是**注册着的（`ui-chat` 的 `apply` 里 `key: "context"`），只是对我们的节点永远不会被调用；
- `isVisibleChatNode` 与 `TURN_PROCESS_INDEPENDENT_KINDS` 是**两套独立机制**；后者不涉及 `context`（该集合只含 system-prompt/user/steering/turn-trigger/turn-process/turn-error/turn-max-tokens/turn-tail），把行卷进 turn-process 折叠是另一回事，与"行压根不存在"无关。

因此：**转录区卡片是不可实现的**，不是选择器写错了。任何依赖"宿主会渲染我这行"的方案都会静默失效——0.2 的 `tests/source-kind.spec.ts` 用**自造的 fixture** 断言标记生效，所以单元测试全绿而真实界面全空。

## 决策

**引文的可见面只放在插件真正拥有的 composer；转录区不再尝试。**

1. **发送前**：待生效引用继续以卡片排在 composer 卡片内（`conversation.input.overlay`），可移除——这条 0.2 已经是对的。
2. **发送瞬间**：卡片**立即消失**（实测 231ms），不等轮询。用户按下发送后 composer 应当马上看起来"已提交"；等最多一个轮询周期（2s）才收起，手感就是错的。
3. **发送后**：宿主在 `agent/pre-step` 折叠时把实际注入的引文记进一个有界的 per-session 记录（`SentQuoteStore`），composer 轮询到后显示一张**回执卡**（`data-dsh-quote-receipt`），说明这段引文确实随刚才那条消息作为上下文注入了，约 12 秒后自动消失，也可手动关掉。
4. **引文的权威记录仍是 session log**：注入消息带 durable `source.kind === 'quote-context'`（ADR-0001）。回执只是显示便利，不持久化、不跨会话、有上限。

### 发送即认领（claim）：卡片不再回来

发送瞬间清空的**触发信号是草稿被清空**——按下 Enter 会提交并清空可编辑区。

早期版本用"回合开始"（停止控件出现）做上升沿，**这是错的**：agent 已经在思考时发送，没有上升沿可捕获，卡片一直挂着。这是第一次修正（实测回合中发送 **4ms**，空闲 **222–230ms**）。

但**只做 DOM 隐藏仍然不够**。第二次修正的原因：agent 忙时发送**不会开始新回合**（消息排队，agent 继续干活），引用在宿主侧**合法地**仍是 pending，于是轮询把卡片刷回来，并一直停到那个排队消息被处理为止。实测：

```
sent+0.8s   rail=false  hostPending=1   ← 乐观隐藏
sent+5s     rail=true   hostPending=1   ← 刷回来了
sent+30s    rail=true   hostPending=1   ← 仍停着（agent 还在思考）
sent+45s    rail=false  hostPending=0   ← 直到回合结束才走
```

对"已经把它发出去"的用户来说，停 40 秒就是 bug。**修法是把认领落到宿主**：发送时 client 调 `POST /dsh-quote/api/claim`，`QuoteStore.claim()` 给当前所有 pending 打上 `claimed`；`GET /quotes` 只返回**未认领**的（`staged()`），于是卡片不再回来。引用**仍留在 store 里**，折叠照常注入它。

**认领只改呈现，绝不丢引用**——实测（回合中 staged → 发送 → 问模型口令）：

```
rail visible 4s after send: false          ← 卡片不回来
quote drained and recorded as sent: true   ← 折叠仍然注入并记账
MODEL ECHOED THE QUOTE: true               ← 模型确实收到了（回显 ZXQ-7788）
```

## 补充：卡片"发送后不消失"的两种成因

修复过程中收到第二个报告："引用的卡片在对话后还停留在输入框中"。它有**两种成因**，都已在上面处理：一是回合被占用、折叠按设计不消费（下面详述）；二是**清空只等轮询**，最多 2 秒才收起，手感像"没反应"——后者已由"发送瞬间乐观清除"解决。

**现象**：staged 一条引用 → 发送 → 采样 60 秒 `hostPending` 恒为 1，卡片不消失。

**根因**（用 `DSH_QUOTE_TRACE` 逐步记录 `agent/pre-step` 得到）：那个回合的 agent 正卡在一个 **50 次工具调用**的循环里（session log 只有 1 个 turn，却有 41 条 assistant message、50 次 tool/call，最后一条事件是 `step/start`）。agent 一直没回到用户侧，所以：

- 新消息排队，**从未成为新回合**（session log 里 `turn/start` 计数始终是 1）；
- `agent/pre-step` 持续以 `claimed=[]` 触发（39 次连续空 claim），`isRealUserTurn` 因此为 false；
- 折叠按设计**不消费**引用——引用属于"下一次真正带用户文字的回合"，而那个回合还没到来。

对照同一份 trace 里正常的会话：每一次 `pending 1->0 injected=1`，且 `claimed=[user]`。差别**只**在于回合是否真正开始，与折叠逻辑无关。折叠的纯逻辑由 `tests/quote-fold.spec.ts` 覆盖，全部通过。

**留作诊断手段**：设 `DSH_QUOTE_TRACE=<文件路径>` 可让 host 半端每收到一次 `agent/pre-step` 追加一行 JSON（claim 到的 `source.kind`、队列前后长度、实际注入条数）。引用没被消费时，从外部**看不到**折叠的前置条件，没有这个 trace 就无法区分"折叠没跑"与"回合没开始"。

**已知的体验缺口**（已修）：agent 长时间占用回合时，输入的草稿会滞留、引用卡片一直挂着，而 UI 不解释原因。**引用的排队语义不改**（插件不该自行消费引用），改的是**说明**：引用卡片的副标题现在会区分状态——

- 回合进行中 → 「回合进行中，稍后随你的消息发出」；
- 空闲且已等待超过 3 秒 → 「发送后随你的消息作为上下文」；
- 其余情况 → 照旧显示来源行（如「助手消息」）。

回合是否在跑，从 DOM 上唯一可靠的信号是宿主自己的停止控件（`[aria-label*="停止"]`）——插件不 import 宿主内部状态（client 纯度门）。

**另查明：闸门与落点读的不是同一个集合，但不构成缺陷。** 折叠在 `isRealUserTurn(claimed)` 上判断（loop 本步从收件箱取走的消息），却在 `decision.messages` 上定位插入点（真正进入本步的消息）。实测记录两者（`claimedKinds` / `enteringKinds`）跑了 9 次 pre-step：唯一一次分歧是 `claimed=[user]` vs `entering=[user,runtime-context]`，即**两者对"是否含 user 消息"判断始终一致**，从未出现"entering 有 user 而 claimed 没有"的情形（0 次）。所以闸门读 claimed 是安全的，未作改动。该结论由 `tests/quote-fold.spec.ts` 中的两条新用例钉住：空 claim 的续跑步骤必须保留引用，且连续 39 次空 claim 之后的下一个真实用户回合仍能消费它。

**同时修掉一个潜在的数据丢失**（`tests/fold-atomicity.spec.ts`）：折叠原本**先 `take` 再构造消息**，一旦构造抛错，队列已空、消息没注入，而调用方的 `catch` 会把错误吞掉——用户看到卡片消失，以为成功了，其实引文丢了。现改为**先把全部消息构造出来、再落定 drain**，失败即整批保留、留给后续回合重试。

如实标注**影响范围**：这是**潜在**缺陷，不是本次观测到的现象。现役工厂 `buildContextUserMessage` 走 `structuredClone`，对 HTTP 桥能送达的一切字符串都成立（普通文本、20 万字符、孤立代理项、甚至 `text` 缺失）。修在折叠层，是因为不变量归它所有——将来换工厂或改桥的校验，都不该重新引入这种丢失。

## 备选方案与取舍

| 方案 | 结论 | 理由 |
|---|---|---|
| 继续在转录区打标记 / 换选择器 | 拒绝（不可行） | 行在 `isVisibleChatNode` 处被过滤，渲染器根本不被调用；没有 DOM 可标记 |
| 让引文携带 tool-addition block 以"骗过"可见性 | 拒绝 | 会给模型伪造工具变更语义，污染模型可见内容去换一个装饰效果 |
| 向宿主提需求：给注入行留可见性钩子 | 记录为上游诉求 | 是唯一能真正在转录区显示的正路，但属于 harness 改动，插件侧不可控；在它落地前本 ADR 是当前取舍 |
| 回执常驻直到用户关闭 | 拒绝 | 它报告的是已发生的一次性事件，常驻会把 composer 变成第二本流水账 |
| 只做 composer 内联卡、发送后彻底消失 | 拒绝 | 用户失去"我的引文到底进去了没有"的确认——而转录区恰恰不会给这个确认 |

## 影响

- 删除 `src/client/context-rows.ts`（整个转录区标记机制）；
- `styles.ts` 移除 `[data-dsh-quote-context]` 段，新增 `[data-dsh-quote-receipt]` 段；
- host 新增 `SentQuoteStore` 与 `/dsh-quote/api/sent` 的 GET/DELETE；`agent/pre-step` 折叠加一次"实际注入了什么"的记录；
- `AGENTS.md`/README 中"转录区卡片"的描述作废，改写为 composer 回执；
- 单元测试不再用自造 fixture 断言宿主行为：`tests/source-kind.spec.ts` 现在钉住的是"kind 是 durable attribution、且**不是**转录区句柄"这一事实。
