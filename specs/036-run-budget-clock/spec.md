---
description: "One monotonic run-budget clock started at run start; bash clamps only under a budget and keeps a save floor near the end"
---

# Feature Specification: Shared run-budget clock (RemainingBudget) and bash timeout clamp

**Specification ID**: `036-run-budget-clock`
**Feature Branch**: `feat/remaining-budget` (PR #63)
**Created**: 2026-10-11
**Status**: Draft
**Constitution**: [specs/constitution.md](../constitution.md)
**Input**: PR #63 shipped without a spec. Tech Lead's review (`REVIEW_STACK_20261011.md`, #63 B1, M1–M3, m3, n1) asked for the fixes below. Spec 033 (#96) builds on this clock.
**OMK Preset**: `omk`

## CLI Harness Target Impact

**Classification**: improve (timed headless runs). No change without `OMK_TIME_BUDGET_SEC`.

| Dimension | Baseline (#63 at `54be529`) | Acceptance target | Regression floor | Verification command | Evidence artifact |
| --- | --- | --- | --- | --- | --- |
| Reliability | Clock binds lazily on the first bash call; `Date.now()`; without a budget bash gets an inner 300 s timer; last 10% of the budget clamps every bash call to 1 s | Clock starts once at run start from the process time origin; `performance.now()`; without a budget bash passes `timeout` through exactly as main; near the end a command still gets up to 30 s (never past the real remaining time) | Without `OMK_TIME_BUDGET_SEC` bash behaves exactly as main `47e78c4` | `npx vitest run test/remaining-budget.test.ts test/bash-budget-timeout.test.ts` in `packages/coding-agent` | those two files |

## Design

### 1. One clock, one origin (B1)

- `startRunBudgetClock()` in `core/remaining-budget.ts` creates the clock from `OMK_TIME_BUDGET_SEC` and binds it, **once per process**. A second call returns the bound clock.
- Origin is the **process time origin**: `startedAt = 0` on the `performance.now()` timeline, which counts from process start. The harness timer starts before the process, so this is the earliest point omk can see. Startup, extension and MCP attach, and the first model turns all count against the budget, no matter when bash is first called.
- `runPrintMode` (print and json, the headless path the bench uses) calls it as its first step. The origin does not depend on where the call sits.
- Lazy binding is removed: bash and other consumers only **read** the bound clock (`getActiveRemainingBudget()`). Without `startRunBudgetClock()` (interactive, RPC, or SDK embedders that did not opt in) there is no clock and no clamp. That also removes the 033 A/B confound, where enabling 033 used to bind the clock earlier.

### 2. Monotonic time (M1)

`RemainingBudget` defaults `now` to `performance.now()`. Wall-clock steps (NTP, VM resume) no longer move the budget. Tests still inject `now`.

### 3. No budget → main's bash behavior (M2)

`resolveBashTimeoutForBudget(timeout, budget)`: without a budget it returns the model's `timeout` unchanged, including `undefined`. Then, as on main, there is no inner timer, and the outer tool timeout (`agent.toolTimeouts.bash`, default 300 s) applies. With a budget, an omitted `timeout` gets an inner timer equal to the budget ceiling below. A shorter configured outer timeout still wins, as before.

### 4. Save floor near the end (M3)

Per call: `ceiling = max(1, availableSec, min(30, remainingSec − 5))`, where `availableSec = (remaining − 10% reserve)` in seconds. `timeout = min(requested, ceiling)`.

- Far from the end, the reserve rule is unchanged (a command cannot eat the last 10%).
- Inside the reserve, a command still gets **up to 30 s**, enough to copy artifacts, write results, or run a short compile, but never closer than **5 s** to the real end of the budget.
- Why a floor and not a flat 1 s: the hard-zone message tells the model to "save outputs and finish". With 1 s, that save itself was killed. Why 30 s: it covers the save and verify commands seen in R8 logs (copying, `python -c` checks, short builds). It is still at most 1/3 of the 90 s reserve on the shortest 900 s TB tasks, so one call cannot spend the whole reserve.
- The `"hard"` policy (≤10% remaining) is kept only to pick the timeout message. The unused `"unbounded"` policy is removed (n1).

### 5. Single accessor for finish-check (and #96)

- `readRunBudget(): RunBudgetSnapshot | undefined` returns `{ budgetMs, elapsedMs, remainingMs, elapsedFraction, remainingFraction }` from the shared clock, or `undefined` when no budget is set.
- `excludeRunBudgetWaitMs(ms)` takes harness snapshot waits out of the budget.

#### Finish-check migration (done in #63 after #62 landed; OMK closes #64)

#62 landed on main at `5c5806b`, and #63 merged it. `extensions/builtin/finish-check.ts` now reads the shared clock:

- `elapsedFraction()` returns `readRunBudget().elapsedFraction` whenever a run clock is bound (print/json mode). Without a bound clock (interactive `OMK_FINISH_CHECK=always`, unit tests that inject `now`) it keeps the old local clock from extension load, so those paths behave exactly as before. The local clock's default is now `performance.now()` too.
- A harness snapshot wait goes to `excludeRunBudgetWaitMs(waitedMs)` when the clock is bound, else to the local `startedAt` as before.
- `resolveTimeBudgetMs` is imported from `remaining-budget.ts`; the duplicate in `core/finish-check.ts` is gone (#44 n1). `budgetMs` is still read from env for `finishDisciplinePrompt` and the local fallback.

The thresholds keep their values and all compare against that one `elapsedFraction`:

- 0.75 `FINISH_CHECK_SAVE_NOW_FRACTION`
- 0.85 `FINISH_CHECK_EXTRA_TURN_FRACTION` (spec 035, behind `OMK_FINISH_CHECK_EXTRA_TURN`)
- 0.90 `FINISH_CHECK_SKIP_FRACTION`
- 0.30, spec 032's early-finish threshold, is not on main yet. It reads the same `elapsedFraction` when it lands.

Acceptance (`finish-check-run-clock.test.ts`, each fails on the old local clock): with the shared clock bound at t=0 and the extension loaded at t=60 s of 100 s, save-now fires at 76 s and not at 70 s; the check is skipped when the run settles at 91 s; the spec 035 extra turn is refused at 86 s; a 50 s snapshot wait leaves the shared clock at 0.4, not 0.9.

## Acceptance

Named vitest cases:

1. **Run-start origin**: a clock started at t=0, with bash first called at t=60 s of a 100 s budget, clamps from 40 s remaining, not 100 s (`bash-budget-timeout.test.ts`).
2. **Once per process**: a second `startRunBudgetClock()` returns the same clock. Without `OMK_TIME_BUDGET_SEC` it binds nothing (`remaining-budget.test.ts`).
3. **Monotonic default**: a clock built without `now` reads `performance.now()` (`remaining-budget.test.ts`).
4. **No budget = main**: with no bound clock, bash passes `timeout: undefined` and `timeout: 1800` to the executor unchanged, and no lazy clock appears even when `OMK_TIME_BUDGET_SEC` is set in the env (`bash-budget-timeout.test.ts`).
5. **Omitted timeout under a budget** gets the budget ceiling (`bash-budget-timeout.test.ts`).
6. **Save floor**: with 5 s / 20 s / 40 s left of a 1000 s budget, a 300 s request gets 1 s / 15 s / 30 s. With 95 s left it gets 95 − 100 reserve → the floor, 30 s (`remaining-budget.test.ts`).
7. `readRunBudget()` returns `undefined` without a clock and the fractions from the shared origin with one. `excludeRunBudgetWaitMs` shifts them (`remaining-budget.test.ts`).

## Non-goals

- Per-session clocks for RPC or SDK processes that host several runs (m1). The clock is per process and opt-in through `runPrintMode`. `bindActiveRemainingBudget(undefined)` resets it.
- Background handoff for long commands.

## Expected Files

- `specs/036-run-budget-clock/spec.md`: this spec (first commit)
- `packages/coding-agent/src/core/remaining-budget.ts`: `startRunBudgetClock`, `readRunBudget`, `excludeRunBudgetWaitMs`, monotonic default, save floor; remove lazy `ensureActiveRemainingBudget`
- `packages/coding-agent/src/core/tools/bash.ts`: read-only clock lookup, pass-through without budget
- `packages/coding-agent/src/modes/print-mode.ts`: start the clock
- `packages/coding-agent/test/remaining-budget.test.ts`, `test/bash-budget-timeout.test.ts`
