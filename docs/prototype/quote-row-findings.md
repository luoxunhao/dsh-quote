# 原型验证结论：自定义 Chat Node kind 的可行性与边界

日期：2026-09-26
约束：全程不修改任何 DSH 源码，只改 `E:\project\dsh\dsh-quote`。

> **状态：实验分支，勿发布。**
>
> 本文件所在分支 `prototype/quote-row` 是一次**方向验证**的结果，**不是**可交付版本：
>
> - `pnpm test` 有 **2 个失败用例**（`tests/source-kind.spec.ts`），它们断言
>   `source.kind === 'user'` 的旧契约，而本原型**故意**改成了私有 kind。这是预期状态。
> - 结论是**不建议**照此全面重构 —— 理由见文末「对产品决策的含义」。
> - 已验证可用的版本在 `main` 的 `2604ba3`（引文作为普通 user 消息，始终可见、不折叠）。

## 结论摘要

**「引文以自定义 Chat Node kind 渲染成注入风格卡片」技术可行，但无法脱离「回合过程」折叠组。**

## 已证实的部分（真实浏览器 + qtest :3099）

### 三个风险点全部通过

| 风险 | 结果 | 证据 |
|---|---|---|
| 与官方 `messageDefinition` 重复显示 | **不重复** | `quote ALSO as user bubble: 0`、`context row: 0` |
| Location key 冲突 / 注册被 reject | **无** | 控制台过滤输出为空 |
| 纯度门 / `uiConversation` 可达性 | **通过** | 构建无 `@deepseek-ai` 值导入；注册成功 |

### 行本身渲染正确

```
quote row elements       : 1
quote row chat-flow kind : "quote"        ← 不在可见性黑名单
rect                     : { h: 24, w: 737 }
display                  : flex
title                    : "引用上下文"
summary                  : "QSET… 设置模式可见性探针"
```

### 机制确认（读源码得到，与实测一致）

1. `isVisibleChatNode` 是**黑名单**（`system-prompt` / `context` / permission command），
   自定义 kind `quote` **放行** —— 这是可见性的基础。
2. 官方 `messageDefinition.match` 认领**每一个** `user/message`；
   但 `contextsBySeq` 是 `Set`，允许并存；官方副本产出 `context` 节点被滤掉，
   只剩我们自己的 `quote` 行 —— 因此**不重复**。
3. 纯度门只拦**值导入**；结构化拿到 `ctx.uiConversation` 即可（与现有 `ctx.slots` 同款）。

## 未解决的部分：行被折进「回合过程」

### 折叠判据（宿主硬编码）

```js
// ui-chat/lib/client.js
const TURN_PROCESS_INDEPENDENT_KINDS = new Set([
  "system-prompt", "user", "steering", "turn-trigger",
  "turn-process", "turn-error", "turn-max-tokens", "turn-tail"
])

const processMember = routedNode !== undefined && processWindowReady
  && !TURN_PROCESS_INDEPENDENT_KINDS.has(routedNode.kind)     // ← 'quote' 不在集合里
  && routedNode.anchorSeq >= processSpec.processStartSeq      // ← 引文必在回合内
  && (...)
```

- `TURN_PROCESS_INDEPENDENT_KINDS` 是**宿主常量**，没有任何插件扩展点。
- `processSpec.processStartSeq = turn.start.seq`；引文在回合中注入，
  `anchorSeq` 必然 ≥ 它。

**两条都命中 → 插件节点必然被折叠，且无法逃逸。**

### 唯一的喘息窗口

```js
const liveProcess = processPresentation !== undefined && !processPresentation.turnClosed
const alwaysOpen  = liveProcess || interleavedInput || turnProcessAlwaysOpen(routedNode)

function turnProcessAlwaysOpen(node) {
  return location.turn.status === "open" || reason === "aborted" || reason === "error"
}
```

即：**回合进行中**（`turnClosed === false`）折叠组强制展开，行会显示在屏幕上；
回合一结束就收起来。这也**不**取决于节点 kind。

### 实测印证

10ms 分辨率采样，按下 Enter 后：

```
   9ms  absent
 105ms  present collapsed=true     ← 首次出现即已折叠，从未可见过一帧
```

本 profile 无模型凭据，回合瞬间报错关闭 → `turnClosed` 立即为 true →
行首帧就被折进组里。这解释了为什么我在 `qtest` 里**永远测不到它可见**。

**因此"全程不可见"是本 profile 的产物，不是行的固有属性。** 在真实 profile
（回合持续运行）中，回合进行期间行应当可见，回合结束后被折叠收起。

### 「能展开吗」——实测回答

折叠是**两层**，从 disclosure 列表可直接读出：

```
{"label":"已完成分析","expanded":"false"}                          ← 宿主的回合过程折叠组
{"label":"引用上下文QEXP2… 展开可达性测试文本","expanded":"false"}  ← 我们自己的行
```

点击外层的「已完成分析」后 `y` 从 493 → 509，**确实展开了**，但行仍不可见。
完整祖先链（由内向外）说明了原因：

```
 0 div  h=  24  cls=dsh-quote-row      ← 行本身：尺寸正常
 1 div  h=   0  display: contents      ← 伪信号：不生成盒子，h=0 无意义
 2 div  h=  32  cls=EvIC1a_flowItem
 3 div  h=  32  cls=O_Ebla_content
 4 div  h=   0  cls=O_Ebla_body        ← 真正的折叠体（overflow:auto, max-height:400px）
 5 div  h=  19  cls=O_Ebla_root
 6 div  h= 493  cls=EvIC1a_column
```

**决定性证据** —— 在行的中心坐标做 `elementFromPoint`：

```json
{ "cls": "Sixlwa_turnErrorRow", "isRowOrChild": false }
```

该位置实际绘制的是**别的内容**（回合错误行），不是我们的行。行被压成 0 高度、不占像素。

**结论**：行可以被折进组里、组也可以被用户展开，但这**完全是宿主的折叠交互**，
插件既不能控制它的默认状态，也不能让行待在组外。

## 未验证的一环

**未能**在真实回合运行期间观测到行可见 —— 因为 `qtest` profile 没有模型凭据，
无法产生一个持续运行的回合。`web` profile 用 `workbuddy` provider，凭据不可及。

要完成这一环，需要：在有凭据的 profile 里跑一次，或在 `qtest` 里接入凭据。

## 对产品决策的含义

| 目标 | 自定义 kind 方案 |
|---|---|
| 引文有区分度（不是伪装成用户消息） | ✅ 达成 |
| 转录区可见（不违反可见性黑名单） | ✅ 达成 |
| 不被折进「回合过程」 | ❌ **不可达成**（宿主硬编码） |
| 回合进行中即时可见 | ✅ 应当成立（`alwaysOpen`），但未在真回合中实测 |

**关键权衡**：换成自定义 kind 后，引文在一轮结束后会被收进「已完成分析」折叠组，
用户需要展开才能看到 —— 而现状（`source.kind: 'user'`）虽然伪装成用户消息，
但**始终可见、不折叠**。

所以这不是纯粹的改进，而是一次**取舍**：
- 现状：永远可见，但与用户消息无法区分
- 原型：有区分度，但回合结束后默认收起

## 建议

在投入全面重构前，先在有模型凭据的环境里验证「回合进行中行可见」这一环。
若成立，再让用户就上述取舍做决定；若不成立（仍不可见），则原型方案价值有限。
