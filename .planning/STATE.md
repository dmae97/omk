---
gsd_state_version: "1.0"
milestone: v2.0.0
milestone_name: Pi-independent OMK
current_phase: 02
current_phase_name: Native extensions and explicit migration
current_plan: "02-06 artifact acceptance"
status: blocked
last_updated: "2026-11-10T00:19:00Z"
state_head: 48fb8e33a84d01fde163091ed36a8bca981d3bbe
progress:
  total_phases: 6
  completed_phases: 1
  total_plans: 1
  completed_plans: 1
---

# Project state

## Current position

Milestone: v2.0.0 Pi-independent OMK
Phase: 02 of 6 (Native extensions and explicit migration)
Status: Native default `omk` implemented; combined verify passed for candidate `019d076c…`
Current gate: owner confirmation of tokens-per-turn, clipboard classification and the one-module-per-PR split before checking off Phase 2.
User-directed implementation lane: Rust H1/H2a/H2b, H2c writer reconnect, H2d same-execution verifier/receipt continuation and H2e recovery-preserving native-record GC are verified bounded slices; broader ownership migration remains open. Package changes require fresh artifact receipts before activation.

## Decisions

- Preserve existing spec-kit governance; use GSD for execution/state tracking.
- Do not equate absence of Pi npm packages with absence of compatibility coupling.
- Start with the smallest end-to-end boundary slice and RED/GREEN evidence.
- Keep versions at 1.5.10 until full milestone release acceptance.
- GSD defaults do not authorize commits, model overrides or publication.

## Historical Phase 1 evidence

- Baseline `npm run check`: passed, script tests 555 passed / 30 skipped / 0 failed.
- `node scripts/pi-inventory.mjs --check`: passed before implementation;
  9 broad namespace manifest entries, 44 imports/mentions, 4 alias consumers.
- Existing affected source/docs were backed up outside the checkout.
- GSD plan checker: PASS after recognizing two complete typed tasks and their
  supporting artifacts/key links; no remaining plan blockers.
- Existing targeted baseline: 176 tests passed across seven files.
- Initial 239-test and 258-test passes missed review counterexamples; their
  observed RED corrections and history are retained in the phase-1 summary.
- Latest main run: 266 tests passed across ten explicit files, exit 0.
- Latest main `npm run check`: exit 0, 555 script tests passed / 30 skipped / 0 failed.
- Final independent code review: PASS, CR-01/CR-02/CR-03 resolved; 27 selected
  tests and nine real-filesystem assertions passed. Security register: six closed.
- Post-check source digests, preserved backup files, HEAD and Git index entries match.
- Final goal verifier: passed, 4/4 truths, 29 selected cases passed, no blockers.
  Report covers 16 frozen inputs; owner `verification.status` returned passed.
- GSD `phase.complete 1` completed one plan and advanced to phase 02. Its ID parser
  rejected `V2-BOUNDARY-01`, so main updated that single checkbox/traceability row
  from the accepted report. IDs and validation gates were not renamed or weakened.

## Open limitations

- `Rscript` is not on PATH, but an existing R 4.4.3 installation was found and explicitly used for H1 budget and TS/R/Rust DAG acceptance. Broader mathematical/recovery gates remain separate.
- Windows blueprint is outside current accessible project files.
- Native desktop/platform acceptance remains unrun. Packaged Node/Bun/installed declarations and combined source acceptance passed for candidate `019d076c…`, revalidated against the recorded checkout origin and current package fingerprint. The separate bounded native observation stream passed its own source/binary gates; this is not a desktop installer or window acceptance.
- The earlier development snapshot is committed as `48fb8e33a8`. H1 now changes real native execution code and its broker integration; the earlier artifact-only continuation is historical. Shared dependencies and other worktrees remain untouched.

## Continuation, 2026-11-06

The metadata above records the earlier phase-1 handoff, not completion of the
subsequent phase-2 source work. Existing phase-2 summaries and review were read;
no plan or broad requirement was marked complete in this continuation.

- Added extension-memory lifecycle fixes: failed factories release recorded event
  subscriptions; retired runtimes release bound action/provider callbacks, pending
  payloads, maps and inventory references. Shared live runtimes remain usable.
- RED: six intended assertion failures. GREEN: 87 tests in eight explicit files,
  zero skipped; coverage for the two new modules is 100% lines and 88.88% branches.
