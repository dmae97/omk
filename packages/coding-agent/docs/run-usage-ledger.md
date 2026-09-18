# Run usage ledger

Status: implemented as an in-memory accounting module and explicit operation adapter.
Not automatically connected to AgentSession, provider HTTP retries, MCP, or child CLI.
Existing `RunBudget` request/concurrency/deadline behavior is unchanged.

Source: `src/core/run-usage-ledger.ts` and `src/core/run-usage-operation.ts`.

## Contract

- `reserve(attemptId, requestId, reservation)` admits an operation only when reported
  consumption + held reservation + proposed reservation fits each supplied cap.
  Retry attempts may share a logical request ID. IDs cannot be reused for attempts.
- `recordTransport(transportId, attemptId)` records a transport start observed by the
  caller. An application dispatch does not automatically count as an HTTP attempt.
- `recordUsage(eventId, attemptId, usage)` accepts one cumulative report per attempt.
  Identical redelivery is idempotent; changed payloads and second reports are rejected.
  Reports arriving after settlement or closure still bind to the original attempt.
- `settle(attemptId)` requires observed operation settlement, not a cancellation request.
  Unknown usage retains its reservation after settlement and blocks new capped admission.
- `close()` seals admission and transport starts but retains ownership and reservations.
- Snapshots distinguish the accounted subtotal from `total: null` when usage is missing.
  `estimatedUsd` is an estimate in USD, never invoice-confirmed spending. Token figures
  are caller-normalized reports; the ledger cannot detect provider zero-filled missing usage.
- Counts and amounts reject negative, non-finite and unsafe arithmetic. Maps are bounded
  by `maxEntries` (default 10,000); there is no automatic eviction of deduplication state.

`runUsageOperation` reserves before invoking the callback and settles in `finally`.
The adapter captures the admitted attempt ID before invoking the callback, so later
input mutation cannot redirect settlement. Usage reporters must still supply the correct
attempt ID themselves. The callback promise must represent the operation lifetime. Do not pass a timeout race
that returns before the underlying work settles. No AbortSignal is treated as proof
of termination. Failed operations still count as requests/attempts.

## Verification and limits

From `packages/coding-agent`:

```sh
node ../../node_modules/vitest/dist/cli.js run test/run-usage-ledger.test.ts test/run-usage-ownership.test.ts test/run-budget.test.ts test/run-budget-scope.test.ts
```

The local fixture records main work with two transport retries, continuation, summary,
and child-labelled work: four logical requests, six transports, eight input tokens.
These are explicit local adapter events, not real provider, process, or billing evidence.
Tests cover 6 consumed + 3 reserved + 2 proposed against cap 10, delayed settlement,
late usage, duplicate/conflicting events, missing usage, bounded input/state, and the
ownership boundary: denied admission never runs the operation, cancellation retains
the reservation until observed settlement, and settlement attribution survives caller
input mutation.

No durable replay/restart support, price-table revision binding, invoice corrections,
work/verification/cleanup partitioning, or automatic whole-run transport instrumentation
is provided. Actual usage can exceed its reservation: it is recorded honestly and blocks
later capped admissions rather than being clipped. This is not a hard financial limit.
R08 end-to-end product integration remains incomplete.
