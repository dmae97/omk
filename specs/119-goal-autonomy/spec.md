# Spec 119 — goal autonomy (`OMK_GOAL_AUTONOMY`)

Base: `origin/main` `a4bfeb5a97`. Builds on spec 106 §5 (B — goal autonomy, AU1–AU4, PREREG non-inferiority) and the existing `/goal` controller.
Scope of this file: spec only; no code, no deps, no CHANGELOG.

## 1. Problem

- `/goal` already loops: `agent_settled` in `extensions/builtin/goal-controller.ts` calls `decideGoalContinuation()` (`goal-continuation.ts`) and, with an approved check, `GoalAcceptanceFlow.settle()` (`goal-controller-acceptance.ts`) runs the check, then `advance-round` + `continueGoal()` or `block()`.
- Gaps against spec 106 AU1–AU4:
  - Stops are only `round-limit`, `not-active`, check failure/blocked. No budget/deadline stop (AU4), no explicit stop reason for "outcome unknown" side effects (AU4).
  - A user steer queued mid-goal returns `queued` and the loop resumes on the next settle; there is no revocation record that rejects a late continuation of the old round (AU2).
  - A changed acceptance command bumps `revision`, but nothing prevents the controller from continuing under a scope (target files / command set) the user did not re-approve (AU3).
  - A goal is created only by an explicit `/goal <text>`; there is no opt-in path from an explicit execution request.
- Result: the model either re-asks for confirmation each step (cost) or, if pushed to continue, has no hard, recorded stop conditions beyond rounds.

## 2. Change (behind default-off flag)

Flag: **`OMK_GOAL_AUTONOMY=1`** (strict `=== "1"`; any other value ⇒ off). Unset ⇒ behavior byte-identical to main (test-pinned, G0). No YOLO; `command-safety` / `command-safety-parser` unchanged; `maxRounds` default 8, not raisable by the model.

1. **Stop policy** — extend `decideGoalContinuation()` input with optional `budget` (`{ maxCostUsd?, deadlineIso? }`, set **only** by the user via `/goal budget …`; never env, never model-set) and `lastSideEffect: "ok" | "unknown"`. New reasons `budget-limit`, `deadline`, `outcome-unknown`, `scope-changed`. Cost includes subagent lanes. A call with unknown cost is never counted as 0; if remaining budget cannot be determined ⇒ stop with `budget-limit` (fail closed). Flag off ⇒ fields ignored, reasons unreachable. Each stop moves the goal to `blocked` via existing `store.transition` and is recorded as a `goal_autonomy_stop` custom entry (`{reason, round, revision}`; no prompt text). A stop is a normal end, so `omk.goal.v1` is unchanged and `DurableGoalErrorCode` is not used. An unknown stop reason when reading entries ⇒ fail closed (treat as stopped, no auto-continue).
2. **Outcome-unknown** — a `bash`, `edit` or `write` call that ended by timeout or abort in the settled turn sets `lastSideEffect="unknown"` ⇒ stop, never auto-continue that round (AU4). Detection is structural, never by matching output text: the tools throw a typed `ToolTerminalError` (`timeout` | `aborted`), and the tool-execution boundary attaches that cause (or its own `timeout`/`aborted` terminal disposition) to the settled call **in memory only** (`takeToolTerminalCause(toolCallId)`, `omk-agent-core`). It is never serialized: not in the result, `details.omk`, events or the session file; `disposition`, envelope rules, run-termination classification and late-settlement behavior are unchanged. The goal controller reads it only at `agent_settled`. Explicitly not the `command-safety` mutating list. (Tech Lead 2026-10-24.)
3. **Steer (AU2)** — applies only to an explicit user steer. A steer while a goal is active sets the goal to `paused`, drops the pending continuation and records `goal_autonomy_revoke {round}`; `continueGoal()` refuses any continuation of a round ≤ the revoked round. The goal resumes only on explicit user `/goal resume`. Detected on the `input` event (`streamingBehavior: "steer"`, source not `extension`, not a slash command); with the flag on, `AgentSession.steer()` (RPC `steer`) emits the same `input` event (`source: "rpc"`); flag off it emits nothing new. A refused late continuation is counted in a numbers-only `goal_autonomy_continuation_rejected {round, revision, count}` entry.
4. **Scope pin (AU3)** — approval stores `{contractRevision, commandSha256}` (sha only). If `checkIdentity()` revision differs from the pinned one at settle, the loop stops with `scope-changed` and asks re-approval; no reuse of the old approval.
5. **Opt-in goal creation** — out of scope. Only explicit `/goal`. The intent classifier is a separate spec (confirmed, Tech Lead 2026-10-24).

