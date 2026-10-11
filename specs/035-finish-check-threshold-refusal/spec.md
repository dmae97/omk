---
description: "Finish check: refuse completion when the run's own measurement misses a numeric limit the task states"
---

# Feature Specification: Finish check refuses completion below a stated numeric limit

**Specification ID**: `035-finish-check-threshold-refusal` (confirmed by Tech Lead; a separate spec file that ships in the revived PR #62)
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

**Classification**: improve, opt-in (`OMK_FINISH_CHECK_EXTRA_TURN=on`, default off; no change when off). When on: no change for interactive runs, tasks without numeric limits, or runs that report a passing measurement for every numeric limit.

| Dimension | Baseline (#62 @ `3eb9349213`) | Acceptance target | Regression floor | Verification command | Evidence artifact |
| --- | --- | --- | --- | --- | --- |
| Completion correctness | A REQ line whose own numbers fail its limit (e.g. `74 >= 75`) is recorded as reported and the run ends | The item is recorded `fail` with the gap, and the run gets one continue turn while time allows. An unmeasured tier-1 item gets a go-measure turn instead; the two share one extra turn | Runs whose limits pass and runs without tier-1 items behave exactly as #62 (same messages, same single check turn). A run never gets more than one extra turn per task | `../../node_modules/.bin/vitest run test/finish-check-requirements.test.ts test/finish-check.test.ts` in `packages/coding-agent` | those two test files |
| Benchmark score | R8 omk: corewars 2/3, train-fasttext 0/3, regex-chess 1/3 | Small A/B (below): D ≥ A on the target tasks, corewars not worse | No new timeouts (T1/T2) caused by the continue turn on target or control tasks | Small A/B, 3 runs per task per arm | A/B report under `/workspace/omk-ab/` |

## Agent-Oriented Requirements

### Requirement 1 - Ledger checks the run's own comparisons (Priority: P0)

**Agent**: coder
**Evidence Gate**: command-pass
**Risk**: low

- The checklist message asks that every tier-1 item report one comparison per limit, in the form `<label> <measured> <op> <limit>`, separated by `;`, where `<op>` is one of `>=`, `>`, `<=`, `<`, `=`, `≥`, `≤`. Example: `REQ 1: FAIL - stone 74 >= 75; paper 70 >= 75; vampire 82 >= 75; snake 7 >= 33; g2-clear 39 >= 33`. Path-only checklists keep #62's wording.
- `parseFinishCheckLedger` evaluates each comparison it finds in the measured text. Numbers may carry `%`, a size unit, or thousands separators; both sides of one comparison must have the same unit (or none), otherwise that comparison is skipped, not guessed (`62%` vs `0.62` is skipped).
- A ledger item gains `gaps: string[]` (the comparisons that are false, e.g. `stone 74 >= 75`) and `source: "reported" | "compared"`. If any comparison is false, the item's status is `fail` and `source` is `compared`, even when the line says PASS. A line that says FAIL stays `fail`. A PASS line whose comparisons are all true, or that has no parsable comparison, stays as reported.
- A tier-1 item is **unmeasured** when it is `unreported`, or its line has no parsable comparison. The ledger item gains `numeric: boolean` and `hasMeasurement: boolean` (false for unmeasured tier-1 items; tier 2–3 items are always `true`, since they are not numeric). The name is not `measured` because #62's ledger already uses `measured` for the reported value string. An unmeasured item keeps its reported status; FAIL without a comparison is still `fail`.
- Parsing rules: numbers may use an exponent (`1e-3`) and the unicode minus `−`; `=>` is read as `>=` and `=<` as `<=`; version-like numbers (`3.11`) are not compared. In each `;`-separated part only the last comparison chain is evaluated, so context such as `was 80 > 90 before, now 95 > 90` is judged on `95 > 90`. The message asks for the current measurement only.
- Only `REQ <n>: PASS|FAIL` lines are read (case-insensitive). Other spellings (`REQ 1: PASSED`, `REQ 1 - PASS`) stay `unreported`; on a numeric item that costs the measure turn, which asks for the exact form again.
- The REQ lines are read from the latest assistant message of the settled run that has any (else the last assistant message), so a run that writes its REQ lines and then makes one more tool call is still read. Earlier runs and tool results are never read.
- Only arithmetic is checked. omk does not re-derive the limit from the task sentence and does not re-run the measurement; whether `75` is the task's real limit is the run's claim, recorded in the ledger.

### Requirement 2 - One extra turn per task: threshold retry or go-measure (Priority: P0)

**Agent**: coder
**Evidence Gate**: command-pass
**Risk**: medium (spends budget; must not cause timeouts)

**Gate**: `OMK_FINISH_CHECK_EXTRA_TURN`, read by `resolveFinishCheckExtraTurn` in `src/core/finish-check.ts` like the other `OMK_*` switches: `1`/`true`/`on`/`enable`/`enabled` (any case) turns it on; unset or any other value is off, the default until the A/B shows a gain. Off, the finish check behaves exactly as before this spec: the check turn ends the task's finish check, the end event is `{ active: false, ledger }`, there is no round-2 ledger, no extra-turn stop steer, and the check-turn tool cap counts from the check to the next user task as in #62. The ledger fields of Requirement 1, the comparison parser, the REQ-line reading and the tier-1 cut (Requirement 3) apply either way. Everything below in this requirement applies only when the gate is on.

When the check turn settles, omk looks at the tier-1 ledger items:

- **Threshold fail**: at least one tier-1 item is `fail` (reported or compared).
- **Unmeasured**: at least one tier-1 item has `measured: false` and is not `fail`.

If either holds and all of the following are true, omk does not let the run end and sends exactly one follow-up:

- this user task has not had its extra turn yet. Threshold retry and go-measure share **one** extra turn per task (`FINISH_CHECK_MAX_EXTRA_TURNS = 1`), never one each;
- `elapsedFraction < FINISH_CHECK_EXTRA_TURN_FRACTION` when a budget is set; with no budget, this limit does not apply;
- the check turn did not stop with `aborted` or `error`, and there are no pending user messages.

`FINISH_CHECK_EXTRA_TURN_FRACTION = 0.85` is a named, exported constant in `src/core/finish-check.ts`, next to `FINISH_CHECK_SAVE_NOW_FRACTION` (0.75) and `FINISH_CHECK_SKIP_FRACTION` (0.90), and is used in the decision and in tests by name, never as a literal. When the #63 `RemainingBudget` clock lands, this threshold moves onto that clock together with the 75%/90% thresholds; until then it reads the same `elapsedFraction` as they do.

The follow-up (`buildFinishCheckContinueMessage`) has one or two parts, both in the same single message:

- **Threshold part** (when any tier-1 item fails): names each failing REQ with its gaps, says the task is not complete, lifts the "quick fix only" rule for those items, tells the run to keep the currently saved output until a new one measures better (never leave the deliverable worse or missing), and asks for fresh `REQ` lines for those items.
- **Measure part** (when any tier-1 item is unmeasured): names each such REQ and asks the run to measure it on the current outputs with a command and report `<label> <measured> <op> <limit>`. It does not say the task failed, and it lets the run fix an item only if the new measurement fails it.

Then:

- The extra turn is ordinary work: the check-turn tool cap and wrap-up steer do not apply to it. The 75% save-now steer still applies. When a budget is set and the extra turn reaches `FINISH_CHECK_SKIP_FRACTION` (90%), omk sends `FINISH_CHECK_EXTRA_TURN_STOP_MESSAGE` once as a steer: keep the best measured version saved and reply with the REQ lines.
- When the extra turn settles, its REQ lines are parsed against the same requirements and appended as a second `finish_check_ledger` entry with `round: 2`, and a `finish_check` event `{ active: false, ledger, round: 2 }` is emitted (runs with `--no-session` have no session entries). No further check or extra turn follows, whatever the result: a go-measure turn that reveals a fail does not get a threshold retry, and a threshold retry that leaves items unmeasured does not get a go-measure turn.
- `finish_check` end events carry `extraTurn: "threshold" | "measure" | "both" | undefined` and the REQ ids involved, so the bench logger can count them.
- A `fail` on a tier 2–3 (path) item alone does not trigger the extra turn; missing deliverables belong to candidate 2 (`specs/034`).

### Requirement 3 - Keep every limit of a numeric item (correctness bug, Priority: P0)

**Agent**: coder
**Evidence Gate**: command-pass
**Risk**: low

- #62 cuts every item at 220 characters (`MAX_REQUIREMENT_CHARS`). On `winning-avg-corewars` that cut drops `g2-clear.red` from the 33% limit, so the checklist asks the run to verify a partial requirement. This is a correctness bug and is fixed in the same PR.
- A tier-1 sentence is kept whole up to 1000 characters (`MAX_NUMERIC_REQUIREMENT_CHARS`), so no limit is lost; a longer one is cut at its last `, ` or `; ` clause boundary before the limit, never mid-word. Cutting after the last number would not work: in corewars the last number is `100 battles`, and `g2-clear.red` comes after it. Tier 2–3 items keep the 220-character cut.
- A sentence is tier 1 only when a bound word (`at least`, `less than`, `within`, `up to`, …) sits next to a number, or a number is followed by `or more`/`or less`; paths, file names and version strings are removed before this test, so `Save to /app/v2/out.csv` or `Use Python 3.11` is not numeric.

### Requirement 4 - Gates (Priority: P0)

- The first commit is this spec. `npm run check` passes before each commit; explicit-path staging; touched modules stay under the module-size ceiling; no new import cycles; no `any`.

## Acceptance criteria (named vitest cases)

`R` below is the corewars sentence from `winning-avg-corewars/instruction.md`. Unless a case says otherwise: headless mode, workspace mutated, `OMK_TIME_BUDGET_SEC=3600`, check turn settles at 2772 s (77%).

Threshold retry:

1. **74 < 75 refuses (corewars r2).** Reply `REQ 1: PASS - stone 74 >= 75; paper 70 >= 75; vampire 82 >= 75; snake 7 >= 33; g2-clear 39 >= 33`. Ledger item 1 is `fail`, `source: "compared"`, `measured: true`, `gaps` = `["stone 74 >= 75", "paper 70 >= 75", "snake 7 >= 33"]`. Exactly one follow-up is sent; it contains `REQ 1`, `stone 74 >= 75`, and the keep-the-saved-output sentence. The end event has `extraTurn: "threshold"`.
2. **Same with an honest FAIL line.** Reply `REQ 1: FAIL - stone 74 >= 75` → `fail`, `source: "reported"`, one threshold follow-up.
3. **75 ≥ 75 accepts.** Reply `REQ 1: PASS - stone 75 >= 75; paper 78 >= 75; vampire 82 >= 75; snake 33 >= 33; g2-clear 39 >= 33` → `pass`, `gaps: []`, no follow-up, `extraTurn` undefined; session entries and events equal #62's for the same reply apart from the new fields.
4. **Retry then still failing ends.** Case 1, then the extra turn replies `REQ 1: FAIL - stone 74 >= 75` → `round: 2` entry `fail`, no further follow-up, the run ends.
5. **Retry then passing.** Case 1, then the extra turn replies `REQ 1: PASS - stone 77 >= 75; …` → `round: 2` entry `pass`, no further follow-up.

Go-measure (unmeasured tier-1 items):

6. **No REQ line → one nudge.** The reply has no REQ line → item 1 `unreported`, `measured: false`; one follow-up with only the measure part (it does not say the task failed); `extraTurn: "measure"`.
7. **Vague PASS → one nudge.** `REQ 1: PASS - all opponents beaten` → status `pass` as reported, `measured: false`, one measure follow-up.
8. **Nudge, then a fail → no second turn.** Case 6, then the extra turn replies `REQ 1: FAIL - stone 74 >= 75` → `round: 2` entry `fail` with gaps, no threshold follow-up, the run ends.
9. **Nudge, then still unmeasured → no second turn.** Case 6, then the extra turn has no REQ line → `round: 2` entry `unreported`, no follow-up.

Shared single extra turn:

10. **Fail first → no nudge later.** Two tier-1 items: item 1 as in case 1, item 2 unreported → one follow-up containing both parts (`extraTurn: "both"`). The extra turn then leaves item 2 unreported → no further follow-up. Variant: the check reports only item 1 failing and item 2 measured; after the retry, item 2 becomes unreported → still no nudge.
11. **One extra turn total per task across both kinds.** In every case above, the number of follow-ups after the check turn is 0 or 1. A new user task (non-extension `input`) resets the allowance.

Gates and scope:

12. **Late runs are not extended.** Case 1 and case 6 at 3080 s (85.6%) → ledger recorded, no follow-up. The test compares against `FINISH_CHECK_EXTRA_TURN_FRACTION`, and a separate test asserts `FINISH_CHECK_SAVE_NOW_FRACTION < FINISH_CHECK_EXTRA_TURN_FRACTION < FINISH_CHECK_SKIP_FRACTION`.
13. **Aborted or user-interrupted check turn.** Case 1 or case 6 where the check turn stops with `aborted`, or `hasPendingMessages()` is true → no follow-up.
14. **Non-numeric tasks unchanged.** (a) A prompt with no extractable requirement → `FINISH_CHECK_MESSAGE` unchanged, no ledger entry, no follow-up (existing test stays green unchanged). (b) A prompt with only a path item, reply `REQ 1: FAIL - /app/out.txt missing` or no REQ line → recorded, `measured: true`, no follow-up.
15. **Units.** `REQ 1: PASS - size 160MB < 150MB; accuracy 0.6105 >= 0.62` → `fail`, two gaps. `accuracy 61% >= 0.62` → that comparison skipped (mixed units); with no other comparison the item is `measured: false`.

Truncation bug (Requirement 3):

16. **The corewars sentence keeps both limits.** `extractRequirements(corewarsPrompt)` returns one tier-1 item that contains `75%`, `stone.red`, `33%` and `g2-clear.red`, and does not end with `…`. On `3eb9349213` this case fails (the item ends at `snake.red` `…`).
17. **Other items unchanged.** The train-fasttext and regex-chess items are identical to #62's output, and a tier-2 path sentence over 220 characters is still cut at 220.

Review fixes (Tech Lead review of #62, 2026-10-11):

18. **Bound word next to a number.** `Save the file under /app/out1.txt`, `… use Python 3.11`, `Place results within step2/report.md` and `Install version 2.4.1 and keep it below the other packages.` are not numeric; `within atol=1e-5`, ``within a `1e-10` tolerance``, `60% of the original time or less` are.
19. **Parser.** `err 1e-3 <= 0.01` passes and `err 1e-2 <= 1e-3` fails; `−1 <= 0` passes; `python 3.11.2 >= 3.8.0` is skipped; `was 80 > 90 before, now 95 > 90` passes; `acc 0.7 => 0.62` passes.
20. **Long numeric sentences.** A tier-1 sentence between 400 and 1000 characters is kept whole; a longer one ends at a clause boundary with ` …`.
21. **Extra-turn stop steer.** In the extra turn, the stop steer is sent once at 90% (not at 88.9%), and never outside the extra turn.
22. **Strict REQ form.** `REQ 1: PASSED`, `REQ 1 - PASS`, `REQ 1 PASS` → `unreported`; `req 1: pass` → `pass`.
23. **Which message is read.** REQ lines in an earlier assistant message of the same run, followed by a tool call and `Done.`, are read; REQ text inside a tool result is not.
24. **Abort and resume.** An aborted extra turn records a `round: 2` entry and ends; extension-source input afterwards does not restore the allowance.

Gate (default off):

25. **Flag parsing.** `resolveFinishCheckExtraTurn` is true for `on`, `1`, `true`, `ON`, ` enabled `, and false for unset, `""`, `off`, `0`, `false`, `always` and other text.
26. **Flag off is the pre-035 behaviour.** With the flag unset, `off` or an unknown value, cases 1, 2, 6 and 7 send no follow-up after the check turn; the session has exactly one ledger entry `{ items }`; the end event equals `{ active: false, ledger }`; a later settle in the same task (even past 90%) sends nothing and writes no round-2 entry; the stop steer is never sent. The check-turn tool cap still fires once when calls continue after the check turn settled.
27. **Flag on.** Every other extra-turn case (1–13, 21, 23, 24) and the extension flow test run with `OMK_FINISH_CHECK_EXTRA_TURN=on`.
28. **Run log.** With `OMK_RUN_LOG_DIR` set and the flag on: case 1 writes `{ type: "extra-turn", used: true, reasons: ["below-threshold"] }` with `extraTurnFraction` 0.77; case 6 `reasons: ["unmeasured"]`; case 3 `used: false, reasons: []`; case 12 `used: false, reasons: ["below-threshold"]`. The flag off or `OMK_RUN_LOG_DIR` unset writes no line.

## A/B measurement

- **Pin**: main `d69af96` (Tech Lead's joint A/B pin; #62 is merged with the gate, and 032–035 and their run logs are in it). 035 is measured in the joint A/B with arms A–E on that one build (Bench Analyst's plan, `/workspace/omk-bench-analyst/AB_PLAN_d69af96.md`). 035's verdict is **A vs D**: A runs with `OMK_FINISH_CHECK_EXTRA_TURN` unset (identical to #62 without the extra turn) and D with `OMK_FINISH_CHECK_EXTRA_TURN=on`. All other new opt-in flags (`OMK_FINISH_CHECK_REVERIFY`, `OMK_RESPONSE_REASONING_CAP`, `OMK_DELIVERABLE_GUARD`) are off in both. This replaces the two-build baseline below.
- **Shared arms**: A is the shared control for 033, 034 and 035, so if A is low by chance all three look better together. D is also 032's control (spec 032: D vs E). Report the A/D result with this caveat.
- Benches run `omk --no-session --mode json` with `OMK_RUN_LOG_DIR` set in every arm; `extraTurn` counts by kind come from the `extra-turn` lines in `$OMK_RUN_LOG_DIR/finish-check.jsonl` (see "Run log").
- **Baseline (A)**: main after #44 and #45 are merged (Staff Engineer is merging main `47e78c4` into them now), plus #62 as merged without this spec's change, so A already sends the checklist. If #62 is not merged when the A/B runs, A is main(#44+#45) + #62 @ its rebased head and B is the same + this change. A must not be bare main `47e78c4`: it has no finish check, so R8/B′ numbers would not line up.
- **Target tasks** (class K in the report, plus the two B′ cases of the same shape):
  - `winning-avg-corewars`: R8 r2 ended at 77% of budget with 74 < 75. The main target; this is the case the change can catch.
  - `train-fasttext`: B′ r1 B reported 0.6105 < 0.62 but ended at 3259/3600 s (90.5%), past both the check skip (0.90) and the extra-turn limit (0.85). Kept as a target to see whether an earlier gap is caught; it is not expected to move much.
  - `regex-chess`: R8 r1 admitted the en-passant miss in prose at ~89% budget, and its numeric REQs are size limits only. Kept as a **regression guard** (B′ r1 lost after a PASS-only checklist, so a longer run must not hurt it), not an expected gain.
- **Control**: 2 tasks with a tier-1 REQ that omk passed 3/3 in R8 (Tech Lead or Desk picks them from `r8_trials.json`) to confirm that go-measure turns do not add timeouts or cost passing runs.
- 3 runs per task per arm. Report per task: reward, `extraTurn` counts by kind, round-2 ledger result, agent seconds. Per Tech Lead, a change with no score difference is not merged even if the code looks good; with the gate this means the flag is not turned on by default (decision 7).
- The A/B needs the bench Grok credits refilled; until then: spec, implementation, unit tests only.

## Non-goals

- No re-running of measurements by omk and no parsing of the task's own test scripts.
- No detection of prose admissions ("still wrong", "not quite", "below the target") outside REQ lines. Such phrases also appear in normal progress narration, in quoted task text and in descriptions of earlier attempts that were later fixed, so a keyword or heuristic detector would have a high false-positive rate and would spend the single extra turn on runs that are actually done. The structured `REQ` comparison is the only trigger.
- No fresh-context re-verification (candidate 1, `specs/032`) and no deliverable watchdog (candidate 2, `specs/034`).
- No change to `finishDisciplinePrompt` (candidate 5, `specs/031`).
- No move to the #63 `RemainingBudget` clock in this PR; that happens when #63 lands.

## Run log (decision 8)

With `OMK_RUN_LOG_DIR` set and `OMK_FINISH_CHECK_EXTRA_TURN` on, each decision about the single extra turn appends one line to `<OMK_RUN_LOG_DIR>/finish-check.jsonl` through `appendRunLog("finish-check", …)` (spec 042): `{ type: "extra-turn", used, reasons, extraTurnFraction }`. With `OMK_RUN_LOG_DIR` unset or the flag off, nothing is written.

- A decision is made when the check turn settles and the verifier of spec 032 does not take over, and when that verifier settles. One line per decision, so at most two per task, and at most one with `used: true`.
- `used`: whether the extra turn was sent.
- `reasons`: what called for it, in this order: `"below-threshold"` (a numeric item missed its limit), `"unmeasured"` (a numeric item had no measurement), `"reverify-fix"` (spec 032's verifier failed). Empty when nothing called for it; non-empty with `used: false` when the turn was already used, the turn ended aborted or with a pending message, or it was 85% or later.
- `extraTurnFraction`: the budget fraction finish-check read at the decision (`null` without a budget). `appendRunLog`'s own `t`, `elapsedFraction`, `pid` and `role` are added to the line; a line holds no task text or model output.

## Decisions (Tech Lead, 2026-10-11)

1. Number stays 035, as a separate spec file shipped in the revived #62 PR.
2. Extra-turn cutoff is 85% of budget, as the named constant `FINISH_CHECK_EXTRA_TURN_FRACTION` next to the 75%/90% thresholds; it moves to the #63 `RemainingBudget` clock later.
3. Unmeasured tier-1 items get a go-measure turn, but it shares one extra turn per task with the threshold retry.
4. Prose-admission detection is a non-goal (high false-positive rate).
5. The 220-character cut that drops corewars' g2-clear limit is a correctness bug fixed in the same PR.
6. Review of #62 (`REVIEW_STACK_20261011.md`): numeric tier needs a bound word next to a number (M1); exponent, unicode minus, `=>`/`=<`, version numbers and context comparisons in the parser (M2, m1–m3); tier-1 kept to 1000 characters with a clause cut (m4); one 90% stop steer in the extra turn (m5); strict REQ form kept on purpose (m6); latest REQ-bearing assistant message of the run is read (n1).
7. Merge condition for #62: the extra turn ships behind `OMK_FINISH_CHECK_EXTRA_TURN`, default off. It is turned on by default only after Bench Analyst's A/B shows a gain; until then #62 changes only the ledger, parser and checklist text.
8. Run log (after #102): the extra-turn decision is written to `finish-check.jsonl` as described in "Run log"; nothing is written unless `OMK_RUN_LOG_DIR` is set and `OMK_FINISH_CHECK_EXTRA_TURN` is on.

## Expected Files

- `specs/035-finish-check-threshold-refusal/spec.md`: this spec (first commit)
- `packages/coding-agent/src/core/finish-check-compare.ts`: new pure module that evaluates `<measured> <op> <limit>` comparisons and units
- `packages/coding-agent/src/core/finish-check-requirements.ts`: comparison format in the message, `numeric`/`hasMeasurement`/`gaps`/`source` in the ledger, tier-1 cut rule, `extraTurnItems` and `buildFinishCheckContinueMessage` (here rather than in `finish-check.ts`, which this module already imports, to avoid an import cycle)
- `packages/coding-agent/src/core/finish-check.ts`: `FINISH_CHECK_EXTRA_TURN_FRACTION`, `FINISH_CHECK_MAX_EXTRA_TURNS`, a pure `decideExtraTurn` decision, `resolveFinishCheckExtraTurn`
- `packages/coding-agent/src/core/extensions/builtin/finish-check.ts`: the single extra turn and the round-2 ledger; the check-turn tool cap counts only during the check turn
- `packages/coding-agent/test/finish-check-requirements.test.ts`: AC15–18, 20, 22 and ledger comparison cases
- `packages/coding-agent/test/finish-check-compare.test.ts`: AC19
- `packages/coding-agent/test/finish-check-extra-turn.test.ts`: AC1–14, 21, 23–27
- `packages/coding-agent/docs/environment-variables.md`: `OMK_FINISH_CHECK_EXTRA_TURN` row
- `packages/coding-agent/test/finish-check-run-log.test.ts`: AC28 (the writer lives in `extensions/builtin/finish-check-run-log.ts`, see spec 032 decision 10)
