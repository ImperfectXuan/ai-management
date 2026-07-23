---
name: canonical-rules-design
description: Canonical rules for AI Workspace — 7 universal, language-agnostic rule files covering core principles, code style, project structure, testing, documentation, version control, and error handling.
metadata:
  type: project
---

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
