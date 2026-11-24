# OMK contract crate

Unpublished, dependency-limited Rust crate for spec 120 stage K0: the single
source of truth for the session JSONL, public RPC and extension-host wire types,
and for the `omk+pi` compatibility tables.

Nothing in production imports or launches this crate. It is not an agent,
execution host, scheduler or SDK. The Node core remains the production owner.

## Contract

- Schema types and compatibility tables are being moved here. TypeScript wire
  declarations (T009) and the Node core's `pi-compat.ts` runtime table (T004)
  are generated from this crate.
- Round-trip gates use synthetic fixtures only. No real session, credential,
  prompt or user path enters the repository.
- Dependencies are limited to `serde` and `serde_json`, pinned with `=`, matching
  the other `native/` crates. The `serde_json` `raw_value` feature preserves
  serialized field values without adding a dependency or changing a lockfile.

## Checks

```sh
cargo check --offline --locked --manifest-path native/omk-contract/Cargo.toml
cargo test --offline --locked --manifest-path native/omk-contract/Cargo.toml --test roundtrip session
cargo test --offline --locked --manifest-path native/omk-contract/Cargo.toml --test roundtrip rpc
cargo test --offline --locked --manifest-path native/omk-contract/Cargo.toml
cargo clippy --offline --locked --manifest-path native/omk-contract/Cargo.toml --all-targets -- -D warnings
cargo fmt --manifest-path native/omk-contract/Cargo.toml --check
```

The repository pins Rust 1.99.0 in the root `rust-toolchain.toml`.

## Status

Stage K0 units T001 to T012 are locally complete under decision I1: toolchain, crate skeleton,
compatibility tables and their generated Node copy, synthetic fixtures,
session/public RPC contracts, extension-host wire types and their TypeScript
declarations, capability matrix, native checks and the approved G0 baseline
refresh. Fresh recording now matches the reviewed corpus. See [K0 verification](../../packages/coding-agent/docs/omk-2-rust-core.md#k0-status-and-verification-2026-11-12).

### T004 compatibility table

- `omk-contract-gen` also prints the compiled compatibility values: dialects,
  default dialect, targets, the 14 aliases, the classifier namespaces and
  packages, and the hint text. They come from the constants in `compat.rs`, not
  from parsing its source.
- `scripts/contracts/compat-table.mjs` renders
  `packages/coding-agent/src/core/pi-compat.ts` from those values. The alias table
  keeps its namespace-times-suffix form, so `scripts/pi-inventory.mjs` reads it
  unchanged. A table that form cannot express, an unknown target or an unsafe
  name stops generation.
- `node scripts/check-contract-drift.mjs` fails on a hand edit of that file. The
  regenerated body equals the pre-T004 source byte for byte; only the two-line
  generated header was added.

### T009 TypeScript declarations

```sh
node scripts/generate-contracts.mjs --write   # regenerate after a contract change
node scripts/check-contract-drift.mjs         # read-only; fails on any difference
```

- `omk-contract-gen` is compiled with the crate and prints the exact source files
  it was built from. The Node emitter reads that catalog, so declarations follow
  the compiled sources rather than a hand-maintained list.
- Output is `packages/protocol/src/generated/rust-contracts/`: one type-only file
  per Rust module, re-exporting from `wire.generated.ts`. The flat file keeps the
  mutually recursive RPC and session modules free of import cycles. Nothing is
  exported from the `omk-protocol` package root and no runtime code changes.
- The emitter reads a bounded subset of Rust and serde. Unknown syntax, attributes
  or types stop generation instead of guessing a wire shape. Hand-written serde
  implementations are pinned by digest in `scripts/contracts/serde-adapters.json`;
  changing one fails generation until the adapter mapping is reviewed.
- Declarations describe JSON shapes only. They do not validate input at runtime.
  The runtime compatibility table is the separate T004 output above.

`tests/fixtures` contains ten data files. The recorder's `--check` mode freshly
records G0 and RPC and compares the seven copied session-equivalence goldens as
archived synthetic records, not fresh behavior/parity evidence. It also checks
manifest hashes and inventory; it does not overwrite the stored fixtures.
The recorder freezes the reviewed input work-path width at 45 UTF-16 code units,
so changing the temporary parent cannot change faux token estimates or cache
boundaries before textual path normalization. It shortens/pads only the random
work-directory prefix, never recorded numeric values. The RPC driver also uses a separate per-run package alias with the reviewed
46-code-unit width instead of the checkout path. Both aliases point at the actual
candidate files; no usage or cache values are rewritten. The selected temporary
parent must be absolute and at most 34 code units long for both inputs to fit;
otherwise recording fails with an instruction to set a shorter
`TMPDIR`/`TEMP`/`TMP`. Native platform acceptance remains separate. See [the drift investigation](../../specs/120-rust-core/k0-fixture-drift.md).

### T006 session contract

- `session.rs`: header, all nine entry variants, required nullable `parentId`,
  optional fields and opaque extension data, including explicit JSON null.
- `session_message.rs`: provider messages, coding-agent messages, content blocks
  and extension-defined roles. Invalid known roles cannot fall back to opaque data.
- `session_jsonl::SessionRecord`: validates each record into `FileEntry` and
  reserializes ordered raw field values. Its typed view is immutable. This keeps
  the compact G0 JSONL's field order, nested payloads, numbers and escapes intact.
  Use `into_entry()` then `from_entry()` to change typed data; new records use
  serde field order. Arbitrary outer whitespace is not a byte-preservation promise.
- Tests compare all 20 I1-approved G0 records and the complete JSONL byte for byte.
  A separate legacy-marker test preserves decoding of old sessions. Six
  archived scenarios contribute 22 `trace.entries`: tests explicitly replace
  numeric message timestamp sentinel `<T>` with `0` in memory, then check compact
  typed projections. The seventh golden is metrics-only and has no session entries.
  These projection checks do not claim original archive-byte or runtime parity.

### T007 public RPC contract

- `rpc.rs` exposes `RpcInput`, `RpcOutput`, `RpcMessage` and `RpcRecord`.
  The `rpc_*.rs` modules define 29 commands, command-specific success payloads,
  errors (including unknown command names), state/models/statistics, extension UI
  requests/responses and session/provider/assistant-stream events.
- Optional properties distinguish absence from null. The two nullable cycling
  responses require a `data` key, even when its value is null. UI responses
  require a correlation id and at least one valid value/confirmed/cancelled field.
- Known fields are typed; arbitrary tool arguments/results, extension details,
  unknown fields and provider-specific compatibility objects are retained.
  These are wire shapes, not dispatch, retry, task-result or authorization logic.
- Tests replay all 35 stored transcript rows (4 input, 31 output), with direction
  checks and byte-identical output. Numeric `durationMs` stays numeric; replay
  performs no additional normalization or fixture regeneration. Synthetic cases
  cover the other commands/responses, all nine UI methods, event/stream variants,
  invalid shapes and typed edits. Command/UI method inventories are checked
  against the current TypeScript source.
- Session and RPC records share `jsonl.rs`. `SessionRecord` remains an alias with
  its existing API and behavior; all eight T006 tests remain unchanged and pass.

No session migration, persistence, recovery, RPC transport or production caller
is added. T011 integrated CI: the contract crate passed on Linux, macOS and
Windows at `09b6389aac` in run 42988270672. This is K0 crate evidence, not
headless-core platform acceptance; the overall CI run failed. I1's updated fixture
and legacy-marker test were subsequently checked locally on Linux only. Remaining tasks
are in `specs/120-rust-core/tasks.md`.
