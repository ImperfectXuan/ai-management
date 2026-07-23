---
id: 01-code-style
title: Code Style
scope: all
---

# Code Style

Language-agnostic conventions for naming, formatting, and structure. When a language has an established community style guide, it takes precedence. Otherwise, apply these rules.

## Naming

- **Types, classes, interfaces**: Nouns or noun phrases (`UserProfile`, `OrderRepository`)
- **Functions, methods**: Verbs or verb phrases (`getUser`, `calculateTotal`, `sendNotification`)
- **Booleans**: `is`, `has`, `can`, `should` prefix (`isActive`, `hasPermission`, `canEdit`, `shouldRetry`)
- **Constants**: UPPER_SNAKE_CASE for truly constant values (`MAX_RETRY_COUNT`, `DEFAULT_TIMEOUT_MS`)
- **Variables**: Describe what they contain — `users` over `data`, `elapsedMs` over `time`
- **No abbreviations** unless they are universal (`id`, `url`, `http`, `json`, `xml`). Never `usr`, `cnt`, `msg` (except in localized contexts like error codes)

## Function / Method Size

- Target ≤ 50 lines (not counting blank lines and comments)
- If a function exceeds this, extract logical sub-steps into well-named helper functions
- A function should do one thing and operate at a single level of abstraction

## File Size

- Target ≤ 500 lines per file
- When a file grows beyond this, split by responsibility, not arbitrarily
- Co-location is fine: a dozen tightly related small functions in one file is better than one function per file

## Comments

- **Explain why, not what** — the code shows what it does; comments explain the reasoning
- **Document surprises**: hacks, workarounds, non-obvious performance choices, and "don't do X because Y" constraints
- **TODO / FIXME / HACK**: always include a date and context so readers can judge staleness
  - `// TODO(2026-07): extract this once we have three callers`
  - `// FIXME: breaks when input has trailing whitespace — see issue #42`
- **Delete commented-out code** before merging — version control remembers it; the file should not

## Whitespace

- One blank line between logical blocks within a function
- Two blank lines between top-level definitions (functions, classes)
- No trailing whitespace on any line
- Files end with exactly one newline

## Consistency

- If the codebase already uses a different convention, match it
- A consistent codebase beats a "better" convention applied inconsistently
- When in doubt, look at surrounding code and replicate
