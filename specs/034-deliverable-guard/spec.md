---
description: "Headless runs: warn early when a required output file is missing, keep the last valid copy, and restore it before the end"
---

# Feature Specification: Deliverable watchdog and last-good copy

**Specification ID**: `034-deliverable-guard`
**Feature Branch**: `feat/deliverable-guard` (off main `5c5806b`; spec drafted earlier on `spec/034-deliverable-watchdog`)
**Created**: 2026-10-11
**Status**: Implemented, opt-in (PR #100); default-on waits for Bench Analyst's A/B
**Constitution**: [specs/constitution.md](../constitution.md)
**Input**: Improvement candidate 2 in `/workspace/omk-ab/IMPROVEMENT_CANDIDATES_20261011.md` ("산출물 워치독 + 마지막 유효본 보존"). Tech Lead assigned it to Staff Engineer after 031.
**Depends on**: #62 (`splitSentences`, the produce-word rules in `finish-check-requirements.ts`) and #63 (`readRunBudget()`, the shared run clock, spec 036), both merged; the branch carries main `c3ac89e`.

**Clock**: the guard reads time through `budgetFraction: () => number | undefined` (injectable for tests). The default, `runBudgetFraction`, reads it the way finish-check does after spec 036: `readRunBudget()?.elapsedFraction` when the shared run clock is bound (print/json mode, origin = run start), else `OMK_TIME_BUDGET_SEC` from the time the extension loads, so `always` in an interactive session still has a clock. The guard's own checks and copies are run time, not harness waits, so it does not call `excludeRunBudgetWaitMs` (spec 036 uses that for harness snapshot waits only). Tested in `deliverable-guard-run-clock.test.ts`: loaded at 60% of a 100 s budget it steers on the first tool event; it steers at 41 s and not at 39 s; it restores at 91 s while its own clock is still at 0.

## Evidence (R8, `improve/r8_omk_fail_details.txt`, `r8_omk_fail_classes.csv`)

Class T1 (timeout with no saved output, or a broken one) is 10 of R8's 64 omk failures; mini passed 2 of the same reps.

| Task (budget) | Rep | What the verifier saw |
| --- | --- | --- |
| write-compressor (900 s) | r1, r2 | `data.comp` does not exist. r2's last response was one 876 s stream, so the 75% save-now steer never landed |
| gpt2-codegolf (900 s) | r3 | `/app/gpt2.c` does not exist |
| gpt2-codegolf (900 s) | r1 | `/app/gpt2.c` is 5069 bytes, limit `< 5000` |
| path-tracing-reverse (1800 s) | r3 | `mystery.c` does not exist |
| path-tracing-reverse (1800 s) | r2-retry | `mystery.c` exists but does not compile |
| extract-moves-from-video (1800 s) | r1, r3 | `/app/solution.txt` does not exist |
| break-filter-js-from-html (1200 s) | r2 | `/app/out.html` does not exist |
| train-fasttext (3600 s) | r3 | `/app/model.bin` was deleted |

In 8 of the 10 cases the run got the 75% save-now steer and still ended with no file. A text reminder at 75% is too late and too weak; the harness has to act on its own.

Output paths are recoverable from the prompts. A path that follows a produce word in the same sentence is the deliverable in all seven target tasks (checked against `tb2/terminal-bench-2/*/instruction.md`):

| Task | Sentence | Deliverable | Size limit in the prompt |
| --- | --- | --- | --- |
| write-compressor | "Write me data.comp that's compressed …" | `<cwd>/data.comp` | "data.comp must be at most 2500 bytes" |
| gpt2-codegolf | "Call your program /app/gpt2.c …" | `/app/gpt2.c` | "Your c program must be <5000 bytes" (single deliverable) |
| path-tracing-reverse | "Write a C program /app/mystery.c …" | `/app/mystery.c` | gzip size only, not checked |
| break-filter-js-from-html | "… create a file called /app/out.html …" | `/app/out.html` | none |
| extract-moves-from-video | "… create a file /app/solution.txt …" | `/app/solution.txt` | none |
| train-fasttext | "The model should be saved as /app/model.bin" | `/app/model.bin` | "less than 150MB" (single deliverable) |
| tune-mjcf | "Tuned mjcf should be saved as /app/model.xml." | `/app/model.xml` | none |

Paths that only appear as inputs (`/app/decomp.c`, `/app/filter.py`, `/app/model_ref.xml`, `/app/a.out` in "I will run it /app/a.out …") follow no produce word and are not deliverables.

## CLI Harness Target Impact

**Classification**: improve (benchmark completion discipline). Off by default; no change for interactive sessions, for runs without the flag, or for tasks whose prompt names no deliverable.

| Dimension | Baseline (main + #62 + #63) | Acceptance target | Regression floor | Verification | Evidence |
| --- | --- | --- | --- | --- | --- |
| Missing output at timeout | 8 of 10 T1 runs end with no file | Missing deliverables get a steer at 40% of the budget; a valid copy that existed at any point is back in place by 90% and at settle | Runs whose deliverables are present and valid see no steer, no restore and no extra tool call | `vitest run test/deliverable-guard.test.ts test/fast-check.test.ts` | those files |
| Broken output at timeout | gpt2 r1 (size), ptr r2-retry (compile) | Current file invalid + last-good exists → restored | A valid current file is never replaced by an older copy | same | same |
| Overhead | none | Per tool call: one `stat` per deliverable; a fast check only when size or mtime changed, ≤ 5 s each | Total guard time per run reported in the end event | same | `deliverable_guard` session entry |
| Benchmark score | R8 omk: 3 of 19 runs on the 6 target tasks | A/B below: effect rule (C ≥ A + 2 on targets, with a steer or restore in the gain) | No new timeouts on controls | A/B, 3 runs per task per arm | Bench Analyst report |

## Requirements

### Requirement 1 - Find deliverables in the prompt (P0)

- New pure `extractDeliverables(prompt, cwd)` in `src/core/deliverable-guard.ts`, built on #62's sentence splitter (exported from `finish-check-requirements.ts`; code blocks and indented lines are still skipped).
- In each sentence, the first path after the first produce word is a deliverable. Produce words: #62's `PRODUCE_WORDS` plus `call(ed)?` and `name(d)?` ("Call your program /app/gpt2.c"). A path is an absolute path with at least two segments or a relative file name with a known extension (#62's `RELATIVE_FILE` list plus `.comp`, `.xml`, `.h`, since `data.comp` is write-compressor's deliverable); relative names resolve against the session cwd.
- Directories (path ends in `/`) are not deliverables. At most 4 deliverables per task, in prompt order.
- Size limit: a sentence that names a deliverable (full path or basename) and bounds a byte size (`<`, `<=`, `at most`, `less than`, `under`, `no more than` + `N bytes|B|KB|MB|GB`) sets that deliverable's limit. KB/MB/GB are binary (1024-based): train-fasttext's verifier uses `150 * 1024 * 1024`, and the looser reading never restores an older copy over a file the verifier would accept. If the task has exactly one deliverable, a size sentence that names no file also applies to it. `<` is strict, `at most` inclusive. Anything else (gzip size, "2k") sets no limit.

### Requirement 2 - Fast validity check, shared with the per-edit diagnostics spec (P0)

- New `src/core/fast-check.ts`: `fastCheckFile(path, { sizeLimit?, timeoutMs = 5000 })` → `{ ok, reason?, ms }`.
- `ok` requires: the file exists, is a regular file, is non-empty, and is within the size limit. Then by extension, only when the checker is on `PATH`: `.c`/`.h` `cc -fsyntax-only -I <file's directory>`, `.py` `python3 -m py_compile` (writing bytecode to a temp dir), `.json` `JSON.parse`, `.sh` `bash -n`. Other extensions (including `.xml`) get existence and size only: a tag-balance check would keep broken files as "good" copies (Tech Lead, 2026-10-11).
- A checker that is missing, times out or crashes is "unknown", which counts as `ok` (the guard never discards a file because a checker failed). A `cc` failure whose stderr says a header was not found (gcc `fatal error: x.h: No such file or directory`, clang `fatal error: 'x.h' file not found`; checkers run with `LC_ALL=C`) is `unknown:missing-header`, also `ok`: the build may pass `-I` flags the guard does not know, and calling that file broken would put an older copy over a better file (Tech Lead review of `b0998ee`). Every check runs with a 5 s timeout and is killed with its process group.

### Requirement 3 - Last-good copy (P0)

- After each `tool_execution_end`, for each deliverable: `stat`; if size or mtime changed since the last look, run `fastCheckFile`; if `ok`, copy the file to `<tmpdir>/omk-deliverables/<pid>/<index>-<basename>` and record size, sha256 and the elapsed fraction. Only the latest good copy per deliverable is kept.
- Files over 256 MiB are not copied (recorded as `too_large`). The store is outside the workspace and deleted when the session shuts down.
- Resource bounds (checked after Tech Lead's #101 note on concurrent large reads): there is no `Promise.all` over files. `observe`, `restoreBroken` and `restoreSync` walk at most 4 deliverables one at a time, and the extension runs every event's and the timer's file work through one serial chain, so at most one copy, hash or check runs at a time. The sha256 of a copy is streamed, so a file near the 256 MiB cap is never held in memory; the only whole-file read left is `JSON.parse` in `fastCheckFile`, capped at 32 MiB. No limiter is needed.

### Requirement 4 - Watchdog steer at 40% (P0)

- When the shared clock (`readRunBudget()`) passes `DELIVERABLE_WATCHDOG_FRACTION = 0.4` and any deliverable does not exist, send one steer: it names the missing paths and says to write a simple working version to each now and improve it afterwards. Once per user task.
- Checked on `tool_execution_end`, `message_end`, and by an unref'd timer that reads the budget fraction every 5 s, so a long single stream (write-compressor r2) is still caught; the steer is delivered at the next boundary. The timer needs only the fraction.
- No budget means no steer.

### Requirement 5 - Restore before the end (P0)

- Restore points: (a) the shared clock passes `DELIVERABLE_RESTORE_FRACTION = 0.9` (same point as `FINISH_CHECK_SKIP_FRACTION`), by the same timer as well as on events, once per task; (b) every `agent_settled`, before finish-check decides on its turn; (c) best effort on `SIGTERM` in headless runs: synchronous, existence and size only, no checker processes. The same synchronous restore also runs in the guard's `session_shutdown` (reason `quit`) handler before the store is deleted, logged with `point: "shutdown"`: print mode's SIGTERM listener is registered before the guard's and disposes the runtime, so `session_shutdown` can delete the copies before the guard's own SIGTERM listener runs. After a normal settle this finds nothing to restore.
- At a restore point, a deliverable is restored only when the current file is missing or `fastCheckFile` says not `ok`, and a last-good copy exists. A valid current file is never replaced.
- After a restore at (a), the run gets one steer naming what was restored and why ("`/app/gpt2.c` was 5069 bytes, over the 5000-byte limit; restored the 4,8xx-byte copy from 62% of the budget"), so it does not overwrite it with the broken version again.
- Every restore is written to a `deliverable_guard` session entry and emitted as an event: path, reason (`missing` | `invalid:<reason>`), restored size and sha256, the fraction it was saved at.

### Requirement 6 - Gating (P0)

- `OMK_DELIVERABLE_GUARD`: unset, empty or any other value = disabled (default). `1`/`true`/`on`/`enable`/`enabled` (the values `OMK_FINISH_CHECK_EXTRA_TURN` accepts) = headless only, the same rule as `shouldAddFinishDiscipline`. `always` = every session (for tests).
- Off is exactly main: the factory returns before registering any handler, timer or signal handler (tested). Per Bench Analyst's rule, the A/B flips only this flag on one main build, and default-on waits for that A/B.
- Benchmark workers spawned by the subagent extension get it off, like `OMK_FINISH_CHECK` in #45.
- The guard does not depend on finish-check being on, but when both are on, restore (b) runs before the finish-check turn, so the check sees the restored file.

### Requirement 6b - Run log for the A/B (P0)

- Bench runs use `--no-session --mode json`, so session entries and event-bus records never reach `omk.jsonl`. The guard logs through spec 042's `appendRunLog("deliverable-guard", record)`: with `OMK_RUN_LOG_DIR` set and the guard on, one JSON line per event goes to `<OMK_RUN_LOG_DIR>/deliverable-guard.jsonl`:
  - `steer`: `kind` (`watchdog` | `restore`) and the paths named;
  - `verdict`: at each restore point, per deliverable, the fast-check result and the decision (`keep` | `restore` | `no_copy`), with `path`, `point`, `ok`, `reason`, `ms`;
  - `restore`: every restore record (90%, settle, SIGTERM and shutdown), with `path`, `point`, `outcome`, `reason`, sizes, sha256 and the saved-at fraction;
  - `summary`: at each settle, `steers`, `restores`, `guardMs`.
- `appendRunLog` adds `t` (epoch ms), `elapsedFraction` (shared clock or null), `pid` and `role`; guard records never use those keys. Records hold paths, reasons, numbers and hashes only (spec 042 privacy rule), never file contents or environment values.
- `appendRunLog` writes with `appendFileSync`, so the SIGTERM line is on disk before exit, and never throws into the run.
- Guard off: nothing is written even when `OMK_RUN_LOG_DIR` is set. `OMK_RUN_LOG_DIR` unset: nothing is written.

### Requirement 7 - Gates (P0)

- First commit is this spec. `npm run check` passes before each commit; touched modules stay under the module-size ceiling; no import cycles; no `any`.

## Acceptance criteria (named vitest cases)

Extraction (`deliverable-guard.test.ts`, run on the real `instruction.md` text copied into fixtures):

1. The seven target prompts give exactly the deliverables in the table above, and none of the input paths.
2. Size limits: write-compressor 2500 inclusive, gpt2 5000 strict, train-fasttext 150 MB strict, path-tracing none.
3. A prompt with two deliverables and an unnamed size sentence applies the limit to neither.
4. Paths in fenced code and indented lines are ignored.

Fast check (`fast-check.test.ts`):

5. Missing, empty, directory and over-limit files are not `ok`, with distinct reasons.
6. A `.c` file with a syntax error is not `ok` when `cc` exists; the test is skipped when `cc` is missing. Same for `.py` with `python3`.
7. A checker that hangs is killed at the timeout and the result counts as `ok` with reason `unknown:timeout`.
7b. A `.c` file whose `#include` (quoted or angled) does not exist is `ok` with reason `unknown:missing-header`; an angled header in the file's own directory is found through `-I`; a real syntax error in a file whose headers are found is still `syntax:cc` (`cc` present).

Guard (harness tests with a fake clock and fake budget of 900 s):

8. **Watchdog**: deliverable missing at 360 s (40%) → exactly one steer naming it; a second tool call at 400 s sends nothing more. Present at 360 s → no steer.
9. **Long stream**: no tool event between 300 s and 800 s → the 40% timer fires and the steer is queued for the next boundary.
10. **gpt2 r1 shape**: a valid 4,900-byte copy is saved, later the file grows to 5,069 bytes → at 810 s (90%) the 4,900-byte copy is back, one steer explains it, a `deliverable_guard` entry records `invalid:size`.
11. **ptr r2-retry shape**: a compiling copy is saved, the current file stops compiling → restored at settle (`cc` present).
12. **train-fasttext r3 shape**: a saved copy, then the file is deleted → restored at settle with reason `missing`.
13. **Never downgrade**: the current file is valid but different from the last-good copy → nothing is restored at 90% or at settle.
14. **No copy, nothing to do**: missing deliverable with no last-good copy → no restore, entry records `missing_no_copy`.
15. **Gating**: flag unset/off → no handlers, timers or signal handlers are registered; flag `on` with a UI → nothing; flag `on` headless → active. No budget → no steer and no 90% restore, but settle restore still works.
16. **Order with finish-check**: both on, file deleted before settle → the finish-check turn's first tool sees the restored file.
17. **Cleanup**: the store directory is gone after session shutdown; timers are cleared and do not keep the process alive.
17b. **Header not found is not broken**: a compiling copy is saved, the newer file includes a header `cc` cannot find → kept at settle, nothing restored (`cc` present).
17c. **SIGTERM in print mode** (`deliverable-guard-sigterm.test.ts`): through `runPrintMode`'s real SIGTERM listener, a missing deliverable with a copy is restored, then the store directory is deleted.
18. **Run log** (`deliverable-guard-log.test.ts`): guard off + `OMK_RUN_LOG_DIR` set → no file; guard on + variable unset → nothing written; a run with a watchdog steer, a 90% restore and a settle gives `steer`, `verdict`, `restore` and `summary` lines carrying `t`/`elapsedFraction`/`pid`/`role`; no guard record sets those keys; no file contents or env values; the SIGTERM restore line is written synchronously.

## A/B measurement (Bench Analyst decides)

- **Pin**: main `d69af96` (Tech Lead's joint A/B pin; #62, #63, this spec's code (#100) and the run logs are in it). 034 is measured in the joint A/B with arms A–E on that one build (Bench Analyst's plan, `/workspace/omk-bench-analyst/AB_PLAN_d69af96.md`). One SHA, env settings only.
- **Arms**: A = control, all new opt-in flags off (`OMK_DELIVERABLE_GUARD`, `OMK_RESPONSE_REASONING_CAP`, `OMK_FINISH_CHECK_EXTRA_TURN`, `OMK_FINISH_CHECK_REVERIFY` unset). C = `OMK_DELIVERABLE_GUARD=on` only. 034's verdict is **A vs C**.
- **Shared control**: A is the shared control for 033, 034 and 035, so if A comes out low by chance, all three look better together. Report the A/C result with this caveat.
- **Evidence source**: benches run `omk --no-session --mode json`, so there is no session file and the `deliverable_guard` session entry is not available. Every arm sets `OMK_RUN_LOG_DIR` to a directory in the run dir, which the adapter copies into the trial's `agent/` directory. Steers, verdicts, restores by reason and guard seconds are read from `$OMK_RUN_LOG_DIR/deliverable-guard.jsonl` (see Requirement 6b). In A no `deliverable-guard.jsonl` appears, which confirms the flag was off.
- **Targets**: write-compressor, gpt2-codegolf, path-tracing-reverse, break-filter-js-from-html, extract-moves-from-video, train-fasttext (the T1 tasks above). tune-mjcf is left out: its R8 loss was a better candidate never saved, which this spec does not address.
- **Controls**: the five shared controls from spec 032 (omk 3/3 in R8): log-summary-date-ranges, openssl-selfsigned-cert, sqlite-db-truncate, git-leak-recovery, constraints-scheduling. 034's control criteria (the task writes an output file, and at least one control first writes its output after 40% of the budget and still passes, so a mid-work steer is tested on a run that does not need it) are checked in the R8 logs before the run; a control that does not meet them is swapped (Bench Analyst's plan).
- 3 runs per task per arm. Report reward, steers sent, restores by reason, guard seconds per run, cost. A noise-level difference is not a win; with 3 runs per task most results are expected to be inconclusive, and the report says so in its first line.
- Steered passing runs are counted separately: how many passing runs (either arm's R8-equivalent) got a steer in C, and whether they lost.
- **Verdict rules** (Bench Analyst, set before the run; paired by task × rep, so the targets give 6 tasks × 3 runs = **18 pairs** and the controls 5 × 3 = 15 pairs):
  - **Effect**: all of
    - targets: C − A ≥ **+2** passes over the 18 target pairs, and at least one gained run (a pair where C passed and A did not) has a `steer` or `restore` line in its `deliverable-guard.jsonl`;
    - the sign test on the discordant target pairs points the same way;
    - controls: C ≥ A − 1 passes over the 15 control pairs;
    - floor: no target run that passed in A lost in C because the guard put an older copy back (checked against the `restore` and `verdict` records of the losing C run).
  - **No effect**: the upper bound of the 95% confidence interval of the target pass difference is below +2, i.e. an effect that size would have shown and did not.
  - **Inconclusive**: anything else. The report gives the number of discordant pairs and how many more runs a verdict would need. With 3 runs per task this is the likely outcome; the report says so in its first line.
  - Any control that loses a run or gains a new timeout in C is reported even when C ≥ A − 1 holds. R8 omk passed 3 of 19 target runs; gpt2-codegolf and train-fasttext were 0/3 for both omk and mini, so the other four targets decide it.
- **Cost verdict** (separate from the pass verdict, as in spec 033): per-run cost in xAI `cost_in_usd_ticks` from the adapter's `omk_usage_raw.jsonl`, not omk's `usage.cost`. Requests sent and usage lines are counted per run; a missing usage line makes C − A a **[lower, upper] interval**. A cost conclusion is stated only if both ends agree; otherwise "cost verdict deferred".
- **What happens next** (Tech Lead): the code is already on main with the flag off, so the verdict only sets the default. Effect → a PR that turns the guard on by default. Inconclusive → stays off, more runs in the next A/B. No effect → a PR that removes the flag and the code.
- **Cost** (R8 omk runs, computed from xAI `cost_in_usd_ticks` in `agent/omk_usage_raw.jsonl`, 1 tick = 1e-10 USD; per-task means in `/workspace/omk-bench-analyst/r8_task_cost.json`, field `mean`): the six targets average **$0.61 per run** (mean of the six per-task means; $0.67 when weighted by R8's 19 target runs, field `n`). The earlier "about $3.7 per target run" was wrong: $3.67 is the sum of the six target means, i.e. one rep of all six targets. The five controls average $0.05 per run. One rep of 034's tasks in one arm is about $3.92 (targets $3.67 + controls $0.25), so arm C's 3 reps are about $11.7 at R8 means; A is shared with 033/035 and is costed in the joint plan (R8 total $155.2 over 262 omk runs, $0.59/run). Needs 인호's OK and refilled credits.

## Non-goals

- Saving better candidates the run found but never wrote (tune-mjcf r2). That needs the run's own score, not a file check.
- Forcing the next tool call to be a baseline write. The candidate report suggested it; a steer is tried first because a forced call can break a run that is mid-way through a multi-step write.
- Re-running the task's tests or any network access.
- Reverting changes made during 032's verification turn. 032 marks those results invalid; restoring the files is a follow-up once both specs are in.

## Known risks

- The 90% restore can revert a file that is only temporarily broken while the model fixes it over several edits. Accepted by design: the model is told by the restore steer, and the A/B measures it from the run log (tasks whose result goes 1→0 after a restore).
- A missing header is a fatal error for `cc`, so it stops there: a `.c`/`.h` file whose `#include` cannot be found is `unknown:missing-header` (counts as `ok`) even if it also has a real syntax error later in the file, and the guard keeps it instead of restoring the last good copy. Accepted: this errs toward keeping the newer file (Tech Lead review of #100).

## Decisions (Tech Lead, 2026-10-11)

1. At 40% the guard only steers; it does not force the next tool call to be a write. Bench Analyst agrees.
2. The watchdog point stays at 0.4. Bench Analyst's R8 count on the 6 target tasks: of 15 losing runs, 8 never wrote the deliverable and 6 first wrote it at 76–92%; only train-fasttext r2 wrote before 40%. Of 4 passing runs, 3 wrote at 7–18%, but path-tracing-reverse r1 first wrote at 77% and still passed, so the steer can land mid-work. The A/B counts passing runs that got a steer and whether they lost, and a control task that writes its output late and passes is included.
3. `.xml` content checks are out of scope; `.xml` gets existence and size only.

## Expected Files

- `specs/034-deliverable-guard/spec.md`: this spec (first commit)
- `packages/coding-agent/src/core/deliverable-guard.ts`: `extractDeliverables`, size-limit parsing, flag parsing, steer texts, `runBudgetFraction` (pure)
- `packages/coding-agent/src/core/deliverable-store.ts`: last-good copies, restore decisions, SIGTERM restore, cleanup (split from the extension for the module-size ceiling)
- `packages/coding-agent/src/core/fast-check.ts`: `fastCheckFile` (shared with the per-edit diagnostics spec)
- `packages/coding-agent/src/core/extensions/builtin/deliverable-guard.ts`: events, timer, steers, session entries
- `packages/coding-agent/src/core/extensions/builtin/harness-factories.ts`: registration, before finish-check
- `packages/coding-agent/src/core/finish-check-requirements.ts`: export the sentence splitter and produce words
- `packages/coding-agent/examples/extensions/subagent/worker-env.ts`: workers get the guard off
- `packages/coding-agent/docs/environment-variables.md`, `docs/usage.md`. `CHANGELOG.md` is left for a follow-up because open #97 edits it too.
- Tests: `test/deliverable-guard.test.ts` (extraction, AC 1-4), `test/fast-check.test.ts` (AC 5-7), `test/deliverable-guard-extension.test.ts` (AC 8-17 and the flag-off case), `test/deliverable-guard-run-clock.test.ts` (shared run clock), `test/deliverable-guard-log.test.ts` (AC 18), `test/deliverable-guard-sigterm.test.ts` (AC 17c), fixtures under `test/fixtures/deliverables/`
