# Spec: dsh-quote — 把选中的对话文字作为注入上下文随下一条消息引用

Status: ready-for-agent

Feature slug: `dsh-quote`

## Problem Statement

用户在 DSH 对话里看到某段回答（或任意一段文字），想"接着这段继续提问"。目前只能手动把这段复制、粘进自己的下一条提问，或口头描述"你刚才说的那段"。复制粘贴会污染问题文本、丢失来源上下文，追问时引用与被追问对象边界模糊。

用户希望：在对话里划选一段文字 → 右键一键把它"引用到对话"→ 它作为一段**注入上下文**，随用户下一次真正发送的问题一起喂给模型——用户自己的问题保持干净，模型仍能清楚读到被引用的那段内容。

## Solution

一个极简 DSH 插件 `dsh-quote`：

划选任意文字块（assistant / 用户自己 / tool 输出）→ 右键菜单「引用到对话」→ 该会话排入一条**待生效引用** → 只在用户**下一次真实发送的消息**回合，作为一条带插件来源的**注入上下文**喂给模型 → 随即清除。引文**不进用户消息正文**，不跨会话、不持久化、用完即走。

实现必须是 **host + client 双面**：浏览器端没有往模型上下文写入的通道，"注入"只能由 host 在 `agent/pre-step` 折叠（mirror 官方 `agent-instructions` 注入 `<system-reminder>` 的做法）。此为 DSH 硬约束，详见 ADR-0001。

## User Stories

1. 作为 DSH 用户，我想在对话里划选任意一段文字块，以便把它作为引用内容喂给后续问题。
2. 作为 DSH 用户，我想在划选文字后通过右键菜单看到「引用到对话」动作，以便一键添加而不打断心流。
3. 作为 DSH 用户，我希望能引用 **assistant 的回答**里的文字，以便基于模型之前的输出继续追问。
4. 作为 DSH 用户，我希望能引用**我自己发过的消息**里的文字，以便澄清或修正我之前说的内容。
5. 作为 DSH 用户，我希望能引用 **tool 输出**里展示的文字，以便基于工具结果继续提问。
6. 作为 DSH 用户，当我右键点击的地方**没有非空文字选区**时，我不想看到「引用到对话」入口，以免误触。
7. 作为 DSH 用户，当我引用后，我希望那段内容作为**注入上下文**而非写进我的问题正文，以便我的问题保持干净、模型能区分引用与新增意图。
8. 作为 DSH 用户，我希望能**连续引用多段**（在发送前分别右键添加两段以上），以便一次综合多段内容追问。
9. 作为 DSH 用户，我希望这些待生效引用只作用于**当前这个对话会话**，以便不会污染其他会话或后续新对话。
10. 作为 DSH 用户，我希望被引用的内容**只随我下一条真实发送的消息生效一次**，以便用完即走、不长期占用上下文窗口。
11. 作为 DSH 用户，我希望在**发送前**能看到"已引用待生效"的低调提示并可移除，以便发现自己误加或忘记自己引用过什么。
12. 作为 DSH 用户，当模型在进行工具调用 / 中间步骤（没有我新发的文字）时，我不希望待生效引用被这些中间步骤消耗，以便它只作用于我真正写下的问题。
13. 作为 DSH 用户，当我发送的问题前没有任何待生效引用时，我希望消息行为与未安装本插件时完全一致，以便插件在不使用时零侵入。
14. 作为 DSH 用户，我希望引用动作本身**不做弹窗/闪烁反馈**（添加是静默排队），以便不打断心流。
15. 作为 DSH 用户，当我**刷新页面或会话被冷恢复**时，尚未发出的待生效引用可以丢失，以便实现保持简单（引用是短暂状态，不值得持久化）。

## Implementation Decisions

