# Rust host H2d: same-execution verifier continuation

Date: 2026-11-09. Baseline HEAD: `48fb8e33a84d01fde163091ed36a8bca981d3bbe`.
This continues the already-dirty H2c checkout; it does not replace unrelated work.
Versions remain **1.5.10**. No installed-engine activation, commit, push or release.

## Accepted boundary

For opt-in `linux-command-v1`, `RunCoordinator.reconnect` and the real source
`omk run reconnect` can observe a dispatched verifier. The new observer holds the
exclusive journal/authority leases; the original execution ID, grant token,
readonly workspace claims, namespace, generation and frozen candidate stay fixed.
The verifier intent additionally binds its candidate digest, check claim and
original receipt timeout. Reconnect does not acquire a replacement grant or replay
the gate for an already-dispatched check.

- The original `verificationDeadlineMs` and verify cap apply, even after the work
  deadline. Native timeout/output/cleanup policy and authorization are not renewed.
- Candidate workspaces are validated, never rematerialized over an existing check.
- Durable native output/timestamps reconstruct deterministic content-addressed
  check receipts before or after receipt publication. Conflicting receipt bytes
  fail closed; a failed check remains violated rather than becoming a pass.
- Existing dispatches in the current generation are observed once more as needed,
  never executed again. Only never-dispatched subsequent checks get normal new
  grants. Writer/model work is unreachable from verifier continuation.
- The same command can survive a second observer crash during a later check.
  Completed duplicates revalidate evidence without another authority epoch.
- Cancellation, authorization expiry/revocation and original-budget expiry cannot
  produce a passing attestation. Known effects drain before settlement. Lost hosts
  and unprovable outcomes remain quarantined; absent, legacy or mismatched records
  cannot authorize another dispatch.

The opt-in environment digest now carries `writer-verifier-v2`. Older writer-only
opt-in environments and verifier dispatches without original timeouts are not
silently upgraded. Default-off behavior and unselected legacy dispatch serialization
remain unchanged. No native Rust source or dependency change was needed: H2b/H2c
already supplied the durable execution machinery.

## Files and design

- `native-reconnect.ts`, `native-reconnect-binding.ts` and
  `native-reconnect-event.ts` extend the existing coordinator path and replay
  boundary; `coordinator.ts` calls the accurately named `reconnectNativeExecution`.
- `native-verifier-check.ts` owns observation, cancellation/drain and settlement
  of an existing check. It contains no spawn, acquire, commit or materialization.
- `verification-phase.ts` reuses the normal verification/evidence path with an
  explicit reconnect owner; it skips materialization and reuses prior dispatches.
- `owned-execution.ts` persists verifier receipt timeout at dispatch, binds the
  original verifier intent and uses native timestamps on the connected path too.
- `run-types.ts`, `event-parser.ts` and `process-projection.ts` validate the optional
  original timeout. No new observation event or parallel evidence format was added.
- `broker.ts` versions the opt-in environment; `rust-host-binding.ts` and protocol
  comments describe the expanded bounded scope. User docs and native README agree.
- Three `verified-run-rust-verifier-*.test.ts` files, `helpers/native-verifier.ts`
  and `fixtures/native-verifier-owner.ts` supply real-source/runtime acceptance.

## Observed RED, corrections and review

pstack's bounded-unit and failing-first procedure was applied directly in the root
agent, without delegation or provider calls. Advisory AdaptOrch routing selected a
sequential chain; it is not a correctness proof.

1. Actual source CLI parent killed during a committed verifier: the new acceptance
   failed with `verified-run: reconnect_unavailable` before production edits
   (`red.log`). This was the intended missing behavior, not a fixture failure.
2. Connected execution and recovery were made receipt-deterministic. Native intent
   binding was strengthened to include candidate/check/timeout, not merely argv.
   Existing verifier dispatch is never reused as permission to execute again.
3. Negative-test cleanup exposed private-file mode errors and an unlink/open-file
   race. Restoring files uses private permissions; the missing-file test now renames
   and restores the same inode instead of replacing the live host's open file.
   Earlier failing logs are retained, not relabeled as passes.
4. Direct self-review covered authority fencing and original token provenance,
   candidate/claim binding, native durable prefix/termination, stale journal heads,
   deadline behavior, receipt conflicts, legacy serialization and bounded loops.
   The existing check receipt/evidence publisher remains canonical. No blocking
   finding remains in this bounded slice. This is self-review, not independent
   multi-agent or platform acceptance.

## Final verification

Evidence root:
`/mnt/omkdata/tmp/opencode/omk-rust-verifier-20261109-01a1be6d/`.

| Gate | Observed result | Log |
|---|---|---|
| Explicit real-binary Node matrix, `vitest --run --maxWorkers=1` | **120 passed / 0 failed / 0 skipped**, 19 files | `final-matrix-corrected.log` |
| Protocol `test/run-reconnect.test.ts` | **9 passed**, exit 0 | `protocol.log` |
| Rust `test --offline --locked -- --test-threads=1` | **12 passed**, exit 0 | `cargo-test.log` |
| Rust offline locked check, all-target Clippy `-D warnings`, fmt, release build | All exit 0 | `cargo-{check,clippy,fmt,build}.log` |
| `NODE_OPTIONS=--max-old-space-size=4096 taskset -c 0,1 npm run check` | Exit **0**; script tests **588 passed / 30 skipped / 0 failed**, compiler included | `root-check.log` |
| Active LSP probe on 10 changed paths | Clean coverage not confirmed; auxiliary suggestions only | Session diagnostic result |

The 19 new verifier tests cover live source CLI loss, pre/post-receipt crashes,
partial receipts and unstarted checks, a second CLI-owner crash during a later
check, concurrent exclusion, exact command replay, failed/altered receipts, stale
approval/revision/generation/execution, changed selection, lost/legacy/mismatched
records, cancellation, revocation/expiry, original verification time and stale
observer/candidate/check/timeout bindings. The remaining 101 tests are the adjacent
writer/native-host/journal/authority/recovery/cancellation matrix.

Cargo used a network-disabled bubblewrap sandbox, read-only source/toolchain,
isolated copied cache/target and one job/test thread. Heavy gates ran sequentially.
Fresh binary: `target/release/omk-execution-host`, SHA-256
`23906cea4144ea19d340334aa5d314af2192240cd0f49f1f5c0c06abfa34e49c`.
This matches H2c's binary because native Rust source is unchanged; source snapshot
comparison also passed. No installed binary was overwritten.

## Remaining limits

This is Linux source-engine acceptance, not packaged/installed-engine, desktop,
cross-platform or fresh R-oracle acceptance. Node still owns durable authority,
scheduling and publication. DAG/scripted-agent/session reconnection, compacted
start provenance and native-record retention/GC remain separate work. Parent loss
before commit cannot reconnect. A dispatch without its native identity/output is
not permission to rerun. Package changes require fresh artifact acceptance before
activation; neither Phase 2 nor the 2.0 milestone is marked complete.

Proposed commit message: `기존 grant와 후보를 유지하는 Rust verifier 재연결 추가`.
