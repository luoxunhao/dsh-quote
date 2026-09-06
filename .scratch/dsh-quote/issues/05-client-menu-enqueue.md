# Issue 05: Client — 「引用到对话」菜单 + 静默入队到 host

Status: ready-for-agent

## Description

选区就绪后，在光标处提供右键菜单项「引用到对话」。点击后**静默**把该引文（文本 + 来源 messageId + 会话 id）经自有 cordis service 方法交给 host 入队。添加动作不弹窗、不做闪烁反馈（静默排队）。

## Acceptance Criteria

- [ ] 命中文字块且选区非空时，弹出含「引用到对话」的右键菜单（portal，定位光标）
- [ ] 点击「引用到对话」→ 通过自有 cordis service 方法把引文交给 host 入队（client 不直接写 host 状态）
- [ ] 添加为静默排队，无弹窗 / 闪烁 / toast
- [ ] 菜单生命周期随触发关闭；资源可清理
- [ ] jsdom 测试：菜单出现条件、点击入队调用正确 host service 方法

## Dependencies

Issue 02, Issue 04

## Type

frontend/client

## Priority

high

## SPEC Reference

Implementation Decisions — client 半端 引用动作静默入队
