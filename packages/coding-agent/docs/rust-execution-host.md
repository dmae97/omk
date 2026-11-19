# Opt-in Rust execution supervision

`RunCoordinator` can use a Rust process owner for verified-run writer/verifier
commands on Linux. The default remains the existing Node supervisor. This is the
first execution-ownership slice of [OMK 2.0](omk-2-migration.md), not a completed
Rust agent or a native desktop release.

## Select the backend

Build the [execution host](../../../native/omk-execution/README.md) into an isolated
external target directory. Set its canonical executable path explicitly in the
trusted parent process environment:

```sh
OMK_RUST_EXECUTION_HOST=/absolute/path/to/omk-execution-host omk run plan --contract contract.json
OMK_RUST_EXECUTION_HOST=/absolute/path/to/omk-execution-host omk run start \
  --contract contract.json --approve APPROVED_CONTRACT_DIGEST --command-id UNIQUE_ID
```

These examples require an OMK build containing this adapter; setting the variable
on an older installed engine does not add the implementation. No build, download,
installation or activation happens automatically. The path is not a project
setting, model-authored contract field or permission grant. Run approval, scoped
workspace capture and durable authority admission remain mandatory.

The selected file must be an absolute, owner/root-owned ELF executable, not writable
by group or others. The process pins canonical path and SHA-256 and rejects changed
bytes, a changed selection or removal of the selection rather than falling back.
The native identity and its kill helper are included in the environment digest,
so evidence produced with a different backend is not silently eligible for reuse.
File checks bind observations; they do not protect against a hostile operator
racing file replacement between validation and OS exec.

## What moves, what stays

| Responsibility | Owner in this slice |
|---|---|
| Approve contract, acquire grant, commit dispatch/process identity | Node durable authority and journal |
| Spawn gated sandbox, release after commit, retain bounded output | Rust |
| Monotonic execution timeout, original boot-bound phase cap, cancellation, process-group kill and reap | Rust |
| Namespace identity and termination checks | Rust, independently checked again by Node |
| Durable termination receipt after a witnessed drain | Rust |
| Per-request accepted/ready/committed/terminal execution record | Rust; Node still owns grants and settlement |
| Native child/channel lifetime and hard-stop watchdog | Node adapter |
| DAG scheduling, retries, recovery journal, verification and publication | Existing Node components |
| UI, providers, MCP and general tools | Existing runtime |

There is one sandbox dispatch per selected command. A native failure never invokes
the Node supervisor for that command. Parent disconnect requests cancellation by
default; the explicit single-command reconnect mode below preserves a committed
writer or verifier instead.
A crashed native host or lost termination receipt leaves the durable execution
unsettled/quarantined. The existing recovery path can reconcile a real namespace
witness later. No new automatic retry or fabricated termination is introduced.

Git publication retains its separately reviewed Node sandbox layout. The default
Node backend remains available when the variable was never selected. Replacing
the installed engine or selecting the backend globally is a separate operation.

## Acceptance

From `packages/coding-agent`, supply the freshly built binary explicitly:

```sh
EXECUTION_HOST_TEST_BINARY=/absolute/path/to/omk-execution-host \
  node ../../node_modules/vitest/dist/cli.js --run --maxWorkers=1 \
  test/verified-run-rust-host.test.ts \
  test/verified-run-rust-host-protocol.test.ts \
  test/verified-run-rust-host-binding.test.ts \
  test/verified-run-rust-host-record.test.ts \
  test/verified-run-rust-host-durability.test.ts \
  test/verified-run-rust-reconnect.test.ts \
  test/verified-run-rust-reconnect-guards.test.ts \
  test/verified-run-rust-reconnect-cli.test.ts \
  test/verified-run-rust-verifier-reconnect.test.ts \
  test/verified-run-rust-verifier-guards.test.ts \
  test/verified-run-rust-verifier-cli.test.ts
```

Tests inspect the live process ancestry to prove Rust owns the sandbox, refuse
code release when the journal callback fails, cover detached children, timeout,
combined output limits, readonly mounts, parent EOF, wrong-owner controls and
blocked output. Real coordinator tests exercise writer/verifier acceptance,
durable duplicate-command handling and quarantine after killing the native owner.
Tests without the explicit binary report skips, not native acceptance.

Run the existing verified-run authority/recovery/cancellation tests as adjacent
regressions, plus `npm run check`. R is not part of the execution loop. The
independent budget oracle and the existing finite TS/R/Rust DAG oracle are
separate developer checks; process safety is tested through real processes.

## Durable termination receipts

