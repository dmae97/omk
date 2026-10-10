---
description: "Finish discipline forbids looking up a task's official solution or tests online"
---

# Feature Specification: No remote answer lookup in headless runs

**Specification ID**: `031-no-remote-answer-lookup`
**Feature Branch**: `fix/no-remote-answer-lookup`
**Created**: 2026-10-11
**Status**: Draft
**Constitution**: [specs/constitution.md](../constitution.md)
**Input**: R8 failure analysis (`IMPROVEMENT_CANDIDATES_20261011.md`, candidate 5). In db-wal-recovery r1 and r3, omk fetched the task's reference `solve.sh` from GitHub; r1 had passed and was scored 0 for contamination. Tech Lead assigned it first because it is the smallest change and removes a disqualification risk.
**OMK Preset**: `omk`

## CLI Harness Target Impact

**Classification**: preserve (prompt-only rule; no code path changes)

| Dimension | Baseline | Acceptance target | Regression floor | Verification command | Evidence artifact |
| --- | --- | --- | --- | --- | --- |
| Integrity | `finishDisciplinePrompt` has no rule about remote solutions; `FINISH_CHECK_MESSAGE` only forbids searching other local directories | The discipline block tells the run not to fetch the task's official solution, reference tests or expected outputs from the web or public repositories, and says general documentation is fine | Every existing discipline line and the budget line are unchanged; `FINISH_CHECK_MESSAGE` is unchanged | `npx vitest run test/finish-check.test.ts` in `packages/coding-agent` | `packages/coding-agent/test/finish-check.test.ts` |
| Score | R8: 2 contaminated db-wal-recovery runs | db-wal-recovery ×3 with 0 contamination hits from `r7_contamination_audit.py` | No pass-rate drop on the same task | Targeted A/B (needs bench credits) | A/B note in the PR |

## Acceptance Criteria

1. **AC1**: `finishDisciplinePrompt(undefined)` and `finishDisciplinePrompt(600_000)` both contain one line that forbids looking up the task's official solution, reference tests or expected outputs online or in public repositories, naming a benchmark's solve script as an example.
2. **AC2**: The same line allows general documentation and library references, so normal web use is not discouraged.
3. **AC3**: The other discipline lines, their order, the budget line and `FINISH_CHECK_MESSAGE` are unchanged (existing tests pass unmodified).
4. **AC4**: Gates: biome, module-size, import-cycles, tsgo, `test/finish-check.test.ts`, pre-commit `npm run check`.

## Non-goals

- Blocking network tools or URLs. This is a prompt rule only; enforcement would need a tool-level policy and is out of scope.
- Changing interactive mode. The discipline block is only added in headless runs with finish check on.

## Expected Files

- `packages/coding-agent/src/core/finish-check.ts`: one new line in `finishDisciplinePrompt`.
- `packages/coding-agent/test/finish-check.test.ts`: AC1 and AC2 assertions.
- `packages/coding-agent/CHANGELOG.md`: one Changed entry.

## Dependency

Needs #44 and #45 on main (they add `finish-check.ts`). This branch is based on #45 (`3fce389`) locally and is opened against main only after #45 merges.
