---
name: andrej-karpathy-skills
description: Minimal, goal-driven, surgical coding workflow adapted from forrestchang/andrej-karpathy-skills for OMK. Use for coding, refactoring, debugging, and review tasks where assumptions, overengineering, or broad edits could cause regressions.
---

# andrej-karpathy-skills

Source basis: forrestchang/andrej-karpathy-skills at commit 2c606141936f1eeef17fa3043a72095b4765b9c2. This OMK skill is a compact adaptation, not a vendored copy of upstream prompts or code.

## Use when

- Any non-trivial code change needs tight scope and proof.
- The request is ambiguous enough that silent assumptions could be wrong.
- A refactor or bugfix risks drive-by edits.
- You need to turn an imperative request into verifiable success criteria.

## OMK workflow

1. State assumptions and tradeoffs only when they affect the implementation path. Ask if ambiguity blocks safe progress.
2. Define success as observable checks: tests, typecheck, lint, build, screenshots, replay, or exact output.
3. Make the smallest change that satisfies the goal. Avoid speculative abstractions and features not requested.
4. Touch only files directly tied to the request. Preserve existing style and avoid unrelated cleanup.
5. Remove only dead code introduced by your own change unless the user asked for broader cleanup.
6. Verify, inspect the diff, and report remaining risks honestly.

## Output contract

Return:

- assumptions that mattered
- success criteria and checks
- changed files
- commands run
- pass/fail status
- risks or blocked items

## Guardrails

- Do not broaden scope to improve adjacent code.
- Do not hide confusion behind a confident implementation.
- Do not claim completion without evidence.