Each native dispatch receives the private directory `<state root>/native-witness/`
(created owner-only, `0700`). When Rust observes the recorded namespace init gone
within the same boot, it writes one canonical receipt, `0600`, through a temporary
file, `fsync`, rename and directory `fsync`, before reporting `finished`. This also
happens after a lost parent: Rust finishes or cancels under the selected mode,
drains and records the witness. A failed
write reports the `witness` error, never a successful settlement.

Restart reconciliation, candidate resume and writer restart probe the live
namespace first. Only an inconclusive probe (`unknown`, for example after a reboot
or PID reuse) is resolved by a receipt whose bytes match the recorded identity
exactly, in an owner-only regular file inside an owner-only directory. A receipt
never overrides `alive`. After the authority durably records termination, the
live path deletes its receipt; a crash in between leaves a harmless duplicate.
Receipts carry the operator's same-user trust, like the authority journal itself.

## Durable execution records

The broker binds the native request ID to its durable execution ID and supplies
`<state root>/native-exec/`. Rust creates an owner-only record exclusively before
spawn, syncs readiness before emitting `ready`, syncs commit before releasing
code, and syncs the terminal record before emitting `finished`. A repeated ID is
refused before spawn. Non-detachable records are removed after the authority and
run journal record termination. Reconnectable writer/verifier records remain available
for crash recovery, including the settlement/candidate gap. Explicit record GC
requires the additional proofs described below; no background pruning runs. After syncing each append, Rust atomically
publishes a private `<requestId>.head` byte-count marker and syncs the directory.
Readers consume only that committed prefix: even a complete terminal line after
the marker is not a result. An append or marker-publication failure poisons the
writer rather than appending a misleading recovery record.

Accepted records contain the host's boot ID, PID and start ticks, its original
wall-clock start, and the dispatch binding digest. That digest binds the original
grant token, intent, execution ID and generation; it grants no permission itself.
Recovered timestamps use the persisted start plus native monotonic duration,
not the time at which a replacement parent happened to observe the result. Legacy
records remain inspectable, but cannot reconnect without the required bindings
and durable-prefix marker.

Detachable output is persisted even if the first parent received the last event.
Real `RLIMIT_FSIZE=0` and blocked-marker-publication tests verify that failed
persistence emits no `finished` and cannot be accepted by the record reader.
A recovered result still requires independent namespace-termination observation.

## Original phase deadline owned by Rust

Production verified-run dispatches pass `phaseDeadline: { bootId, deadlineMs }`
from the already anchored journal budget. Writers use `workDeadlineMs`; verifiers
use `verificationDeadlineMs`. Rust checks this absolute boot-clock cap before
record creation/spawn, throughout supervision and after durable commit before
code release. Detachment never restarts it. Relative per-command timeout, output
limits and cleanup limits still apply independently.

Rust reads the Linux boot ID and `/proc/uptime`, not a replacement parent's wall
clock. The proc clock truncates to centiseconds; its conservative upper bound can
expire up to 10 ms early rather than extending the cap. This is not a hard
real-time OS termination guarantee. Unknown clocks and boot mismatches fail
closed. Accepted native records persist this exact cap; reconnect and verifier
receipt continuation compare it with the original journal before control or
settlement. An altered cap cannot authorize a longer run.

Older private v1 callers without this optional field retain relative-timeout
behavior, but their records cannot satisfy the new phase-bound reconnect gate.
Older binaries reject the new request field without fallback. Build and explicitly
select a matching host when testing this source version; no installed binary is
replaced automatically. The existing binary hash/environment binding still
prevents silently reusing results from a different host.

## Reconnect the same native writer (opt-in)

For `linux-command-v1` only, set `OMK_RUST_EXECUTION_RECONNECT=1` together with
`OMK_RUST_EXECUTION_HOST` **before planning and starting**. The mode is part of
the environment digest and must match during reconnect and verification. It
cannot be supplied by a model-authored contract. The default remains off.
After commit, losing the parent leaves the writer or verifier running under its original
native timeout/output limits. Before commit, parent loss still cancels. Operator
SIGINT/SIGTERM still requests cancellation rather than detachment.

Inspect the original run to obtain its active execution ID, revision and generation:

```sh
OMK_RUST_EXECUTION_HOST=/absolute/path/to/omk-execution-host \
OMK_RUST_EXECUTION_RECONNECT=1 omk run reconnect RUN_ID --execute \
  --approve ORIGINAL_CONTRACT_DIGEST --execution ORIGINAL_EXECUTION_ID \
  --revision OBSERVED_REVISION --generation ORIGINAL_GENERATION \
  --command-id UNIQUE_RECONNECT_ID --state-dir ORIGINAL_STATE_ROOT
```

