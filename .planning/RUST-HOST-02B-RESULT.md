# H2b terminal durability continuation — 2026-11-09

## Scope and starting point

Continued the owner-requested OMK 2.0 Rust migration using the installed project
pstack verification-unit/TDD workflow and the real OMK source engine. Work stayed
in the root agent. No delegated model, installation, activation, version change,
commit, push or publication occurred.

HEAD at entry was `48fb8e33a84d01fde163091ed36a8bca981d3bbe`, with extensive existing
uncommitted work. H2a termination witnesses and partially implemented H2b records,
wire-level detachable execution and a record observer already existed. This change
does not claim those earlier additions as newly authored work. Their production
broker records dispatches, but does not select detachable execution or call the
reattach helper automatically.

The bounded deliverable is a durable terminal boundary, not complete H2b recovery:

- `native/omk-execution/src/supervisor.rs`: sync the terminal record before sending
  `finished`; persist output for every committed detachable execution, regardless
  of whether parent loss was observed; do not append detachment after terminal.
- `native/omk-execution/src/record.rs`: correct the output persistence contract.
- `packages/coding-agent/src/core/verified-run/rust-host-record.ts`: accept bounded
  output for committed attached terminals as well as detached terminals. Still
  reject pre-commit output, detached terminals without output and malformed data.
  Document the existing recovery timestamp estimate for the clock guard.
- `packages/coding-agent/test/verified-run-rust-host-durability.test.ts`: new real
  host fault-injection and attached-outcome recovery tests, with no fake executor.
- `packages/coding-agent/test/verified-run-rust-host-record.test.ts`: update the
  intended attached-output contract and preserve a negative missing-output case.
- `native/omk-execution/README.md` and
  `packages/coding-agent/docs/rust-execution-host.md`: document current owners,
  staging limits, timestamp semantics and executable acceptance.

## RED and GREEN

The first test attempt raced creation of the accepted record and produced an
unrelated `missing_record` failure. It is not counted as the intended RED. The
test now waits for the real `ready` event before inspecting the commit.

The corrected pre-change run failed both tests for their intended reasons:

1. After the real native commit, `prlimit --pid=<owned host> --fsize=0:0` prevents
   terminal persistence without affecting the already-spawned sandbox. The old
   supervisor nevertheless emitted `finished` before the write failed.
2. A detachable host whose first parent received all events retained no durable
   output. Recovering the result failed with `outcome_unknown`.

After the fix, both tests pass: failed persistence emits no `finished`; a committed
attached record recovers its full output without another execution. A repeated
observation against a read-only record leaves its bytes unchanged. The record
parser's newly legal attached-output shape is intentional, not a weakened
requirement to make an unrelated test pass.

## Observed verification

Evidence root:
`/mnt/omkdata/tmp/opencode/omk-rust-record-20261109-01a1be6d/`

Cargo commands used `bash "$WORK/cargo.sh"`, a network-disabled bwrap container
with cleared environment, read-only source/toolchain, an isolated cache and
external target directory. No dependency or lock change. Cargo used one build job
and tests used one thread. The source CLI used private test HOME/agent/workspace
paths and synthetic local commands, without provider calls.

| Check | Result |
|---|---|
| `cargo build --release --offline --locked --manifest-path omk-execution/Cargo.toml --bins` | Exit 0; fresh native binary |
| `cargo test --offline --locked --manifest-path omk-execution/Cargo.toml -- --test-threads=1` | Exit 0; 11 passed, zero ignored |
| `cargo check --offline --locked --manifest-path omk-execution/Cargo.toml` | Exit 0 |
| `cargo clippy --offline --locked --manifest-path omk-execution/Cargo.toml --all-targets -- -D warnings` | Exit 0 |
| `cargo fmt --manifest-path omk-execution/Cargo.toml --check` | Exit 0 |
| Actual-binary ten-file Node matrix | Exit 0; 62 passed, zero skipped |
| Final focused record/durability tests, after adding the missing-output negative case | Exit 0; 16 passed, zero skipped |
| `node "$WORK/cli-smoke.mjs"` | Exit 0; real source `run plan/start/artifact/events`, two dispatches, verified artifact, unchanged base workspace |
| `NODE_OPTIONS=--max-old-space-size=4096 taskset -c 0,1 npm run check` | Final exit 0, including root typecheck and repository guards |

The Node matrix command, from `packages/coding-agent`, was:

```sh
EXECUTION_HOST_TEST_BINARY="$WORK/target/release/omk-execution-host" \
  node ../../node_modules/vitest/dist/cli.js --run --maxWorkers=1 \
  test/verified-run-rust-host.test.ts \
  test/verified-run-rust-host-protocol.test.ts \
  test/verified-run-rust-host-binding.test.ts \
  test/verified-run-rust-host-record.test.ts \
  test/verified-run-rust-host-durability.test.ts \
  test/verified-run-native-witness.test.ts \
  test/verified-run-authority-wiring.test.ts \
  test/verified-run-authority-restart.test.ts \
  test/verified-run-cancel-resume.test.ts \
  test/verified-run-writer-restart.test.ts
```

The final focused command used the same binary/runner options and only the record
and durability test files. It adds one parser case to the earlier matrix; the two
counts overlap and must not be summed. Root check initially stopped at the existing
record helper's recovery-date subtraction. Its explanatory wall-clock annotation
now sits on that expression; no deadline, clock policy or guard was weakened.
Root check has an unrelated informational `useTemplate` finding in
`spec066-mcp-output-cap.test.ts`, which was left untouched.

The active LSP probe did not confirm clean coverage: four files were inconclusive,
and the parser had three advisory AST hints about boundary decoding. Actual Cargo
check, Clippy and root TypeScript checking passed. No blanket LSP-clean claim.
R policy code and budgets were not changed; R-specific root cases remain skipped
without `OMK_RSCRIPT`, not new mathematical acceptance. No full build/suite or
packaged Node/Bun artifact acceptance was rerun.

## Self-review and next unit

Direct review checked persist-before-deliver ordering, termination before record,
no post-terminal append on disconnect, unchanged bounded output, immutable
observation, failed persistence and absence of fallback dispatch. Original dirty
hunks were preserved; source snapshots and a scoped diff are in the evidence root.

Still required before production reconnect:

- Bind recovery to the original durable grant, run generation and namespace,
  with fresh owner/epoch fencing. Never use a record as permission to dispatch.
- Bind host liveness to boot identity, not only PID/start ticks. Prove stale-owner
  and lost-host behavior through a real restarted coordinator.
- Preserve original execution timestamps if recovery output becomes user-facing;
  the current helper labels observation time and estimates the start from duration.
- Integrate recovered outcome settlement and candidate verification without a
  second writer, deadline reset or budget refund.

The native desktop, Windows/macOS acceptance, full Rust scheduling/grant ownership
and milestone release remain open. Versions and installed engine remain 1.5.10.
Suggested commit message: `fix: Rust 실행 결과를 완료 통지 전에 영속화`.
