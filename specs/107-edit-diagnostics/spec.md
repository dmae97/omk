# Spec 107 — OMK_EDIT_DIAGNOSTICS: new-only diagnostics after edit/write

Status: draft (spec only, no implementation)
Base: `origin/main` @ `f3dcf2c189` (Merge #221 release/1.5.6). Refs under `packages/coding-agent/src/core/tools/` unless noted; line numbers anchored to that SHA.
Order: Tech Lead 2026-10-22 KST, borrowing candidate "1" (lint-on-edit), after the bash truncation fix (`e4cefedb15`, branch `fix/bash-tail-drop-truncation`, not yet merged).
Freeze: 10/23 12:00 KST ⇒ default off.

## 1. Problem

After `edit`/`write` the model gets only `Successfully replaced N block(s)` (`edit.ts:189-196`) or `Successfully wrote N bytes` (`write.ts:90-94`). A type/syntax error the edit introduced is invisible until the model chooses to call `diagnostics`, run a build, or run tests — often several turns later, after building on top of the broken edit.

`diagnostics.ts` already exists (tsc / pyright|ruff / go vet / cargo check, fail-soft, normalized `DiagnosticLine`), but it is only a model-invoked tool (`index.ts:92,187,218`). Nothing runs it automatically.

## 2. Prior art and evidence (honest strength)

- SWE-agent `windowed_edit_linting` ([edit](https://github.com/SWE-agent/SWE-agent/blob/main/tools/windowed_edit_linting/bin/edit), MIT): lints after edit, compares with pre-edit lint, and **rejects/reverts** the edit when new errors appear.
- Aider auto-lint ([docs](https://aider.chat/docs/usage/lint-test.html), Apache-2.0): lints edited files and feeds errors back to the model.
- Evidence: [arXiv 2405.15793](https://arxiv.org/abs/2405.15793) Table 3 — edit with linting 18.0% vs 15.0% without (SWE-bench Lite, GPT-4 Turbo).
  **Weak for omk**: 2024 model, a different harness (ACI with 100-line windows), single run.
  **The report-only variant specified here has NO direct evidence.** The +3.0 pp came from a *reject-on-lint* variant (edit rejected and reverted when new lint errors appear). We ship *report-only*, so +3.0 pp is **not** the expected effect and must not be cited as one. Prior expectation: unknown, possibly zero; the A/B below decides.
- Code policy: **no code copied**. Fresh implementation; one attribution comment naming both sources. No new dependency.

## 3. Design

### 3.1 Flag
`OMK_EDIT_DIAGNOSTICS=1` enables; anything else (incl. unset) = off. Read per call via `process.env` (same convention as `OMK_RTK_OUTPUT` in `rtk-output.ts:39`). Flag off ⇒ the edit/write code path, tool result bytes and `details` are byte-identical to main (asserted by test, §7).

### 3.2 Integration points (verified at `f3dcf2c189`)
| File | Change |
|---|---|
| `diagnostics.ts` | Export a new internal helper `collectFileDiagnostics(cwd, path, { timeoutMs, signal, bypassCache: true })` that reuses `detectLanguages`/`CHECKERS` (`:290-318`) and returns `{ lines, skipped }`. Existing tool behavior unchanged. |
| new `edit-diagnostics.ts` | `isEditDiagnosticsEnabled()`, `diffNewDiagnostics(before, after)`, `formatNewDiagnostics(...)`. Attribution comment here. |
| `edit.ts:149-197` | Inside `withFileMutationQueue`, if flag on: baseline before `ops.writeFile` (`:184`), post-check after it; append the report to the text content; add `details.newDiagnostics`. |
| `write.ts:72-95` | Same; baseline only if the file existed (new file ⇒ empty baseline, see §3 item 4a). |
| `index.ts` | No change (tools are already constructed with `cwd`). |

### 3.3 Algorithm
1. Language from extension only (`.ts/.tsx/.py/.go/.rs`); other files ⇒ skip both checks (zero cost).
2. **Baseline** (pre-write) and **post** run with `bypassCache: true`. Required: the 5 s TTL cache in `checkLanguage` (`:320-332`) keys on `language+cwd+path`, so a cached result would return the *pre-edit* diagnostics as the post-edit result.
3. New = post minus baseline under the key `(path, severity, normalized message)` — **line/column excluded** so diagnostics that merely shift because lines were inserted above are not reported as new. **Decided (Tech Lead, 2026-10-22 KST):** before keying, comparing or hashing, the message is normalized by removing line/column numbers and position notations (e.g. `(12,5)`, `:12:5`, `line 12`, `col 5`); the run-log message hash uses the same normalized message. Test: inserting lines above an existing error reports 0 new errors. Multiset semantics (count per key).
4a. **New file without baseline (decided, Tech Lead 2026-10-22 KST):** when `write` creates a file that did not exist, there is no baseline. **Only errors inside that new file are counted; errors in all other files are excluded**, because without a baseline every existing project error would look new.
4. **Scope (Q2, decided):** errors from the edited file **and** errors in other files that are NEW vs the pre-edit baseline (tsc is project-wide, so cross-file breakage such as a removed export is visible). Order: edited file first, then other files. Cap **5 files and 20 entries in total**, then `... N more`.
   **Severity (Q5, decided):** errors only. Warnings are neither listed nor counted in the text.
5. Text appended to the existing success message, e.g.
   ```
   Successfully replaced 1 block(s) in src/a.ts.
   New diagnostics after this edit (2, vs pre-edit baseline):
   ERROR src/a.ts:12:5 Property 'foo' does not exist on type 'Bar'.
   ```
   No new diagnostics ⇒ append nothing (keeps tokens flat on the common path). Timeout ⇒ append **nothing** (see §3.4). Other skips (missing checker, no project marker, spawn failure, baseline unavailable) ⇒ append nothing to the text; reason goes to `details.newDiagnostics.skipped` and the run log only.
6. **Report only, never reject/revert (Q1, decided).** The edit is already written and the result is still a success. A reject/revert variant is a possible future third A/B arm and needs its own spec.
7. **Concurrency (Q6, decided):** inside `withFileMutationQueue`: run baseline, write, record a snapshot of the written file (`mtime` + content hash). **Release the mutation lock, then** run the post-check. Before appending the report, re-stat/hash the file; if it differs from the snapshot (another edit landed), **skip the report** (append nothing, log reason `stale`). The lock is never held for the post-check, so other agents are not blocked.

### 3.4 Latency budget & failure behavior
- **Q3, decided:** **10 s per check, 20 s per edit** total deadline (post-check gets whatever remains of 20 s). Env override `OMK_EDIT_DIAGNOSTICS_TIMEOUT_MS` (per check) for local debugging only; A/B uses the defaults.
- tsc is project-wide (`checkTypeScript` runs `tsc --noEmit -p`), so on large repos it will hit the timeout. Timeout ⇒ **show nothing** to the model and call `appendRunLog("edit-diag-timeout", {...})` (`core/run-log.ts:50`). **The edit result never fails** because of diagnostics.
- Missing checker / no project marker / spawn failure ⇒ existing `skippedReason`, kept in `details` only; **never** a tool error.
- Baseline failed but post succeeded ⇒ do not report (cannot compute "new"); say `skipped: baseline unavailable`.
- Abort: `signal` aborts the checker child (needs `run()` to accept a signal; today it only has a SIGKILL timer, `:79-103`). Abort after the write still returns via the existing `throwIfAborted` path.
- Post-check runs **outside** the mutation queue (Q6). The baseline check still runs inside it (before the write); its cost is bounded by the 10 s per-check deadline. Stale-snapshot ⇒ skip, logged.

## 4. Success criterion (fixed BEFORE any A/B)

- **Primary:** paired resolve rate on the same task set, arm ON (`OMK_EDIT_DIAGNOSTICS=1`) vs OFF. The original superiority target (ON − OFF ≥ +δ pp, δ = 2 pp, Q4) is kept for record but is superseded by the non-inferiority goal below.
- **δ = 2 pp (Q4, decided).**
- **n = TBD — computed from the pilot (ρ, p_d) as the free-run count needed for the clustered CI lower bound to clear −3pp, then committed here. BLOCKING: no main measurement run may start until n is committed. If n exceeds the free-run budget, commit "inconclusive" instead and skip the main run; n is never raised afterwards.**
  - Power calc (Bench Analyst, 2026-10-22 KST, relayed by OMK): paired McNemar, α = 0.05 two-sided, power 0.8, δ = 2 pp. Required pairs by discordant-pair rate p_d:
    | p_d | required pairs |
    |---|---|
    | 0.05 | 979 |
    | 0.10 | 1,960 |
    | 0.15 | 2,941 |
    | 0.20 | 3,922 |
  - Default assumption p_d = 0.10 (≈ 89 tasks × ≈ 22 reps) is **unmeasured**. A **pilot measures p_d first**; n is then fixed in this spec (commit) before the main run and **never increased afterwards**.
  - **Clustering (Agent Researcher):** ≈ 89 tasks × ≈ 22 reps makes pairs within a task non-independent, violating McNemar's independence assumption. The **verdict uses task-clustered analysis**: per-task resolve-rate difference with a task-level cluster bootstrap, or GEE with task as cluster. Effective sample size is below 1,960 pairs; **Bench Analyst recomputes power under clustering** before n is fixed.
  - **Pilot hold-out:** pilot data used to estimate p_d is held out and **never reused** for the main-run verdict.
  - **Clustered power (Bench Analyst, 2026-10-22 KST, relayed by OMK):** design effect DE = 1 + (m−1)ρ (m = reps per task). With K tasks fixed, effective n ≤ **K/ρ**. **ρ (ICC of paired differences) is an unmeasured assumption.** Effective-n upper bound at K = 89, next to the independent-pairs table above:
    | ρ (assumed, unmeasured) | effective-n upper bound (K = 89) | feasible p_d |
    |---|---|---|
    | 0.05 | 1,780 | only p_d = 0.05 (24 reps = 2,136 pairs) |
    | 0.10 | 890 | none |
    | 0.30 | 297 | none |
    | 0.50 | 178 | none |
    - ρ ≥ 0.10 makes every p_d infeasible. Spec 094 measured success ICC 0.4858, near ρ = 0.50. **With 89 tasks, a superiority δ = 2 pp is effectively undetectable.**
- **Pre-registered goal (Tech Lead final ruling, 2026-10-22 KST): non-inferiority, flag stays opt-in.** This spec cannot make the flag default-on.
  - **Margin fixed at −3 pp, before the pilot. The margin is NOT set from the pilot.** PASS ⇔ the lower bound of the **task-clustered 95% CI** of the resolve-rate difference (ON − OFF) is **> −3 pp**.
  - **Cost guardrails (also non-inferiority):** tokens per turn ≤ **1.10×** OFF; wall time ≤ **1.25×** OFF.
  - Mechanism metrics (below) are an **operation check only**.
  - **Default-on only via a separate spec** that gets a PASS on path 1.
- **Pilot:** its size is **fixed before it starts**. It uses separate runs on the **SAME 89 tasks** (not separate tasks), so K stays 89. It exists **only** to measure ρ and p_d, from which Bench Analyst computes how many free runs the clustered CI needs to clear −3 pp. Pilot data is **never reused** for the verdict.
  - If that number exceeds what free runs can do, record **"inconclusive"** here in a commit **before the main run, skip the main run**, and keep the flag opt-in. n is **never extended after the fact**.
- **Conditional path 1 — increase K:** add tasks (e.g. a SWE-bench Verified subset, 2–3 reps per task). **Reopens only after 인호 sets a $ cap.** The benchmark runs from bench scripts, **not as an omk dependency**; Library Scout checks the dataset license first. **The path is chosen before the pilot.** On this path only: if the $ cap cannot reach the required n, δ is tightened to the smallest effect the achievable n can detect, fixed before the main run; n is never extended after the fact. (On the default non-inferiority path the margin stays −3pp and over-budget means "inconclusive".)
- Task set: frozen list (ids + hash committed before first run), tasks in TS/Python only (where checkers exist).
- **Verdict is on resolve rate (non-inferiority) plus the cost guardrails.** Mechanism metrics below cannot rescue a failed or inconclusive result.
- **Supporting mechanism metrics (pre-registered; mechanism-only — never evidence for resolve-rate claims):**
  1. **New errors remaining at end:** diagnostics are run **outside the tool-call record**, identically for both arms, at session end. Counted as the **net increase vs the pre-edit baseline** (task starting state), **paired per task** (ON vs OFF). Tasks in languages without a diagnostics checker are **excluded from the denominator**, and the excluded count is reported.
  2. **Next-edit fix rate (report-only, NOT part of the verdict):** denominator = edits that produced new diagnostics. *Fixed* = after the next edit, the diagnostic with the **same file + same normalized message key** is gone. Disappearance due to **file deletion is counted separately** (not as fixed). The "hidden" comparison comes from a **separate shadow run** (`OMK_EDIT_DIAGNOSTICS=shadow`), never from the OFF arm.
- **Shadow mode (decided, Tech Lead 2026-10-22 KST):** `OMK_EDIT_DIAGNOSTICS=shadow`, off by default. The checker runs, but results go **only** to the run log (`edit-diag` event with `mode: "shadow"`); the model-facing tool result text and `details` are **byte-identical to OFF** (tested, including the first request payload in a faux session). Shadow is **not** the control arm: running the checker changes time and tokens. **The A/B stays OFF vs ON.**
- **Telemetry:** every `edit-diag` event logs `mode` (`on`|`shadow`), `baselineMs`, `postMs` and `diagMs` (= baseline + post checker time). `diagMs` is report-only; it is never subtracted from wall time (CPU/I/O contention would remain).
- **Arms pinned** to the same `origin/main` SHA that contains `e4cefedb15` (bash truncation fix) once merged; the only difference is the env flag.
- **Equal-path-length build dirs** for both arms (e.g. `/workspace/omk-ab-on` / `/workspace/omk-ab-of`… same length) so prompt bytes do not differ by path.
- **Diff the first request payload** of ON vs OFF on one task: must be byte-identical (flag changes only tool results, never the system prompt/tool schema). Any diff ⇒ stop, fix, re-pin.
- **Free runs only.** No $ cap has been set by 인호, so no paid run until one is.

## 5. Guardrails (must not regress, judged on the same pairs)
- tokens/turn (median, p90): ON ≤ OFF × 1.10.
- **Pre-registration (checker coverage):** before any measurement, pin the exact `tsc`, `pyright` and `ruff` versions in the bench image (recorded in the run manifest), and log a per-task `checkerRan` (boolean) in the run log. The verdict uses all tasks; the `checkerRan=true` subset is report-only. In ON and shadow arms the session record (`edit-diag-session.jsonl`) is created at session start and always written once at process end, even with zero edits or no checker-backed files (`checkerRan=false`, `checks=0`). A task whose session line is missing is a **log error**: it is flagged and excluded from the `checkerRan` analysis, never counted as `checkerRan=false`. Log-error tasks still count in the resolve-rate verdict, which uses grading results on all tasks; they are excluded only from the mechanism metric (the `checkerRan` subset). Report the log-error rate per arm; if either arm exceeds 5%, the mechanism metric is marked "uninterpretable".
- wall time/task (median, p90): ON ≤ OFF × 1.25, measured as-is on pure OFF vs ON arms (no subtraction, no shadow in the control arm); per-edit diagnostics latency (`diagMs`) p90 reported separately.
- turns/task: report; no hard gate.
- edit/write tool error rate: must be unchanged (report-only must never turn a success into an error).
- Diagnostics-skipped rate by reason (timeout/missing checker) reported; if timeout > 50% of TS edits the result is "not measurable", not "no effect".

## 6. Risks
- Project-wide tsc on big repos ⇒ mostly timeouts ⇒ feature degenerates to noise. Measured by skipped rate.
- Path filter in checkers is substring `d.path.includes(path)` (`:257` etc.): `a.ts` matches `data.ts`; tsc paths are root-relative while `path` is cwd-relative. Implementation must normalize to absolute paths and compare exactly.
- Cross-file new errors (Q2) can be noisy on project-wide tsc; mitigated by baseline subtraction and the 5-file / 20-entry cap.
- Post-check outside the lock (Q6) can race with another edit; mitigated by the mtime/hash snapshot check (skip, never misreport).
- The `diagnostics.ts` cache/path bugs are fixed in a **separate bug-fix PR** (branch `fix/diagnostics-cache-path`), not in this spec's implementation PR.
- Pre-existing broken repos: baseline subtraction keeps the noise out, but message-only keys can hide a second identical new error at a different site (multiset count mitigates).

## 7. Test plan
Unit (`test/edit-diagnostics.test.ts`, fake checker injected, no real tsc):
- flag off ⇒ result `content`/`details` deep-equal to main for edit and write.
- new error introduced ⇒ listed; pre-existing error ⇒ not listed; error shifted by inserted lines ⇒ not listed.
- fixing an error ⇒ nothing appended.
- timeout ⇒ nothing appended, `appendRunLog("edit-diag-timeout")` called, tool still succeeds; missing checker / spawn failure ⇒ nothing appended, tool still succeeds.
- cross-file new error listed after edited-file errors; cap 5 files / 20 entries.
- warnings never listed.
- file changed between snapshot and report ⇒ report skipped; mutation lock released before post-check (a second queued edit is not blocked by the post-check).
- result never rejected/reverted.
- (cache bypass and exact path match are covered by the `fix/diagnostics-cache-path` PR tests.)
- write to new file ⇒ empty baseline; only errors inside the new file are counted.
- abort during post-check ⇒ child killed, queue released.
Suite (`test/suite/edit-diagnostics-flag.test.ts`, faux provider per `test/suite/README.md`):
- session with flag on: faux model edits a TS fixture with a type error; the next request's tool-result message contains the new diagnostic; with flag off it does not; first request payload identical in both.
Gates: `npm run check`, targeted vitest, existing `test/diagnostics-tool.test.ts` unchanged and green.

## 8. Decisions (Tech Lead, 2026-10-22 KST)
- Q1 Report-only; never reject/revert. Reject = future third arm, own spec.
- Q2 Include other files' NEW errors vs pre-edit; edited file first; cap 5 files / 20 entries total.
- Q3 10 s per check, 20 s per edit; timeout ⇒ show nothing + `appendRunLog("edit-diag-timeout")`; edit result never fails.
- Q4 δ = 2 pp; power calc in §4 (979–3,922 pairs by p_d); n fixed after pilot measures p_d, written here before the main run (blocking); superseded by the non-inferiority ruling in §4 (margin −3 pp fixed before pilot; over budget ⇒ inconclusive, skip main run, never grow n).
- Q5 Errors only.
- Q6 Snapshot, release mutation lock, then check; compare mtime/hash before reporting; skip if changed.
- `diagnostics.ts` TTL-cache bypass and exact-path fixes ship as a separate bug-fix PR (`fix/diagnostics-cache-path`).
