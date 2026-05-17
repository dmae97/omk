---
name: omk-evidence-contract
description: Generate task-specific evidence contracts before a done/completed claim. Use for feature, bugfix, refactor, research, release, security, docs, or orchestration tasks that need changed files, non-empty diffs, test/build/typecheck results, citations, uncertainty, conflicting evidence, and final risk notes.
---

## Evidence Contract

Use this before declaring work complete. Define the claim first, then list the minimum evidence that can prove or falsify it.

## Process

1. Classify the task type: feature, bugfix, refactor, research, release, security, docs, or orchestration.
2. Write the completion claim in one sentence.
3. List required evidence and the command or artifact that proves it.
4. Mark any unavailable evidence as a gap with a concrete reason.
5. Report remaining risk without converting gaps into success.

## Feature / Bugfix / Refactor Evidence

- Changed files.
- Non-empty relevant git diff, unless the task was explicitly read-only.
- Unit or integration test result for changed behavior.
- Build, typecheck, lint, or static-analysis result appropriate to the stack.
- Regression note covering edge cases and untested paths.

## Research Evidence

- Cited sources or local files inspected.
- Date checked for external or version-sensitive facts.
- Confidence and uncertainty.
- Conflicting evidence or missing primary-source coverage.
- Recommendation with assumptions separated from verified facts.

## Release / Security Evidence

- Secret scan or explicit reason it was not run.
- Audit, permission, or destructive-action review when relevant.
- Changelog/PR/release checklist evidence.
- Rollback or recovery note for risky changes.

## Output

```txt
Task type:
Completion claim:
Required evidence:
Evidence gathered:
Gaps:
Conflicting evidence:
Final risk:
Done verdict:
```
