# Issue 02: Host — 待生效引用会话队列 service

Status: ready-for-agent

## Description

在 host 半端实现按会话隔离的**待生效引用队列**（纯内存、会话级；刷新/冷恢复即丢，见 CONTEXT.md「待生效引用」/「一次性」）。暴露 service 方法供 client 经自有 cordis service 方法调用，也供 `agent/pre-step` 折叠读取。

## Acceptance Criteria

- [ ] 每个会话各自独立的待生效引用队列（不跨会话、无全局并集）
- [ ] 队列存储每条引文的文本 + 可选来源 messageId，保插入顺序
- [ ] service 提供：按会话入队、列出、逐条移除、清空
- [ ] 纯内存、会话级；不随会话持久化
- [ ] 队列生命周期资源归当前 fiber，可随会话/插件 dispose 清理

## Dependencies

Issue 01

## Type

backend/host

## Priority

high

## SPEC Reference

Implementation Decisions — host 半端：会话待生效引用队列（纯内存）
