---
name: omk-plan-first
description: Read-only planning workflow before implementation. Use for architecture, refactor, feature development, risky edits, and ambiguous tasks.
---

## Plan-first Workflow

Use this when the task is non-trivial, risky, multi-file, architectural, or ambiguous.

## Steps

1. Restate the goal in concrete terms.
2. Identify unknowns.
3. Explore only relevant files.
4. List affected modules.
5. Propose implementation steps.
6. Define quality gates.
7. Define rollback strategy.
8. Ask at most one blocking question only when impossible to proceed safely.

## Rules

- Do not edit files during planning.
- Do not run destructive commands.
- Prefer narrow, testable steps.
- Include explicit acceptance criteria.

## Plan Format

```txt
Goal:
Assumptions:
Files to inspect:
Files likely to change:
Implementation steps:
Quality gates:
Risks:
Rollback:
```
