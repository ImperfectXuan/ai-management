---
id: 02-project-structure
title: Project Structure
scope: all
---

# Project Structure

Conventions for organizing code into directories and modules. Applies regardless of language or framework.

## Entry Point

- The project root must have a clear, discoverable entry point
- Common patterns: `src/index.*`, `app/main.*`, `cmd/` directory, or `main.*` at root
- A new developer should be able to find the entry point within 30 seconds of opening the repository

## Directory Naming

- **kebab-case** for directories: `user-service`, `payment-gateway`, `email-templates`
- Directory name should describe what lives inside — `authentication` over `auth-stuff`
- Group by feature or domain, not by file type:
  - ✅ `users/` (contains handler, repository, model, tests)
  - ❌ `controllers/`, `models/`, `views/` scattered across the tree

## Layering

Organize code by distance from the domain, not by technical role:

```
entrypoint / delivery  ← HTTP, CLI, event handlers (thin, no business logic)
       ↓
  business logic       ← domain rules, use cases, workflows
       ↓
  data access          ← repositories, data sources, external APIs
       ↓
 infrastructure        ← logging, configuration, framework wiring
```

- Inner layers never import from outer layers
- Sibling modules at the same layer should not import each other — extract shared code upward
- Each layer exposes a narrow public interface; internals stay private

## File Naming

- Name the file after its primary export: `UserAuthenticator.js`, `password-hasher.go`, `email_service.py`
- Test files live alongside the code they test: `UserAuthenticator.test.js`, `password_hasher_test.go`
- A directory with a single public module may use an `index` file to re-export

## Configuration

- Environment-specific values live in configuration files or environment variables, never hardcoded
- Default configuration values should enable a working dev setup out of the box
- Secrets (API keys, passwords, tokens) never go in configuration files — use a secrets manager or environment variables

## Shared / Common / Utils

- General-purpose code with no business meaning: string helpers, date formatting, type guards
- These directories should stay small — if they grow, the code probably belongs closer to its consumers
- A function used by one module is not "utility" — it belongs to that module
