English | [简体中文](CONTRIBUTING.zh-CN.md)

# Contributing to AI Workspace

Thank you for your interest in contributing. AI Workspace is designed to
grow with the AI Coding tool ecosystem, and contributions from users of
different tools are essential.

## Code of Conduct

Be respectful. Assume good faith. Focus on the work.

## Ways to Contribute

| Contribution | Impact | Good First Issue? |
|---|---|---|
| Add a new tool adapter | Expands the ecosystem | Yes |
| Write canonical rules for a domain | Helps specific project types | Yes |
| Improve sync/validate scripts | Core reliability | No |
| Report a tool compatibility issue | Early detection | Yes |
| Improve documentation | Lower barrier to entry | Yes |

## Development Setup

No build step required. AI Workspace is a file-based infrastructure layer.

```bash
git clone <repo-url>
cd ai-workspace
```

To test adapter output locally:

```bash
.ai-workspace/scripts/sync.sh
.ai-workspace/scripts/validate.sh
```

## Adding a New Tool Adapter

1. Create a directory: `.ai-workspace/adapters/<tool-name>/`
2. Create an instruction template: `.ai-workspace/adapters/<tool-name>/<tool>.md`
3. Create a mapping file: `.ai-workspace/adapters/<tool-name>/mapping.yaml`
4. Add the tool's root-level stub (e.g., `.github/copilot-instructions.md`)
5. Update `README.md` supported tools table
6. Run `sync.sh` and `validate.sh`

**Adapter template guidelines:**

- Keep adapters under 50 lines. If you need more, the canonical
  representation should be improved first.
- Use the tool's native include/import mechanism when available.
- Fall back to inline content when includes are not supported.
- Document which version of the tool was tested.

### mapping.yaml Format

```yaml
tool: codex
version: ">=1.0"
includes_support: true          # Does the tool support @include syntax?
include_syntax: "@{path}"       # Include syntax pattern
rules:
  - source: rules/00-core.md
    required: true
  - source: rules/01-code-conventions.md
    required: true
  - source: rules/domains/frontend.md
    required: false              # Loaded only for frontend projects
```

## Writing Canonical Rules

Rules live in `.ai-workspace/rules/`. Follow this format:

```markdown
---
id: nn-topic
title: Human-Readable Title
priority: 1-5                       # 1 = highest
scope: [always, domain, context]    # When to apply
---

# Title

## Section

- Rule in imperative mood ("Use X for Y")
- Rationale in parentheses when non-obvious

## Section

- ...
```

**Guidelines:**

- One topic per file. Split when a file exceeds 200 lines.
- Write rules in **imperative mood** ("Use kebab-case for file names",
  not "We should use kebab-case").
- Include a brief rationale when the rule is not self-evident.
- Use the `scope` field: `always` for universal rules, `domain` for
  domain-specific, `context` for situational.
- Never reference a specific AI Coding tool in canonical rules.

## Pull Request Process

1. Fork and branch.
2. Make your change following the guidelines above.
3. Run `sync.sh` and `validate.sh`.
4. Update `CHANGELOG.md` under `[Unreleased]`.
5. Open a PR with a clear description.

A maintainer will review within a week.

## Style Guide

- **Language**: English (international, not US-specific idioms).
- **Line length**: No hard limit, but prefer 100 characters.
- **File names**: kebab-case for directories and non-tool files.
- **YAML**: 2-space indent.
- **Markdown**: ATX headings (`#`), fenced code blocks with language tags.

## Recognition

All contributors are acknowledged in the repository. Significant
contributions (new tool adapters, major rule sets) are called out
in `CHANGELOG.md`.
