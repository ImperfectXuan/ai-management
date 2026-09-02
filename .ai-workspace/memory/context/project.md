---
id: project
title: 项目上下文
---

# AI Workspace

## 用途

统一收编各 AI 编码工具（Claude Code / Codex / Cursor / Trae）的规则、MCP、技能与密钥到单一事实源 `.ai-workspace/`，通过 `aiws sync` 分发、`aiws validate` 守护一致性、`aiws import` 反向收编。

## 技术栈

- CLI：POSIX sh + jq + age
- TUI：Ink + React
- Desktop：Electron + React + TypeScript

## 关键决策

<!-- 见 memory/adr/ -->

## 约定规范

见 `.ai-workspace/rules/`
