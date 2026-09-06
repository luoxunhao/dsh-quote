# Issue 04: Client — 选区捕获 seam

Status: ready-for-agent

## Description

client 半端的选区捕获。挂一个会话级组件到 slot `conversation.composer.dock`；在文档层挂 `contextmenu` 捕获监听，检测到非空选区且命中 `[data-chat-flow-key]` 的文字块时，取选区文本并解析来源消息。不做从 DOM 反推源 markdown。

## Acceptance Criteria

- [ ] 注册会话级 slot `conversation.composer.dock` 的组件，随活动会话常驻
- [ ] 文档层 `contextmenu` 捕获监听；选区为空或不在 `[data-chat-flow-key]` 上时不产生动作
- [ ] 选区文本取 `window.getSelection().toString()`（渲染后文本，用户所见即所得）
- [ ] 沿 DOM `closest('[data-chat-flow-key]')` 取节点 key → 经 `useChat` snapshot `nodes.get(key)` 解析 `assistant-step` 节点来源 `messageId` + blocks
- [ ] client 不 value-import 其他 `@deepseek-ai` 模块；不接管/替换 `assistant-step` 渲染器
- [ ] jsdom 测试：有非空选区 + 命中文字块 → 可解析；无选区 / 不在文字块上 → 不产生入口

## Dependencies

Issue 01

## Type

frontend/client

## Priority

high

## SPEC Reference

Implementation Decisions — client 半端；Testing Decisions — client 捕获 seam
