# Issue 01: 插件脚手架（host + client 双面包）

Status: ready-for-agent

## Description

为 `dsh-quote` 建立可构建、可挂载、可测的最小 DSH 双面插件骨架。这是其它所有 Issue 的地基（ADR-0001 决定插件必须 host + client 双面）。

## Acceptance Criteria

- [ ] `package.json`：`name`、`exports`（`.` host + `./client` bundle + `./cordis.patch.yml` + `./package.json`）、`dsh.bundle.patch`、`dsh.client`（platform `web`）就位
- [ ] host + client 双 tsc program（`tsconfig.build.json` 等），client bundle 构建走官方 tsdown 契约，保留 client 纯度门（只 value-import 平台模块白名单）
- [ ] `cordis.patch.yml`：顶层数组，含本插件的 `id`/`name`/`config` 行
- [ ] 空实现通过 `pnpm typecheck` / `pnpm build`
- [ ] peer/devDependencies 与目标 DSH 正式版一致（对齐 dsh-codex-project 的版本取证）

## Dependencies

None

## Type

infra

## Priority

high

## SPEC Reference

Implementation Decisions — 独立插件仓库、双面包、client 纯度门
