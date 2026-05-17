---
name: omk-test-debug-loop
description: Debug failing lint, typecheck, test, and build commands with minimal fixes and repeated verification.
---

## Test Debug Loop

Use this when a command fails.

## Steps

1. Capture exact command and output.
2. Classify failure:
   - syntax
   - type
   - dependency
   - runtime
   - test assertion
   - environment
   - flaky
3. Identify the smallest related file set.
4. Fix the root cause, not the symptom.
5. Re-run the failing command.
6. Run adjacent checks if needed.
7. Stop after repeated failure and report blocker.

## Rules

- Do not make broad refactors while debugging.
- Do not weaken tests unless the test is demonstrably wrong.
- Do not delete failing tests to pass.
- Do not ignore type errors.

## Report

```txt
Failing command:
Failure class:
Root cause:
Fix:
Re-run result:
Remaining risk:
```
