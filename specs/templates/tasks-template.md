# Tasks: [FEATURE NAME]

**Input**: `spec.md`, `plan.md`
**Output**: DAG-ready tasks with authority and evidence metadata

## Task Format

```txt
- [ ] T001 [P] Description with exact file paths in `backticks`
  > role: explorer | planner | coder | reviewer | qa | security
  > deps: none | Txxx
  > files: [`path`]
  > risk: read | write | shell | merge | ask
  > authority: read | write | patch | shell | review | merge
  > health: runtime available/auth/model/quota where applicable
  > verify: `command`
  > gate: summary | command-pass | file-exists | review-pass | diff-nonempty
```

## Standard Phases

### Phase 1 — Discover

- [ ] T001 [P] Inspect current contracts, docs, and tests
  > role: explorer
  > deps: none
  > files: []
  > risk: read
  > authority: read
  > health: local repo readable
  > verify: `npm run version:check`
  > gate: command-pass

### Phase 2 — Implement

- [ ] T002 Apply scoped code/docs changes
  > role: coder
  > deps: T001
  > files: [`src/**`, `docs/**`, `test/**`]
  > risk: write
  > authority: write, patch
  > health: selected runtime healthy
  > verify: `npm run check`
  > gate: command-pass

### Phase 3 — Verify

- [ ] T003 Run quality gates and produce evidence
  > role: qa
  > deps: T002
  > files: [`.omk/runs/<run-id>/result.md`]
  > risk: shell
  > authority: shell
  > health: local toolchain ok
  > verify: `npm test`
  > gate: command-pass