- Root `tsgo --noEmit`: exit 0. `npm run check`: exit 1, script tests 579 passed,
  one failed, 30 skipped. The blocker is existing orphaned
  `dist/core/subscription-usage-cache.*` output, not modified by this slice.
- Verification ran sequentially with one Vitest worker and two-CPU root checks.
  No global setting, installed engine, version, commit or publication changed.
- Evidence: `/tmp/omk-v2-memory-20261106-01a1b084/`, including RED/GREEN logs,
  focused coverage, root-check log and compiler log. See
  `packages/coding-agent/docs/extension-memory-lifecycle.md` for scope and limits.

## Continuation, 2026-11-08

- Reused exact reviewed dependency locks for offline consumer installation without registry metadata, dependency upgrades or lifecycle scripts.
- Fixed the synthetic artifact provider's follow-up request classification and reused tool-call IDs. All five packaged Node CLI controls and four SDK tool executions across reload/cwd replacement passed.
- Regression tests: 31 passed. Final root check: exit 0, 586 passed / 30 skipped / 0 failed. Candidate inputs stayed unchanged during the check.
- Existing Rust crates: 37 tests passed, Clippy and fmt passed in a network-disabled, read-only-source sandbox. This does not migrate execution ownership.
- Actual Linux x64 Bun build succeeded but installed transitive CJS resolution failed. Installed declarations failed with eight TS2307 errors. Combined artifact verification remains failed.
- Installed engine and workspace versions remain 1.5.10; no commit, push, publication or activation.

## Rust host H1 continuation, 2026-11-08

- Added a real Rust Linux sandbox supervisor and connected it to the production verified-run broker under explicit `OMK_RUST_EXECUTION_HOST` selection. Node retains approval, durable grants, scheduling and publication; Rust owns selected writer/verifier process supervision.
- Real release-binary integration: 15 tests passed with no skips. Source CLI plan/start/artifact/events passed; the base workspace stayed unchanged. Host SIGKILL preserves quarantined execution rather than falling back.
- New Rust crate: 7 tests, Clippy, fmt and release build passed. Root `npm run check` passed, 586 script tests / 30 skips / 0 failures.
- Base R 4.4.3 independently verified 6,566 budget traces. Existing TS/R/Rust DAG gate passed 2,214 DAG and 16 memory cases. Sixty oracle/negative-control tests ran with actual R, zero skips.
- Direct review reproduced and fixed blocked-output cancellation and an EOF/termination race. Full evidence, the ambient-umask failure/recheck and residual limits are in [the H1 result](RUST-HOST-01-RESULT.md).
- Installed engine/default behavior and all version numbers remain unchanged. No milestone completion percentage, commit, release or native-workbench acceptance is claimed.

## Bun package.json and declaration boundary continuation, 2026-11-08

- Compiled Bun CJS-subpath failure root-caused to Bun 1.3.4+ standalone executables not loading on-disk `package.json` by default. Both compile commands now pass `--compile-autoload-package-json`. A regression test builds a real executable.
- `GoogleThinkingLevel` moved to an SDK-free module. Root `omk-ai` declarations no longer reach `@google/genai`. The boundary test ratchets the remaining Anthropic edge.
- Gate candidate `5c7f1f98…`: `prepare`, `node` and `bun` passed. `types` failed with seven errors, all upstream `@anthropic-ai/sdk` 0.91.1, which 0.92.0 fixes. The bump is pending separate review because 0.92.0 also adds env-configured headers.
- `npm run check`: exit 0, 588 passed, 30 skipped, 0 failed. Details are in [the Phase 2 acceptance continuation](phases/02-native-extensions-and-explicit-migration/02-ACCEPTANCE-20261108.md).
- Versions remain 1.5.10. There was no commit, push, publication, dependency change or activation.

## Anthropic SDK 0.92.0 continuation, 2026-11-08

- Pinned `@anthropic-ai/sdk` 0.92.0, which fixes the upstream declaration errors. Lockfile and shrinkwrap changed only in the SDK rows, and integrity was checked against the tarball.
- Review found that 0.92.0's `ANTHROPIC_CUSTOM_HEADERS` is applied after auth headers. A real-SDK RED showed it replacing the selected API key and OAuth token. `OmkAnthropic` keeps pre-0.92.0 header behavior.
- Gate `prepare`, `node`, `bun` and `types` passed with zero TS errors and no `skipLibCheck`. `packages/ai` tests: 1345 passed. `npm run check` exit 0.
- Versions remain 1.5.10. There was no commit, push, publication or activation.