The equivalent source SDK entry is `RunCoordinator.reconnect(command, approval)`,
using `RunReconnectCommand` from `omk-protocol`. This is not `restart-writer`:
reconnect never starts another writer, re-materializes its workspace, issues a
replacement writer grant, increments the run generation or refunds time/requests.

The replacement parent acquires the existing exclusive authority and journal
leases. Authority epoch/session incarnation advance to fence old observers;
the original execution token, claims, authorization deadline, ID and generation
remain unchanged. Live old grants stay quarantined and retain their claims until
termination is witnessed. The observer checks fresh committed authority bytes,
original start provenance, exact workspace claims, the journal namespace, native
binding and boot identity before every control/settlement boundary. A revoked
or expired authorization only permits cancellation/drain, never a success verdict.
Missing or mismatched authority/record data fail closed without another dispatch.

On success the same writer workspace becomes a candidate and the ordinary
verifier runs under its own normal grant. The original work/verification caps
still apply. Reusing the exact reconnect command after another parent crash
continues observation; a live owner excludes competitors. A completed duplicate
returns its existing state and revalidates signed evidence. If that writer command
already checkpointed a candidate, its replay does not restart verification. To
observe a dispatched verifier, use its execution ID as described below. Candidate
`resume` remains a separate operation that reruns verification in a new generation.

## Reconnect the same verifier

For the same opt-in `linux-command-v1` profile, `omk run reconnect` also accepts the
active verifier execution ID, or the most recent verifier ID after `exited` but
before final evidence publication. Approval, revision, generation and command-ID
requirements are identical to the writer example. The observer preserves the
frozen candidate and original verifier grant, readonly workspace claim, namespace
and execution ID. Its intent binds the candidate digest, check claim ID and
original receipt timeout as well as argv and claims.

The candidate workspace is checked, never rematerialized over a running verifier.
Previously dispatched checks are observed from their committed native records,
not rerun. Check receipts use persisted native timestamps, output and the original
receipt timeout, so recovery before or after receipt publication produces the same
content-addressed receipt. Conflicting receipt bytes are refused. In a multi-check
contract, only checks with no dispatch intent receive new executions and grants.
No writer/model work is reachable from this verifier continuation.

The original `verificationDeadlineMs` and verify cap apply, not the writer's work
deadline. An expired verification budget, cancellation or revoked/expired grant
cannot produce a passing attestation. An active effect is drained before the
observer records the stop when the native binding permits it. Unknown host loss
stays quarantined. A second parent crash may occur after a later check starts:
retrying the exact reconnect command then observes that check without rerunning
the completed prefix or adding another reconnect event.

The opt-in environment binding is now `writer-verifier-v2`. Earlier writer-only
opt-in runs are not silently upgraded to verifier reconnect: changed environment
bindings and missing original receipt timeouts are refused. Unselected/default
execution and legacy journal dispatches retain their existing behavior.

Current limits: the `linux-command-v1` writer and its sequential verifiers only;
no DAG, scripted-agent or general session reattach, cross-boot execution recovery,
automatic reattach, or deletion of unprovable native records.
Authority replay derives `startProvenance` from the original `effect-started`
and subsequent cancellation/expiry events. Compaction preserves it for retained
grants, so reconnect does not depend on archived event rows. An epoch restart
alone is not revocation; cancellation and recorded expiry remain drain-only
after any number of snapshots. This changes no token, claims or deadline.
Runtime authority compaction also preserves settled grants while their run is
recoverable, unsettled, publication-open or undecidable from journal/clock evidence.
It uses the same recovery hold policy as workspace GC. Retention is evidence,
not renewed authorization: expired results retain their original tombstone expiry
and duplicate-command disposition. Once recovery is closed, ordinary grant and
tombstone compaction can remove them. A grant already dropped by an older
compaction remains unavailable. No automatic compaction or GC was added.

Legacy event logs replay without rewriting their original bytes. Legacy snapshots
that already lost start/revocation provenance remain refused rather than guessed;
a later cancellation cannot recreate missing start evidence. Older engines may
refuse enriched snapshots, so preserve the original ledger before adopting this
source version and do not strip fields to force a downgrade. Missing output remains unknown. Real-binary tests
cover two parent crashes, concurrent-owner exclusion, duplicate commands, forged
bindings, stale generations/incarnations, cancellation, revocation, original-budget
expiry and native-host loss. These checks are not desktop/platform acceptance.

## Native record retention and GC

`omk run gc` includes native execution records alongside its existing derived
workspace cleanup. It needs no native-host selection to inspect stored records.
It does not run automatically, send cancellation, reopen authority, compact its
ledger, advance epochs, dispatch commands or grant permission to retry.

