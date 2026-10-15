---
name: canonical-rules-design
description: Canonical rules for AI Workspace — 7 universal, language-agnostic rule files covering core principles, code style, project structure, testing, documentation, version control, and error handling.
metadata:
  type: project
---

> **文档属性：阶段设计快照**（2026-10-10 补充范围说明）。原文描述的是文件日期对应的阶段；设计确认、任务勾选或评审发现不代表当前交付状态。
> 当前需求见 [SPEC](../../SPEC.md)，实现状态与修复证据见 [PROGRESS](../../PROGRESS.md)，本文件的需求关联见 [TRACEABILITY](../../TRACEABILITY.md)。原始执行指令仅适用于原阶段，后续开发按 [SDD](../../SDD.md) 建立功能规格。

# Canonical Rules Design

**Date:** 2026-07-23
**Status:** approved

## Overview

7 language-agnostic rule files for `.ai-workspace/rules/`, covering the most universal development conventions. Each file follows the `nn-topic.md` naming convention with YAML frontmatter (`id`, `title`, `scope`).

## Rule Files

| File | Title | Style |
|---|---|---|
| `00-core.md` | Core Principles | Principle-based |
| `01-code-style.md` | Code Style | Prescriptive |
| `02-project-structure.md` | Project Structure | Prescriptive |
| `03-testing.md` | Testing Strategy | Mixed |
| `04-documentation.md` | Documentation | Prescriptive |
| `05-version-control.md` | Version Control | Prescriptive |
| `06-error-handling.md` | Error Handling & Logging | Mixed |

**Why mixed style:** Mechanical conventions (naming, formatting, file structure) get prescriptive rules for consistency. Design decisions (architecture, abstraction) get principle-based frameworks that require contextual judgment.

**How to apply:** Rules are synced to AI tool native files via `aiws sync`, which concatenates all `rules/*.md` files and generates `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, and `.trae/rules.md`. Each rule file must pass `aiws validate` checks: correct naming, frontmatter completeness, ≤200 lines, no tool-specific references.
