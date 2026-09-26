# dsh-quote

**DSH 极简插件：把对话里选中的一段文字，随你的下一条消息一起送进对话。**

选中任意文字块（assistant / 你自己 / tool 输出）→ 松手弹出菜单 →「添加到对话」→ 那段文字先以卡片排在输入框里（可移除）→ 你按下发送，**卡片立即消失**，引文作为一条**独立的用户消息**排在你自己那条消息之前进入对话，用完即走。

## 为什么是这样（简短）

- 引文是**独立的一条 user 消息**，不拼进你的消息正文——你的问题文本保持干净，模型能清楚区分"我引用的旧内容"与"我新写的意图"（ADR-0001 的原始意图）。
- 它必须是 `source.kind === 'user'`：GUI 只把 user kind 的消息渲染成转录区气泡，任何插件私有 kind 的注入行都会在渲染前被滤掉（实测见 ADR-0002）。这是"引文可见"能成立的唯一途径，见 `docs/adr/0003-quote-as-user-message.md`。

## 行为（确认稿）

- 来源范围：任意文字块（不限 assistant / 自己 / tool）
- 触发：划选松手后在选区上方弹出胶囊菜单「复制文本 / 添加到对话」
- 落点：排一条"待生效引用"；每条以附件卡片显示在输入框卡片内（引文 + 来源行类型），可移除；卡片等待超过 3 秒后副标题说明「发送后随你的消息作为上下文」
- 发送：卡片**立即消失且不会回来**（即使 agent 正忙、消息只是排队）
- 语义：一次性、对下一条真实用户消息投递、随即清除；不跨会话、不持久化
- 转录区：引文显示为你的一条用户气泡，位置在你自己的消息**之前**
- 命名：`dsh-quote`，菜单文案「添加到对话」

> 引用只在**下一个真正带用户文字**的回合投递。agent 正卡在长工具循环里时，那个回合还没开始，引用会如实等待——**但 composer 里的卡片此时已经随发送消失了**，不会挂在那里。诊断这类问题用 `DSH_QUOTE_TRACE=<文件>`。

## 词汇与决策

- 领域词汇 → [`CONTEXT.md`](CONTEXT.md)
- 核心取舍 → [`docs/adr/0001-quote-as-injected-context.md`](docs/adr/0001-quote-as-injected-context.md)、[`docs/adr/0002-quote-visibility.md`](docs/adr/0002-quote-visibility.md)、[`docs/adr/0003-quote-as-user-message.md`](docs/adr/0003-quote-as-user-message.md)

## 技术落点（已实现）

- **client 挂载点**：会话级 slot `conversation.input.overlay`（`src/client/index.tsx` 注册 `QuoteDock`）。该槽渲染在 composer 卡片内部顶端的零高锚点上，所以引用卡片能像附件一样压在输入框里；`conversation.input.dock` 是卡片**上方**的全宽槽位，`conversation.input.attachments` 是被官方图片附件占用的 single 槽，两者都不合适。
- **选区捕获**：文档层 `mouseup` 捕获监听（`selectionchange` / `scroll` 只负责收起）；选区非空且命中 `[data-chat-flow-key]` 时 → `window.getSelection().toString()` + 行 `data-chat-flow-kind`（`src/client/quote-dock.tsx`）。
- **静默入队 / 引用卡片**：`QuoteDock` 经自有 HTTP API（`src/client/api.ts`）把引文交给 host；每条待生效引用渲染为一张附件卡片（`data-dsh-quote-rail`），卡片副标题是来源行类型，hover 出移除按钮。
- **发送即清除（需求 2 的落点）**：按下发送时 `QuoteDock` 把当前所有 staged 引文的 **id 记进 `submittedRef`** 并清空 rail；此后每次轮询结果都先滤掉这些 id。**记住 id 而不是等一个时间窗**，是因为 agent 忙时引用在宿主侧会合法地长时间保持 pending，时间窗一过卡片必然复活。同时 `POST /claim` 让宿主把引用标记为已提交（权威半边），等它不再报告这些 id 后本地记录回收。
- **投递**：host 端（`src/index.ts`）`agent/pre-step` 一次性折叠（`src/quote-fold.ts`），仅跟随真实用户回合，投递后清空（`src/quote-store.ts`）。引文由 `src/quote-context.ts` 构造成**普通 user 消息**（`source.kind: 'user'`），插在该步最后一条真实用户消息**之前**，因此在转录区渲染为你自己的用户气泡（`data-chat-flow-kind="user"`）。
- **转录区不需要插件介入**：GUI 对 user kind 消息自行渲染气泡，插件不注册任何 renderer、不加任何 CSS。这也意味着**没有回执卡**——引文自己就是确认，见 ADR-0003。

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

断言覆盖三条需求：bundle 进入 `__DSH_BOOT__`、dock 挂载并轮询自有 API、`conversation.input.overlay` 落在 composer 卡片内、host HTTP 桥往返、真实鼠标划选弹出菜单、卡片入 rail、**发送后卡片立即消失且 60 秒内不复活**、**引文在转录区渲染为一条位于用户消息之前的 user 气泡**、一次性队列排空。脚本会自行处理宿主首启的「内测声明」弹窗（与插件无关）。

**运行时兼容**：本插件面向 `@deepseek-ai/dsh` **0.1.7-rc.2**。peer/dev 范围钉在 `^0.1.7-rc.2` / `0.1.7-rc.2`。

**架构约束**：
- client bundle 禁止 value-import 其他 `@deepseek-ai` 模块（client 纯度门）；与 DSH 交互只走公开 slot / 自有 HTTP 桥。host/client 共享的字符串常量必须放零依赖叶子（如 `src/source-kind.ts`），不能从 host 模块导出给 client 用。
- **宿主自带的包只能是 `peerDependencies`，绝不能进 `dependencies`**。profile 是独立的 hoisted pnpm 工程，而宿主自己的包在全局 `dsh` 那棵树里，插件往上找 `node_modules` 走不到——声明成 `dependencies` 就会被就地再装一份，插件的裸 import 绑到第二份实例上。表现是 profile 照常启动、**每条对话在第一次工具调用处静默死掉**，日志里没有"模块重复"提示。`link:` 安装只放软链所以看不出问题，`file:<tgz>`（桌面分发用的形态）才会暴露；唯一例外是插件要 spawn 成独立进程用的包。`pnpm verify` 与 `tests/dependency-face.spec.ts` 双向拦住这个回归。
- 引文 = 独立 user 消息（不进用户消息正文）、双面 host + client——取舍见 `docs/adr/0001-quote-as-injected-context.md` 与 `docs/adr/0003-quote-as-user-message.md`。

