---
description: "Finish check: a finish before 30% of the budget gets one fresh-context verification turn that tests the deliverables on new inputs"
---

# Feature Specification: Fresh-context re-verification for early finishes (before 30% of budget)

**Specification ID**: `032-fresh-context-reverify`
**Feature Branch**: `feat/032-fresh-context-reverify` from main `5c5806b` (#44, #45, #62 with spec 035, #99), with main `c3ac89e` (#63, shared run clock, spec 036) merged in. The spec was drafted on `spec/032-fresh-context-reverify` on top of #62 @ `bc34980`.
**Created**: 2026-10-11
**Status**: Draft
**Constitution**: [specs/constitution.md](../constitution.md)
**Input**: Improvement candidate 1 in `/workspace/omk-ab/IMPROVEMENT_CANDIDATES_20261011.md` (expected +4–7 R8 trials, confidence medium). Tech Lead assigned it to OMK after spec 035.
**OMK Preset**: `omk`

## Evidence

From the report and `/workspace/omk-ab/improve/` (`r8_omk_fail_classes.csv`, `r8_trials.json`, `r8_omk_fail_details.txt`). Budgets are each task's `[agent] timeout_sec` in `terminal-bench-2-1/<task>/task.toml`.

- R8 omk lost 64 of 264 trials. The "claimed done but wrong" group (S 18, G 10, P 2, K 2, C 3, D 1) used a median 41% of the budget, and the finish check, which already ran in R8 in the same context with 6 tool calls, ended PASS in all of them. In partial B′ the #62 checklist wrote 66 PASS lines and 0 FAIL lines.
- 21 of the S/G/P trials ended before 50% of the budget (23 counting C and D). **13 of these 21 ended before 30%**, the trigger chosen by Tech Lead. They are listed under A/B below.
- Typical misses are ones a reader with no stake in the earlier work would test:
  - G (fits the given example only): extract-elf hard-coded the example's `0x400000` base and scored 0% on a newly compiled binary; filter-js changed 5 of 12 clean HTML files; pytorch-model-cli r3 failed hidden predictions after 137 s.
  - S (wrong reading of the spec): fix-git fast-forwarded to the wrong commit after 38 s and 68 s; git-multibranch finished in 51 s without the HTTPS deploy working; sqlite-with-gcov produced no `.gcda`; chess-best-move r1 printed only one of several mating moves.
  - P: path-tracing r1 ended after 162 s without `/app/image.ppm`.
- The same-context check checks the run's own story. It reads the plan it wrote, measures what it already measured, and agrees with itself.
- **Cost on passing runs**: passing omk trials end at a median 26% of the budget. Over the 268 R8 omk trials with a known budget:
  - at 0.5: 148 of 194 passing trials end early (76%), and the trigger fires on about 170 trials;
  - at **0.3**: 106 of 194 passing trials (55%), 126 trials in total (47%);
  - 0.3 keeps 13 of the 21 S/G/P early failures and fires on 42 fewer passing trials.
- Most verifier turns still land on runs that already pass. The design has to be cheap, bounded, and unable to break a correct result, so it is off by default, the A/B records per-trial cost, and the A/B includes controls.

## Design

### When it runs

- Gate: `OMK_FINISH_CHECK_REVERIFY`, read by `resolveFinishCheckReverify` with the same parsing as `OMK_FINISH_CHECK_EXTRA_TURN`: `1`/`true`/`on`/`enable`/`enabled` (any case, trimmed) is on; unset or any other value is off, the default until the A/B shows a gain. It applies only where the finish check itself runs (`resolveFinishCheckMode`), only in headless sessions (never with a UI, even with `OMK_FINISH_CHECK=always`), and only when the run has a budget, because "early" has no meaning without one.
- Subagent workers never trigger: `subagentWorkerEnv` (#45) already strips `OMK_TIME_BUDGET_SEC` and turns the finish check off for them, and this change also adds `OMK_FINISH_CHECK_REVERIFY` to its lead-only variables, so a worker opted in with `OMK_FINISH_CHECK_WORKERS` still never runs the verifier.
- **Budget source**: the trigger reads the same `elapsedFraction` as every other finish-check threshold. Finish-check reads the budget through one reader, `FinishCheckOptions.readBudget`, returning `{ budgetMs, elapsedMs, elapsedFraction }`. Its default is `readRunBudget() ?? localBudget()`: the shared run clock of spec 036 (#63), whose origin is process start in print/json mode, and, when no run clock is bound (interactive `OMK_FINISH_CHECK=always`, unit tests), `OMK_TIME_BUDGET_SEC` with finish-check's own clock as on main. Tests inject a reader. A late-loaded extension still measures 0.30 from run start.
- Trigger: the run's **first settle** of a user task (the moment the finish check is decided) is at `elapsedFraction < FINISH_CHECK_REVERIFY_FRACTION`.
- Default **off**. It is turned on by default only after an A/B win (decision 4).
- `FINISH_CHECK_REVERIFY_FRACTION = 0.3` is a named, exported constant in `src/core/finish-check.ts`, next to `FINISH_CHECK_SAVE_NOW_FRACTION` (0.75), `FINISH_CHECK_EXTRA_TURN_FRACTION` (0.85) and `FINISH_CHECK_SKIP_FRACTION` (0.9). Like them it compares against the shared run clock (spec 036). A trigger at 0.5 may be measured later as a separate A/B arm; this spec ships 0.3.

### Order of turns (one task)

```
work → settle (at < 30%) → check turn (#62, same context, REQ ledger)
     → verifier turn (this spec, fresh context, read-only on deliverables)
     → at most one fix turn (shared with spec 035), then end
```

Without the trigger, the flow is exactly main as merged: #62 with spec 035, whose extra turn is behind `OMK_FINISH_CHECK_EXTRA_TURN`.

### What "fresh context" means in omk

The verifier is **one turn in the same session whose model input is rebuilt from scratch** through the existing `context` extension event (`ContextEvent`, which fires before each LLM call and can replace `messages`).

- **The model sees**: the system prompt (same tools, same `<finish_discipline>`), one user message (the verifier instruction, which quotes the original task prompt in full), and only the messages after it: the verifier's own assistant and tool-result messages, and any steer sent during the turn.
- **The model does not see**: earlier assistant messages, thinking, tool calls or results, the check turn, steers, or compaction summaries.
- The handler finds the instruction by a fixed marker (`<fresh_verification>`) and keeps everything from it onward. When the verifier turn ends, the handler stops filtering, so the fix turn has the full history plus the verifier's report.

Why not a separate process or a subagent:
- The `subagent` tool is an example extension (`examples/extensions/subagent`). The bench `single` arm does not load it, and its workers are spawned `omk --mode json -p --no-session` processes with the finish check off.
- A child process gives stronger isolation (its own tool state, nothing shared), but it adds process start-up, model and auth plumbing, separate budget accounting, and a second transcript to stitch back.
- The `context` filter gets the property that matters, no prior reasoning in the model input, at the cost of one short turn. **Decision 2**: same-session `context` filtering. If the A/B shows the prior conversation leaking into the fresh context, the verifier moves to a child process in a later change. Leaks to look for: the verifier quotes earlier reasoning or tool output it was not given, or repeats the run's earlier wrong assumption word for word.
- **Model and effort**: the verifier turn uses the same model and thinking level as the run (decision 5). Changing effort would mix this spec's effect with spec 033's.

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
- The deliverables list is hashed (size and sha256, files ≤ 8 MiB; larger files compare by size only; at most 4 files read at once) before and after the turn. A change is recorded as `mutated: true`, and the verification is **void** (decision 6). Its verdict is recorded as `void`, its findings are kept for the record but generate no fix turn, and its REQ measurements are not used either. omk does not restore the changed deliverable; restoring belongs to candidate 2 (`specs/034`, artifact preservation). Spec 035's own check-ledger result can still call for the single extra turn.

**Caps**:
- `FINISH_CHECK_REVERIFY_MAX_TOOL_CALLS = 10`, then a wrap-up steer. The verifier gets its own wrap-up text (`FINISH_CHECK_REVERIFY_WRAP_UP_MESSAGE`: stop testing, do not change the deliverables, reply with the `VERIFY` lines and `VERDICT`) instead of the check turn's, which asks for a one-line summary. The check turn's tool cap does not count verifier or fix-turn calls.
- `FINISH_CHECK_REVERIFY_TIME_FRACTION = 0.15`: once the verifier has used 15% of the budget (read through `readBudget`), it gets the wrap-up steer. The steer is sent once per verifier, whichever cap is hit first.
- The 75% save-now steer still applies.
- The verifier starts below 30%, so with the caps it normally ends below about 45%, leaving the fix turn well inside spec 035's 85% cutoff.

### After the verifier: one fix turn, shared with spec 035 (decision 1)

- The verifier's `FAIL` lines are findings. omk sends **one** fix turn if any of these hold:
  - there is at least one finding;
  - spec 035's check ledger has a numeric fail;
  - the verifier's own REQ comparisons fail (it measured unmeasured items).

  The fix turn is subject to spec 035's gates: under `FINISH_CHECK_EXTRA_TURN_FRACTION`, not aborted, no pending user input, and the verifier is not void.
- The message lists the findings (expected and got) and any 035 gaps. It also repeats 035's "keep the saved output until a new version measures better" rule and asks the run to re-run the failing checks before ending.
- This fix turn **is** spec 035's single extra turn (`FINISH_CHECK_MAX_EXTRA_TURNS = 1` is unchanged). There is one extra turn per task in total, ever, whatever triggered it: per task, at most one check turn, one verifier turn, and one fix turn.
- When the verifier runs, spec 035's go-measure nudge is folded into the verifier turn, which receives the unmeasured items, so no separate nudge is sent.
- When the trigger does not fire, spec 035 behaves exactly as merged.
- **With `OMK_FINISH_CHECK_EXTRA_TURN` off** (its default on main): the verifier only verifies and records. It still runs when its own trigger fires, and its `finish_check_verify` entry and `{ stage: "verify", fixTurn: false }` event are written, but no fix turn or continue message is sent, whatever it finds. The extra turn is created only by `OMK_FINISH_CHECK_EXTRA_TURN` (decision 9).
- **With both flags on**: the trigger rules above apply unchanged (verifier findings, the verifier's REQ fails, or check-ledger fails).
- No verifier after the fix turn, and no second fix turn. The fix turn's REQ lines are recorded as a `finish_check_ledger` entry with `round: 2` (as in 035), and its `VERIFY` lines, if any, as a `finish_check_verify` entry with `round: 2`.
- A verifier with no `VERIFY` lines, `VERDICT: PASS`, an aborted verifier, a void (mutated) verifier, or a pending user message produces no findings that count. Spec 035's ledger result alone then decides the fix turn.

### Records

- Session entry `finish_check_verify`: `{ verdict: "pass" | "fail" | "unreported" | "void", findings: { id, status, text }[], toolCalls, elapsedMs, mutated, paths, costUsd }`. `costUsd` and token usage come from the assistant messages of the verifier turn, so the A/B can report verifier cost per trial.
- `finish_check` events: `{ active: true, stage: "verify" }` when the verifier starts, and `{ active: false, stage: "verify", verdict, findings, mutated }` when it ends. Runs with `--no-session` see them through the bench logger.

## CLI Harness Target Impact

**Classification**: improve, opt-in (`OMK_FINISH_CHECK_REVERIFY=on`; the fix turn also needs `OMK_FINISH_CHECK_EXTRA_TURN=on`); no change when off.

| Dimension | Baseline (main `5c5806b`) | Acceptance target | Regression floor | Verification command | Evidence artifact |
| --- | --- | --- | --- | --- | --- |
| Completion correctness | An early finish gets one same-context check that agrees with itself (0 FAIL / 66 lines in B′) | With the flag on, an early finish also gets one fresh-context verifier turn on new inputs and at most one fix turn | Flag off, a late finish, a UI session, or no budget: identical to main `5c5806b` (same messages, entries, events) | `../../node_modules/.bin/vitest run test/finish-check-reverify.test.ts test/finish-check-extra-turn.test.ts test/finish-check-requirements.test.ts test/finish-check.test.ts` in `packages/coding-agent` | those files |
| Benchmark score | R8 omk on the primary target tasks: see table below | B − A ≥ +3 trials on primary targets (3 runs per task per arm) | Controls: B ≥ A − 1 trial; no new T1/T2 timeouts on any task | Small A/B | report under `/workspace/omk-ab/` |
| Cost and time | — | Verifier turn median ≤ 10% of budget; per-trial cost +≤ 20% (recorded per trial) | — | A/B trajectories and `finish_check_verify.costUsd` | same report |

## Agent-Oriented Requirements

### Requirement 1 - Trigger and gate (P0)
`resolveFinishCheckReverify(value)`, `FINISH_CHECK_REVERIFY_FRACTION`, a pure `shouldReverify({ enabled, hasUI, firstSettleFraction, aborted, hasPendingMessages, alreadyVerified })` (no budget means `firstSettleFraction` is `undefined`, so no trigger). The fraction is read through `readBudget` at the first settle, before the check turn and any snapshot wait. `subagentWorkerEnv` drops `OMK_FINISH_CHECK_REVERIFY`.

### Requirement 2 - Fresh-context verifier turn (P0)
`context` handler active only during the verifier turn; instruction builder with the deliverables list, the REQ list, the different-input step and the reply format; `parseVerifyReply`.

### Requirement 3 - Guards and caps (P0)
`write`/`edit` blocked during the verifier; before/after hashes; a mutated verifier is void; tool cap 10; time steer at 15% of budget.

### Requirement 4 - Shared fix turn (P0)
The fix decision merges non-void verifier findings and 035 ledger fails under 035's single-turn allowance and gates; no measure nudge when the verifier ran; round-2 records.

### Requirement 5 - Gates (P0)
The first commit is this spec. `npm run check` before each commit; explicit-path staging; the new module stays under 250 pure LOC; no new import cycles; no `any`.

## Acceptance criteria (named vitest cases)

Defaults: `OMK_FINISH_CHECK_REVERIFY=on`, `OMK_FINISH_CHECK_EXTRA_TURN=on`, `OMK_TIME_BUDGET_SEC=900`, headless, workspace mutated by `write /app/out.txt`, first settle at 180 s (20%).

1. **Trigger.** After the check turn settles, exactly one follow-up starts with `<fresh_verification>`. It contains the task prompt, `/app/out.txt`, the REQ list and the different-input step. Event `{ active: true, stage: "verify" }`.
2. **Boundary at 0.3.** First settle at 269 s (29.9%) → the verifier runs. First settle at 270 s (exactly 30%) or 450 s (50%) → no verifier. The tests compare with `FINISH_CHECK_REVERIFY_FRACTION` by name. A separate test asserts `REVERIFY (0.3) < SAVE_NOW (0.75) < EXTRA_TURN (0.85) < SKIP (0.9)`.
3. **The first settle decides.** First settle at 260 s, check turn ends at 330 s (36.7%) → the verifier still runs.
4. **Off by default.** With `OMK_FINISH_CHECK_REVERIFY` unset, `off` or an unknown value, sent messages, entries and events equal main's flow for the same replies, with `OMK_FINISH_CHECK_EXTRA_TURN` both unset and on. `resolveFinishCheckReverify` accepts exactly the values `resolveFinishCheckExtraTurn` accepts.
5. **No budget, no UI, no workers.** `OMK_TIME_BUDGET_SEC` unset → no verifier. A session with a UI (even with `OMK_FINISH_CHECK=always`) → no verifier. `subagentWorkerEnv` output never carries `OMK_FINISH_CHECK_REVERIFY` or a budget (extends the #45 worker-env test). An injected `readBudget` drives the trigger instead of the env budget.
5a. **Shared run clock.** With a run clock bound at t=0 and the extension loaded at 200 s of 900 s, a first settle at 260 s (28.9% of the run) fires the verifier; a first settle at 280 s (31.1%) does not, although the extension's own clock reads 80 s.
6. **Fresh context** (harness test with the faux provider capturing `Context.messages`). During the verifier call, the messages are [verifier instruction quoting the task prompt] plus the verifier's own tool round-trips. No earlier assistant text, tool result or check-turn message is present. On the next (fix) call, the full history is back. The verifier call uses the run's model and thinking level.
7. **Read-only.** During the verifier, `write` and `edit` are blocked with the `/tmp/omk-verify/` reason; after it ends they run normally.
8. **Mutated means void.** A verifier `bash` call changes `/app/out.txt` and the reply has `VERIFY 1: FAIL - …`. The entry has `mutated: true` and `verdict: "void"`, no fix turn is sent, and the deliverable is not restored. Variant: the check ledger also has `stone 74 >= 75` → one fix turn (threshold only), whose message does not contain the void finding.
9. **Caps.** The 10th verifier tool call triggers the wrap-up steer once. With 15% of the budget (135 s) used inside the verifier, the steer comes once, whichever cap is hit first.
10. **Verifier FAIL → one fix turn.** `VERIFY 1: FAIL - parse new ELF; expected 0x401000; got 0x400000` with nothing mutated → one fix follow-up containing the finding and the keep-saved-output sentence. The fix turn ends with no further turn, and the entries carry `round: 2`.
11. **One extra turn per task, ever.** The check ledger has `stone 74 >= 75` and the verifier FAILs → one fix message containing both. The check is a numeric fail and the verifier PASSes → one fix turn (threshold). In every case the number of fix or extra follow-ups per task is 0 or 1.
12. **Measure folded into the verifier.** The check leaves REQ 1 unmeasured → the verifier instruction lists REQ 1 with the comparison format, and no separate measure nudge is sent. The verifier then measures `stone 74 >= 75` → that becomes a finding and gets the one fix turn.
13. **No findings, no turn.** `VERDICT: PASS` with all-PASS lines, no VERIFY lines, an aborted verifier, or `hasPendingMessages()` → no fix turn, unless spec 035's ledger alone calls for one.
14. **Late fix.** The verifier FAILs but ends at 0.86 of the budget → no fix turn; findings recorded.
15. **No second verifier.** After a fix turn, or for any later settle of the same task, no `<fresh_verification>` is sent. A new user task resets this.
16. **Instruction content.** The instruction contains the line about new inputs and "Do not count re-running the given examples", the `/tmp/omk-verify/` rule, the no-web-answers rule, and the reply format. The deliverables list is deduplicated and capped at 30.
17. **Cost recorded.** The `finish_check_verify` entry carries `costUsd` and token totals summed from the verifier turn's assistant messages (faux usage in the test).
18. **Extra-turn flag off (decision 9).** With `OMK_FINISH_CHECK_REVERIFY=on` and `OMK_FINISH_CHECK_EXTRA_TURN` unset: the verifier runs and its verdict and findings are recorded (`finish_check_verify`, event `fixTurn: false`), but no fix turn or continue message is sent for a verifier FAIL, a check-ledger miss (`stone 74 >= 75`), a verifier REQ miss, or a verifier PASS; a later settle sends nothing. With both flags on, cases 10–12 apply.

## A/B measurement

- **One build, one flag** (Bench Analyst's rule): both arms run the same main build (after this PR merges) and differ only in `OMK_FINISH_CHECK_REVERIFY`: unset in A, `on` in B. All other new opt-in flags are off in both arms, except `OMK_FINISH_CHECK_EXTRA_TURN=on` in **both** arms, because 032's fix turn is 035's single extra turn.
- **A (baseline)**: `OMK_FINISH_CHECK_EXTRA_TURN=on`, `OMK_FINISH_CHECK_REVERIFY` unset (identical to main with 035 on, AC4).
- **B**: `OMK_FINISH_CHECK_EXTRA_TURN=on`, `OMK_FINISH_CHECK_REVERIFY=on`. Same model (grok-4.7 xhigh), same adapter, `time_budget=auto`.
- 3 runs per task per arm.

**Primary targets** at the 0.3 trigger: R8 omk trials in S/G/P that ended before 30% of the budget, on tasks with budgets ≤ 1800 s. These are 11 trials on 10 tasks.

| Task | Budget | R8 omk | Early-finish failing trials (agent s, % of budget, class) |
| --- | --- | --- | --- |
| fix-git | 900 | 1/3 | r1 38 s 4% S, r3 68 s 8% S |
| git-multibranch | 900 | 2/3 | r1 51 s 6% S |
| path-tracing | 1800 | 2/3 | r1 162 s 9% P |
| mteb-retrieve | 1800 | 2/3 | r1 195 s 11% S |
| extract-elf | 900 | 0/3 | r1 132 s 15% G (r3 at 49.8% is outside 0.3) |
| financial-document-processor | 1200 | 2/3 | r3 176 s 15% S |
| pytorch-model-cli | 900 | 2/3 | r3 137 s 15% G |
| dna-insert | 1800 | 2/3 | r1 404 s 22% S |
| sqlite-with-gcov | 900 | 2/3 | r3 206 s 23% S |
| chess-best-move | 900 | 1/3 | r1 231 s 26% S |

**Secondary target** (3600 s budget; run only if credits allow): video-processing (r3 12% G, r2 28% G). With it, 0.3 covers **13 of the 21** S/G/P early failures.

**Out of reach at 0.3** (8 of 21; candidates for a later 0.5 arm): dna-assembly r3 37%, protein-assembly r1 39%, install-windows-3.11 r1 31% and r2 41%, make-mips-interpreter r1 44%, raman-fitting r2 45%, extract-elf r3 49.8%, sam-cell-seg r1 49.8%.

**Excluded:** filter-js-from-html (R8 failures ended at 64–85%) and sanitize-git-repo r1 (24%, class D: a scope problem, not a verification one).

**Controls** (omk 3/3 in R8, finished early, budget ≤ 1800 s), to catch false FAILs that break a passing result: log-summary-date-ranges, openssl-selfsigned-cert, sqlite-db-truncate, git-leak-recovery, constraints-scheduling.

**Report**: reward per task and arm; how often the verifier fired; verdicts, including `void`; findings that led to a fix and whether the fix turned the reward around; `mutated` count; verifier seconds and share of budget; **cost per trial for both arms, and verifier cost per trial** (required). Also report any sign of earlier conversation leaking into the verifier (decision 2). Per Tech Lead, no merge without a score difference, and the flag stays off by default until the A/B wins.

**Size**: 10 primary + 5 controls = 15 tasks × 3 × 2 = 90 trials (+6 with video-processing). The A/B needs the bench Grok credits refilled. If they are short, drop mteb-retrieve and two controls: 72 trials.

## Non-goals

- No change to requirement extraction. The report's idea of also extracting qualitative requirements ("print them all", "merge into master") is a separate change to `finish-check-requirements.ts`.
- No separate verifier process, model or effort level in this version (decisions 2 and 5).
- No restore of a deliverable the verifier changed, and no findings from such a verifier (decision 6; restore is spec 034).
- No verifier for interactive runs, runs without a budget, or subagent workers.
- No reading of the task's test files, and no web lookups (the report found contamination in db-wal-recovery; spec 031 adds the general rule).

## Decisions (Tech Lead, 2026-10-11)

1. **Fix turn**: shares spec 035's single extra turn. One extra turn per task in total, ever.
2. **Isolation**: same-session `context` event filtering. If the A/B shows the prior conversation leaking into the fresh context, the verifier moves to a child process later.
3. **Trigger**: `FINISH_CHECK_REVERIFY_FRACTION = 0.3`, covering 13 of the 21 S/G/P early failures. It fires on about 55% of passing R8 trials (106/194), so the A/B records per-trial cost. A 0.5 arm may be measured separately later.
4. **Default**: off. It is enabled by default only after an A/B win.
5. **Model and effort**: the same as the run, to avoid confounding with spec 033.
6. **Mutation**: a verifier that changes a deliverable is recorded as `mutated` and its result is void; no fix turn is generated from it. Restoring the deliverable belongs to candidate 2 (spec 034, artifact preservation).
7. **Base and clock**: implement on main `5c5806b` (#62 merged, 035's extra turn behind `OMK_FINISH_CHECK_EXTRA_TURN`). Read the budget through an injectable seam with today's finish-check source, and switch it to #63's `readRunBudget()` only after #63 lands (superseded by decision 8).

8. **Clock**: #63 merged before this PR, so the trigger reads the shared run clock in this PR (decision 7's seam defaults to `readRunBudget()`).
9. **Extra turn only from its own flag**: with `OMK_FINISH_CHECK_EXTRA_TURN` off, 032 only verifies and records; no fix turn. The extra turn is created by that one flag alone (one flag, one behaviour, a clean off switch). This settles open question 1.

## Bench visibility

Benches run `omk --no-session --mode json`. JSON mode writes only session events (`session.subscribe`) to stdout: the follow-up user messages (check, verifier instruction, fix turn) and the assistant replies with their REQ/VERIFY lines appear there as message events, but `appendEntry` records (`finish_check_ledger`, `finish_check_verify`) and `omk.events.emit("finish_check", …)` events do not (no session file, and the extension event bus has no stdout subscriber). The trigger decision, verdict, `mutated` and whether the fix turn used the shared extra turn are therefore not visible in `omk.jsonl` today.

They will go to the shared run log (`appendRunLog("finish-check", record)` writing `$OMK_RUN_LOG_DIR/finish-check.jsonl`, Runtime Engineer's PR) once it merges: one record for the trigger decision (fired or not, first-settle fraction), one for the verifier result (verdict, finding counts, `mutated`, changed-path count, tool calls, seconds, cost, `fixTurn`). Records hold only hashes, paths and numbers, no prompt text, file contents or env values. The call sites are marked with `run-log (spec 032)` comments in `extensions/builtin/finish-check.ts`; wiring them is a follow-up on top of `run-log.ts`.

## Open questions (for Tech Lead, all settled)

1. ~~032 on, 035 extra-turn flag off~~: decided by Tech Lead as decision 9 (verify and record only, no fix turn).
2. ~~A/B arms~~: settled by Bench Analyst's rule (one flag per A/B; 032 runs with `OMK_FINISH_CHECK_EXTRA_TURN=on` in both arms).

## Expected Files

- `specs/032-fresh-context-reverify/spec.md`: this spec
- `packages/coding-agent/src/core/finish-check.ts`: `resolveFinishCheckReverify`, `FINISH_CHECK_REVERIFY_FRACTION`, `shouldReverify`
- `packages/coding-agent/src/core/finish-check-reverify.ts`: pure module (instruction, deliverables list, reply parsing, fresh-context filter, fix message, cost totals, caps)
- `packages/coding-agent/src/core/finish-check-reverify-hash.ts`: deliverable hashing (size and sha256, files ≤ 8 MiB, 4 reads at once)
- `packages/coding-agent/src/core/extensions/builtin/finish-check-reverify-stage.ts`: verifier turn wiring (context filter, write/edit block, caps, records)
- `packages/coding-agent/src/core/extensions/builtin/finish-check.ts`: the budget reader, the trigger, and the shared fix turn
- `packages/coding-agent/src/core/extensions/builtin/finish-check-reply.ts`: reply readers moved out of the extension (module size)
- `packages/coding-agent/examples/extensions/subagent/worker-env.ts`: `OMK_FINISH_CHECK_REVERIFY` is lead-only
- `packages/coding-agent/test/finish-check-reverify.test.ts`, `-reverify-hash.test.ts`, `-reverify-hash-limit.test.ts`, `-reverify-stage.test.ts`, `-reverify-flow.test.ts`, `-reverify-harness.test.ts`, `finish-check-budget-seam.test.ts`
- `packages/coding-agent/docs/environment-variables.md`: `OMK_FINISH_CHECK_REVERIFY` row
