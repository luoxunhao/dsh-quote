# dsh-quote

**DSH 极简插件：把对话里选中的一段文字，作为「注入上下文」随下一条消息喂给模型，方便接着它继续提问。**

选中任意文字块（assistant / 你自己 / tool 输出）→ 松手弹出菜单 →「添加到对话」→ 那段作为注入上下文，只在你**下一次发送的真实用户消息**时生效一次，用完即走，**不进你消息正文**。

## 为什么是这样（简短）

- 引文是**注入上下文**而非拼进 user 消息——保持你的问题文本干净，模型能清楚区分"你引用的旧内容"与"你新写的意图"。
- **必须双面 host + client**：DSH 的浏览器端没有往模型上下文写入的通道，"注入"只能由 host 在 `agent/pre-step` 折叠（mirror 官方 `agent-instructions` 注入 `<system-reminder>` 的做法）。详见 `docs/adr/0001-quote-as-injected-context.md`。

## 行为（确认稿）

- 来源范围：任意文字块（不限 assistant / 自己 / tool）
- 触发：划选松手后在选区上方弹出胶囊菜单「复制文本 / 添加到对话」
- 落点：排一条"待生效引用"；每条以附件卡片显示在输入框卡片内（引文 + 来源行类型），可移除
- 语义：一次性、对下一条真实用户消息注入、随即清除；不跨会话、不持久化
- 命名：`dsh-quote`，菜单文案「添加到对话」

## 词汇与决策

- 领域词汇 → [`CONTEXT.md`](CONTEXT.md)
- 核心取舍 → [`docs/adr/0001-quote-as-injected-context.md`](docs/adr/0001-quote-as-injected-context.md)

## 技术落点（已实现）

- **client 挂载点**：会话级 slot `conversation.input.overlay`（`src/client/index.tsx` 注册 `QuoteDock`）。该槽渲染在 composer 卡片内部顶端的零高锚点上，所以引用卡片能像附件一样压在输入框里；`conversation.input.dock` 是卡片**上方**的全宽槽位，`conversation.input.attachments` 是被官方图片附件占用的 single 槽，两者都不合适。
- **选区捕获**：文档层 `mouseup` 捕获监听（`selectionchange` / `scroll` 只负责收起）；选区非空且命中 `[data-chat-flow-key]` 时 → `window.getSelection().toString()` + 行 `data-chat-flow-kind`（`src/client/quote-dock.tsx`）。
- **静默入队 / 引用卡片**：`QuoteDock` 经自有 HTTP API（`src/client/api.ts`）把引文交给 host；每条待生效引用渲染为一张附件卡片（`data-dsh-quote-rail`），卡片副标题是来源行类型，hover 出移除按钮。
- **注入**：host 端（`src/index.ts`）`agent/pre-step` 一次性折叠（`src/quote-fold.ts`），仅跟随真实用户回合，注入后清空（`src/quote-store.ts`）；注入消息带 plugin source（`src/quote-context.ts`）。
- **转录区卡片**：注入的引文由宿主统一渲染成"上下文注入"折叠行，宿主没留按插件定制的缝——折叠行里唯一能辨出生产者的是 `[data-context-source]` 的**文本**（插件名，稳定标识）。所以 `src/client/context-rows.ts` 只给本插件的行打 `data-dsh-quote-context` 标记，CSS 仅重扮带标记的行，其余插件的注入行逐字节不变。行的位置由宿主按日志 `anchorSeq` 决定，插件改不了：转录区是一根扁平 flex 列，`order` 只会把行甩到整个会话的首尾，做不出与相邻一行交换。

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

**架构约束**：
- client bundle 禁止 value-import 其他 `@deepseek-ai` 模块（client 纯度门）；与 DSH 交互只走公开 slot / 自有 HTTP 桥。
- **宿主自带的包只能是 `peerDependencies`，绝不能进 `dependencies`**。profile 是独立的 hoisted pnpm 工程，而宿主自己的包在全局 `dsh` 那棵树里，插件往上找 `node_modules` 走不到——声明成 `dependencies` 就会被就地再装一份，插件的裸 import 绑到第二份实例上。表现是 profile 照常启动、**每条对话在第一次工具调用处静默死掉**，日志里没有"模块重复"提示。`link:` 安装只放软链所以看不出问题，`file:<tgz>`（桌面分发用的形态）才会暴露；唯一例外是插件要 spawn 成独立进程用的包。`pnpm verify` 与 `tests/dependency-face.spec.ts` 双向拦住这个回归。
- 引文 = 注入上下文（不进 user 消息正文）、双面 host + client——不可逆取舍见 `docs/adr/0001-quote-as-injected-context.md`。
