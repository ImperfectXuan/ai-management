---
id: 04-documentation
title: Documentation
scope: all
---

# Documentation

What to document, when, and how. Documentation that drifts from reality is worse than no documentation — keep it honest.

## README

Every project root must have a README covering these five items:

1. **What this project does** — one sentence + one paragraph
2. **Quick start** — commands a new developer runs to get a working dev environment (install deps, build, run)
3. **Prerequisites** — runtime version, system dependencies, required tooling
4. **Basic usage** — the 2-3 most common operations with examples
5. **How to contribute** — link to CONTRIBUTING or a short paragraph on where to start

## Inline Comments

- **Explain the algorithm**: why a particular approach was chosen over obvious alternatives
- **Mark edge cases**: "this handles the case where the input list is empty"
- **Flag temporary solutions**: use `TODO` / `HACK` / `FIXME` with context (see 01-code-style)
- **No redundant comments**: `x = x + 1  // increment x` is noise — delete it
- **No commented-out code**: use version control for history

## API Documentation

Every public function, method, or endpoint must document:

- **Parameters**: name, type, expected range or constraints
- **Return value**: type and meaning (including what `null`/`None`/`nil` means)
- **Exceptions / errors**: what can go wrong and what callers should do about it
- **Example**: a minimal code snippet showing correct usage (not required for trivial getters)

## Changelog

- Follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format
- Every release gets an entry under Added / Changed / Deprecated / Removed / Fixed / Security
- Write changelog entries for humans, not for machines — "Added rate limiting to login endpoint to prevent brute-force attacks" over "Added rate limiter middleware"

## Stale Documentation

- If you discover documentation that's wrong, fix it in the same PR
- If you can't fix it now, add a prominent version-range note at the top: `<!-- Accurate for v1.0–1.3. Needs update for v2.0. -->`
- Delete obsolete docs rather than accumulating them — the git history preserves them
