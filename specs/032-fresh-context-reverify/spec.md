---
description: "Finish check: an early finish gets one fresh-context verification turn that tests the deliverables on new inputs"
---

# Feature Specification: Fresh-context re-verification for early finishes

**Specification ID**: `032-fresh-context-reverify`
**Feature Branch**: `spec/032-fresh-context-reverify` (spec only; the implementation branch stacks on #62 @ `bc34980`, which carries #44, #45 and spec 035)
**Created**: 2026-10-11
**Status**: Draft
**Constitution**: [specs/constitution.md](../constitution.md)
**Input**: Improvement candidate 1 in `/workspace/omk-ab/IMPROVEMENT_CANDIDATES_20261011.md` (expected +4–7 R8 trials, confidence medium). Tech Lead assigned it to OMK after spec 035.
**OMK Preset**: `omk`

## Evidence

From the report and `/workspace/omk-ab/improve/` (`r8_omk_fail_classes.csv`, `r8_trials.json`, `r8_omk_fail_details.txt`). Budgets are each task's `[agent] timeout_sec` in `terminal-bench-2-1/<task>/task.toml`.

- R8 omk lost 64 of 264 trials. The "claimed done but wrong" group (S 18, G 10, P 2, K 2, C 3, D 1) used a median 41% of the budget, and the finish check, which already ran in R8 in the same context with 6 tool calls, ended PASS in all of them. In partial B′ the #62 checklist wrote 66 PASS lines and 0 FAIL lines.
- 21 of the S/G/P trials ended before 50% of the budget (23 counting C and D). They are listed under A/B below.
- Typical misses are ones a reader with no stake in the earlier work would test:
  - G (fits the given example only): extract-elf hard-coded the example's `0x400000` base and scored 0% on a newly compiled binary; filter-js changed 5 of 12 clean HTML files; pytorch-model-cli r3 failed hidden predictions after 137 s.
  - S (wrong reading of the spec): fix-git fast-forwarded to the wrong commit after 38 s and 68 s; git-multibranch finished in 51 s without the HTTPS deploy working; sqlite-with-gcov produced no `.gcda`; chess-best-move r1 printed only one of several mating moves.
  - P: path-tracing r1 ended after 162 s without `/app/image.ppm`.
- The same-context check checks the run's own story. It reads the plan it wrote, measures what it already measured, and agrees with itself.
- **Cost of a 50% trigger**: in R8, 148 of 194 passing omk trials also ended before 50% (median 26%). A trigger at 50% therefore fires on about 170 of 264 trials, most of them already passing. The design has to be cheap, bounded, and unable to break a correct result. That is why it is behind a flag and why the A/B includes controls.

## Design

### When it runs

- Gate: `OMK_FINISH_CHECK_REVERIFY`. Unset or `0/off` means off (the default until the A/B shows a gain); `1/on` means on. It applies only where the finish check itself runs (`resolveFinishCheckMode`), and only with `OMK_TIME_BUDGET_SEC` set, because "early" has no meaning without a budget. Subagent workers never trigger: `subagentWorkerEnv` (#45) already strips `OMK_TIME_BUDGET_SEC` and turns the finish check off for them.
- Trigger: the run's **first settle** of a user task (the moment the finish check is decided) is at `elapsedFraction < FINISH_CHECK_REVERIFY_FRACTION`.
- `FINISH_CHECK_REVERIFY_FRACTION = 0.5` is a named, exported constant in `src/core/finish-check.ts`, next to `FINISH_CHECK_SAVE_NOW_FRACTION` (0.75), `FINISH_CHECK_EXTRA_TURN_FRACTION` (0.85) and `FINISH_CHECK_SKIP_FRACTION` (0.9). It moves to the #63 RemainingBudget clock with them. 0.5 matches the existing discipline line "Have a saved, working result before half of it is used".

### Order of turns (one task)

```
work → settle (at < 50%) → check turn (#62, same context, REQ ledger)
     → verifier turn (this spec, fresh context, read-only on deliverables)
     → at most one fix turn (shared with spec 035), then end
```

Without the trigger, the flow is exactly #62 + spec 035.

### What "fresh context" means in omk

The verifier is **one turn in the same session whose model input is rebuilt from scratch** through the existing `context` extension event (`ContextEvent`, which fires before each LLM call and can replace `messages`).

- **The model sees**: the system prompt (same tools, same `<finish_discipline>`), one user message with the original task prompt text, the verifier instruction, and only the verifier's own assistant and tool-result messages from this turn.
- **The model does not see**: earlier assistant messages, thinking, tool calls or results, the check turn, steers, or compaction summaries.
- The handler finds the instruction by a fixed marker (`<fresh_verification>`) and keeps everything from it onward. When the verifier turn ends, the handler stops filtering, so the fix turn has the full history plus the verifier's report.

Why not a separate process or a subagent:
- The `subagent` tool is an example extension (`examples/extensions/subagent`). The bench `single` arm does not load it, and its workers are spawned `omk --mode json -p --no-session` processes with the finish check off.
- A child process gives stronger isolation (its own tool state, nothing shared), but it adds process start-up, model and auth plumbing, separate budget accounting, and a second transcript to stitch back.
- The `context` filter gets the property that matters, no prior reasoning in the model input, at the cost of one short turn. This is open question 2.

**Instruction content** (`buildReverifyMessage`, in a new `src/core/finish-check-reverify.ts`):
- The marker, plus a statement that the verifier is checking someone else's work, with nothing to defend.
- The deliverables list: paths written or edited in this task (from `tool_execution_start` args of `write`/`edit`, deduplicated, at most 30), plus the #62 REQ path items.
- The #62 REQ list, including spec 035's unmeasured numeric items, which the verifier measures with the `<label> <measured> <op> <limit>` comparison format.
- Steps:
  1. For each requirement sentence in the task, write in one line how a hidden test would most likely check it, then check it that way.
  2. **Different inputs**: if the task shows example inputs, outputs, files or commands, build at least two new inputs that differ from them (other values, boundary or empty cases, a larger case, a freshly generated file such as a newly compiled binary or a different HTML document), run the deliverable on them, and compare with an expectation derived from the task text, not from the deliverable's own output. Do not count re-running the given examples.
  3. Check that required outputs exist at their exact paths in the required format, and that required services, ports and git state are live.
- Rules: do not modify the deliverables, and put scratch files under `/tmp/omk-verify/`. Do not search other directories or the web for tests or answers.
- Reply format: `VERIFY <n>: PASS|FAIL - <what was checked>; expected <x>; got <y>`, then `VERDICT: PASS|FAIL`.

**Guards during the verifier turn**:
- `write` and `edit` tool calls are blocked through the `tool_call` event, with a reason pointing to `/tmp/omk-verify/`. `bash` is not policed.
- The deliverables list is hashed (size and sha256, files ≤ 64 MB) before and after the turn. A change is recorded as `mutated: true`. omk does not restore anything; that is candidate 2 (`specs/034`).

**Caps**:
- `FINISH_CHECK_REVERIFY_MAX_TOOL_CALLS = 10`, then the existing wrap-up steer.
- `FINISH_CHECK_REVERIFY_TIME_FRACTION = 0.15`: once the verifier has used 15% of the budget, it gets the wrap-up steer once.
- The 75% save-now steer still applies.
- The verifier starts below 50%, so with the caps it normally ends below about 65%, leaving the fix turn inside spec 035's 85% cutoff.

### After the verifier: one fix turn, shared with spec 035 (proposal, open question 1)

- The verifier's `FAIL` lines are findings. omk sends **one** fix turn if any of these hold:
  - there is at least one finding;
  - spec 035's check ledger has a numeric fail;
  - the verifier's own REQ comparisons fail (it measured unmeasured items).

  The fix turn is subject to spec 035's gates: under `FINISH_CHECK_EXTRA_TURN_FRACTION`, not aborted, no pending user input.
- The message lists the findings (expected and got) and any 035 gaps. It also repeats 035's "keep the saved output until a new version measures better" rule and asks the run to re-run the failing checks before ending.
- This fix turn **is** spec 035's single extra turn (`FINISH_CHECK_MAX_EXTRA_TURNS = 1` is unchanged): per task there is at most one check turn, one verifier turn, and one fix turn.
- When the verifier runs, spec 035's go-measure nudge is folded into the verifier turn, which receives the unmeasured items, so no separate nudge is sent.
- When the trigger does not fire, spec 035 behaves exactly as merged.
- No verifier after the fix turn, and no second fix turn. The fix turn's REQ and VERIFY lines are recorded with `round: 2`.
- A verifier with no `VERIFY` lines, `VERDICT: PASS`, an aborted verifier, or a pending user message produces no findings. Spec 035's ledger result alone then decides the fix turn.

### Records

- Session entry `finish_check_verify`: `{ verdict: "pass" | "fail" | "unreported", findings: { id, status, text }[], toolCalls, elapsedMs, mutated, paths }`.
- `finish_check` events: `{ active: true, stage: "verify" }` when the verifier starts, and `{ active: false, stage: "verify", verdict, findings, mutated }` when it ends. Runs with `--no-session` see them through the bench logger.

## CLI Harness Target Impact

**Classification**: improve, opt-in (`OMK_FINISH_CHECK_REVERIFY=on`); no change when off.

| Dimension | Baseline (#62 @ `bc34980`) | Acceptance target | Regression floor | Verification command | Evidence artifact |
| --- | --- | --- | --- | --- | --- |
| Completion correctness | An early finish gets one same-context check that agrees with itself (0 FAIL / 66 lines in B′) | With the flag on, an early finish also gets one fresh-context verifier turn on new inputs and at most one fix turn | Flag off, a late finish, or no budget: identical to #62 + 035 (same messages, entries, events) | `../../node_modules/.bin/vitest run test/finish-check-reverify.test.ts test/finish-check-extra-turn.test.ts test/finish-check-requirements.test.ts test/finish-check.test.ts` in `packages/coding-agent` | those files |
| Benchmark score | R8 omk on the primary target tasks: see table below | B − A ≥ +3 trials on primary targets (3 runs per task per arm) | Controls: B ≥ A − 1 trial; no new T1/T2 timeouts on any task | Small A/B | report under `/workspace/omk-ab/` |
| Cost and time | — | Verifier turn median ≤ 10% of budget; per-trial cost +≤ 20% | — | A/B trajectories | same report |

## Agent-Oriented Requirements

### Requirement 1 - Trigger and gate (P0)
`resolveReverifyMode(env)`, `FINISH_CHECK_REVERIFY_FRACTION`, a pure `shouldReverify({ mode, enabled, budgetSet, firstSettleFraction, aborted, hasPendingMessages, checkRan })`. The fraction is taken at the first settle, before the check turn.

### Requirement 2 - Fresh-context verifier turn (P0)
`context` handler active only during the verifier turn; instruction builder with the deliverables list, the REQ list, the different-input step and the reply format; `parseVerifyReply`.

### Requirement 3 - Guards and caps (P0)
`write`/`edit` blocked during the verifier; before/after hashes; tool cap 10; time steer at 15% of budget.

### Requirement 4 - Shared fix turn (P0)
The fix decision merges verifier findings and 035 ledger fails under 035's single-turn allowance and gates; no measure nudge when the verifier ran; round-2 records.

### Requirement 5 - Gates (P0)
The first commit is this spec. `npm run check` before each commit; explicit-path staging; the new module stays under 250 pure LOC; no new import cycles; no `any`.

## Acceptance criteria (named vitest cases)

Defaults: `OMK_FINISH_CHECK_REVERIFY=on`, `OMK_TIME_BUDGET_SEC=900`, headless, workspace mutated by `write /app/out.txt`, first settle at 300 s (33%).

1. **Trigger.** After the check turn settles, exactly one follow-up starts with `<fresh_verification>`. It contains the task prompt, `/app/out.txt`, the REQ list and the different-input step. Event `{ active: true, stage: "verify" }`.
2. **Boundary.** First settle at 450 s (exactly 50%) → no verifier. The test compares with `FINISH_CHECK_REVERIFY_FRACTION` by name. A separate test asserts `REVERIFY (0.5) < SAVE_NOW (0.75) < EXTRA_TURN (0.85) < SKIP (0.9)`.
3. **The first settle decides.** First settle at 420 s, check turn ends at 480 s → the verifier still runs.
4. **Off by default.** No env var → sent messages, entries and events equal the #62 + 035 flow for the same replies.
5. **No budget, no trigger.** `OMK_TIME_BUDGET_SEC` unset → no verifier. `subagentWorkerEnv` output never enables it (extends the #45 worker-env test).
6. **Fresh context** (harness test with the faux provider capturing `Context.messages`). During the verifier call, the messages are [task prompt, verifier instruction] plus the verifier's own tool round-trips. No earlier assistant text, tool result or check-turn message is present. On the next (fix) call, the full history is back.
7. **Read-only.** During the verifier, `write` and `edit` are blocked with the `/tmp/omk-verify/` reason; after it ends they run normally. A `bash` that changes `/app/out.txt` sets `mutated: true` in the entry.
8. **Caps.** The 10th verifier tool call triggers the wrap-up steer once. With 15% of the budget (135 s) used inside the verifier, the steer comes once, whichever cap is hit first.
9. **Verifier FAIL → one fix turn.** `VERIFY 1: FAIL - parse new ELF; expected 0x401000; got 0x400000` → one fix follow-up containing the finding and the keep-saved-output sentence. The fix turn ends with no further turn, and the entries carry `round: 2`.
10. **Shared with 035.** The check ledger has `stone 74 >= 75` and the verifier FAILs → one fix message containing both. The check is a numeric fail and the verifier PASSes → one fix turn (threshold). Never two.
11. **Measure folded into the verifier.** The check leaves REQ 1 unmeasured → the verifier instruction lists REQ 1 with the comparison format, and no separate measure nudge is sent. The verifier then measures `stone 74 >= 75` → that becomes a finding and gets the one fix turn.
12. **No findings, no turn.** `VERDICT: PASS` with all-PASS lines, no VERIFY lines, an aborted verifier, or `hasPendingMessages()` → no fix turn, unless spec 035's ledger alone calls for one.
13. **Late fix.** The verifier FAILs but ends at 0.86 of the budget → no fix turn; findings recorded.
14. **No second verifier.** After a fix turn, or for any later settle of the same task, no `<fresh_verification>` is sent. A new user task resets this.
15. **Instruction content.** The instruction contains the line about new inputs and "Do not count re-running the given examples", the `/tmp/omk-verify/` rule, the no-web-answers rule, and the reply format. The deliverables list is deduplicated and capped at 30.

## A/B measurement

- **A (baseline)**: #62 @ `bc34980` build (main `47e78c4` + #44 + #45 + #62 + spec 035), `OMK_FINISH_CHECK_REVERIFY` unset.
- **B**: A + this change, with `OMK_FINISH_CHECK_REVERIFY=on`. Same model (grok-4.7 xhigh), same adapter, `time_budget=auto`.
- 3 runs per task per arm.

**Primary targets**: R8 omk trials in S/G/P that ended before 50% of the budget, on tasks with budgets ≤ 1800 s.

| Task | Budget | R8 omk | Early-finish failing trials (agent s, % of budget, class) |
| --- | --- | --- | --- |
| fix-git | 900 | 1/3 | r1 38 s 4% S, r3 68 s 8% S |
| git-multibranch | 900 | 2/3 | r1 51 s 6% S |
| path-tracing | 1800 | 2/3 | r1 162 s 9% P |
| mteb-retrieve | 1800 | 2/3 | r1 195 s 11% S |
| extract-elf | 900 | 0/3 | r1 132 s 15% G, r3 448 s 49.8% G |
| financial-document-processor | 1200 | 2/3 | r3 176 s 15% S |
| pytorch-model-cli | 900 | 2/3 | r3 137 s 15% G |
| dna-insert | 1800 | 2/3 | r1 404 s 22% S |
| sqlite-with-gcov | 900 | 2/3 | r3 206 s 23% S |
| chess-best-move | 900 | 1/3 | r1 231 s 26% S (r2 404 s 45% C) |
| dna-assembly | 1800 | 2/3 | r3 660 s 37% S |
| protein-assembly | 1800 | 1/3 | r1 707 s 39% S |
| make-mips-interpreter | 1800 | 1/3 | r1 796 s 44% S |
| raman-fitting | 900 | 0/3 | r2 407 s 45% S |

**Secondary targets** (long budgets; run only if credits allow): video-processing (3600 s; r3 12% G, r2 28% G), install-windows-3.11 (3600 s; r1 31% P, r2 41% S), sam-cell-seg (7200 s; r1 49.8% G). The report also lists filter-js-from-html, but its R8 failures ended at 64–85%, so the trigger would not fire there; it is excluded. sanitize-git-repo r1 (24%, D) is a scope problem, not a verification one; excluded.

**Controls** (omk 3/3 in R8, finished early, budget ≤ 1800 s), to catch false FAILs that break a passing result: log-summary-date-ranges, openssl-selfsigned-cert, sqlite-db-truncate, git-leak-recovery, constraints-scheduling.

**Report**: reward per task and arm; how often the verifier fired; verdicts; findings that led to a fix and whether the fix turned the reward around; `mutated` count; verifier seconds and share of budget; cost per trial. Per Tech Lead, no merge without a score difference.

**Size**: 14 primary + 5 controls = 19 tasks × 3 × 2 = 114 trials. The A/B needs the bench Grok credits refilled. If they are short, run the 9 report tasks that are still in scope (extract-elf, pytorch-model-cli, path-tracing, fix-git, dna-insert, chess-best-move, git-multibranch, sqlite-with-gcov, financial-document-processor) plus 3 controls: 72 trials.

## Non-goals

- No change to requirement extraction. The report's idea of also extracting qualitative requirements ("print them all", "merge into master") is a separate change to `finish-check-requirements.ts`.
- No restore of deliverables the verifier changed (candidate 2, `specs/034`).
- No separate verifier process, model or effort level in this version (open questions 2 and 5).
- No verifier for interactive runs, runs without a budget, or subagent workers.
- No reading of the task's test files, and no web lookups (the report found contamination in db-wal-recovery; spec 031 adds the general rule).

## Open questions for Tech Lead

1. **Shared or separate fix turn.** Proposed: the verifier's fix turn is spec 035's single extra turn, so at most check + verifier + 1 fix per task. Alternative: a separate fix allowance for the verifier (up to 2 fix turns). That is more chances, but more time, and the two can compete near 85%.
2. **Fresh context by `context` filter in the same session (proposed)**, or a child `omk -p --no-session` process with `OMK_FINISH_CHECK=0`? The child is stronger isolation, but needs model and auth plumbing and costs more.
3. **Trigger cutoff.** 0.5 fires on about 76% of passing R8 trials (148/194), which is where the cost and regression risk come from. 0.3 would still cover 13 of the 21 primary-class failures (all of the ≤ 26% ones) and fire on fewer passing runs. Keep 0.5 for the first A/B and then tune, or start at 0.3?
4. **Default.** Keep the flag off by default and turn it on only after an A/B win?
5. **Verifier effort.** Same model and thinking level as the run (proposed), or a lower effort to save time and cost? This touches candidate 3 (`specs/033`).
6. **Mutation.** Is recording `mutated: true` enough, or should a verifier that changes a deliverable void its findings?
