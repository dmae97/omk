# Rust host H2h: retain grants needed by run recovery

Date: 2026-11-10. Baseline HEAD: `48fb8e33a84d01fde163091ed36a8bca981d3bbe`.
Continued H2g in the existing dirty checkout. Versions remain **1.5.10**.
No commit, push, dependency change, installed-engine activation or release.

## Implemented boundary

Runtime authority stores now supply a trusted `retainGrant` policy to explicit
compaction. It preserves settled execution grants while the associated run is
recoverable, unsettled, publication-open, or undecidable from its journal/clock.
A missing or damaged run is not evidence that recovery ended. Generic authority
stores without this runtime policy retain their previous compaction behavior.
No automatic compaction, background sweep or new execution command was added.

`run-retention.ts` owns the recovery hold decision shared by authority retention
and workspace GC. `authority-compaction.ts` selects retained grants/tombstones
without changing tokens, claims, state, original deadlines or counters. Retained
grants also retain expired tombstones with their original expiry; duplicate
commands still return `result-expired`, never a fabricated fresh grant. Once the
recovery hold ends, ordinary compaction can drop the pair. Unsettled grants
remain retained independently of age.

Already-dropped grants and legacy provenance are not reconstructed. The policy
keeps uncertain data rather than guessing or silently extending authorization.
It reads run evidence while the existing authority mutation lease is held; a
successor cannot dispatch or change generation through that authority meanwhile.

## Cleanup and pstack decisions

Pstack's **Sequence work into verifiable units** made retention the first unit,
verified before the subsequent Rust phase-deadline change. **Model the Domain**
put recoverability in one shared policy instead of duplicating it in GC and
compaction. Existing file-size and import-cycle limits were not raised.

Removed the duplicate GC recoverability implementation, extracted selection from
the oversized authority store, and shared the native compaction test helper.
Removed H2g's synthetic result-retention workaround from that helper. The original
writer/verifier grants now survive without that workaround.

## Verification

Evidence root: `/tmp/omk-rust-h2hi-20261110-E6mguP/`.

- `h2h-red.log`: seven intended failures across retention and H2g compaction;
  the original grant or expired tombstone pair was dropped. The existing
  recovery-cap release case remained green.
- `h2h-green-final.log`: all 11 then-current retention/compaction cases passed
  against the original H2d binary before H2i changed native execution.
- Final added writer coverage proves the terminal-output/pre-candidate window.
  Verifier coverage includes pre-attestation, already-written receipts, actual
  authority rewrite/head crash recovery and unchanged original budget/candidate.
- Combined writer/verifier/authority/GC matrix: **161 passed in 25 files**,
  no failures/skips (`final-matrix.log`). The subsequent Rust-only pre-spawn
  review change passed **26 tests in five files** (`post-review-native.log`).
- Final retention-only recheck: **8 passed**, including a forced on-disk snapshot
  retaining an expired tombstone's exact original expiry (`final-retention.log`).
- `npm run check`: exit **0**, script **588 passed / 30 skipped / 0 failed**;
  lint, compiler, import-cycle/module-size and repository guards passed.
- LSP clean coverage was incomplete; the compiler is separate acceptance evidence.

A first green attempt left a deliberately damaged test journal in place during
fixture cleanup, so cleanup itself threw after the retention assertion. The
fixture now restores its original journal before cleanup. Both owned abandoned
fixtures from the RED/first-green attempts were removed only after committed
terminal records and host/namespace termination checks. No user run directory was
swept; evidence is in `owned-fixture-cleanup.json`.

## Remaining scope

This is Node authority retention supporting the existing Rust owner, not a Rust
grant issuer or ledger port. H2i moves original phase-cap enforcement into Rust.
Native authorization revocation handoff, ledger/scheduler ownership, witness
retention, broader reconnect profiles and desktop/platform acceptance remain open.
Changed package inputs still need fresh artifact gates before activation.

Direct self-review covered expiry/idempotency, conservative unknown outcomes,
lease ordering, crash windows, shared GC semantics and module boundaries. It is
not an independent-agent review or release approval. Initial dirty-path hashes
and the Git index are checked separately against final state.

Proposed commit message: `복구 가능한 실행의 grant를 authority 압축에서 보존`.
