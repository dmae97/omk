# 099 — Acceptance contract revision

Status: draft · Release-blocking correctness fix · No flag

## Problem

`GoalAcceptance` keeps one approved check command per goal, but a trusted
receipt records only goal key, receipt digest and workspace hash. `approve()`
replaces the command in place, and a failing check records nothing. So
`complete()` accepts any earlier passing receipt whose workspace still matches,
even when it was produced by a different, withdrawn, or since-failed check.

Reproduction (files unchanged throughout):

1. `/goal verify true` → passes, receipt attached.
2. `/goal verify false` → fails.
3. `/goal complete` → **completed** (should be refused).

## Evidence

Commit `5a767fae96` adds regressions to
`packages/coding-agent/test/goal-controller-acceptance.test.ts`. On main
`63bbd20b4f`: 4 failed | 14 passed (18).

| Case | main |
|---|---|
| A passes → B fails → complete | completed (✗) |
| same command passes → fails → complete | completed (✗) |
| script passes → edited to fail → restored → complete | completed (✗) |
| approval withdrawn after a pass → complete | resolved (✗) |
| same command fails → passes → complete (must be allowed) | completed (✓) |

The fix commit adds two more: A pass → B → back to A → complete refuses until
A re-runs (A re-run then completes), and an aborted run never completes.

## Fix

In `src/core/goal-acceptance.ts` only; no new verifier, no new dependency.

- Each goal has a check contract `{ command, contractRevision, contractDigest }`.
  `contractRevision` increments whenever `approve()` changes the command or
  withdraws it; `contractDigest` is the SHA-256 of the command.
- Trusted receipts carry `checkId`, `contractRevision` and `contractDigest`, in
  addition to receipt digest and workspace.
- The contract records the latest non-aborted result of its revision.
  `complete()` refuses when that result failed, so a later fail is not masked
  by an earlier pass; a later pass after a fail is allowed.
- Only receipts matching the current `checkId` + `contractRevision` +
  `contractDigest` + workspace count. Older receipts stay attached to the goal
  and in the process map; they are excluded from judgment, never deleted.
- A withdrawn approval still gates completion when the goal ever had a passing
  receipt in this process.

## Acceptance (Tech Lead, verbatim)

no flag. (1) 4 regressions refuse 4/4; (2) same contract fail then pass -> complete allowed 1/1 (add this test too); (3) receipts must carry checkId and contractRevision (a digest field is fine in addition); old receipts lacking them are excluded from judgment, not deleted; (4) all existing tests pass; (5) zero new deps.

## Tech Lead decisions (final)

1. Every change of the approved command, including withdrawal and reverting
   to an earlier command, bumps `contractRevision`; reverting never revives
   the earlier command's pass receipt (A pass → B → back to A → complete
   refuses until A re-runs and passes). A withdrawn approval gates completion
   once the goal has had a passing receipt in this process; the controller's
   rollback after an unrunnable first approval therefore does not block goals
   that never had a check.
2. Aborted runs are not counted as the latest result, and an abort never
   counts as a pass.
3. `checkId` is derived from the goal key but stored as its own field on each
   trusted receipt.

## Flag question

Considered `OMK_ACCEPTANCE_CONTRACT_REV` (default off) under the 1.4.x/1.5
patch rule. Rejected: the old behavior completes goals whose current approved
check fails, which is a correctness/safety defect, not a feature. No flag.

## Risks

- Restoring a previous command (controller rollback when a new command cannot
  run) bumps the revision by design (decision 1), so the user must re-run `/goal verify` before
  completing. Conservative; refuses, never wrongly allows.
- Same-command re-approval keeps the revision (no extra friction).
- Process-scoped only, as before: nothing is read back from disk.

## Rollback

Revert the fix commit; the regression tests then go red again. No data
migration: receipts and the goal journal format are unchanged.
