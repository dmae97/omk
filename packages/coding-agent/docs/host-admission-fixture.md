# H0 no-execution admission fixture

This is a test-only ownership slice of the [2.0 roadmap](omk-2-migration.md), not a
Rust execution host or an authenticated control API. Production remains Node.

## Boundary

`test/verified-run-admission-fixture.ts` accepts an existing start command and
contract, trusted host approval and caller-owned fixture resources. The caller
opens a dedicated temporary authority store, reconciles it, registers the session
and acquires the run's real session-owner lease. It owns cleanup of both leases,
including after errors. Never pass a production state root to this test helper.

The fixture and `RunCoordinator.start()` share `parseApprovedRunStart()`. It
strictly parses the existing schemas, revision/generation zero, run identity,
contract digest and trusted approval digest, and refuses revoked approval. No
schema or public command changed. Parsing does not verify the workspace base or
sandbox, authenticate a UI actor or authorize executing anything.

The fixture also checks the owner path, authority root/session, expected epoch,
reconciliation and an absolute trusted host authorization deadline. Incarnation,
claim/weight conflicts and command idempotency use `AuthorityStore.acquire()`.
That method now checks the durable owner/head fence before cached responses as
well as new reservations. A commit whose authority is released during persistence
cannot publish its head or acknowledge success. Read-only `lookup()` remains a
disposition query, not permission to start an effect.

`VerifiedRunApproval` still contains only `approvedContractDigest` and an optional
abort signal. The fixture deadline is not a new approval field. It comes from the
trusted test host, with the existing rollback-detecting authority clock, never
from serialized model/UI input. Expiry at the exact boundary is refused. Retries
cannot extend the bound deadline or change contract, claims or weight.

## Durable dry disposition

The successful fresh path records only:

1. `grant-reserved` for the exact command meaning.
2. `cancel-requested`, settling the never-started reservation as `cancelled`.
3. `result-retained` for a deterministic dry-result digest.

The returned object has `execute=false`, `executionRequested=false` and
`publish=false`. It exposes no grant token. No `dispatch-intent`, `effect-started`
or fabricated termination witness is emitted. A production run journal is not
created. Broker execution, sandbox probing and workspace capture are guarded by
test sentinels, and the writer's marker must remain absent.

Exact retransmission returns the retained dry result without ledger appends or a
new grant. Another start command id cannot replace a retained start for the same
fixture run. Partial persistence failures propagate rather than returning success;
a retry repairs the existing durable transaction boundary. Durable authority,
approval, session ownership and expiry are checked again before acknowledging
completed persistence. Possibly-live or
non-fixture grants cannot be converted into a dry result.

The disposition survives reopening the real store. An old epoch envelope is
still rejected, even when the old result can be inspected. This is not an
authenticated reconnect or cross-incarnation result-adoption implementation.

## Verification

From `packages/coding-agent`:

```sh
node ../../node_modules/vitest/dist/cli.js --run \
  test/verified-run-admission.test.ts \
  test/safe-wiring-authority-admission.test.ts
```

Adjacent regressions cover the existing authority store, restart/replay, clock,
real verified-run start and dispatch wiring. Run `npm run check` at repository
root after source changes. Neither these tests nor a dry-result digest proves
Rust ownership, process settlement, budget/charging correctness or OS support.
