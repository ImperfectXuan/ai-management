---
id: 03-testing
title: Testing Strategy
scope: all
---

# Testing Strategy

Guidelines for writing effective, maintainable tests. Adapt the specific tooling to your language, but keep these principles.

## The Test Pyramid

```
        /  E2E   \       ← A handful. Happy-path flows through the full system.
       /──────────\
      /Integration \     ← A moderate number. How components talk to each other.
     /──────────────\
    /     Unit       \   ← The majority. Single function or module in isolation.
   /──────────────────\
```

- **Unit tests**: fast, focused, no I/O. Test one behavior per test.
- **Integration tests**: verify that real implementations talk to each other correctly. Test boundary crossings (module → database, module → API).
- **End-to-end tests**: simulate a real user journey. Keep these few — they are slow and brittle.

## Coverage

- Core business logic: ≥ 80% line coverage
- Utility functions: test the public surface; don't chase every branch
- Coverage percentage is a floor, not a goal — 100% coverage of bad tests is still bad tests

## Test Naming

```
<subject>_<scenario>_<expected outcome>
```

Examples:
- `calculateDiscount_expiredCoupon_returnsZero`
- `login_invalidPassword_throwsAuthenticationError`

A reader should understand what broke, under what conditions, without opening the test body.

## Structure

Follow **Arrange → Act → Assert** (AAA):

1. **Arrange**: set up the test data and preconditions
2. **Act**: execute the single behavior under test
3. **Assert**: verify the outcome — one logical assertion per test when practical

Separate the three blocks with a blank line for visual clarity.

## Independence

- Tests must not depend on execution order
- Tests must not share mutable state
- Each test sets up its own world and tears it down
- A failing test should not cause unrelated tests to fail

## Mocking

- Mock **external boundaries**: network calls, file system, system clock, random number generators
- Do **not mock** internal modules you own — test them through their real interface
- If a module is hard to test without mocking its internals, that's a design signal: the module is too tightly coupled

## Tests as Documentation

- A well-written test describes the expected behavior more precisely than prose
- When someone asks "what happens if X?", they should be able to find a test that answers
- Keep test code as clean as production code — no copy-pasted setup blocks, no magic values without context
