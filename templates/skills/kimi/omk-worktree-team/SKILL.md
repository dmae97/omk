---
name: omk-worktree-team
description: Git worktree based multi-agent team workflow for isolated parallel coding, review, QA, and integration.
---

## Worktree Team Policy

Use this skill when a task can be split across packages, modules, routes, services, components, tests, or documentation.

## Rules

- Each worker edits only its assigned git worktree.
- Never let two workers modify the same file unless explicitly coordinated.
- Each worker must report:
  - assigned task
  - changed files
  - commands run
  - test result
  - unresolved risks
- Integrator merges patches only after worker self-test and reviewer pass.
- Resolve conflicts in a dedicated integration step.

## Worker Report

```txt
Worker:
Branch:
Task:
Changed files:
Commands:
Result:
Known issues:
Ready for review: yes/no
```

## Merge Rule

Merge only if:

1. worker self-test passed
2. diff review passed
3. no protected file violation
4. no secret leakage
5. integration test plan exists
