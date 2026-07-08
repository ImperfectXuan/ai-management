English | [简体中文](FAQ.zh-CN.md)

# Frequently Asked Questions

## General

### What problem does AI Workspace solve?

AI Coding tools (Claude Code, Codex, Cursor, Trae) each read their own
instruction files. When a project uses multiple tools, the same rules
must be duplicated across `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, etc.
AI Workspace provides a single canonical source for all project rules,
with thin adapters that generate each tool's native format.

### Is this a replacement for the tools' own configuration systems?

No. AI Workspace sits on top of each tool's configuration system. It
does not replace `CLAUDE.md` — it generates it from a canonical source
so you do not have to maintain it manually.

### Do I need to use all modules?

No. Each module (rules, skills, memory, MCP) is independently usable.
You can start with only the rules module and adopt others later.

### Does this add latency to AI tool startup?

No. AI Workspace is a file-based system. Tool startup reads the same
number of files as before — the sync step happens offline, at commit time.

## Setup

### How do I add AI Workspace to an existing project?

Copy the `.ai-workspace/` directory and root stubs into your project
root, edit your rules, and run `sync.sh`.

### What if my project already has an AGENTS.md or CLAUDE.md?

Migrate their content into `.ai-workspace/rules/00-core.md`, then replace
the root files with the thin stubs from this project. The sync script
will regenerate them from the canonical rules.

### Does this work on Windows?

Yes. The directory structure and scripts are designed to be cross-platform.
Sync scripts use POSIX-compatible shell, which works on Windows via Git
Bash, WSL, or MSYS2.

## Tool Compatibility

### What if a tool does not support @include syntax?

The sync script falls back to generating a merged file with all applicable
rules concatenated. The `includes_support` field in `mapping.yaml` controls
this behavior.

### How do I add support for a new tool?

Create a directory under `.ai-workspace/adapters/<tool-name>/` with an
instruction template and a `mapping.yaml` file, then create the tool's
expected root-level file. See CONTRIBUTING.md for details.

### What happens when a tool changes its configuration format?

You update the adapter. Canonical rules are unaffected. This is why the
canonical layer and adapter layer are separate.

## Rules

### How many rules should I write?

Start with 3-5 rules in `00-core.md`. Add more only when a repeated
issue justifies it. A rule that is never enforced is noise.

### Can I have rules that apply only to some tools?

Yes. Use the `tools` field in the rule's frontmatter:

```yaml
tools: [codex, claude]
```

The sync script will skip the rule for tools not listed.

### How do I write a good rule?

A good rule is specific, imperative, and includes rationale when
the reasoning is not obvious.

## Maintenance

### How do I keep generated files in sync?

Run `.ai-workspace/scripts/sync.sh` after any rule change. In Phase 2,
a pre-commit hook will run this automatically.

### Should I commit generated files?

Yes. Most AI Coding tools read these files directly and do not run a
build step. CI validates that generated files match the canonical source.

## Community

### Can I contribute a rule set for my language or framework?

Yes. See CONTRIBUTING.md for the submission process.

### Is there a marketplace for rule sets?

Not yet. Planned for Phase 3. For now, rule sets can be shared as Git
repositories that users include as submodules.
