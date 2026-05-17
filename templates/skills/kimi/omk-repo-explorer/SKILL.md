---
name: omk-repo-explorer
description: Efficient repository exploration without dumping the whole codebase. Use before feature work, debugging, refactoring, and review.
---

## Repository Exploration

Never read the whole repository blindly.

## Steps

1. Identify project type.
2. Build a shallow map:
   - top-level directories
   - app entry points
   - config files
   - test directories
3. Search for task keywords.
4. Read only the smallest relevant files first.
5. Expand outward through imports, call sites, routes, schemas, and tests.
6. Produce an evidence-backed map.

## Output

```txt
Relevant files:
Entry points:
Data flow:
Existing patterns:
Test locations:
Unclear areas:
Recommended next files:
```