## Phase 2 combined acceptance, 2026-11-08

- All seven source groups passed for candidate `2962df3d…`: phase1 266, native-loader 33, cli-sdk 117, doctor 33, preservation 316+114, Atelier 88 with 1 skipped plus types/vendor, root check 588/30/0. `source.json` was assembled, and combined `verify` exited 0 (`activation: not-authorized`).
- 02-06 is complete for its authorized scope. The missing 02-01 summary was written from current receipts. All six authorized steps passed.
- Phase 2, V2-CORE-01, V2-MIGRATE-01 and V2-API-01 are not checked off. The omitted dialect stays `omk+pi`. Closing them needs an owner decision on the default flip and the spec-108 equivalence, benchmark, one-module-per-PR and deprecation criteria, then a separate activation run.
- Evidence: `/mnt/omkdata/tmp/opencode/omk-v2-sdk092-20261108-115739/` and [02-06-SUMMARY.md](phases/02-native-extensions-and-explicit-migration/02-06-SUMMARY.md). Versions remain 1.5.10. There was no commit, push, publication or activation.

## Native default switch, 2026-11-08

- Owner approved the `omk` default and waived free Terminal-Bench. The omitted dialect now resolves to `omk` everywhere. `omk+pi` stays explicit. Native legacy-import failures carry a migration hint.
- Gate root `/mnt/omkdata/tmp/opencode/omk-v2-default-omk-20261108-133426/`: `prepare`, `node`, `bun`, `types`, all seven source groups and combined `verify` passed. The new `default-omitted` control fails startup with the hint under packaged Node and compiled Bun.
- spec-108: tool-call order identical; wall-time ratio 1.002; tokens per turn not measured offline; counts differ only by the intended test changes; one-module-per-PR pending at commit. See [the acceptance record](phases/02-native-extensions-and-explicit-migration/02-ACCEPTANCE-20261108.md#continuation-native-default-omk-2026-11-08).
- Versions remain 1.5.10. There was no commit, push, publication or installed-engine activation.

## Bounded native observation continuation, 2026-11-08

- The four stale `subscription-usage-cache` dist files were already absent. Source-derived dry-run found zero stale outputs and prune tests passed; no additional generated file was deleted.
- Current package fingerprint matches `019d076c…`. Existing Node/Bun/types/source receipts and artifact hashes were revalidated from their exact original worktree, exit 0. No receipt was relabeled or artifact rebuilt.
- Added `omk-workbench-wire --stream` and a library consumer: one current graph, bounded reused input frame, direct output/flush, no retained history or output queue. Authority-only updates remain observable; stale/duplicate observations are omitted.
- Two intended RED assertions preceded the fix. Rust 16 tests and all check/Clippy/fmt/release gates passed. Actual source CLI observations streamed before EOF with the separately built Rust execution host selected; the original one-shot interoperability test also passed without skips.
- Final root `npm run check`: exit 0, 588 passed / 30 skipped / 0 failed. An earlier 300-second tool timeout was followed by a successful 900-second-budget run, without changing test timeouts or assertions.
- Heavy commands ran sequentially, Cargo with one job/test thread, root checks on two CPUs with a 4096 MiB Node heap cap. Synthetic 2,000/50,000-frame empty-graph streams used 1,956/2,184 KiB maximum RSS; this is not a production GUI or memory-savings claim.
- See [the stream result](WORKBENCH-STREAM-01-RESULT.md) for source scope, resource limits, exact evidence and remaining work. No installed-engine activation, version change, commit or release.

## Rust host H2a durable termination receipts, 2026-11-08

- Rust now writes a durable termination receipt (`native/omk-execution/src/witness.rs`) into `<state root>/native-witness/` after it witnessed the namespace init gone in the same boot, including after parent EOF. Temp file, fsync, rename and directory fsync; idempotent on identical bytes, refuses conflicting bytes, shared or symlinked directories.
- Node `native-witness.ts` lets restart reconcile, candidate resume and writer restart resolve only an `unknown` live probe (reboot, PID reuse) with a byte-exact owner-only receipt; `alive` is never overridden. The live path deletes the receipt after `confirmTerminated`. `runAuthorityProbe` keeps its old behavior without a state root.
- RED observed three ways: Node upgrade removed (2 failures), Rust record call removed from a separate build (2 failures), live discard removed (1 failure). GREEN: Rust 10 tests (budget 4, protocol 3, witness 3), Clippy, fmt, release build; Node native-witness 6 + rust-host 9 with the real binary, zero skips.
- Adjacent 13-file matrix: 106/109 first, then the failing writer-restart file passed 10/10 alone with no code change; the failures were `deadline`/`inconclusive` at load average 22 to 23. Root `npm run check`: exit 0, 588 passed / 30 skipped / 0 failed.
- Evidence: `/mnt/omkdata/tmp/opencode/omk-rust-h2a-witness-20261108/`. Versions remain 1.5.10. There was no commit, push, publication or activation.

## Rust host H2b terminal durability, 2026-11-09

- Continued the existing uncommitted record/detach implementation rather than replacing it. Rust now syncs terminal records before sending `finished`; committed detachable executions preserve output even when their parent remained connected. Production broker detachment and automatic coordinator reconnect remain disabled.
- Two real-binary REDs reproduced premature success on a failed record write and missing recoverable output. Final focused tests: 16 passed, zero skipped. Adjacent ten-file matrix: 62 passed, zero skipped (overlaps the focused run). Rust: 11 tests, check, Clippy, fmt and release build passed.
- Real source OMK `run plan/start/artifact/events` passed with the new Rust host, two dispatches and unchanged base workspace. Root `npm run check`: exit 0, 588 passed / 30 skipped / 0 failed. LSP coverage was inconclusive; compiler checks passed. No new R acceptance is claimed.
- Applied pstack's verifiable-unit and RED/GREEN workflow directly, without delegated agents. No installed-engine activation, dependency/version change, commit, push or publication.
- Evidence and remaining ownership limits: [H2b result](RUST-HOST-02B-RESULT.md).

## Rust host H2c authority-bound reconnect, 2026-11-09

- Added explicit `RunCoordinator.reconnect` and `omk run reconnect` for `linux-command-v1` writers started with both native-host selection and `OMK_RUST_EXECUTION_RECONNECT=1`. Default behavior and installed settings are unchanged.
- New observer leases/epochs fence old owners while preserving the original writer grant, claims, authorization deadline, execution ID, run generation and budgets. No replacement writer dispatch. Revocation/expiry only allow cancel/drain; mismatched bindings and lost outcomes fail closed.
- Rust records boot identity, original timestamps and the dispatch binding. A synced atomic `.head` marker now exposes only committed record bytes, including when an unpublished terminal line is otherwise complete.
- Actual source CLI survived two successive parent crashes and rejected a concurrent observer. Final Node matrix: 101 passed across 16 files, zero skipped. Protocol: 9 passed. Rust: 12 passed plus check, Clippy, fmt and release build. Final `npm run check`: exit 0, script 588 passed / 30 skipped / 0 failed.
- pstack's bounded-unit/RED-GREEN procedure was applied directly. No provider calls, delegation, dependency/version change, installed-engine activation, commit, push or release. See [H2c result](RUST-HOST-02C-RESULT.md).

## Rust host H2d verifier continuation, 2026-11-09

- Extended opt-in `linux-command-v1` reconnect to observe the original verifier grant, execution, readonly claims and frozen candidate. Verifier intents bind candidate/check/receipt timeout; the original verification deadline is never reset or replaced by the work deadline.
- Connected/native-recovered outcomes use the same durable timestamps and output. Receipt publication is deterministic across parent loss before/after persistence. Existing checks never redispatch or rematerialize their workspace; only never-started checks receive new grants.
- Real source CLI survived another parent crash during a subsequent check, excluded a concurrent owner and replayed one reconnect command without advancing generation. Final 19-file matrix: 120 passed, zero skips/failures; protocol 9 passed; Rust 12 plus check/Clippy/fmt/release passed. Root check: exit 0, 588 passed / 30 skipped / 0 failed. LSP clean coverage remained unconfirmed; compiler passed.
- Applied pstack RED/GREEN and direct self-review. No native Rust source/dependency change, provider call, delegation, version change, commit, push, publication or installed-engine activation. See [H2d result](RUST-HOST-02D-RESULT.md).

## Rust host H2e native record retention/GC, 2026-11-09

- Extended explicit `omk run gc` with conservative native-record reporting and deletion. Recoverable/unsettled records, unknown ownership, unprovable termination, orphan/legacy/incomplete data and missing compacted grant provenance stay retained. No automatic sweep or authority epoch/reconciliation change.
- Native records must match the original terminated grant, execution, generation and namespace; both host and namespace must be gone. Private/no-follow/single-link file and retention checks precede deletion. Durable `.gc.jsonl` retirement and payload-last deletion make interrupted cleanup retryable.
- Real source CLI verified GC followed by writer/verifier reconnect, post-GC evidence/artifact/command replay, live-owner exclusion and SIGKILL during retirement. Full matrix: 148 passed across 23 files, no skips/failures. After shared-type extraction, GC 28 passed; protocol 9 and Rust 12 plus check/Clippy/fmt passed. Root check exit 0, 588 passed / 30 skipped / 0 failed.
- Earlier intended REDs, setup/clock-fixture failures and the fixed type import cycle remain recorded in [H2e result](RUST-HOST-02E-RESULT.md). No test timeout or safety gate was weakened. No Rust implementation/dependency change, provider call, delegation, version change, commit, push, publication or installed-engine activation.

## Rust host H2f obsolete native-record cleanup, 2026-11-09

- Added explicit `omk run gc --prune-obsolete` for orphan/legacy 1.5-era native execution records. The opt-in requires terminal data, no live host, no binding digest, gone namespace witness, private complete files and elapsed retention; live/recoverable/bound/shared/invalid records stay untouched.
- Source CLI preview/execute and native authority/GC regressions passed. Root `npm run check`: exit 0, 588 passed / 30 skipped / 0 failed. No default verified-run directory existed, so no real user records were deleted.
- Evidence: [H2f result](RUST-HOST-02F-RESULT.md). No commit, push, version change, installed-engine activation or release.

## Rust host H2g authority compaction provenance, 2026-11-10

- Continued H2f's remaining provenance gap without replacing inherited changes. Authority replay now carries optional `started | revoked` start provenance in retained grants and snapshots. Native reconnect uses that projection instead of rescanning archived event rows. Old snapshots with missing provenance and fully dropped grants remain unavailable; no grant retention or scheduling policy changed.
- Removed duplicate projection assembly and reconnect's mutable revoked flag. The authority module remains within its unchanged 559 pure-LOC ratchet. No Rust implementation or dependency changed.
- Observed RED: ten authority assertions and four actual native/source-CLI reconnect failures. Final 16-file matrix: 102 passed, zero failures/skips. Final cleanup recheck: 42 passed. `npm run check`: exit 0, 588 script tests / 30 skips / 0 failures. LSP clean coverage remained unconfirmed; compiler passed.
- Pstack's verifiable-unit and domain-model principles were applied directly. Unrelated inherited changes were hash-checked; only this run's abandoned terminal test fixture was removed. No provider call, delegation, version change, commit, push, installed-engine activation or release. Setup/umask/cwd failures and remaining limits are recorded in [H2g result](RUST-HOST-02G-RESULT.md).

## Next action

Continue core ownership migration after the bounded writer/verifier reconnect and native-record GC boundary. Start/revocation provenance now survives compaction for retained grants. Retention of settled grants across recoverable crash windows is a separate next scope; completely dropped grants are not reconstructed. Native witness retention, orphan/legacy cleanup policy, DAG/scripted-agent/session reconnect and Rust grant-ledger/scheduler ownership remain separate work. Extend independent R checks when transferring scheduler/budget policies. H1/H2a/H2b/H2c/H2d/H2e are bounded slices, not the full host.

The [Phase 2 artifact failures](phases/02-native-extensions-and-explicit-migration/02-ACCEPTANCE-20261108.md) are resolved. The native default was already switched and candidate `019d076c…` has combined acceptance; unresolved spec-108 criteria remain separate. Changed package inputs require a fresh gate root, not relabeled receipts. The new native consumer has separate evidence because native sources are outside that package gate. Desktop windows/authenticated transport, Rust durable records/reconciliation, platform acceptance and milestone release remain open; phase 2 and the 2.0 milestone are not complete.
