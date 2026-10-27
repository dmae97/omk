# Spec 100 — task_result real producer wiring

Status: draft (spec only, no implementation)
Base: `origin/main` @ `63bbd20b4f` (PR #175, spec 096 merged). **PR #177 (spec 099, head `46539fbcde`) was not on main at fetch time**; `6df371131f` is already pushed and force-push is forbidden, so this branch will **not** be rebased. After #177 merges, a fresh branch off the new main will carry these spec commits via cherry-pick; once its PR is open it follows main by merging main in (no rebase, no force-push).
Source: 인호's audit, section F2 ("task_result의 분류 입력을 실제 생산자에 연결").

## 1. Problem (all refs are `63bbd20b4f`)

1. **Producer drops the classification inputs.** `factFromGoalAcceptance(result, options)` accepts `currentWorkspaceSha256` and `matchedTests` (`packages/coding-agent/src/core/task-result.ts:164-170`) and uses them for `stale`/`zero_tests` (`task-result.ts:197-199`). The only real producer calls it with no options: `publishHostTaskFact(this.omk.events, factFromGoalAcceptance(result), taskRunId)` (`src/core/extensions/builtin/goal-controller-acceptance.ts:178-179`). So in production `stale` and `zero_tests` are unreachable; only unit tests with synthetic options reach them.
2. **No test counts exist at the source.** `GoalAcceptanceResult` (`src/core/goal-verification.ts:45-59`) has no executed/matched/skipped field and no `checkKind`. A tsc run and a `vitest` run that matched 0 tests are indistinguishable.
3. **Pass fact published before completion is decided.** The fact is published inside `run()` (`goal-controller-acceptance.ts:179`); `acceptance.complete()` is called later (`goal-controller-acceptance.ts:117`) and can throw `evidence-required` ("workspace changed after the acceptance check passed", `src/core/goal-acceptance.ts:137-145`; plus the 099 revision/digest refusal). The catch at `goal-controller-acceptance.ts:118-122` only notifies; the already-published `passed` fact is never downgraded. TUI/print/RPC therefore can show `check: passed` for a goal the host refused to complete.
4. **Coverage denominator is guessed.** `projectCoverage` sets `checksTotal: host.length` (`task-result.ts:134-140`), i.e. the number of facts observed, not the number of required checks. A required check that never ran yields `0/0`, which renders like "nothing required".
5. **Identity is receipt-scoped.** Fact id is `goal-acceptance:${receiptId}` (`task-result.ts:178`) and the collector keys by fact id (`src/core/task-result-collector.ts:92,104`). fail→fix→pass leaves two independent facts instead of one check with attempts.

## 2. Proposed change

Behind `OMK_TASK_RESULT` (existing flag, `task-result.ts:106-108`); see §4.

### 2.1 Source data — `src/core/goal-verification.ts`, `src/core/goal-acceptance.ts`
- Add to `GoalAcceptanceResult` (optional, additive):
  - `checkKind: "test_runner" | "typecheck" | "shell"` — classified from the approved command by a pure `classifyCheckKind(command)` (new, in `goal-verification.ts`); unknown → `"shell"`.
  - `tests?: { executed?: number; matched?: number; skipped?: number }` — filled only for `test_runner`, parsed by a pure `parseTestCounts(kind, output)` for **node:test, vitest and jest only** (decided). Each runner needs ≥2 real-output fixtures. A parse failure leaves counts `undefined` (rendered unknown); never default to 0. `skipped` is display-only and never affects status.
- Expose `acceptance.currentWorkspaceSha256(cwd)` reusing `captureGoalWorkspace(cwd).sha256` so freshness comes from the GoalAcceptance owner (audit: projection must not own a second verifier).
- `checkId` = goal key + approved-command digest; `checkRevision` = 099 contract revision. Both copied onto the result.

### 2.2 Fact — `src/core/task-result.ts`
- `GoalAcceptanceFactOptions` gains `executedTests`, `skippedTests`, `checkKind`, `checkId`, `checkRevision`, `completion?: "accepted" | "refused"`, `refusalReason?: string`.
- `TaskCheckFact` gains optional `checkKind`, `tests` (each count `number | "unknown"`), `checkId`, `attempt`.
- Rules (in order after existing failed/aborted/timeout/completeness/gate):
  - `test_runner` and `matched === 0` → `insufficient/zero_tests`.
  - `test_runner` and counts unparseable (`matched` unknown) → `insufficient/unverified_counts` (decided, Decision 7). Never `passed`.
  - workspace sha differs → `insufficient/stale`.
  - `completion === "refused"` → `insufficient/completion_refused` (new reason) with `refusalReason`.
- `projectCoverage`: `checksTotal = 1` per approved command (decided); no approved command → `checksTotal: "unknown"` with `receiptsObserved: n`. Never `0`.

### 2.3 Producer — `src/core/extensions/builtin/goal-controller-acceptance.ts`
- `run()` (l.165-185): publish with full options (`currentWorkspaceSha256` captured after the check, counts, kind, checkId, revision).
- turn-settle path (l.112-128): after `complete()` throws `DurableGoalError`, publish a **downgrade** fact immediately (same `checkId`, same `attempt`) with `completion: "refused"`, replacing the earlier pass. On success publish nothing extra. Completion logic itself is unchanged by this spec.
- Required-but-not-run: when a run settles with an approved command and no receipt for the current revision, publish `insufficient/not_run` for that `checkId`.

### 2.4 Collector — `src/core/task-result-collector.ts`
- Key current state by `checkId` (latest attempt wins; replacement of same attempt overwrites); keep prior attempts in `attempts[]` (not counted as separate required checks).

### 2.5 Surfaces — `src/modes/interactive/task-result-status.ts`, `src/modes/print-mode.ts`, `src/modes/rpc/*`
- Render `unknown` literally ("tests: ? matched", "checks: ?/? (1 receipt)"), never `0`. Show `checkKind` and the "observation, not task correctness" scope label already required by the audit.

## 3. Acceptance criteria (measurable)

Harness: a real `GoalAcceptanceFlow` + `GoalController` in a temp git repo with a tiny node:test project (temp HOME, `OMK_TRUST_PROJECT=0`, `env -u TYPESAFE_API_KEY`, `OMK_TASK_RESULT=1`). No hand-built `TaskCheckFact` and no direct `publishHostTaskFact` calls in these tests (enforced by a grep assertion in the test file). Each case asserts TUI status line, print-mode final block, and RPC `task_result` event, and asserts the three agree field-for-field on `check.status`, `reason`, `tests`, `coverage`.

| # | Case | Expected projection (all 3 surfaces) |
|---|------|--------------------------------------|
| 1 | fail→fix: approved `node --test`, first run 1 failing test, edit, rerun passes | final `check: passed`, `tests {executed:1, matched:1, skipped:0}`, `checkKind:test_runner`, one `checkId` with `attempts.length === 2` (failed, passed), `coverage 1/1`; goal completed |
| 2a | external edit after the check, before publish (hook `afterCheckBeforePublish`) | `insufficient/stale`; no `passed` fact emitted; goal stays active |
| 2b | 099 revision refusal: pass under A, command changed to B before complete | `insufficient/completion_refused`; never `passed` |
| 2c | external edit after publish, before `complete()` (hook `afterPublishBeforeComplete`) | `passed` fact, then downgrade to `insufficient/completion_refused`, refusalReason contains "workspace changed"; final status never `passed`; goal stays active |
| 3 | not run: approved command, run settles without a check | `insufficient/not_run`, `coverage 0/1`. 3b: no approved command → `checksTotal ?` with `receiptsObserved:0`; never `0/0` |
| 4 | 0 tests: runner filter matches nothing, exit 0 | `insufficient/zero_tests` (never `passed`), `tests.matched: 0`; completion behavior unchanged (blocking decided later from data) |
| 4b | unparseable runner output, exit 0 | `insufficient/unverified_counts`, counts rendered `?`; never `passed` on any surface |
| 5 | cancel: Esc during check | `cancelled`; no `passed` fact ever emitted for that attempt (asserted on full RPC event stream) |

Edit ordering (2a, 2c) is reproduced deterministically through a fixed test-only hook in the producer (`afterCheckBeforePublish` / `afterPublishBeforeComplete`), with no sleeps or timing. Downgrade timing (cases 2b, 2c): when `complete()` refuses, one downgrade event for the earlier pass fact (same `checkId`/`attempt`) is emitted at that moment and observed identically on TUI, print and RPC — same status, reason and `refusalReason`, asserted on each surface before the next turn begins. Parsers: ≥2 real-output fixtures each for node:test, vitest, jest; a fixture with skipped tests shows `skipped` without changing status.

Also: flag off → zero `task_result` events and byte-identical print golden to `63bbd20b4f`; full coding-agent suite green; no new dependencies.

## 4. Flag decision

Proposal: **keep behind existing `OMK_TASK_RESULT`, default off** (1.4.x rule). Justification: task_result itself is default-off; this changes what it emits (new reasons, `unknown` values, replacement facts) and RPC consumers may parse `checksTotal` as a number. No new flag: a second flag would create untested on/off combinations. Additive `GoalAcceptanceResult` fields (kind, counts) are computed regardless of flag but are not surfaced when off. Flipping default-on is a separate decision for Tech Lead after these e2e cases pass.

## 5. Risks
- Test-count parsing is format-fragile; mitigated by `unknown` instead of guesses, and per-runner fixtures.
- `checksTotal: number | "unknown"` is an RPC type change (flag-gated, version bump of `TASK_RESULT_VERSION`).
- Replacement facts could race with run settlement; 096 run-scoping (`taskRunId`) must also gate the refusal fact.
- Workspace hash capture after each check adds cost on large repos (already done once in `complete()`).

## 6. Rollback
Flag off restores 096 behavior (no events). Code rollback: revert the merge; `GoalAcceptanceResult` additions are optional fields so older readers ignore them (to be verified by a test reading a new-field receipt with old parser, unlike #177 where this was unverified).

## 7. Decisions (Tech Lead, 2026-10-21)
1. Required check count = 1 per approved command; no command → unknown, never 0.
2. Pass with 0 matched tests → `zero_tests`, not pass. Completion logic unchanged here; blocking decided later from data.
3. Count parsing: node:test, vitest, jest only, ≥2 real fixtures each. Parse failure → counts unknown and never pass.
4. `stale` and `completion_refused` stay separate; refusal downgrade must reach TUI/print/RPC identically at that moment.
5. `skipped` is display-only.
6. vitest/jest counts are parsed from output text only; no reporter packages or runners are added, not even as devDependencies. The e2e uses node:test only, so new dependencies stay 0.
7. Unparseable counts use `insufficient/unverified_counts` (not `unavailable`), to keep parser defects separate from environment unavailability.

## 8. Open questions
None open; base plan and status name are decided (header, Decision 7).
