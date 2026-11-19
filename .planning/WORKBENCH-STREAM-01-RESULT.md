# v2 continuation: bounded native observation stream, 2026-11-08

## Scope and current state

The checkout had advanced since the 2026-11-06 memory report. The four stale
`dist/core/subscription-usage-cache.*` files were already absent. The existing
source-derived prune dry-run found zero stale outputs, and its regression tests
passed. No additional dist file or other session's artifact was deleted.

The existing packaged Node, compiled Bun, installed declarations and source-group
receipts bind candidate
`019d076c9ed4350ebf7454b09579be7b3e4ad6448d894f661e1c3ea63912f58c`.
The current checkout's package-input fingerprint matches. Verification first
correctly rejected execution from the wrong checkout origin; invoking the gate
from its recorded `.worktrees/verify-buncjs-20261108` origin then revalidated
source, installed bytes, binary, declarations, logs and all source groups, exit 0.
No receipt was relabeled and no old artifact was rebuilt or modified.

The added Rust workbench sources are outside the seven-package gate's input
scope. They have their own new binary and acceptance evidence below. The package
fingerprint still matched after implementation. This does not add the Rust
workbench to an npm tarball or certify a desktop installer.

## Implementation

- `native/omk-workbench/src/stream.rs`: `consume_stream`, bounded per-frame reading,
  a single current `GraphView`, direct serialization and flush-before-next-read.
- `native/omk-workbench/src/main.rs`: explicit `--stream`; unchanged default
  one-frame/EOF contract and sanitized error output.
- `native/omk-workbench/src/lib.rs`: exports the stream consumer for a future
  desktop-owned reader/writer.
- `native/omk-workbench/tests/stream.rs`, `stream_bounds.rs`: actual executable
  streaming before EOF, stale/duplicate filtering, authority updates, error
  boundaries, lazy multi-frame input and output failure.
- `native/omk-workbench/tests/source-cli.mjs`: actual source Node CLI observations
  consumed by one persistent native executable. The synthetic run used the
  separately built Rust execution host via `OMK_RUST_EXECUTION_HOST`.
- Native README and planning state: exact usage, acceptance and unresolved scope.

A valid frame is at most 262144 payload bytes plus LF. The parser consumes no
more than that limit before rejecting an unterminated/oversize frame. The buffer
is reused; there is no accumulated transcript, background reader or output queue.
Temporary typed objects and reader/writer-owned buffers still allocate memory.
Synchronous I/O applies backpressure; the caller owns deadlines and cancellation.

Only identical and componentwise stale full observations are omitted. Authority
changes at the same run revision still emit. Conflicts, mixed-order regression,
invalid framing and I/O errors fail closed. No execution/grant/control capability
is added, and previously emitted observations do not certify a later failed stream.

## Observed acceptance

Evidence root:
`/mnt/omkdata/tmp/opencode/omk-v2-continuation-20261108-LYNEU1/`.

| Command/gate | Result |
| --- | --- |
| `node scripts/prune-dist-orphans.mjs packages/coding-agent --dry-run` | Exit 0, zero stale outputs |
| `node --test scripts/test/prune-dist-orphans.test.mjs` | Exit 0 |
| Existing package gate `verify` from its exact original checkout | Exit 0; all Node/Bun/types/source receipts and artifact hashes verified |
| Rust stream RED, `cargo test ... --test stream` | Exit 101; two intended behavior assertions failed, old one-shot control passed |
| `cargo test --offline --locked --manifest-path omk-workbench/Cargo.toml` | Exit 0; 16 tests, zero skipped/ignored |
| Cargo `check`, `clippy --all-targets -- -D warnings`, `fmt --check`, release build | All exit 0 |
| New source-CLI integration under explicitly selected Rust execution host | Exit 0; one real process test, zero skipped |
| Existing `workbench-run-graph-wire.test.ts` with the newly built release binary | Exit 0; one test, zero skipped; original malformed-input controls preserved |
| Final `npm run check` | Exit 0; 588 script tests passed, 30 skipped, zero failures, compiler and browser smoke stage completed |

The initial root-check attempt hit its 300-second tool deadline after the script
tests and preceding guards. It was not recorded as a pass. A sequential retry with
a 900-second command budget completed in 5:01.83. No test timeout or assertion was
weakened. No owned check process remained after the timed-out attempt.

Cargo ran with one build job and one test thread, verified copies of all eleven
locked archives/extracted sources, private Cargo home and target, read-only
source/toolchain and a network-disabled bubblewrap sandbox. No dependencies were
installed or upgraded. The root check used two CPUs, `GOMAXPROCS=2` and a 4096 MiB
Node heap cap. All heavy commands ran sequentially.

## Resource observations

- GNU time reported a maximum RSS of 2,713,500 KiB for the root check and 206,476 KiB
  for the Node/native integration. These are rusage maxima, not a simultaneous
  process-tree total or a hard whole-machine memory limit.
- Direct release-binary synthetic streams of 2,000 and 50,000 monotonically newer
  empty-graph snapshots completed with exit 0 and empty stderr. Maximum RSS was
  1,956 KiB and 2,184 KiB respectively. Input was generated lazily and output went
  to `/dev/null`, so no transcript was retained by the harness.
- This is evidence against transcript-proportional growth on that synthetic case,
  not a production GUI memory benchmark, an A/B savings claim or a universal cap.
- Cargo resource files measure the sandbox launcher and are not used as compiler
  RSS claims because descendant accounting across the namespace is incomplete.

## Direct review and remaining work

Reviewed framing limits, immutable execution capabilities, both journal cursors,
flush/write failure handling, original one-shot compatibility and child cleanup.
No new correctness blocker was found in the scoped implementation. The new
streaming integration removes its temporary workspaces and kills/waits only its
own child on failure. Evidence, source hashes and owned build outputs are retained.

This advances the native desktop's observation input and its Rust consumer; it
is not an Orbit/GPUI window, authenticated/reconnectable transport, durable Rust
execution ledger or full U1/H2 acceptance. Those remain open. The existing H1
supervisor, Node approval/grant ownership, installed engine and version 1.5.10
remain unchanged. No commit, push, publication, global activation or milestone
completion was performed.

Next implementation boundaries: Rust durable execution records and reconciliation
with no double-dispatch, then desktop-owned transport/window wiring using reviewed
GPUI dependencies. R acceptance expands only when a numerical policy is moved;
this observation stream introduces no numerical policy.

Proposed commit, not created:
`feat(workbench): 메모리 상한을 둔 지속 관측 스트림 추가`
