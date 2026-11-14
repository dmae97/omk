# Rust host H2e: recovery-preserving native record retention and GC

Date: 2026-11-09. Baseline HEAD: `48fb8e33a84d01fde163091ed36a8bca981d3bbe`.
The existing dirty H1–H2d work was preserved. Versions remain **1.5.10**.
No commit, push, dependency change, installed-engine activation or release.

## Implemented boundary

The existing `collectVerifiedRuns` / `omk run gc` now reports and optionally
collects native execution records. The default is still preview, with seven-day
retention; only explicit `--execute` removes artifacts. No background sweep runs.

- Reuse the existing run recoverability policy: keep active/unsettled executions,
  open writers/publications, recoverable candidates and paused runs inside their
  original anchored cap. A terminal native result alone does not close recovery.
- Borrow exclusive authority then run-owner leases without opening/reconciling
  authority, advancing epochs, compacting history, cancelling or dispatching work.
  A live or unknown owner keeps records instead of forcing ownership.
- Bind each deletable record to its journal execution, generation and namespace,
  original session/grant token/intent, and an authoritatively terminated effect.
  Other unresolved grants for the run block cleanup too. Independently prove the
  native host and namespace gone; never infer that from age or a terminal line.
- Require private, bounded, no-follow, single-link files. Verify the committed
  terminal prefix, no unpublished tail, and stable inode/content/mtime before
  deletion. Both journal and native companions must satisfy retention; future
  mtimes stay recent, rather than acting as elapsed time.
- Keep orphan/sidecar-only, incomplete, legacy, temporary, damaged or unprovable
  records, including missing compacted grant provenance. Unsafe native evidence
  also blocks the corresponding derived workspace cleanup.
- Durably rename an eligible payload to `<requestId>.gc.jsonl`, remove companions,
  sync their removal, then remove the retired payload last and sync again.
  A later sweep revalidates the run, authority, identities and remaining files
  before completing interrupted GC, even after the head was already removed.
  Retirement files are never read as reconnect results.
- Preserve journals, authority, issuer keys, candidate manifests/blobs, receipts
  and attestations. Evidence/artifact reads and completed reconnect replay remain
  usable after GC. The native witness lifecycle is not swept in this slice.

Reports add `nativeRecords`, `prunedNativeBytes` and `prunableNativeBytes` without
changing the meaning of derived-workspace totals. Partial removals are not credited
as fully freed bytes; `remove_failed` reports CLI exit 1 and can be retried.

## Changed paths

- `packages/coding-agent/src/core/verified-run/run-gc.ts`: integrate native decisions
  under the existing run lease, reject invalid direct-call options, and avoid
  treating native control directories as unrelated run directories.
- `native-record-gc.ts`: native inventory association, authority/host/namespace
  proofs, retention decisions and conservative reporting.
- `native-record-files.ts`: private file snapshots, revalidation and durable,
  restartable removal ordering.
- `run-gc-types.ts`: shared report/options types, re-exported through `run-gc.ts`
  to preserve its existing SDK type surface without an import cycle.
- `rust-host-record.ts`: explicit retired-file read for GC only; default reconnect
  reads still select only the original `.jsonl` filename.
- CLI handler/help, `docs/rust-execution-host.md`, native README and planning state.
- Three `verified-run-native-gc*.test.ts` files, `helpers/native-gc.ts` and
  test-only `fixtures/native-gc-stop.ts`. No production pause/fault hook was added.

All source paths above are under `packages/coding-agent` unless specified.
Native Rust implementation and dependency locks were not changed by this slice.

## pstack units and observed failures

1. **Initial RED:** two actual source-CLI GC tests failed because the existing
   report had no native record collection/retention entries. `red.log` records the
   intended missing behavior before production changes.
2. **First GREEN:** source CLI preview/removal preserved evidence and completed
   reconnect replay; pre-attestation records survived GC and reconnected. Existing
   derived-workspace GC tests passed alongside them.
3. **Authority counterexample:** a terminal run with an extra unresolved durable
   reservation was pruned. `guards-red.log` captured the assertion failure; the
   fix conservatively keeps that run's native records and derived workspaces.
4. Negative-test fault injection initially did not update Node's named builtin
   exports. The test now uses `syncBuiltinESMExports`; product behavior was not
   changed to manufacture an exception. Actual source CLI SIGKILL and subsequent
   lease reclamation independently exercise the retirement crash window.