```sh
omk run gc --state-dir ORIGINAL_STATE_ROOT --older-than 7d
omk run gc --state-dir ORIGINAL_STATE_ROOT --older-than 7d --execute
```

`--prune-obsolete` is an explicit opt-in for unindexed legacy/orphan records.
It only removes a legacy-shaped bundle after proving it is not a live execution:
the record has a terminal event, no binding digest, the recorded host is not
alive (PID/start-ticks checked), and any namespace witness is gone. It must also
be private, complete and older than the requested retention. Invalid, live,
recoverable, bound or shared records remain untouched. The flag has no effect
without `--execute`.

The first command is a preview: both paths take exclusive leases, but only
`--execute` deletes artifacts. The report adds `nativeRecords` entries with
`requestId`, `runId`, `executionId`, `action`, `reason`, state-root-relative `paths`
and `bytes`. `prunedNativeBytes`/`prunableNativeBytes` count native files separately
from the existing derived-workspace totals; partially removed bundles receive no
freed-byte credit. An interrupted removal reports
`remove_failed` and CLI exit 1; kept/unknown records are not false successes.

Deletion requires all of these:

- The run is terminal, or its original recovery cap has expired, with no active
  execution, open writer, unsettled authority grant or open publication.
- Exclusive authority and run-owner leases are held in the same order as dispatch.
  GC reads committed authority without repair, reconciliation or epoch changes.
- The native record matches the journal's execution/generation/namespace and its
  original terminated grant, session and token/intent binding.
- The native host is gone and namespace termination is independently provable.
  A dead parent, terminal line, cancellation request or old mtime alone is insufficient.
- Record data and companions are private, single-link regular files, unchanged
  across inspection/deletion. Their committed prefix contains a terminal event,
  with no unpublished suffix. Symlinks and shared/hardlinked files are refused.
- Both the journal and every native companion satisfy `--older-than`. Future
  mtimes remain recent rather than converting a wall-clock rollback into expiry.
  Retention age is not a replacement for the original execution/recovery budget.

This preserves committed live writers/verifiers and the terminal-result,
pre-candidate and pre-attestation crash windows. A paused run stays recoverable
inside its anchored cap. Orphan/sidecar-only files, incomplete or legacy records,
unknown temporary files, damaged journals/authority and missing compacted grant
provenance are kept rather than guessed unless `--prune-obsolete` explicitly
opts into the stricter legacy/orphan cleanup described above. Unsafe native
evidence also blocks that run's derived workspace removal. Native witness files
have a separate lifecycle and are not swept by this operation.

GC first renames an eligible payload to `<requestId>.gc.jsonl` and syncs the
directory, then unlinks companions and the retired payload last. If the CLI dies
mid-removal, a later GC rechecks eligibility, authority, identities and surviving
bytes before completing it, including after the head was removed. A retirement
filename is not reconnect output or a replacement termination witness.

Journals, authority history, issuer keys, candidate manifests/blobs, check receipts
and attestations are not removed. Evidence, artifact reads and completed reconnect
replay therefore remain usable after GC. Duplicate-execution prevention continues
to depend on those durable ledgers, not on retaining a transient native file forever.
The same-user storage trust boundary still applies; GC is not protection against
a hostile operator racing arbitrary filesystem replacement.

Authority-compaction acceptance additionally runs
`verified-run-authority-provenance.test.ts` and
`verified-run-rust-compaction.test.ts`. These cover repeated snapshots, recorded
cancellation/expiry, legacy and malformed provenance, actual source-CLI writer
reconnect and continuation of the original writer/verifier grants without
synthetic result retention. `verified-run-grant-retention.test.ts` covers
pre-candidate/pre-attestation windows, rewrite-crash recovery, unknown evidence,
unchanged expiry and release after the original recovery cap.
`verified-run-rust-phase-deadline.test.ts` covers detached native expiry without a
cancel or replacement observer, commit gating, wrong boots and forged caps.
They do not reconstruct already-dropped grants.

Acceptance additionally runs `verified-run-native-gc.test.ts`,
`verified-run-native-gc-guards.test.ts`, `verified-run-native-gc-storage.test.ts` and
the existing `verified-run-gc.test.ts` with the explicit real native binary.
They exercise actual source-CLI preview/deletion, GC followed by writer/verifier
reconnect, process death during durable retirement and idempotent GC replay.

## Remaining migration scope

Rust does not yet own the durable grant ledger, multi-run scheduler, provider
streaming, session lifecycle, crash journal, UI control or publication. This
backend is not cross-platform, packaged-release or native-workbench acceptance.
The milestone remains incomplete, even when this bounded execution path passes.
