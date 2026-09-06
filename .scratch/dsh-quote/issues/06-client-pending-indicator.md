# Issue 06: Client — 发送前"待生效引用"提示条 + 移除

Status: ready-for-agent

## Description

当某会话存在 ≥1 条待生效引用时，在发送前显示低调的"待生效引用"提示条，可逐个移除。仅在有待生效引用时才出现，出现时不弹窗不闪烁。

## Acceptance Criteria

- [ ] 会话有待生效引用时，发送前出现低调"待生效引用"提示条
- [ ] 提示条显示当前待生效引用，可逐个移除
- [ ] 无待生效引用时不显示（零侵入）
- [ ] 提示条 UI 低调，不打断心流；支持键盘/`aria-*`
- [ ] 状态随 host 队列变化实时反映（经自有 cordis service 读取）
- [ ] jsdom 测试：有/无待生效引用的显示与移除

## Dependencies

Issue 02, Issue 05

## Type

frontend/client

## Priority

low

## SPEC Reference

Implementation Decisions — client 半端 发送前提示条