5. WSL wall-clock noise made zero-age fixtures intermittently recent. Private
   completed-run fixtures now have explicit old mtimes. Product future-mtime
   retention remains intact and has a separate negative test. No execution budget,
   timeout or protection was loosened.
6. The first broad matrix had two setup-time failures: one existing host-crash
   test and one new storage fixture. The same two files passed all 23 tests in an
   unchanged isolated recheck; the subsequent full matrix passed all 148.
   The earlier failures remain in the evidence directory.
7. Root check found a type import cycle between GC modules. Shared types were
   extracted, not added to the cycle baseline. The cycle gate, post-extraction
   GC tests and complete root check then passed.

Direct self-review checked original recovery windows, readonly authority access,
lease order, grant/identity binding, no-follow storage, uncommitted tails,
partial-delete recovery, retained evidence, byte accounting and module boundaries.
It also added directory sync after companion deletion, before the payload is
removed. No blocking finding remains for this bounded slice. This is self-review,
not independent multi-agent approval or a platform correctness proof.

## Verification receipts

Evidence root:
`/mnt/omkdata/tmp/opencode/omk-rust-gc-20261109-01a1be6d/`.

| Gate | Observed result | Log |
|---|---|---|
| Full explicit-real-binary matrix, `vitest --run --maxWorkers=1` | **148 passed**, 23 files, zero failures/skips | `final-matrix-recheck.log` |
| After shared-type extraction: three new GC files plus existing GC file | **28 passed**, 4 files, zero failures/skips | `post-types-gc.log` |
| Protocol reconnect command tests | **9 passed**, exit 0 | `protocol.log` |
| Offline locked Cargo tests, one test thread | **12 passed**, exit 0 | `cargo-test.log` |
| Cargo check, all-target Clippy `-D warnings`, fmt | All exit 0 | `cargo-{check,clippy,fmt}.log` |
| Two-CPU, 4096 MiB heap `npm run check` | Exit **0**; compiler passed; script **588 passed / 30 skipped / 0 failed** | `root-check-final.log` |
| Active LSP probe on nine changed paths | Clean coverage unconfirmed; auxiliary suggestions only | Session diagnostics |

The full matrix includes the preceding 120 writer/verifier/native-host/journal/
authority/recovery tests, six existing GC tests and 22 new GC tests. The final
shared-type extraction changed no runtime policy; its four-file recheck and root
compiler/import-cycle gates bind the final source shape.

Real source CLI controls cover preview and explicit deletion, writer reconnect
after GC, terminal-output recovery before attestation, evidence/artifact/replay
following deletion, a live authority owner, SIGKILL during retirement, and repeated
GC. Additional direct-engine checks cover anchored paused-run expiry, unresolved
reservations, partial deletion after head unlink, symlinks/hardlinks/shared files,
missing heads, unpublished tails, wrong bindings, live hosts, unknown temporaries,
orphan/sidecar-only files, compacted provenance, damaged journals/authority and
future mtimes. These are private test fixtures, not a sweep of the user's live state.

The selected binary was the H2d release artifact at
`/mnt/omkdata/tmp/opencode/omk-rust-verifier-20261109-01a1be6d/target/release/omk-execution-host`.
SHA-256: `23906cea4144ea19d340334aa5d314af2192240cd0f49f1f5c0c06abfa34e49c`.
Current Rust source matches its recorded snapshot (`native-source-comparison.log`);
no new native implementation required rebuilding or replacing that artifact.
Cargo ran in its existing isolated, network-disabled, read-only-source sandbox.
Heavy gates ran sequentially; no agent delegation or provider calls occurred.

## Remaining limits

Unknown/orphan/legacy records and compacted provenance are intentionally retained,
not automatically guessed or evicted. Native witness retention, authority-history
compaction policy, DAG/scripted-agent/session reconnect and full Rust ledger/
scheduler ownership remain separate work. Same-user storage is not hostile-operator
protection. Source-engine acceptance is not installed/package, desktop,
cross-platform, fresh R-oracle or milestone release acceptance. Changed package
inputs still require new artifact gates before activation. Phase 2 and 2.0 remain open.

Proposed commit message: `복구 가능한 실행 기록을 보존하는 native-record GC 추가`.
