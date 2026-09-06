# Issue 03: Host — agent/pre-step 折叠（真实用户回合才消耗）

Status: ready-for-agent

## Description

host 半端的**主 seam**：在 `agent/pre-step` 把某会话队列里的待生效引用作为带插件来源的注入上下文，插入**下一次真实带用户文字**的回合，随后清空队列。中间 assistant / tool 步骤不消耗；多条累积。mirror 官方 `agent-instructions` 注入 `<system-reminder>` 的方式。**不进用户消息正文**。

## Acceptance Criteria

- [ ] 仅当该 step 携带真实带用户文字的消息时才注入并清空
- [ ] 纯 assistant / tool（无新用户文字）的 step 不消耗待生效引用
- [ ] 多条待生效引用累积到同一条真实用户消息一起注入
- [ ] 注入内容作为带插件来源的上下文消息（`user/message` + plugin source），不与用户消息文本混入
- [ ] 无待生效引用时不改动 step（零侵入）
- [ ] 该折叠逻辑实现为可注入会话表面的纯逻辑，便于单测
- [ ] 单元测试：覆盖注入、清空、非用户回合不消耗、累积、空队列透传（主 seam，先例 dsh-codex-project `context-injection.spec.ts`）

## Dependencies

Issue 02

## Type

backend/host

## Priority

high

## SPEC Reference

Implementation Decisions — host 半端 agent/pre-step 折叠；Testing Decisions — host 折叠 seam
