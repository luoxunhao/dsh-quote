# dsh-quote

**DSH 极简插件：把对话里选中的一段文字，作为「注入上下文」随下一条消息喂给模型，方便接着它继续提问。**

选中任意文字块（assistant / 你自己 / tool 输出）→ 右键 →「引用到对话」→ 那段作为注入上下文，只在你**下一次发送的真实用户消息**时生效一次，用完即走，**不进你消息正文**。

## 为什么是这样（简短）

- 引文是**注入上下文**而非拼进 user 消息——保持你的问题文本干净，模型能清楚区分"你引用的旧内容"与"你新写的意图"。
- **必须双面 host + client**：DSH 的浏览器端没有往模型上下文写入的通道，"注入"只能由 host 在 `agent/pre-step` 折叠（mirror 官方 `agent-instructions` 注入 `<system-reminder>` 的做法）。详见 `docs/adr/0001-quote-as-injected-context.md`。

## 行为（确认稿）

- 来源范围：任意文字块（不限 assistant / 自己 / tool）
- 触发：划选后右键菜单「引用到对话」
- 落点：排一条"待生效引用"；发送前有低调提示条、可移除
- 语义：一次性、对下一条真实用户消息注入、随即清除；不跨会话、不持久化
- 命名：`dsh-quote`，右键文案「引用到对话」

## 词汇与决策

- 领域词汇 → [`CONTEXT.md`](CONTEXT.md)
- 核心取舍 → [`docs/adr/0001-quote-as-injected-context.md`](docs/adr/0001-quote-as-injected-context.md)

## 技术落点（已实现）

- **client 挂载点**：会话级 slot `conversation.composer.dock`（`src/client/index.tsx` 注册 `QuoteDock`）。
- **选区捕获**：文档层 `contextmenu` 捕获监听；选区非空且命中 `[data-chat-flow-key]` 时 → `window.getSelection().toString()` + `useChat` 解析来源 `messageId`（`src/client/quote-dock.tsx`）。
- **静默入队 / 待生效提示条**：`QuoteDock` 经自有 HTTP API（`src/client/api.ts`）把引文交给 host；有 ≥1 条待生效引用时显示低调、可移除的提示条。
- **注入**：host 端（`src/index.ts`）`agent/pre-step` 一次性折叠（`src/quote-fold.ts`），仅跟随真实用户回合，注入后清空（`src/quote-store.ts`）；注入消息带 plugin source（`src/quote-context.ts`）。

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
```

**架构约束**：
- client bundle 禁止 value-import 其他 `@deepseek-ai` 模块（client 纯度门）；与 DSH 交互只走公开 slot / 自有 HTTP 桥。
- 引文 = 注入上下文（不进 user 消息正文）、双面 host + client——不可逆取舍见 `docs/adr/0001-quote-as-injected-context.md`。
