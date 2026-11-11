# OMK contract crate

Unpublished, dependency-limited Rust crate for spec 120 stage K0: the single
source of truth for the session JSONL, public RPC and extension-host wire types,
and for the `omk+pi` compatibility tables.

Nothing in production imports or launches this crate. It is not an agent,
execution host, scheduler or SDK. The Node core remains the production owner.

## Contract

- Schema types and compatibility tables are being moved here. TypeScript wire
  declarations are generated from this crate (T009); generating the Node
  compatibility tables is still pending (T004).
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

Stage K0 units T001, T002, T003, T005, T006, T007, T008 and T009 are complete:
toolchain, crate skeleton, compatibility tables, synthetic fixtures, session/public
RPC contracts, extension-host wire types and their TypeScript declarations. K0 as a
whole is not complete.

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
- Declarations describe JSON shapes only. They do not validate input at runtime,
  and they do not cover the T004 compatibility tables.

`tests/fixtures` contains ten data files. The recorder's `--check` mode freshly
records G0 and RPC and compares the seven copied session-equivalence goldens as
archived synthetic records, not fresh behavior/parity evidence. It also checks
manifest hashes and inventory; it does not overwrite the stored fixtures.

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
- Tests compare all 24 G0 records and the complete JSONL byte for byte. Six
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
is added. CI integration remains a separate task. Native
macOS/Windows acceptance remains unverified. Remaining tasks are in
`specs/120-rust-core/tasks.md`.
