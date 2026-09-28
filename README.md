# dsh-quote

**DSH 极简插件：把对话里选中的一段文字，作为「引用上下文」随你的下一条消息送进对话。**

选中任意文字块（assistant / 你自己 / tool 输出）→ 松手弹出菜单 →「添加到对话」→ 那段文字先以卡片排在输入框里（可移除）→ 你按下发送，**卡片立即消失**，引文作为一条带标签的**「引用上下文」折叠行**出现在对话里，用完即走。

## 为什么是这样（简短）

- 引文**不拼进你的消息正文**——你的问题文本保持干净，模型能清楚区分"我引用的旧内容"与"我新写的意图"（ADR-0001 的原始意图）。
- 引文**不伪装成你自己的消息**：它以插件私有的 `source.kind` 投递，再由插件注册的 Conversation definition 渲染成一条可区分的引用行。这样你一眼能分辨"这是我引用的"与"这是我自己说的"，见 `docs/adr/0004-quote-as-own-chat-node.md`。
- **为什么不能靠默认投影**：宿主按 `source.kind` 分类每一条 `user/message`——`kind: 'user'` 会变成你无法改造的用户气泡；其它任何 kind 会变成被 `isVisibleChatNode` 滤掉的 `context` 节点。插件只能靠**自己的 node kind** 逃出这两条路。

## 行为（确认稿）

- 来源范围：任意文字块（不限 assistant / 自己 / tool）
- 触发：划选松手后在选区上方弹出胶囊菜单「复制文本 / 添加到对话」
- 落点：排一条"待生效引用"；每条以附件卡片显示在输入框卡片内（引文 + 来源行类型），可移除；卡片等待超过 3 秒后副标题说明「发送后随你的消息作为上下文」
- 发送：卡片**立即消失且不会回来**（即使 agent 正忙、消息只是排队）
- 语义：一次性、对下一条真实用户消息投递、随即清除；不跨会话、不持久化
- 转录区：引文显示为一条 **「引用上下文」** 折叠行，折叠时显示有界摘要，点击展开看完整引文
- 长引文：卡片只渲染有界预览（全文在 tooltip 里）；注入给模型的内容带一行头部说明来源与行数，正文逐字保留
- 上限：单条引文最多 **200000 字符**，超出会**拒绝并在输入框里说明原因**（不做截断——截断会注入你没选的内容）
- 命名：`dsh-quote`，菜单文案「添加到对话」

> 引用只在**下一个真正带用户文字**的回合投递。agent 正卡在长工具循环里时，那个回合还没开始，引用会如实等待——**但 composer 里的卡片此时已经随发送消失了**，不会挂在那里。诊断这类问题用 `DSH_QUOTE_TRACE=<文件>`。

> **已知边界（宿主行为，插件无法控制）**：引文行会随回合结束被宿主收进「回合过程」折叠组。回合**进行中**它露在外面；回合结束后需要展开宿主的折叠组才能看到。原因见 ADR-0004。

## 词汇与决策

- 领域词汇 → [`CONTEXT.md`](CONTEXT.md)
- 核心取舍 → [`docs/adr/0001-quote-as-injected-context.md`](docs/adr/0001-quote-as-injected-context.md)、[`docs/adr/0002-quote-visibility.md`](docs/adr/0002-quote-visibility.md)、[`docs/adr/0003-quote-as-user-message.md`](docs/adr/0003-quote-as-user-message.md)、[`docs/adr/0004-quote-as-own-chat-node.md`](docs/adr/0004-quote-as-own-chat-node.md)

## 技术落点（已实现）

