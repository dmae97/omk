---
name: omk-git-commit-pr
description: Git commit and pull request summary workflow using Conventional Commits and evidence from the current diff.
---

## Commit Policy

Use Conventional Commits:

```txt
feat(scope): summary
fix(scope): summary
refactor(scope): summary
test(scope): summary
docs(scope): summary
chore(scope): summary
```

## Steps

1. Inspect current diff.
2. Group changes by purpose.
3. Exclude unrelated changes.
4. Generate commit message.
5. Generate PR summary if requested.

## PR Body

```md
## What changed

## Why

## Test result

## Risk

## Notes
```

## Rules

* Do not claim tests passed unless they were run.
* Mention commands that failed or were not run.
* Keep summary factual.
