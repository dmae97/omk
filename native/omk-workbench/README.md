# Workbench observation prototype

`omk-workbench-wire` consumes one `omk.run-graph.v1` JSONL snapshot from stdin and
returns its validated typed representation. It is unpublished and opt-in. It does
not launch OMK, create a window, execute commands, call providers or connect to
AdaptOrch. Production remains Node; the N02 fixture is unchanged.

The object-only Serde visitor follows the existing `omk-runtime` implementation.
Top-level and nested arrays-as-objects, duplicate/escaped-equivalent keys, unknown
fields, missing nullable bindings, unsupported versions/states and invalid IDs,
digests, safe-integer counters or dependency graphs fail closed. A frame has at
most 262144 payload bytes and exactly one terminating LF; stdin is bounded before
growth. The executable waits for EOF; its caller owns cancellation and a deadline.
Errors print a fixed message without reflecting any input.

`GraphView` retains one full snapshot and binds run/contract identity. Its cursor
orders both the run journal and authority journal. An authority-only update can
change proof without advancing the run. Older componentwise cursors are ignored;
mixed advancing/regressing cursors, conflicting bindings/content and generation
regression are rejected. Identical observations are duplicates. Full snapshots
can skip revisions. This is not incremental
event replay, host-epoch fencing, authenticated IPC, journal authentication,
execution authority or a correctness proof.

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

See [the wire contract](../../packages/coding-agent/docs/run-graph.md) and
[migration roadmap](../../packages/coding-agent/docs/omk-2-migration.md).
