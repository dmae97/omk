# Rust host H2g: start provenance across authority compaction

Date: 2026-11-10. Baseline HEAD: `48fb8e33a84d01fde163091ed36a8bca981d3bbe`.
Existing H1–H2f changes were preserved. Versions remain **1.5.10**.
No commit, push, dependency change, installed-engine activation or release.

## Boundary and design

Continued the previous handoff's compacted-provenance gap. Native execution is
still owned by the existing Rust supervisor; this slice changes the Node durable
authority/reconnect boundary, not the Rust implementation or scheduler.

Two designs were considered directly: retaining/scanning historical event rows,
or carrying the required history in each retained grant. The latter reuses the
existing projection and snapshot without an additional log, index or API.

- `AuthorityGrantRecord.startProvenance` is optional `started | revoked`.
  Only replay of `effect-started` creates it. Cancellation/recorded expiry marks
  an existing provenance revoked. Epoch quarantine and observed termination
  preserve it. Later cancellation never invents missing start evidence.
- Snapshot parsing validates the discriminator and rejects claims of start on
  unstarted/cancelled grants or without actual claims. New reservations cannot
  carry preexisting start provenance.
- Compaction naturally preserves this projection for retained grants. Reconnect
  consumes it after the same fresh head, epoch, lease, token, identity, claims,
  native-record and deadline checks. No replacement grant or dispatch is added.
- Existing raw event bytes and reservation shape remain unchanged. An old
  snapshot that already discarded provenance remains unavailable. A completely
  dropped settled grant also remains unavailable; retention/GC policy is unchanged.
- Old engines may refuse enriched snapshots. Preserve the old ledger before
  adopting this source version; stripping fields is not a supported downgrade.

Pstack's **Sequence work into verifiable units** constrained the work to H2g and
its own RED/GREEN checks. **Model the Domain** put start/revocation evidence in
one grant discriminator rather than additional synchronized booleans. The work
and review were performed directly, without agents or external model calls.

## Cleanup

Removed reconnect's two historical-event scans and its mutable revoked flag.
Removed two duplicate projection object assemblies while preserving the frozen
projection and fresh map ownership. Consolidated duplicate namespace imports.
The authority module remains at its existing 559 pure-LOC ratchet; no limit was
raised, compatibility shim added or unrelated legacy implementation deleted.

## Observed verification

Evidence root: `/tmp/omk-rust-h2g-20261110-7P6qvu/`.
Commands below use explicit file lists recorded in the corresponding logs and
were run sequentially with one Vitest worker. Package-local matrix checks use
`umask 022`, matching Git's representable file modes; root checks use two CPUs
and a 4096 MiB Node heap limit.

| Check | Result | Evidence |
|---|---|---|
| New authority tests before implementation | 10 intended assertion failures, 1 pass | `provenance-red.log` |
| Real-binary/source-CLI regression before implementation | 4 `authority_history_missing` failures, legacy refusal passed | `native-red-final.log` |
| `vitest --run --maxWorkers=1`, 16 explicit authority/reconnect/GC files | **102 passed**, zero failures/skips | `regression-matrix-final.log` |
| Final cleanup recheck, four provenance/reconnect-guard files | **42 passed**, zero failures/skips | `post-cleanup-final.log` |
| `npm run check`, including `tsgo --noEmit`, lint and repository guards | Exit **0**, script tests **588 passed / 30 skipped / 0 failed** | `root-check.log` |
| Active LSP | Clean coverage unconfirmed; compiler independently passed | Session diagnostics |

The real source CLI reconnects after two authority snapshots with the original
writer token, generation and budget and exactly one writer execution. Revoked
writers only cancel/drain. A terminated verifier explicitly kept by result
retention continues with the original candidate and verification deadline.
Missing legacy provenance fails before reconnect publication or native control.
Adjacent gates cover stale owners, expiry, lost outcomes, concurrent observers,
receipt continuation, GC retention and actual process death.

The explicitly selected H2d binary has SHA-256
`23906cea4144ea19d340334aa5d314af2192240cd0f49f1f5c0c06abfa34e49c`.
No Rust implementation was changed or rebuilt, and no new Cargo/R acceptance is
claimed. Binary integration is not installed-package or desktop acceptance.

## Failed attempts retained in evidence

- The first integration fixture used a nonexistent workspace claim. It was
  corrected before the final RED; this was a setup failure, not product RED.
- An expiry integration attempt ran `expire()` after restart had already
  quarantined the grant. That method intentionally skips quarantined grants,
  so no expiry event existed and the writer waited until its original timeout.
  This invalid scenario was removed, not fixed by changing product expiry or
  test timeouts. Recorded expiry is exercised before quarantine in the unit
  gate; existing real-binary expiry guards also pass. The one abandoned fixture
  was removed only after its committed terminal and gone-process checks.
- The first broad run had two environment/setup failures: inherited restrictive
  umask produced `mode_unrepresentable` in an unchanged Git publication test;
  another existing CLI test resolves its root from package cwd. The entire
  16-file matrix passed from `packages/coding-agent` with `umask 022`, without
  modifying either existing test or weakening a product guard.

## Review and remaining work

Direct self-review checked monotonic revocation, start-only provenance creation,
legacy omission/hash preservation, snapshot replay, no renewed authority or
budgets, verifier retention, resource cleanup and existing module limits.
Initial hashes confirmed unrelated inherited edits unchanged before the final
planning updates; final hashes are recorded separately. This is self-review,
not independent multi-agent approval.

Grant retirement tied to recoverability, native witness retention, DAG/scripted
agent/session reconnect, Rust ledger/scheduler ownership, authenticated desktop
transport and platform/installed-artifact acceptance remain open. Changed package
inputs require fresh artifact receipts before activation. Phase 2 and milestone
2.0.0 are not complete.

Proposed commit message: `authority 압축 후 native 실행 시작과 취소 이력 보존`.
