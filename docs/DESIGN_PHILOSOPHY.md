English | [简体中文](DESIGN_PHILOSOPHY.zh-CN.md)

# Design Philosophy

## Core Principles

### 1. Canonical Core, Thin Adapters

The canonical rules system must have zero knowledge of any specific AI
Coding tool. Each adapter translates canonical rules into a tool-native
format and must stay under 50 lines.

**Why**: If adapters grow thick, it means the canonical representation
is either incomplete or the tool's format is too divergent. In either case,
the problem is surfaced early rather than hidden in complex translation logic.

### 2. Convention over Configuration

Defaults should cover 80% of use cases. A project with standard needs
should need only one rule file. Explicit configuration is for the
remaining 20%.

**Why**: Every configurable option is a decision the user must make and
a code path that must be tested. Minimal configuration reduces cognitive
load and maintenance surface.

### 3. Progressive Disclosure

Each module (rules, skills, memory, MCP) is independently usable. Users
can adopt only the rules module without being forced into the skills or
memory systems.

**Why**: Forcing all modules on day one creates adoption friction. A
project should start with rules and add modules as its maturity grows.

### 4. Git-Native

Everything is a file. Everything is versioned. No databases, no external
services, no runtime dependencies.

**Why**: Git is the universal collaboration tool for software projects.
Building on Git means zero new infrastructure, full audit trail, and
familiar workflows (branch, review, merge) for AI configuration.

### 5. DRY by Inclusion

When a tool supports file inclusion (e.g., `@path/to/rules.md`), the
adapter uses that mechanism. When it does not, the sync script generates
a merged file.

**Why**: Inclusion preserves the single-source-of-truth property at
runtime. Generated files are a fallback, not the primary mechanism.

## Explicit Trade-offs

| Decision | Alternative Rejected | Reason |
|---|---|---|
| Markdown for rules, not YAML/JSON | Structured formats | Markdown is human-writable and AI-readable; YAML frontmatter handles metadata |
| sync script generates files, not symlinks | Symlinks | Symlinks fail on Windows without admin, behave inconsistently in Git |
| Separate files per rule topic | One monolithic rules file | Granular files enable selective inclusion per tool and per domain |
| Shell scripts for sync/validate | Node.js, Python | Zero dependency; POSIX shell is available everywhere |
| Dot-prefixed directory `.ai-workspace/` | Non-hidden directory | Hidden by default reduces `ls` noise while remaining editor-visible |

## Anti-Patterns

These patterns are explicitly discouraged:

1. **Tool-specific rules in canonical files.** A rule that says "Tell Codex
   to use X" violates the canonical layer. The rule should say "Use X."
   The adapter handles how to tell each tool.

2. **Adapter files over 50 lines.** If you need a complex adapter, the
   canonical representation is wrong. Fix the abstraction, not the adapter.

3. **Editing generated files manually.** `AGENTS.md`, `CLAUDE.md`, etc.
   are generated. Manually editing them creates drift that will be
   overwritten by the next sync.

4. **Mixing rules and memory.** Rules say what to do going forward.
   Memory records what was decided in the past. They are different
   artifacts with different lifecycles.

5. **Over-configuring.** If you are writing a `mapping.yaml` with 50
   entries for a single tool, something has gone wrong. Step back and
   simplify.

## Comparison with Alternatives

### vs. Single AGENTS.md / CLAUDE.md per project

The status quo. Simple to start, but rules diverge across tools and
maintenance multiplies with each new tool.

### vs. A SaaS configuration service

Some tools offer cloud-synced settings. This hides configuration from
version control, couples to a specific vendor, and cannot be reviewed in PRs.

### vs. IDE-level settings

IDE settings (like `.vscode/settings.json`) are tool-specific and
don't transfer between editors. AI Workspace is editor-agnostic by design.

## Design Evolution

This philosophy is itself versioned in this repository. As the AI Coding
tool ecosystem evolves, the principles may be refined. Changes to the
design philosophy follow the same contribution process as code changes.
