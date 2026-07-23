---
name: brainstorm
description: Structured ideation and design exploration for new features, architecture decisions, or project inception. Invoke manually with /brainstorm when you want guided creative exploration.
---

# Brainstorm

Use this skill before any creative work - new features, architecture decisions, project inception, or design exploration.

## When to Use

Invoke this skill manually with `/brainstorm` when you want structured creative exploration:

- Starting a new feature or project
- Making architecture decisions
- Exploring multiple approaches to a problem
- User types `/brainstorm` or asks for "brainstorm" / "ideate" / "design exploration"

## Execution Steps

1. **Understand the Problem**
   - Clarify the user's intent and constraints
   - Identify load-bearing questions vs. nice-to-knows
   - Surface existing patterns and prior decisions

2. **Diverge: Explore Problem Space**
   - Reframe from multiple angles (user view, system view, constraint view)
   - Generate breadth before depth
   - Identify the one assumption that decides if the approach can work

3. **Converge: Define Core Problem**
   - Synthesize into a 1-2 sentence problem statement
   - Define scope boundaries (in scope / out of scope)
   - Name the key constraint

4. **Diverge: Explore Solutions**
   - Present 2-3 approaches with explicit tradeoffs
   - Include one unconventional option
   - Include one subtractive option (build less or nothing)
   - Name verification method for each approach

5. **Converge: Decide and Record**
   - Present recommendation with conviction
   - Route only genuine forks to the user
   - Record the decision

## Output Format

```
**Decision:** [what we're doing]
**Approach:** [which approach, brief description]
**Why:** [1-2 sentences on reasoning]
**Next:** [immediate next action]
```

## Anti-Patterns to Avoid

- Jumping to solutions before defining the problem
- Presenting seven "maybe" options instead of 2-3 real choices
- Ignoring prior decisions and existing patterns
- Brainstorming when the user said "just build it"
