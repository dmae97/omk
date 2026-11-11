# Subagent execution budgets

The bundled `examples/extensions/subagent` extension delegates isolated tasks to
worker processes. In a normal session, every mode uses the existing lane authority,
which applies the parent's admission decision, shared permits, and process settlement
ownership. Hosts without a lane authority retain the bounded standalone extension
path; they cannot claim the session ownership guarantee.

## Effort policy

The parent session's effort selects these defaults. These are engineering limits,
not measured quality, latency, or memory improvements.

| Parent effort | Concurrent workers | Logical tasks per call | Default execution budget |
| --- | ---: | ---: | ---: |
| off / minimal | 1 | 4 | 2 minutes |
| low | 1 | 4 | 3 minutes |
| medium | 2 | 6 | 4 minutes |
| high | 2 | 8 | 6 minutes |
| xhigh | 3 | 8 | 8 minutes |
| max | 4 | 12 | 10 minutes |
| ultra | 4 | 16 | 14 minutes |

An unavailable or unknown effort uses the high defaults. The task count limit also
applies to chain and graph modes. The actual concurrent count is the minimum of
this policy, task readiness, path conflicts, and host admission. Ultra never removes
the task, concurrency, internal deadline, or outer tool timeout limits.

An explicit `executionBudgetMs` from 60,000 to 840,000 milliseconds replaces the
effort's default time budget. It does not increase concurrency or task limits.
`maxResumeAttempts` remains 0–2, with a default of 1; every attempt consumes the
same logical task budget. The outer tool timeout is 855,000 milliseconds, leaving
room for the existing process cleanup after the maximum internal budget.

Workers receive the parent effort as the native `--thinking` argument. The worker
SDK clamps it to the resolved model's supported levels. An agent's pinned model
still takes precedence over the parent's model; no provider mapping is duplicated
in the extension. Worker adaptive effort remains disabled, so the parent decision
does not trigger a second independent effort controller.

## Parent deadline and termination

When the session supplies a remaining run budget, the worker budget is capped at
that remaining time minus 30 seconds. The reserve belongs to the lead's result
integration, required verification, and reporting. The extension rechecks this
live host value after trust and capability work, immediately before every spawn.
If no capacity remains, it returns an incomplete result without starting a worker.
An unbounded parent still gives its children the finite effort budget above.

Single and chain modes now use the same lane dispatch boundary as parallel and
graph work. Parent abort reaches the worker process tree. A cutoff requests process
termination and waits for the existing managed cleanup. A failed cleanup may return
an `unsettled` result, but the lane keeps the child counter and resource reservation
until its settlement promise confirms termination. A later dispatch cannot ignore
that unresolved ownership.

This prevents premature success and reduces the number of workers that can still
be active near finalization. It does not promise that every task succeeds before
the lead finishes: provider delays, uninterruptible processes, and remote side
effects can prevent that. Required checks remain required; an incomplete or
unsettled worker must not be reported as verified success.

Delegate independent work early and keep dependency handoffs small. Workers already
use isolated context; the existing worker policy limits extension discovery. Lower concurrency
bounds the number of simultaneous worker processes; it is not a byte-level guarantee
for aggregate RSS. Measure the lead, workers, MCP processes, and retained results
together before claiming a memory reduction.

## Verification and rollback

Baseline: OMK 1.5.11, commit
`7389353a6f7f685b52d7be952f79a8bd79bd7565`. The change preserves required verification,
scope checks, cancellation, cost accounting, and observed-termination ownership.
Its deterministic acceptance targets are finite limits at every effort, no spawn
after the parent reserve is exhausted, and no ownership release before confirmed
termination. No live provider latency or RSS comparison is implied by these tests.

From `packages/coding-agent`, run:

```bash
node ../../node_modules/vitest/dist/cli.js --run \
  examples/extensions/subagent/subagent-execution-policy.test.ts \
  examples/extensions/subagent/subagent-extension-smoke.test.ts \
  test/subagent-owned-modes.test.ts \
  test/improvement-subagent-unsettled.test.ts \
  test/improvement-subagent-graph.test.ts
```

The smoke fixtures exercise the extension's native process invocation without
calling a live model. The ownership tests inject a process that ignores cancellation
and only later reports termination. Run `npm run check` from the repository root
after changes. Roll back the extension and its matching core host seam together;
do not drop child counters or release permits to force an active session to finish.
