<p align="center">
  <h1 align="center">AI Workspace</h1>
  <p align="center">
    Shared infrastructure for AI Coding tools — one source of truth, every tool in sync.
  </p>
</p>

English | [简体中文](README.zh-CN.md)

---

## What is AI Workspace?

AI Workspace is a project-level infrastructure layer that lives inside your repository. It provides a **single source of truth** for rules, conventions, skills, and project memory, then distributes them to every AI Coding tool you use — Claude Code, Codex, Cursor, Trae, and more.

Instead of maintaining separate `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, and `.trae/` files with overlapping content, you maintain **one canonical rule set**. Thin adapters translate those rules into each tool's native format.

## Why?

| Without AI Workspace | With AI Workspace |
|---|---|
| N tools = N copies of the same rules | 1 canonical set → N auto-generated adapters |
| Updating rules means editing 4+ files | Edit once, sync everywhere |
| Switching tools loses all context | Project memory persists across tools |
| Team members on different tools see different rules | Consistent AI behavior for the whole team |
| Skills written for one tool are siloed | Skills defined once, translated for all tools |

## Supported Tools

| Tool | Status | Adapter |
|---|---|---|
| Codex | Designed | `adapters/codex/` |
| Claude Code | Designed | `adapters/claude/` |
| Cursor | Planned | `adapters/cursor/` |
| Trae | Planned | `adapters/trae/` |
| GitHub Copilot | Backlog | — |

## Quick Start

```bash
# 1. Clone or initialize the workspace in your project root
git init  # if not already a repo

# 2. Run the scaffold script to set up the directory structure
.ai-workspace/scripts/scaffold.sh

# 3. Edit your canonical rules
vim .ai-workspace/rules/00-core.md

# 4. Sync to all tools
.ai-workspace/scripts/sync.sh
```

## How It Works

```
   You edit once
        │
        ▼
  ┌─────────────────────────┐
  │  .ai-workspace/rules/   │  ← Canonical Rules (Single Source of Truth)
  └───────────┬─────────────┘
              │
     ┌────────┼────────┬────────┐
     ▼        ▼        ▼        ▼
  Codex    Claude   Cursor    Trae      ← Thin Adapters
  Adapter  Adapter  Adapter   Adapter
     │        │        │        │
     ▼        ▼        ▼        ▼
 AGENTS.md CLAUDE.md .cursor-  .trae/   ← Tool-Native Files
                     rules
```

## Directory Structure

```
.
├── .ai-workspace/               # Core infrastructure
│   ├── rules/                   # Canonical rules (the source of truth)
│   │   └── domains/             # Domain-specific rule subsets
│   ├── adapters/                # Tool-specific translation templates
│   │   ├── codex/
│   │   ├── claude/
│   │   ├── cursor/
│   │   └── trae/
│   ├── skills/                  # Cross-tool skill definitions
│   ├── memory/                  # Persistent project knowledge
│   │   ├── adr/                 # Architecture Decision Records
│   │   ├── context/             # Project context summaries
│   │   └── decisions/           # Technical decision log
│   ├── mcp/                     # Shared MCP server configurations
│   ├── scripts/                 # Automation scripts
│   └── templates/               # Project templates
├── docs/                        # Documentation
├── AGENTS.md                    # Codex entry point
├── CLAUDE.md                    # Claude Code entry point
├── CONTRIBUTING.md
├── CHANGELOG.md
└── ROADMAP.md
```

## Documentation

| Document | Description |
|---|---|
| [Architecture](docs/ARCHITECTURE.md) | System design, layers, and data flow |
| [Design Philosophy](docs/DESIGN_PHILOSOPHY.md) | Principles, trade-offs, and rationale |
| [FAQ](docs/FAQ.md) | Frequently asked questions |
| [Roadmap](ROADMAP.md) | Planned features and milestones |
| [Contributing](CONTRIBUTING.md) | How to contribute |
| [Changelog](CHANGELOG.md) | Version history |

## Contributing

Contributions are welcome. Start by reading [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on adding new tool adapters, writing rules, and submitting changes.

## License

MIT
