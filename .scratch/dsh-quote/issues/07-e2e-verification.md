# Issue 07: 端到端验证

Status: ready-for-agent

## Description

整包验证：typecheck / build / test 全绿，并在真实 DSH 组合里做挂载冒烟，确认插件作为独立 profile 层被加载、client bundle 正常进驻 `conversation.composer.dock`、host `agent/pre-step` 折叠生效。mirror dsh-codex-project 的 `verify` 与真实组合验证做法。

## Acceptance Criteria

- [ ] `pnpm typecheck` / `pnpm build` / `pnpm test` 全部通过
- [ ] 插件导出形态测试通过（host `name/inject/apply`、client `inject/apply`）——先例 `plugin-shape.spec.ts`
- [ ] 用非内置 scratch profile 走 `dsh plugin ... add` + `--dump-config`，确认 bundle 层 / 行 id / name / config / 注入顺序
- [ ] 真实 `dsh web` 组合冒烟：右键选区出「引用到对话」、入队、下一条真实用户消息注入且队列清空

## Dependencies

Issue 01, Issue 02, Issue 03, Issue 04, Issue 05, Issue 06

## Type

infra

## Priority

medium

## SPEC Reference

Testing Decisions — 形态 seam、host 折叠 seam、client 捕获 seam；真实组合验证
