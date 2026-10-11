---
description: "Opt-in background bash jobs (start, status, wait, output, kill) for long builds, servers and test suites, with whole-tree cleanup on every exit path"
---

# Feature Specification: Background bash jobs with guaranteed cleanup

**Specification ID**: `044-background-bash`
**Feature Branch**: `spec/background-bash` from main `804766e` (#101). Implementation follows on its own branch after review.
**Created**: 2026-10-11
**Status**: Draft (spec first, no implementation)
**Constitution**: [specs/constitution.md](../constitution.md)
**Input**: R8 Terminal-Bench runs lost trials to bash's 300 s tool timeout on long builds, servers, training and test suites (improvement report `/workspace/omk-ab/IMPROVEMENT_CANDIDATES_20261011.md`, "bash 300초 기본 타임아웃" and "긴 명령 관리"). Tech Lead assigned this to Runtime Engineer in the team room.
**Depends on**: spec 036 (shared run clock, `core/remaining-budget.ts`), spec 042 (`appendRunLog`, `core/run-log.ts`). The real-SIGTERM test reuses the harness of `deliverable-guard-sigterm.test.ts` from #100 (spec 034) once that lands.
**OMK Preset**: `omk`

## Evidence

Source: `/workspace/omk-ab/improve/r8_trials.json`, `r8_omk_fail_classes.csv`, `r8_omk_fail_details.txt`, built by `extract_r8.py` from the R8 trajectories. Read-only.

- `timeout_tool` counts tool results whose last 500 characters match `timed out`. It is non-zero in **15 of the 64** failed omk trials. This is the "about 15 runs" figure. It is a heuristic: it also counts timeouts the model set itself (`Command timed out after 40/180 seconds`) and network timeouts.
- The extract keeps only the last 8 tool calls per trial. In those, the outer 300 s timeout (`Tool "bash" timed out after 300000ms. Cancellation was requested; execution may still be running.`) appears in **6 trials**: extract-moves-from-video r1, path-tracing-reverse r3, schemelike-metacircular-eval r3, torch-pipeline-parallelism r2, train-fasttext r1 and r2. Earlier 300 s timeouts in the same trials, and in the other 9, are outside the extract.
- The other 9 of the 15: caffe-cifar-10 r3, db-wal-recovery r3, extract-moves-from-video r2 and r3, filter-js-from-html r1, make-mips-interpreter r2, sam-cell-seg r1, torch-pipeline-parallelism r3, train-fasttext r3. db-wal-recovery r3 is class X (it looked up the answer online), and its visible timeouts are 25 s and 40 s network lookups. It is not a target.
- The typical pattern is a **wait loop**, not one long command. train-fasttext r1 already ran training under `nohup` with pid files, then lost the call to a `for i in $(seq 1 16); … sleep …` poll ("wait ~8 min") that hit 300 s. So background start alone is not enough. The model also needs a bounded **wait** that returns when the job ends.
- Only failed trials were extracted (`traj` is empty for all 204 passing trials). How often passing runs hit the 300 s timeout is unknown. That is one reason the A/B includes controls.
- The report expects a small gain (+0 to 1 trial): mini also scored 0/3 on train-fasttext. This spec targets the class anyway because a timed-out command wastes 300 s of budget each time (train-fasttext r1 lost it 10 times), and that cost also feeds the T1/T2 timeouts.

## CLI Harness Target Impact

**Classification**: advance (headless timed runs). With `OMK_BASH_BACKGROUND` unset, behavior is exactly main's.

| Dimension | Baseline (R8 omk, main of R8) | Acceptance target | Regression floor | Verification | Evidence |
| --- | --- | --- | --- | --- | --- |
| Task success | Targets below: 2 of 16 runs passed in R8 | A/B (below): B ≥ A + 2 passes on targets, with `bash_job` used in the runs that gained | Controls: no new failure, no new timeout | Bench Analyst's paired verdict, 3 runs per task per arm | Bench Analyst report and `bash-jobs.jsonl` |
| Reliability (cleanup) | n/a (no jobs on main) | 0 job processes alive after every exit path in the acceptance list | Every `start` line in `bash-jobs.jsonl` has a matching end line with `groupGone: true` | `vitest run test/bash-background*.test.ts` in `packages/coding-agent` | those files |
| Flag off | main `804766e` | Tool list, handler list, signal listeners and bash schema byte-identical to main | Same | `test/bash-background-flag-off.test.ts` | that file |
| Context efficiency | One timed-out call returns ≤ 50 KB | One `bash_job` result returns ≤ 16 KiB by default and never more than bash's 50 KB cap | Same | `test/bash-background-output.test.ts` | that file |

## Reference: pi background-task packages (ideas only)

- `@earendil-works/pi-*` packages, and packages that need them as peers, cannot be installed. `package-procurement.ts` blocks the legacy import pattern `@(mariozechner|earendil-works)/pi-`. There is no `@earendil-works/pi-background-tasks` on npm (404 on 2026-10-11). The two public packages of that name, `pi-background-tasks` 2.6.9 (tools `bg_run`, `bg_status`, `bg_logs`, `bg_kill`, `bg_result`) and `@vanillagreen/pi-background-tasks` 2.2.0, both take `@earendil-works/pi-coding-agent` as a peer. Only their READMEs (`npm view … readme`) were read. No code is vendored or ported line by line.
- Ideas kept: return at once with a job id and log path; keep full output in a per-session log and only a bounded tail in memory; SIGTERM, then SIGKILL after a grace period; cap finished-job history; delete logs at session end. vanillagreen measured a 5 s grace that still stopped `cargo build`, `bun test` and a Python HTTP server within 0.9 s of SIGTERM.
- Ideas dropped: wake-ups and notifications driven by output (they add model turns we cannot budget), regex output triggers (they need a ReDoS deadline), and survival across reloads (it conflicts with "no leftover jobs").
- **Pi 1.0 compatibility**: OMK checks Pi 1.0 extension API compatibility before anything ships. This feature uses only the existing OMK extension surface (`registerTool`, `on("session_shutdown" | "agent_settled" | "agent_end" | "tool_result")`, `sendUserMessage`) and adds no new public extension API. The implementation PR records the compatibility check result in its description.

## Design decisions

Each decision gives the recommendation first, then the alternative considered.

### D1. Gate and scope

- `OMK_BASH_BACKGROUND`: `1`/`true`/`on`/`enable`/`enabled` (any case, trimmed; the same parser as `OMK_FINISH_CHECK_EXTRA_TURN` and `OMK_DELIVERABLE_GUARD`) turns it on for **headless sessions only** (print/json, the bench path). `always` turns it on for every session, including interactive (for tests and opt-in users). Unset, empty or anything else means off.
- **Off is exactly main**: no `bash_job` tool is registered, no event handler, timer, `process.on` listener or temp directory is created, and the `bash` schema and description are unchanged. The test compares the registered tool names, the handler list per event and `process.listenerCount` for `SIGINT`/`SIGTERM`/`SIGHUP`/`exit` against a flag-off session.
- Windows: off even when the flag is set (one warning line on stderr). `taskkill /T` is asynchronous and cannot confirm a whole tree is gone on the synchronous shutdown path. Linux and macOS are supported. Layer 2 of D5 is Linux-only.
- **Workers: lead only.** `OMK_BASH_BACKGROUND` is added to `LEAD_ONLY_VARS` in `examples/extensions/subagent/worker-env.ts`. A worker's job would run in its own process group, outside the worker's group, so the subagent's `kill(-workerPgid)` in `managed-process.ts` would not reach it, and the worker's own cleanup does not run when it is SIGKILLed. Worker support would need nested cleanup and is a non-goal.

### D2. Tool shape: one new `bash_job` tool, `bash` unchanged

**Recommendation**: one tool, `bash_job`, with `action: "start" | "status" | "wait" | "output" | "kill" | "list"`. Do **not** add `background: true` to `bash`.

- `start { command, timeout_sec? }` returns `{ job: "j1", state: "running", log, budget }` at once. The command runs through the same preparation as `bash`: `commandPrefix`, `spawnHook`, the loadout access guard, the command-safety re-classification of the effective command, the sandbox preflight (`buildSandboxedSpawnRequest`), and `getShellEnv()` without spoofable `PI_*` session variables. A command bash would block is blocked here too. `timeout_sec` is optional: when set, the job is killed after it (reason `job-timeout`).
- `status { job }` returns the state (`running | exited | killed`), exit code or signal, runtime, total bytes, and the last 10 lines (≤ 2 KiB).
- `wait { job, timeout_sec?, until_output? }` blocks until the job ends, until the literal substring `until_output` appears in new output (no regex), or until the timeout. Default 60 s, at most **240 s**, and never past the spec 036 ceiling (`resolveBashTimeoutForBudget`, so the last 5 s of a budget are never spent waiting). It then returns what `status` returns. This replaces the `sleep` poll loops that hit 300 s in R8.
- `output { job, offset?, tail_lines?, max_bytes? }`: see D4.
- `kill { job }`: see D5. `list`: all jobs, one line each.
- When the tool is on, the `bash` result for a timeout (its error text is unchanged) gets one extra line from a `tool_result` handler: `Long command? Start it with bash_job (action "start") and use "wait".` Nothing else in `bash` changes.

Why not `background: true` on `bash`:

- `bash` is the most-called tool. Changing its schema changes the prompt for every call in the B arm, which confounds the A/B.
- It would touch `core/tools/bash.ts`, which spec 036 just stabilized.
- A model given the flag tends to set it where it is not needed.

A separate tool keeps arm B's prompt equal to arm A's plus one tool. The alternative, five tools in the style of pi (`bg_run`, `bg_status`, …), costs five schemas in every request for the same capability.

**Placement**: `bash_job` is a core tool built in `core/tools/index.ts` from the **same `ToolsOptions.bash`** as `bash`, so it gets the same sandbox policy, prefix, hook and guard. It is added to the tool set only when the gate is on. Its lifecycle handlers live in a built-in harness extension, `<builtin:bash-background>`, listed in `HARNESS_FACTORIES` before finish-check. When the gate is off, its factory returns before registering anything. Both parts share one per-session `BashJobRegistry`. Alternative: everything in the extension. That is simpler, but an extension cannot see the bash tool's sandbox policy or `spawnHook`, so jobs could bypass them. Rejected for safety (open question Q1).

- `bash_job` does not join the `process` timeout category in `agent-tool-settings.ts`. Its longest call, `wait`, bounds itself at 240 s, below the 300 s bash default. `start`, `status`, `output`, `kill` and `list` return in milliseconds.
- With a custom `BashOperations` backend (remote or SSH embedders), `bash_job start` refuses: "background jobs need the local shell". The local spawn path is the only one that can promise D5.

### D3. Limits

| Limit | Value | Why |
| --- | --- | --- |
| Running jobs at once | 4 | Covers build, server, test run and one spare. A 5th `start` is refused with the list of running jobs. |
| Finished jobs kept | 16 | Oldest finished job dropped first, with its log. |
| In-memory tail per job | 256 KiB ring | Serves `status` and `tail_lines` without disk reads. |
| On-disk log per job | 64 MiB | Over the cap, writing stops, bytes keep being counted, and `outputTruncated: true` is reported. The job keeps running. |
| On-disk total | 256 MiB | When reached, new output of every job is counted but not written. |
| Log location | `mkdtempSync(<os tmpdir>/omk-bg-<pid>-)`, mode 0700 | Outside the workspace, so the verifier and `git status` never see it. Removed with `rmSync(…, { recursive: true, force: true })` on every exit path in D5, after the kill. |

- stdout and stderr go to one pipe pair merged in arrival order into one log, the same as `bash`. Output is passed through `sanitizeBinaryOutput` before the model sees it. The raw bytes stay in the log.

### D4. Reading output without flooding the context

- `output` reads one of two ways:
  - `offset` (a byte offset into the log; `0` is the start) returns bytes from `offset` up to `max_bytes`, and `next_offset`, so the model can read incrementally.
  - `tail_lines` (default 50, max 400) returns the last N lines.
  - With neither, it returns `tail_lines: 50`.
- `max_bytes` defaults to **16 KiB** and is clamped to bash's `DEFAULT_MAX_BYTES` (50 KB). Line output is also clamped to `DEFAULT_MAX_LINES` (2000). The result always states `bytes_total`, the returned range, and whether more output exists. If the requested `offset` was never written because of the disk cap, it says so and returns the nearest written range.
- An offset that falls inside a multi-byte character moves forward to the next character boundary, and `next_offset` is always a boundary.
- `status` and `wait` include at most 10 lines (≤ 2 KiB), so a polling loop costs little context.
- Every `bash_job` result ends with a one-line footer listing running jobs (`running: j1 312s, j3 40s`) and, when a budget is bound, `budget: 1240s of 1800s left`.

### D5. Killing the whole tree

Spawn: `spawn(shell, [...args, command], { detached: true, stdio: ["ignore", "pipe", "pipe"] })`. On POSIX the job's shell is a new process group (and session) leader, `pgid = pid`. Each job also gets an env marker, `OMK_BG_JOB=<sessionNonce>.<jobId>`, where the nonce is 16 random hex characters per session. Its pid is registered with `trackDetachedChildPid`, so the SIGTERM/SIGHUP handlers that print, interactive and RPC modes already have (`killTrackedDetachedChildren()`, called synchronously before `disposeRuntime`) kill it with no new code and regardless of extension order.

Kill layers:

1. **Process group**: `kill(-pgid, SIGTERM)`. After a **2 s** grace, `kill(-pgid, SIGKILL)`. Gone is confirmed by `kill(-pgid, 0)` → `ESRCH`, the same test as `processGroupState` in `managed-process-tree.ts` (a small copy goes in `src/utils/process-group.ts`; the subagent example is not refactored here). 2 s sits between `managed-process.ts`'s 1.5 s and vanillagreen's 5 s, and keeps budget-end kills inside the 5 s grace of spec 036.
2. **Escapees (Linux)**: a descendant that called `setsid()` or double-forked leaves the group but keeps the env. After layer 1, scan `/proc/*/environ` of same-uid processes for the exact marker and `SIGKILL` each match. This finds daemonized grandchildren. It misses only a process that clears its environment, which is a documented limitation.
3. **Synchronous paths**: `session_shutdown` (before the first `await`), the SIGTERM/SIGHUP backup, SIGINT, and `process.on("exit")` cannot wait out a grace. They send `SIGKILL` to every group at once, run the layer-2 scan, write the run-log lines and remove the temp dir, all synchronously. `session_shutdown` does this even on a normal end, with no SIGTERM grace: only the first handler is called before an `await`, so nothing after the synchronous part is guaranteed to run before exit. A model that wants a clean stop calls `kill` before it finishes.

Exit paths, all covered by tests:

| Path | Trigger | Mode |
| --- | --- | --- |
| `bash_job kill` | model | layers 1+2, async with grace |
| job `timeout_sec` | per-job timer | layers 1+2, async |
| abort/cancel | `agent_end` whose last assistant message has `stopReason: "aborted"`, and the `bash_job` call's own `AbortSignal` during `wait` (the wait ends, the job lives) | layers 1+2, async; all jobs |
| run budget end | unref'd timer at `remainingMs ≤ 5 s` (`BASH_DEADLINE_GRACE_SEC`) of the spec 036 clock, re-armed on each tool call | SIGKILL + layer 2, sync |
| session end | `session_shutdown`, synchronous before the first `await` | sync |
| SIGTERM/SIGHUP | existing mode handlers via `trackDetachedChildPid` (backup: own listener, idempotent) | sync |
| SIGINT (headless) | own listener, added only while ≥ 1 job is alive, removed at 0. It kills synchronously, removes itself and re-raises SIGINT, so Node's default exit (130) is unchanged. | sync |
| process exit | `process.on("exit")`, added only while ≥ 1 job is alive | sync |
| omk SIGKILLed | cannot be caught; see Q4 (watchdog) | — |

All paths are idempotent. A job is ended once, and the first reason wins.

### D6. What the model is told about jobs still running

- The tool description says plainly: jobs are killed when the run ends, when it is aborted, and when the time budget runs out. A service the task needs to keep running after the run ends must be started with plain `bash` (`nohup … &` / `setsid`), as on main. `bash_job` is for work whose result the run itself will read.
- Every `bash_job` result carries the running-jobs footer (D4).
- **First settle with running jobs** (headless): one `followUp` per user task from `<builtin:bash-background>`: "You finished with N background jobs still running (j1, 312 s, 4.1 MiB written; …). They will be killed when the run ends. If your answer depends on them, `wait` and check the result; otherwise say you are done." The message names ids, ages and byte counts only, never command text. The extension is listed before finish-check in `HARNESS_FACTORIES`, so its follow-up comes first, and finish-check is not changed. When the second settle still has jobs running, nothing more is sent, and session end kills them.
- At the spec 036 hard zone (`elapsedFraction ≥ 0.9`) with jobs running, one `steer`: the job ids and "they will be killed in about Ns". This mirrors the finish-check save-now steer and is sent once per task.

### D7. Run budget

- Jobs are killed at `remainingMs ≤ 5 s` (D5), before the harness's own end, so the verifier never runs next to a half-written artifact from a job.
- `start` and `wait` show the remaining budget. `wait` never sleeps past the spec 036 ceiling. A `start` with less than `BASH_SAVE_FLOOR_SEC` (30 s) left is allowed but warns: "less than 30 s left; this job will be killed at the budget end".
- No budget bound (interactive with `always`, SDK) means no budget kill. The other exit paths still apply.

### D8. Run log (spec 042)

Name: `bash-jobs` → `<OMK_RUN_LOG_DIR>/bash-jobs.jsonl`. One line per event, written with `appendRunLog`, which is synchronous and safe on signal paths:

- `start`: `job`, `cmdSha256` (of the effective command), `cwdSha256`, `running` (count after start).
- `end`: `job`, `reason` (`exit` | `kill` | `job-timeout` | `abort` | `budget` | `session-shutdown` | `sigterm` | `sighup` | `sigint` | `process-exit` | `cap`), `durationMs`, `exitCode`, `signal`, `bytesTotal`, `bytesWritten`, `outputTruncated`, `termSent`, `killSent`, `groupGone`, `escapeesKilled` (layer-2 count).
- `refuse`: `reason` (`max-running` | `remote-backend` | `blocked`), and `cmdSha256` when there is a command.
- `wait`: `job`, `requestedSec`, `waitedMs`, `outcome` (`exited` | `matched` | `timeout` | `aborted`).
- `notice`: `kind` (`settle` | `hard-zone`), `jobs` (count).

Privacy (spec 042 rule): hashes, paths, numbers and enums only. No command text, no output, no `until_output` string, no env values. The test greps every written line for the command and output literals used in the test. Flag off or `OMK_RUN_LOG_DIR` unset: nothing is written.

## Acceptance (named vitest cases, TDD in the implementation PR)

All process tests run real `bash` on Linux and spawn a tree: the job's shell starts `sleep 1000 &` and a subshell that starts another `sleep 1000 &` (a grandchild). They also have a `setsid sleep 1000 &` variant for layer 2. After each path, every pid of the tree is checked with `kill(pid, 0)` → `ESRCH` within 3 s, and no process carrying the marker is left (`/proc/*/environ` scan).

1. `bash-background-kill.test.ts`: `kill` ends the job, child and grandchild. A SIGTERM-ignoring child (`trap '' TERM`) is gone after the 2 s grace via SIGKILL (`killSent: true`). The `setsid` escapee is killed by layer 2 (`escapeesKilled ≥ 1`).
2. `bash-background-shutdown.test.ts`: `session_shutdown` with two running jobs leaves no process and no temp dir. All of it is done synchronously before the handler's first `await`: the test emits shutdown with the handler second in order and checks state right after the synchronous part.
3. `bash-background-sigterm.test.ts`: the **real print-mode path**. A child `omk -p` process (mock provider) starts a job tree through `bash_job`, gets SIGTERM, and exits 143. No tree process survives, and `bash-jobs.jsonl` has an `end` line with `reason: "sigterm"` and `groupGone: true`. It also runs with `OMK_GOAL_CONTROLLER=0`, which flips the extension order (Staff Engineer's #100 finding). It uses the #100 `deliverable-guard-sigterm.test.ts` harness.
4. `bash-background-sigint.test.ts`: the same child receives SIGINT, exits 130 as on main, and leaves no tree. With no job running, the SIGINT listener count equals main's.
5. `bash-background-abort.test.ts`: an aborted run (`agent_end` with `stopReason: "aborted"`) kills all jobs. Aborting only the `wait` call ends the wait (`outcome: "aborted"`), and the job keeps running.
6. `bash-background-budget.test.ts`: with an injected spec 036 clock, jobs are killed at 5 s remaining and not at 6 s (`reason: "budget"`). `wait` with 20 s left and `timeout_sec: 240` waits at most 15 s. The hard-zone steer is sent once.
7. `bash-background-output.test.ts`: a job printing 100 MiB keeps ≤ 64 MiB on disk and reports `outputTruncated`. The total cap of 256 MiB holds over 5 jobs (4 running + refused 5th). `output` never returns more than `max_bytes` (default 16 KiB, clamp 50 KB) or 2000 lines. `offset`/`next_offset` reads reconstruct the written log exactly, including split multi-byte characters. `status`/`wait` return ≤ 10 lines.
8. `bash-background-unknown.test.ts`: `status`/`wait`/`output`/`kill` on an unknown id return an error naming the known ids. On a finished job, `status` and `output` work (log kept), `wait` returns at once, and `kill` returns "already exited (code N)". On a job dropped from the 16-entry history, they say "expired".
9. `bash-background-flag-off.test.ts`: with the flag unset, empty, `0` or `off`, the tool names, the handler list per event, the `process` listener counts and the `bash` tool definition (schema, description) are identical to a session built from main's factory list. No temp dir is created. With `1` in an interactive session, the same holds (headless only). On `win32` (stubbed), it is off with one warning.
10. `bash-background-safety.test.ts`: a command `bash` blocks (command-safety `block`) is refused by `start` with the same message. `commandPrefix` and `spawnHook` apply. A sandbox-denied spawn is refused. A custom `BashOperations` backend refuses with `remote-backend`.
11. `bash-background-settle.test.ts`: the first settle with running jobs sends exactly one `followUp`, ordered before finish-check's. A settle with no jobs sends none. The second settle sends none.
12. `bash-background-log.test.ts`: the event lines of D8 are written, and no line contains the test's command text, output text or `until_output` literal.
13. `examples/extensions/subagent/worker-env.test.ts`: `OMK_BASH_BACKGROUND` is stripped for workers.

## A/B plan (for Bench Analyst; nothing run here)

- **Build**: one main build pinned by SHA, the merge commit of the implementation PR. Arm A: `OMK_BASH_BACKGROUND` unset. Arm B: `OMK_BASH_BACKGROUND=1`. Everything else is identical (model, provider config, task revision, `OMK_TIME_BUDGET_SEC` per task, `OMK_RUN_LOG_DIR` set in both arms). 3 runs per task per arm, interleaved.
- **Targets** (an outer 300 s timeout seen in the R8 extract), with R8 omk passes:
  - torch-pipeline-parallelism 0/3 (900 s)
  - extract-moves-from-video 0/3 (1800 s)
  - train-fasttext 0/3 (3600 s)
  - path-tracing-reverse 1/4 (1800 s)
  - schemelike-metacircular-eval 1/3 (2400 s)
- **Secondary** (only heuristic timeouts): caffe-cifar-10 2/3, sam-cell-seg 2/3. Add them only if credits allow.
- **Controls** (R8 3/3, long builds or runs where `bash_job` could be misused): compile-compcert, mcmc-sampling-stan, rstan-to-pystan, adaptive-rejection-sampler.
- **Cost estimate** from R8 `cost` (per-run mean × 3 runs × 2 arms): targets about $72, controls about $6, total about $78. This is an R8-price estimate, not a quote. Wall time is dominated by train-fasttext (3600 s × 6).
- **Win rule**: B ≥ A + 2 passes on targets, and in each gained run `bash-jobs.jsonl` shows a `start` or `wait`. No new failure or timeout on controls. Every B run's `bash-jobs.jsonl` has one `end` per `start`, all with `groupGone: true`. A noise-level difference is not a win.
- **Also record** per run: the number of 300 s bash timeouts (from `omk.jsonl`), `bash_job` calls by action, total `wait` seconds, `usage.cost.billed` and agent time.
- **Ask**: if the TB adapter allows it, a `ps -eo pid,pgid,args` snapshot after the agent exits and before the verifier, so leftovers are checked outside omk's own log.

## Open questions for Tech Lead

- **Q1 Placement**: core tool built from `ToolsOptions.bash` plus a harness extension for lifecycle (recommended, so jobs cannot bypass the sandbox, prefix or hook), or extension only (simpler, but it cannot see the bash tool's sandbox and hook)?
- **Q2 Abort scope**: kill **all** jobs on an aborted run (recommended, and the acceptance asks for it), or only the jobs started in the aborted run? This matters only for interactive `always`, where Esc aborts a turn.
- **Q3 Settle notice**: one `followUp` from this extension before finish-check (recommended, finish-check untouched), or have OMK fold the running-jobs line into the finish-check message (one turn fewer, but it touches specs 032/035)?
- **Q4 omk SIGKILLed**: add a per-session watchdog (a detached `sh` loop started with the first job: `while kill -0 <omk pid>; do sleep 1; done`, then SIGKILL the recorded groups and marker matches, and exit; killed itself on clean shutdown)? Recommended yes for Linux, because "no leftover jobs ever" otherwise has one hole. It costs one extra process while jobs exist. Whether the TB harness SIGKILLs the agent at timeout or leaves it running in the container was not verified.
- **Q5 Limits**: 4 running / 16 kept / 64 MiB per job / 256 MiB total / 2 s grace / `wait` ≤ 240 s. Confirm or adjust.

## Non-goals

- Jobs that outlive the run (servers a verifier needs). Use plain `bash` with `nohup`/`setsid`, as on main.
- Background jobs for subagent workers (D1).
- Output-driven wake-ups or notifications, regex triggers, survival across reloads.
- Windows support.
- Changing `bash`'s schema, its 300 s default, or spec 036's clamp.

## Expected Files

- `specs/044-background-bash/spec.md`: this spec (first commit)
- `packages/coding-agent/src/core/bash-jobs.ts`: `BashJobRegistry` (spawn, ring buffer, log spill, caps, kill layers, sync teardown)
- `packages/coding-agent/src/core/tools/bash-job.ts`: the `bash_job` tool definition
- `packages/coding-agent/src/core/tools/index.ts`: build `bash_job` from `ToolsOptions.bash` when the gate is on
- `packages/coding-agent/src/core/tools/bash.ts`: export the shared spawn-context and safety preparation (no behavior change)
- `packages/coding-agent/src/core/extensions/builtin/bash-background.ts` and `harness-factories.ts`: lifecycle handlers, before finish-check
- `packages/coding-agent/src/utils/process-group.ts`: `processGroupState`, marker scan
- `packages/coding-agent/examples/extensions/subagent/worker-env.ts`: `OMK_BASH_BACKGROUND` in `LEAD_ONLY_VARS`
- `packages/coding-agent/docs/environment-variables.md`: `OMK_BASH_BACKGROUND`
- `packages/coding-agent/test/bash-background-*.test.ts` (cases 1–12), `examples/extensions/subagent/worker-env.test.ts` (case 13)