- **client 挂载点**：会话级 slot `conversation.input.overlay`（`src/client/index.tsx` 注册 `QuoteDock`）。该槽渲染在 composer 卡片内部顶端的零高锚点上，所以引用卡片能像附件一样压在输入框里；`conversation.input.dock` 是卡片**上方**的全宽槽位，`conversation.input.attachments` 是被官方图片附件占用的 single 槽，两者都不合适。
- **选区捕获**：文档层 `mouseup` 捕获监听（`selectionchange` / `scroll` 只负责收起）；选区非空且命中 `[data-chat-flow-key]` 时 → `window.getSelection().toString()` + 行 `data-chat-flow-kind`（`src/client/quote-dock.tsx`）。
- **静默入队 / 引用卡片**：`QuoteDock` 经自有 HTTP API（`src/client/api.ts`）把引文交给 host；每条待生效引用渲染为一张附件卡片（`data-dsh-quote-rail`），副标题是来源行类型，hover 出移除按钮。卡片标题是**有界预览**（`quotePreview`），全文在 `title` 属性里。
- **提交即声明（需求 2 的落点）**：`QuoteDock` 在**提交按键**（裸 Enter / 发送按钮）上调用 `POST /claim`，然后**显示宿主报告的状态**。客户端**不**自己决定什么已发送 —— 早期版本用"草稿变空"作为发送信号，无法区分「发送」与「退格删除」，导致删除草稿时卡片永久消失而引文仍被静默注入。
- **超限拒绝**：`quoteLimitError` 在客户端（即时反馈）与宿主（权威，`413`）各判一次；拒绝原因显示在 composer 卡片内的 `data-dsh-quote-notice` 里。
- **文本整形（`src/quote-text.ts`）**：零依赖叶子，host 与 client 共用。`quoteSummary`（80，折叠行）/ `quotePreview`（240，卡片）/ `quoteFrame`（模型输入，头部 + 逐字正文）/ `quoteLimitError`（上限）。
- **投递**：host 端（`src/index.ts`）`agent/pre-step` 一次性折叠（`src/quote-fold.ts`），仅跟随真实用户回合，投递后清空（`src/quote-store.ts`）。引文由 `src/quote-context.ts` 构造成一条带**私有 `source.kind`**（`quote-context`）的 user-role 消息，附 `form: 'notice'` 与有界 `summary`，插在该步最后一条真实用户消息**之前**。
- **引文行（需求 3 的落点）**：`src/client/quote-row.ts` 注册一个 Conversation definition，认领 `source.kind === 'quote-context'` 的 append-surface `user/message` 事件，产出 `quote` 节点；`src/client/quote-row-view.tsx` 作为 `conversation.chat.node` 的 `key: 'quote'` 渲染器，画成「引用上下文」+ 摘要的可展开行。
  - **为什么可行**：`isVisibleChatNode` 是 **kind 黑名单**（只排 `system-prompt` / `context` / permission command），自定义 kind 默认可见；`ChatNodeDataMap` 是公开的插件合并面；`ctx.uiConversation.events.register` 是官方自用的注册口。
  - **为什么不重复**：官方 `messageDefinition` 也认领同一事件，但它的副本投影成 `context` 节点被滤掉，只有我们的 `quote` 节点可见（实测 user bubble 0 / context row 0 / quote row 1）。
  - **纯度门**：与 `slots` 同款，走**结构化 context 面**注册，不引入任何 `@deepseek-ai` 值导入。

## 安装 / 挂载

```sh
dsh plugin --profile <name> add <dsh-quote 本地路径或包名>
```

装完**硬刷新浏览器**。client 改动热加载；host 改动需重启 `dsh web`。

## 开发

```bash
pnpm typecheck
pnpm build
pnpm test
pnpm verify   # typecheck + test + 安装面校验（pnpm pack 后装进一次性 pnpm 工程）
```

**真实浏览器验收**（对着一个真跑着的 `dsh --profile web` 服务）：

```bash
dsh --profile web --port 3099 --no-open          # 另开一个测试实例，别动你在用的那个
pnpm browser-test "http://127.0.0.1:3099/?token=<上一步打印的 token>"
```

断言覆盖三条需求：bundle 进入 `__DSH_BOOT__`、dock 挂载并轮询自有 API、`conversation.input.overlay` 落在 composer 卡片内、host HTTP 桥往返、真实鼠标划选弹出菜单、卡片入 rail、**发送后卡片立即消失且 60 秒内不复活**、**引文在转录区渲染为自己的 `quote` 行（非用户气泡、非被滤的 context）**、一次性队列排空。脚本会自行处理宿主首启的「内测声明」弹窗（与插件无关）。

> 注：「引文行是否在屏幕上」取决于宿主的回合过程折叠组是否展开，而后者由回合状态（`turnClosed`）决定。测试把**行已挂载、几何正常、归属宿主折叠**作为硬断言，把「是否可见」作为**上报项**而非门禁 —— 否则一个无模型凭据的 profile（回合瞬时失败关闭）会让套件因插件既未造成、也无法修复的原因失败。

**运行时兼容**：本插件面向 `@deepseek-ai/dsh` **0.1.7-rc.2**。peer/dev 范围钉在 `^0.1.7-rc.2` / `0.1.7-rc.2`。

**架构约束**：
- client bundle 禁止 value-import 其他 `@deepseek-ai` 模块（client 纯度门）；与 DSH 交互只走公开 slot / `uiConversation` 注册口 / 自有 HTTP 桥。host/client 共享的字符串常量必须放零依赖叶子（如 `src/source-kind.ts`），不能从 host 模块导出给 client 用。
- **宿主自带的包只能是 `peerDependencies`，绝不能进 `dependencies`**。profile 是独立的 hoisted pnpm 工程，而宿主自己的包在全局 `dsh` 那棵树里，插件往上找 `node_modules` 走不到——声明成 `dependencies` 就会被就地再装一份，插件的裸 import 绑到第二份实例上。表现是 profile 照常启动、**每条对话在第一次工具调用处静默死掉**，日志里没有"模块重复"提示。`link:` 安装只放软链所以看不出问题，`file:<tgz>`（桌面分发用的形态）才会暴露；唯一例外是插件要 spawn 成独立进程用的包。`pnpm verify` 与 `tests/dependency-face.spec.ts` 双向拦住这个回归。
- 引文 = 独立的一条**引用上下文**消息（不进用户消息正文、不伪装成用户消息），以插件私有的 source kind 投递 + 自注册 Chat Node kind 渲染——取舍见 `docs/adr/0001-quote-as-injected-context.md`、`docs/adr/0003-quote-as-user-message.md`、`docs/adr/0004-quote-as-own-chat-node.md`。

