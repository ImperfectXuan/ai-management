---
id: 05-version-control
title: Version Control
scope: all
---

# Version Control

Conventions for commits, branches, and pull requests. These rules apply regardless of hosting platform (GitHub, GitLab, Bitbucket).

## Commit Messages

Format: `<type>: <imperative summary>`

Types:
- `feat`: new feature
- `fix`: bug fix
- `docs`: documentation only
- `refactor`: code change that neither fixes a bug nor adds a feature
- `test`: adding or updating tests
- `chore`: tooling, dependencies, build scripts
- `style`: formatting, semicolons, etc. — no logic change

Rules:
- Use the imperative mood: `add login rate limiting` (not `added` or `adds`)
- Summary line ≤ 72 characters
- If more context is needed, leave a blank line after the summary and write a paragraph
- **One commit, one logical change** — don't bundle a bugfix, a refactor, and a new feature into one commit

## Branch Naming

Format: `<type>/<short-description>`

Examples: `feat/user-authentication`, `fix/login-timeout`, `refactor/payment-flow`

- Use lowercase and hyphens, no underscores
- Delete branches after merging

## Pull Requests

A PR description must answer three questions:

1. **What** did you change? (brief summary)
2. **Why** did you change it? (problem, context, or issue link)
3. **How** can a reviewer verify it? (steps to test, screenshots if relevant)

Additional guidelines:
- Target ≤ 500 lines changed per PR — smaller PRs get faster, better reviews
- If the PR is a work in progress, mark it as draft
- Request review from at least one person who understands the affected area
- Respond to all review comments — if you disagree, explain why; if you agree, make the change

## What NOT to Commit

- **Secrets**: API keys, passwords, tokens, private certificates — use a secrets manager
- **Build artifacts**: compiled binaries, `.o` files, distribution packages
- **Dependencies**: vendored dependencies unless explicitly decided by the team (use a lockfile instead)
- **IDE configuration**: `.vscode/`, `.idea/` — use EditorConfig (`.editorconfig`) for shared formatting rules
- **Large binary files**: images, videos, datasets — use Git LFS or external storage
- **Local environment files**: `.env` with real credentials, machine-specific overrides

## .gitignore

- Add patterns for the categories above before the first commit
- When adding a new tool or framework, update `.gitignore` in the same PR
- Use project-level `.gitignore` for project-specific ignores; use a global gitignore for OS and IDE files