Integration points: `goal-continuation.ts` (`decideGoalContinuation`), `extensions/builtin/goal-controller.ts` (`agent_settled`, `continueGoal`, `/goal` command: `budget` subcommand, `input` handler), `goal-controller-acceptance.ts` (`settle`, `block`), `goal-acceptance.ts` (`checkIdentity`), `durable-goal.ts` (no schema change; reasons go in custom entries), `extensions/builtin/harness-factories.ts` (unchanged; goal controller already registered via `OMK_GOAL_CONTROLLER`).

## 3. Measurable success criterion

- **Verdict (first A/B):** spec 116 gates (pass rate ≥ base − 3pp; cost ≤ 1.10× base; wall ≤ 1.25× base) **plus** deterministic G0, AU1–AU4, G5–G8 at 100%. No δ in the pass criteria.
- **False-completion rate — report-only, not a verdict.** Definition: goal reported `completed` (done) but hidden tests fail, graded independently of omk's own acceptance checks; paired per task, both denominators reported. A non-inferiority bar (spec 106 §5) is only set from this result, before any second measurement.
- Also report-only: user confirmation turns per completed goal; verified completions; stop reasons histogram.
- Agent Researcher first counts outcome-unknown cases in free flag-off logs; spec and code work do not wait on that number.

## 4. Gates (deterministic, 100% before any paid run)

| Gate | Check |
|---|---|
| G0 | flag unset / `0` / `true`: first request, session entries and goal transitions byte-identical to main (golden) |
| AU1 | approved check fail → repair → pass completes without extra confirmation, within `maxRounds` |
| AU2 | explicit user steer mid-goal ⇒ goal `paused`, pending continuation dropped, no late continuation of the revoked round; resumes only on `/goal resume` |
| AU3 | command / revision / target change ⇒ `scope-changed` stop, old approval not reused |
| AU4 | round, deadline, cost limit (incl. subagent lanes), outcome-unknown ⇒ exact stop reason; unknown-cost call never counted as 0, undeterminable remaining budget ⇒ `budget-limit`; 0 auto-retries of a `bash`/`edit`/`write` call with unknown outcome |
| G5 | model cannot raise `maxRounds` or budget (tool/prompt paths) |
| G6 | `goal_autonomy_*` entries contain no prompt/command text (sha256 only) |
| G7 | no new dependency (Library Scout diff on package/lock) |
| G8 | resume: after a stop or steer, only explicit `/goal resume` continues; continuation uses the current revision; unknown stop reason in a `goal_autonomy_stop` entry ⇒ fail closed (no auto-continue) |

## 5. Test plan

- `test/goal-continuation.test.ts`: new reasons, flag-off ignores fields.
- `test/goal-autonomy.test.ts` (faux model, realistic usage): AU1–AU4, G5, G6, G8 (resume, unknown stop reason fail-closed, unknown-cost fail-closed, subagent-lane cost).
- `test/suite/goal-autonomy-session.test.ts`: real `AgentSession` loop incl. explicit steer mid-goal ⇒ `paused`, then `/goal resume`.
- G0 golden: extend existing goal-controller tests for unset flag. Existing goal/recall/evidence (spec 098/118) suites unchanged.
- Targeted runs + `test/suite` + `npm run check`.

## 6. A/B plan

- Arms: base = flag unset with `/goal` + approved check; treatment = `OMK_GOAL_AUTONOMY=1`. One pinned main SHA, same tasks/model/provider/effort/tools/budget, paired.
- Free first: deterministic gates + count eligible tasks (approved check, ≥1 failing round) from existing run logs; need ≥ 3 eligible tasks, else do not run.
- Verdict = §3 (spec 116 gates + deterministic gates). False completion is reported, not gated.
- **No paid run until 인호 posts a $ cap.**

## 7. Risks

- Runaway loops / cost: mitigated by round cap + budget + deadline, all user-set.
- Repeated side effects: outcome-unknown stop; command-safety unchanged.
- Silent scope drift: scope pin on revision + command sha.
- False completion rise: reported every run; sets the bar for the next measurement.
- Steer race with an in-flight settle: revoke record checked in `continueGoal()` (test AU2).

## 8. Rollback

Unset the flag: controller behaves as main. New custom entries are ignored when off. Code rollback = revert the PR; no goal schema migration.

## 9. Open questions (Tech Lead)

1. Paid $ cap pending 인호. (δ removed per Tech Lead 2026-10-24 KST: false completion is report-only in the first A/B.)
2–6. Resolved (Tech Lead 2026-10-24): budget only via `/goal budget`, cost includes subagent lanes, unknown cost fails closed; intent classifier is a separate spec; outcome-unknown = aborted/timed-out `bash`/`edit`/`write` (not the command-safety list); explicit steer ⇒ `paused` + pending continuation dropped, resume only on explicit user resume; stop reasons stay custom entries, `omk.goal.v1` unchanged, `DurableGoalErrorCode` not used.
