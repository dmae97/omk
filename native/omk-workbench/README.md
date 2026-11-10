# Workbench observation prototype

`omk-workbench-wire` consumes `omk.run-graph.v1` JSONL snapshots from stdin and
returns validated typed observations. The default consumes exactly one frame;
`--stream` consumes successive full snapshots without waiting for EOF. It is
unpublished and opt-in. It does not launch OMK, create a window, execute commands,
call providers or connect to AdaptOrch. This observation consumer does not replace
the Node control plane or the separate opt-in Rust execution supervisor. The N02
fixture is unchanged.

The object-only Serde visitor follows the existing `omk-runtime` implementation.
Top-level and nested arrays-as-objects, duplicate/escaped-equivalent keys, unknown
fields, missing nullable bindings, unsupported versions/states and invalid IDs,
digests, safe-integer counters or dependency graphs fail closed. A frame has at
most 262144 payload bytes and exactly one terminating LF; stdin is bounded before
growth. The default executable waits for EOF. Both modes leave cancellation and
deadlines to the caller. Errors print a fixed message without reflecting any input.

`GraphView` retains one full snapshot and binds run/contract identity. Its cursor
orders both the run journal and authority journal. An authority-only update can
change proof without advancing the run. Older componentwise cursors are ignored;
mixed advancing/regressing cursors, conflicting bindings/content and generation
regression are rejected. Identical observations are duplicates. Full snapshots
can skip revisions. This is not incremental
event replay, host-epoch fencing, authenticated IPC, journal authentication,
execution authority or a correctness proof.

## Persistent observation stream

```sh
/path/to/omk-workbench-wire --stream < snapshots.jsonl
```

The stream holds one `GraphView` and one reusable bounded input frame. It parses
at most 262145 bytes per frame, serializes directly to the writer and flushes each
installed observation before reading the next. It does not retain a transcript or
add an output queue. Temporary decoded snapshots and the reader/writer's own
buffers still consume memory; this is not a whole-process heap ceiling.

Identical and componentwise stale snapshots produce no output. Authority-only
updates are installed and emitted even at an unchanged run revision. Binding
conflicts, mixed cursor regressions, malformed/oversize frames, truncated EOF and
I/O errors terminate the stream. Valid observations already emitted before an
error remain observations, not a successful whole-stream receipt. Empty input
fails; EOF after complete frames succeeds. Unknown or repeated options fail.

Synchronous output applies backpressure before another frame is read. A caller
whose writer blocks must enforce its own timeout or terminate its owned child;
there is no hidden reader thread to keep accumulating input. The Rust library
exposes `consume_stream` for the same bounded path. A desktop can feed it snapshots
from an owned transport, but authentication, durable reconnect, control messages
and the actual native window are separate work. This is not event replay or a
completed U1 desktop.

## Verification

Use an isolated public Cargo cache, external target directory, cleared environment
and network-disabled sandbox for dependency build scripts/procedural macros, as
for the sibling native fixture. `--offline` is not a sandbox. The lock uses the
same pinned Serde/serde_json dependency graph as that fixture, without adding GPUI
or downloading packages. This crate carries its own
[dependency notices](THIRD-PARTY-NOTICES.md), including Unicode-3.0 terms; it does
not require the sibling fixture's untracked files for redistribution notices.

Scoped gates: `cargo test --offline --locked`, `cargo check --offline --locked`,
`cargo fmt --check`, `cargo clippy --offline --locked -- -D warnings` and a binary
build with an external `CARGO_TARGET_DIR`. Actual Node CLI/Rust interoperability
is tested from the coding-agent package with an explicit `WORKBENCH_TEST_BINARY`
binary path; it is not established by Rust unit tests alone.

The standalone source-CLI streaming integration test requires both the existing
Node test dependencies and an explicitly built workbench binary:

```sh
WORKBENCH_TEST_BINARY=/path/to/omk-workbench-wire \
  node --import tsx --test --test-concurrency=1 native/omk-workbench/tests/source-cli.mjs
```

Optionally set `OMK_RUST_EXECUTION_HOST` to the separately built, owner-controlled
execution host to run the synthetic fixture's writer/verifier under Rust. The test
owns temporary workspaces, executes only the fixture commands, consumes real
`omk run graph` output, checks authority-only changes before EOF and verifies that
reading observations leaves the run journal unchanged. Missing workbench binary
configuration fails this test rather than silently skipping it.

See [the wire contract](../../packages/coding-agent/docs/run-graph.md) and
[migration roadmap](../../packages/coding-agent/docs/omk-2-migration.md).
