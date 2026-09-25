# dsh-quote

**DSH 极简插件：把对话里选中的一段文字，作为「注入上下文」随下一条消息喂给模型，方便接着它继续提问。**

选中任意文字块（assistant / 你自己 / tool 输出）→ 松手弹出菜单 →「添加到对话」→ 那段作为注入上下文，只在你**下一次发送的真实用户消息**时生效一次，用完即走，**不进你消息正文**。

## 为什么是这样（简短）

- 引文是**注入上下文**而非拼进 user 消息——保持你的问题文本干净，模型能清楚区分"你引用的旧内容"与"你新写的意图"。
- **必须双面 host + client**：DSH 的浏览器端没有往模型上下文写入的通道，"注入"只能由 host 在 `agent/pre-step` 折叠（mirror 官方 `agent-instructions` 注入 `<system-reminder>` 的做法）。详见 `docs/adr/0001-quote-as-injected-context.md`。

## 行为（确认稿）

- 来源范围：任意文字块（不限 assistant / 自己 / tool）
- 触发：划选松手后在选区上方弹出胶囊菜单「复制文本 / 添加到对话」
- 落点：排一条"待生效引用"；每条以附件卡片显示在输入框卡片内（引文 + 来源行类型），可移除；卡片副标题会区分状态——回合进行中说「回合进行中，稍后随你的消息发出」，空闲等待说「发送后随你的消息作为上下文」
- 语义：一次性、对下一条真实用户消息注入、随即清除；不跨会话、不持久化
- 命名：`dsh-quote`，菜单文案「添加到对话」

> 引用只在**下一个真正带用户文字、且从收件箱取到该消息的回合**生效。agent 正卡在长工具循环里时，那个回合还没开始，引用会如实等待——这不是卡死，卡片会说明原因。诊断这类问题用 `DSH_QUOTE_TRACE=<文件>`。

## 词汇与决策

- 领域词汇 → [`CONTEXT.md`](CONTEXT.md)
- 核心取舍 → [`docs/adr/0001-quote-as-injected-context.md`](docs/adr/0001-quote-as-injected-context.md)、[`docs/adr/0002-quote-visibility.md`](docs/adr/0002-quote-visibility.md)

## 技术落点（已实现）

- **client 挂载点**：会话级 slot `conversation.input.overlay`（`src/client/index.tsx` 注册 `QuoteDock`）。该槽渲染在 composer 卡片内部顶端的零高锚点上，所以引用卡片能像附件一样压在输入框里；`conversation.input.dock` 是卡片**上方**的全宽槽位，`conversation.input.attachments` 是被官方图片附件占用的 single 槽，两者都不合适。
- **选区捕获**：文档层 `mouseup` 捕获监听（`selectionchange` / `scroll` 只负责收起）；选区非空且命中 `[data-chat-flow-key]` 时 → `window.getSelection().toString()` + 行 `data-chat-flow-kind`（`src/client/quote-dock.tsx`）。
- **静默入队 / 引用卡片**：`QuoteDock` 经自有 HTTP API（`src/client/api.ts`）把引文交给 host；每条待生效引用渲染为一张附件卡片（`data-dsh-quote-rail`），卡片副标题是来源行类型，hover 出移除按钮。
- **注入**：host 端（`src/index.ts`）`agent/pre-step` 一次性折叠（`src/quote-fold.ts`），仅跟随真实用户回合，注入后清空（`src/quote-store.ts`）；注入消息带本插件自有的 durable source（`src/quote-context.ts`）。
- **来源类型（source kind）**：0.1.7 起 harness 取消了通用的 `plugin` source kind——**生产者各自声明自己的 kind**（`declare module '@deepseek-ai/dsh-llm'` 扩展 `MessageSourceMap`，与 `dsh-subagent` / `dsh-skill` 同款）。本插件声明 `quote-context`，`form: 'notice'`。它是**注入消息的 durable 归属**（session log 里认得出这条引文），**不是**转录区句柄——没有可着色的行。字符串常量放在零依赖叶子 `src/source-kind.ts`，host 与 client 两半共享（client 不能 value-import host 模块，否则触发 bundle purity gate）。
- **发送后的回执**：宿主在折叠时把**实际注入**的引文记进 `SentQuoteStore`（有界、per-session、只在内存）；`QuoteDock` 轮询 `/dsh-quote/api/sent` 得到后渲染一张回执卡（`data-dsh-quote-receipt`，约 12 秒 TTL，可手动关掉）。发送过程中 `agent/pre-step` 前后对比队列差集来判定"这一步注入了什么"，因为 `foldPendingQuotes` 是纯函数、只返回 decision。
- **转录区不能显示引文（0.2 的错误假设）**：0.2 试图把注入行重扮成转录区卡片，实测**界面上什么都不显示**——宿主在渲染前就把普通注入上下文行过滤掉了（`ui-chat` 的 `isVisibleChatNode` 只放行携带工具增删的 `context` 节点），根本没有可标记的 DOM。引文确实喂给了模型（助手会提到引文内容），但转录区一行都不产生；`conversation.chat.node` 的 `context` renderer 虽然注册着，对我们的节点永远不会被调用。转录区卡片因此**不可实现**，与选择器无关。见 [`docs/adr/0002-quote-visibility.md`](docs/adr/0002-quote-visibility.md)。

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

24 项断言覆盖：bundle 进入 `__DSH_BOOT__`、dock 挂载并轮询自有 API、`conversation.input.overlay` 落在 composer 卡片内、host HTTP 桥往返、真实鼠标划选弹出菜单、卡片入 rail、下一次真实用户回合注入后 composer 出现回执卡、转录区确认**没有**注入行（ADR-0002 前提）、一次性队列排空。脚本会自行处理宿主首启的「内测声明」弹窗（与插件无关）。

> 注：转录区那条断言断言的是"行不存在"。宿主哪天开始渲染普通注入行，这条会失败——那时应当把界面换成真正的转录区卡片，而不是删掉断言。

**运行时兼容**：本插件面向 `@deepseek-ai/dsh` **0.1.7-rc.2**。0.1.7 的两处破坏性变更已适配：`source.kind: 'plugin'` 不再存在（改为自定义 kind），以及转录行生产者标签改为从 `source.kind` 推导。peer/dev 范围随之钉在 `^0.1.7-rc.2` / `0.1.7-rc.2`。

**架构约束**：
- client bundle 禁止 value-import 其他 `@deepseek-ai` 模块（client 纯度门）；与 DSH 交互只走公开 slot / 自有 HTTP 桥。host/client 共享的字符串常量必须放零依赖叶子（如 `src/source-kind.ts`），不能从 host 模块导出给 client 用。
- **宿主自带的包只能是 `peerDependencies`，绝不能进 `dependencies`**。profile 是独立的 hoisted pnpm 工程，而宿主自己的包在全局 `dsh` 那棵树里，插件往上找 `node_modules` 走不到——声明成 `dependencies` 就会被就地再装一份，插件的裸 import 绑到第二份实例上。表现是 profile 照常启动、**每条对话在第一次工具调用处静默死掉**，日志里没有"模块重复"提示。`link:` 安装只放软链所以看不出问题，`file:<tgz>`（桌面分发用的形态）才会暴露；唯一例外是插件要 spawn 成独立进程用的包。`pnpm verify` 与 `tests/dependency-face.spec.ts` 双向拦住这个回归。
- 引文 = 注入上下文（不进 user 消息正文）、双面 host + client——不可逆取舍见 `docs/adr/0001-quote-as-injected-context.md`。
