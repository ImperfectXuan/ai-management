---
id: 00-core
title: Core Principles
scope: all
---

# Core Principles

These principles guide all code and design decisions. When in conflict, prefer the earlier item.

## 1. Readability Over Micro-Optimization

Code is read far more often than it is written. Write for human comprehension first.

- Optimize only when measurement shows a bottleneck
- If you must optimize, document the before/after and the reasoning
- Clever code is not good code — clear code is good code

## 2. Explicit Over Implicit

Make behavior visible at the call site.

- Avoid magic values — name them as constants or configuration
- Avoid implicit global state — pass dependencies explicitly
- Avoid implicit type coercion — be deliberate about types
- Default arguments should be obvious and documented

## 3. Simple Over Flexible

YAGNI — You Aren't Gonna Need It.

- Don't add abstraction for hypothetical future requirements
- One level of indirection is plenty; two is a question; three is a design smell
- Prefer straightforward solutions that can be refactored later over over-engineered ones
- If you can't explain the design in two sentences, simplify it

## 4. Convention Over Configuration

Consistent defaults reduce decision fatigue and cognitive load.

- Follow the existing patterns of the codebase you're in
- If no pattern exists, pick one and document it
- New team members should be able to find things by understanding the conventions, not by memorizing locations

## 5. Composition Over Inheritance

Prefer assembling behavior from small, focused pieces.

- Use interfaces / protocols / traits rather than deep inheritance chains
- A function that takes another function is often simpler than a subclass
- Inheritance is for "is-a" relationships with shared behavior — not for code reuse alone

## 6. Immutability by Default

Favor data that doesn't change.

- Default to immutable data structures and pure functions
- When state must change, make the mutation explicit and localized
- Avoid shared mutable state across modules — it is the root of most concurrency bugs

## 7. Fail Fast and Loud

Catch problems at the earliest possible moment.

- Validate inputs at system boundaries
- Don't silently swallow errors or return sentinel values — raise them
- A clear error message at startup is better than mysterious misbehavior at runtime
