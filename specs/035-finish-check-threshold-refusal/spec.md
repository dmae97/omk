---
description: "Finish check: refuse completion when the run's own measurement misses a numeric limit the task states"
---

# Feature Specification: Finish check refuses completion below a stated numeric limit

**Specification ID**: `035-finish-check-threshold-refusal` (number pending Tech Lead confirmation; 031–034 are assigned)
**Feature Branch**: `feat/finish-check-requirements` (PR #62; this spec is drafted on `spec/finish-check-threshold`)
**Created**: 2026-10-11
**Status**: Draft
**Constitution**: [specs/constitution.md](../constitution.md)
**Input**: Improvement candidate 4 in `/workspace/omk-ab/IMPROVEMENT_CANDIDATES_20261011.md` (R8 + partial B′ analysis). In R8, `winning-avg-corewars` r2 measured its own warrior at 74 wins against `stone.red`, wrote that this is below the 75 the task requires, and finished at 2772 s of 3600 s. The verifier failed on `assert 74 >= 75`. Tech Lead assigned the fix to PR #62 as an acceptance criterion.
**OMK Preset**: `omk`

## Baseline: what #62 does today

PR #62 (`feat/finish-check-requirements` @ `3eb9349213`, stacked on #45 → #44) has no spec of its own; this section records the behavior this spec builds on.

- `extractRequirements(prompt)` (`src/core/finish-check-requirements.ts`) keeps up to 8 sentences from the task prompt. Tier 1 is a sentence that bounds a number (`at least`, `less than`, `between`, `under`, `<`, `≥`, a unit or percent with `must`/`should`, …). Tiers 2–3 name an absolute path or a relative file to produce. Each sentence is cut at 220 characters.
- `buildFinishCheckMessage` appends the items as `REQ n: …` to `FINISH_CHECK_MESSAGE` and asks for one line per item: `REQ <n>: PASS|FAIL - <measured value>`. The check turn's tool cap is `max(6, n + 3)`, at most 12.
- When the check turn settles, `parseFinishCheckLedger` reads the REQ lines into `pass | fail | unreported` items. The extension appends a `finish_check_ledger` session entry and emits `finish_check {active: false, ledger}`. **Nothing acts on a FAIL**: the run ends exactly as it would on PASS.
- The check runs once per user task, only when the run changed the workspace, and not past 90% of `OMK_TIME_BUDGET_SEC` (`FINISH_CHECK_SKIP_FRACTION`).

Evidence that this is not enough:

- R8 `winning-avg-corewars` r2 (class K): final text lists `stone 74/0/26, paper 70/0/30, … snake 7/55/38`, says stone, paper and snake miss the limit, and ends.
- B′ (partial): the check ran in 20/27 B trials with 66 PASS lines and **0 FAIL lines**. `train-fasttext` r1 B reported `0.6105` (< 0.62) and ended. The model admits the gap in prose or in the measured value but does not write FAIL, and even a FAIL would change nothing.

Output of `extractRequirements` on the target prompts (`terminal-bench-2-1`, run on `3eb9349213`):

| Task | Tier-1 REQ | Note |
| --- | --- | --- |
| winning-avg-corewars | REQ 1: `… at least a 75% win rate (75+ wins out of 100 battles) against stone.red, vampire.red, and paper.red, and achieve at least a 33% win rate … against snake.red …` | Two limits, five opponents in one item. **Cut at 220 chars**, so `g2-clear.red` is lost. |
| train-fasttext | REQ 1: `… less than 150MB but get at least 0.62 accuracy …` | Two limits, two units, one item. |
| regex-chess | REQ 2: `… under 100,000 … pairs long, and under 10 megabytes in total.` | Only size limits. The real miss (en passant) is not numeric. |

Every target item has more than one limit, so a design that infers "the" bound of a sentence and compares it with "the" measured number would cover none of them. The run must state each comparison itself, and omk checks the arithmetic.

## CLI Harness Target Impact

**Classification**: improve (benchmark completion discipline; no change for interactive runs, tasks without numeric limits, or tasks that meet their limits).

| Dimension | Baseline (#62 @ `3eb9349213`) | Acceptance target | Regression floor | Verification command | Evidence artifact |
| --- | --- | --- | --- | --- | --- |
| Completion correctness | A REQ line whose own numbers fail its limit (e.g. `74 >= 75`) is recorded as reported and the run ends | The item is recorded `fail` with the gap, and the run gets one continue turn while time allows | Runs whose limits pass, runs without tier-1 items, and runs without any REQ line behave exactly as #62 (same messages, same single check turn) | `../../node_modules/.bin/vitest run test/finish-check-requirements.test.ts test/finish-check.test.ts` in `packages/coding-agent` | those two test files |
| Benchmark score | R8 omk: corewars 2/3, train-fasttext 0/3, regex-chess 1/3 | Small A/B (below): B ≥ A on the target tasks, corewars not worse | No new timeouts (T1/T2) caused by the continue turn on target or control tasks | Small A/B, 3 runs per task per arm | A/B report under `/workspace/omk-ab/` |

## Agent-Oriented Requirements

### Requirement 1 - Ledger checks the run's own comparisons (Priority: P0)

**Agent**: coder
**Evidence Gate**: command-pass
**Risk**: low

- The checklist message asks that every tier-1 item report one comparison per limit, in the form `<label> <measured> <op> <limit>`, separated by `;`, where `<op>` is one of `>=`, `>`, `<=`, `<`, `=`, `≥`, `≤`. Example: `REQ 1: FAIL - stone 74 >= 75; paper 70 >= 75; vampire 82 >= 75; snake 7 >= 33; g2-clear 39 >= 33`. Path-only checklists keep #62's wording.
- `parseFinishCheckLedger` evaluates each comparison it finds in the measured text. Numbers may carry `%`, a size unit, or thousands separators; both sides of one comparison must have the same unit (or none), otherwise that comparison is skipped, not guessed (`62%` vs `0.62` is skipped).
- A ledger item gains `gaps: string[]` (the comparisons that are false, e.g. `stone 74 >= 75`) and `source: "reported" | "compared"`. If any comparison is false, the item's status is `fail` and `source` is `compared`, even when the line says PASS. A line that says FAIL stays `fail`. A PASS line whose comparisons are all true, or that has no parsable comparison, stays as reported.
- Only arithmetic is checked. omk does not re-derive the limit from the task sentence and does not re-run the measurement; whether `75` is the task's real limit is the run's claim, recorded in the ledger.

### Requirement 2 - Refuse completion once, with the gap (Priority: P0)

**Agent**: coder
**Evidence Gate**: command-pass
**Risk**: medium (spends budget; must not cause timeouts)

When the check turn settles and the ledger has at least one `fail` item whose requirement is tier 1:

- If all of the following hold, omk does not let the run end. It sends one follow-up (`FINISH_CHECK_CONTINUE_MESSAGE`) that names each failing REQ with its gaps, says the task is not complete, lifts the "quick fix only" rule for those items, tells the run to keep the currently saved output until a new one measures better (never leave the deliverable worse or missing), and asks it to end with fresh `REQ` lines for the failing items.
  - this user task has had no continue turn yet (at most 1 per user task, `FINISH_CHECK_MAX_CONTINUES = 1`);
  - `elapsedFraction < FINISH_CHECK_CONTINUE_FRACTION` (0.85) when a budget is set; with no budget, the limit does not apply;
  - the check turn did not stop with `aborted` or `error`, and there are no pending user messages.
- The continue turn is ordinary work: the check-turn tool cap and wrap-up steer do not apply to it. The 75% save-now steer still applies.
- When the continue turn settles, its REQ lines are parsed against the same requirements and appended as a second `finish_check_ledger` entry with `round: 2`. No further check or continue turn follows, whatever the result.
- `finish_check` end events carry `continued: boolean` and, when true, the failing ids, so the bench logger can count refusals.
- A `fail` on a tier 2–3 (path) item alone does not trigger a continue turn; missing deliverables belong to candidate 2 (`specs/034`).

### Requirement 3 - Keep every limit of a numeric item (Priority: P1)

**Agent**: coder
**Evidence Gate**: command-pass
**Risk**: low

- A tier-1 sentence is cut only after its last number, up to 400 characters, so no limit is lost. The corewars item keeps `g2-clear.red`. Tier 2–3 items keep the 220-character cut.

### Requirement 4 - Gates (Priority: P0)

- The first commit is this spec. `npm run check` passes before each commit; explicit-path staging; touched modules stay under the module-size ceiling; no new import cycles; no `any`.

## Acceptance criteria (named vitest cases)

`R` below is the corewars sentence from `winning-avg-corewars/instruction.md`. Unless a case says otherwise: headless mode, workspace mutated, `OMK_TIME_BUDGET_SEC=3600`, check turn settles at 2772 s (77%).

1. **74 < 75 refuses (corewars r2).** Reply `REQ 1: PASS - stone 74 >= 75; paper 70 >= 75; vampire 82 >= 75; snake 7 >= 33; g2-clear 39 >= 33`. Ledger item 1 is `fail`, `source: "compared"`, `gaps` = `["stone 74 >= 75", "paper 70 >= 75", "snake 7 >= 33"]`. Exactly one follow-up is sent; it contains `REQ 1`, `stone 74 >= 75`, and the keep-the-saved-output sentence. The end event has `continued: true`.
2. **Same with an honest FAIL line.** Reply `REQ 1: FAIL - stone 74 >= 75` → `fail`, `source: "reported"`, one continue turn.
3. **75 ≥ 75 accepts.** Reply `REQ 1: PASS - stone 75 >= 75; paper 78 >= 75; vampire 82 >= 75; snake 33 >= 33; g2-clear 39 >= 33` → `pass`, `gaps: []`, no follow-up, end event `continued: false`; the session entries and events equal #62's for the same reply apart from the new fields.
4. **No measurement found keeps #62 behavior.** (a) The reply has no REQ line → item `unreported`, no follow-up. (b) `REQ 1: PASS - all opponents beaten` (no comparison) → `pass` as reported, no follow-up. Reason: #62 already asks for a measurement in the check turn, and its ledger has a separate `unreported` state for exactly this. A second "go measure" turn on every vague reply would also cost passing runs time (passing R8 trials end at a median 26% of budget), while the evidence for candidate 4 is runs that *had* a number below the limit. Whether `unreported` tier-1 items should get a measure-only nudge is left to the A/B (see open questions).
5. **Non-numeric tasks unchanged.** (a) A prompt with no extractable requirement → `FINISH_CHECK_MESSAGE` unchanged, no ledger entry, no follow-up (existing test stays green unchanged). (b) A prompt with only a path item, reply `REQ 1: FAIL - /app/out.txt missing` → `fail` recorded, no follow-up.
6. **Late runs are not extended.** Case 1 at 3080 s (85.6%) → ledger `fail` with gaps, no follow-up, `continued: false`.
7. **At most one continue turn.** Case 1, then the continue turn replies `REQ 1: FAIL - stone 74 >= 75` → second ledger entry with `round: 2`, no further follow-up, the run ends.
8. **Continue turn passes.** Case 1, then the continue turn replies `REQ 1: PASS - stone 77 >= 75; …` → `round: 2` entry `pass`, no further follow-up.
9. **Units.** `REQ 1: PASS - size 160MB < 150MB; accuracy 0.6105 >= 0.62` → `fail`, two gaps. `accuracy 61% >= 0.62` → that comparison skipped (mixed units), item stays as reported.
10. **Aborted or user-interrupted check turn.** Case 1 where the check turn stops with `aborted`, or `hasPendingMessages()` is true → no follow-up.
11. **Extraction keeps all corewars limits.** `extractRequirements(corewarsPrompt)[0]` contains `g2-clear.red` and `33%`; the train-fasttext item is unchanged.

## A/B measurement

- **Baseline (A)**: main after #44 and #45 are merged (Staff Engineer is merging main `47e78c4` into them now), plus #62 as merged without this spec's change, so A already sends the checklist. If #62 is not merged when the A/B runs, A is main(#44+#45) + #62 @ its rebased head and B is the same + this change. A must not be bare main `47e78c4`: it has no finish check, so R8/B′ numbers would not line up.
- **Target tasks** (class K in the report, plus the two B′ cases of the same shape):
  - `winning-avg-corewars`: R8 r2 ended at 77% of budget with 74 < 75. The main target; this is the case the change can catch.
  - `train-fasttext`: B′ r1 B reported 0.6105 < 0.62 but ended at 3259/3600 s (90.5%), past both the check skip (0.90) and the continue limit (0.85). Kept as a target to see whether an earlier gap is caught; it is not expected to move much.
  - `regex-chess`: R8 r1 admitted the en-passant miss in prose at ~89% budget, and its numeric REQs are size limits only. Kept as a **regression guard** (B′ r1 lost after a PASS-only checklist, so a longer run must not hurt it), not an expected gain.
- **Control**: 2 tasks with a tier-1 REQ that omk passed 3/3 in R8 (Tech Lead or Desk picks them from `r8_trials.json`) to confirm no extra turns or timeouts on passing runs.
- 3 runs per task per arm. Report per task: reward, `continued` count, round-2 ledger result, agent seconds. Per Tech Lead, a change with no score difference is not merged even if the code looks good.
- The A/B needs the bench Grok credits refilled; until then: spec, implementation, unit tests only.

## Non-goals

- No re-running of measurements by omk and no parsing of the task's own test scripts.
- No detection of prose admissions ("still wrong", "not quite") outside REQ lines. That would need language heuristics and false-positive data; see open questions.
- No fresh-context re-verification (candidate 1, `specs/032`) and no deliverable watchdog (candidate 2, `specs/034`).
- No change to `finishDisciplinePrompt` (candidate 5, `specs/031`).

## Open questions for Tech Lead

1. Spec number: 035, or fold into #62 without a number?
2. Continue limit 0.85 of budget (report's suggestion). corewars r2 (77%) is inside it; train-fasttext and regex-chess (≈ 90%) are not. Lowering the check skip from 0.90 does not help those; raising the limit risks timeouts with no saved improvement.
3. Should a tier-1 item that is `unreported` (no comparison at all) get one short measure-only nudge? Default here: no, keep #62 behavior, decide from A/B data.
4. Prose-admission detection (regex-chess r1): include behind a flag, or leave out as in this spec?

## Expected Files

- `specs/035-finish-check-threshold-refusal/spec.md`: this spec (first commit)
- `packages/coding-agent/src/core/finish-check-requirements.ts`: comparison format in the message, comparison evaluation in the ledger, tier-1 cut rule
- `packages/coding-agent/src/core/finish-check.ts`: `FINISH_CHECK_CONTINUE_FRACTION`, `FINISH_CHECK_MAX_CONTINUES`, `FINISH_CHECK_CONTINUE_MESSAGE` builder, a pure `shouldContinueAfterCheck` decision
- `packages/coding-agent/src/core/extensions/builtin/finish-check.ts`: one continue turn and the round-2 ledger
- `packages/coding-agent/test/finish-check-requirements.test.ts`, `packages/coding-agent/test/finish-check.test.ts`: the cases above