- 独立插件仓库 `dsh-quote`，host + client 双面包（`./client` bundle + host half），不并入 dsh-codex-project 等既有插件。
- **client 半端**
  - 挂载一个会话级组件到 slot `conversation.composer.dock`（对会话常驻、合法、不与其他视图冲突；不要用 `conversation.view`——那是替代整个视图的 tab，不是装饰）。
  - 在文档层挂 `contextmenu` 捕获监听：选区非空且命中 `[data-chat-flow-key]` 时，把选区文本 + 来源信息交给 UI。
  - 从选区解析来源：`window.getSelection().toString()` 作为"用户选中的文字"（渲染后文本，用户所见即所得）；沿 DOM `closest('[data-chat-flow-key]')` 取节点 key → 经 `useChat` snapshot 的 `nodes.get(key)` 解析出 `assistant-step` 节点的来源 `messageId` + blocks。**不做**从 DOM 反推源 markdown（高损耗、脆）。
  - 通过**自有 cordis service 方法**把"引文文本 + 来源 messageId + 会话 id"交给 host（client 纯度门禁止 value-import 其他 `@deepseek-ai` 模块）。
  - 引用动作静默入队，不弹窗；仅当该会话存在 ≥1 条待生效引用时，在发送前显示低调"待生效引用"提示条，可逐个移除。
- **host 半端**
  - 为每个会话维护**待生效引用队列**（纯内存、会话级；刷新/冷恢复即丢）。
  - 在 `agent/pre-step` 折叠：仅当该 step 携带**真实带用户文字**的消息时，把队列里所有待生效引用作为带插件来源的注入上下文插入该 step（mirror `agent-instructions` 的 `<system-reminder>` 注入方式），注入后清空队列。中间 assistant / tool 步骤不消耗。
  - 多条待生效引用**累积**到同一条真实用户消息一起注入。
- 数据/类型面沿用 dsh 会话事件模型（`user/message` + plugin source），注入后由现有事件投影自然渲染。
- 领域词汇见 `CONTEXT.md`；整体不可逆取舍（引文=注入上下文、双面 host）见 `docs/adr/0001-quote-as-injected-context.md`。

## Testing Decisions

- **好的测试只测外部行为**，不测实现细节：断言"给定某会话有 N 条待生效引用 + 一条真实用户消息，`agent/pre-step` 的结果包含这些注入上下文且队列被清空"；以及"没有真实用户文字（纯 assistant/tool step）时待生效引用不被消耗"。
- **host 折叠 seam**（首选、最高 seam）：把"待生效引用 → 折叠进带真实用户消息的 step → 清空队列"实现为可注入会话表面的纯逻辑，单测驱动。先例：dsh-codex-project 的 `context-injection.spec.ts`（`foldWorkspaceContext` / `computeWorkspaceReminder` / `hasIdenticalInjection`，用真实 `Session.eventAt` 表面 fixture 测试去重与折叠位置）。
- **client 捕获 seam**：jsdom 下验证"有非空选区 + 命中 `[data-chat-flow-key]` → 出队；无选区/不在文字块上 → 不出现入口"。先例：dsh-codex-project 的 `client-apply.spec.tsx`。
- **形态 seam**：插件导出形态（host `name/inject/apply`、client `inject/apply`）单测。先例：dsh-codex-project 的 `plugin-shape.spec.ts`。

## Out of Scope

- 引文跨会话 / 全局持久化（待生效引用用完即走）。
- 常驻"钉住/记住"上下文或记忆（与 dsh-mnemon 等功能区分）。
- 从 DOM 选区反推源 markdown / 精确子串对齐。
- 侧边对话、继承整线程追问（better-sidebar 侧边对话已覆盖）。
- 只读上下文洞察面板（dsh-context 已覆盖）。
- 本次 spec 不含插件骨架的完整构建/打包/发布细节。

## Further Notes

- 因浏览器端无上下文写入通道，本插件**必须 host+client 双面**；"注入上下文由 host 在 `agent/pre-step` 做"是不可逆取舍，已由 ADR-0001 记录。
- client 纯净门禁止 value-import 其他 `@deepseek-ai` 模块；选区到消息 id 的解析不依赖 ui-chat 渲染器，走 `composer.dock` + `useChat` snapshot，避免接管 `assistant-step` 渲染。
- 待生效引用用纯内存、会话级队列承载即可，不必随会话持久化。
