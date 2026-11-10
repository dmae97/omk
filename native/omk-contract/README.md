# OMK contract crate

Unpublished, dependency-limited Rust crate for spec 120 stage K0: the single
source of truth for the session JSONL, public RPC and extension-host wire types,
and for the `omk+pi` compatibility tables.

Nothing in production imports or launches this crate. It is not an agent,
execution host, scheduler or SDK. The Node core remains the production owner.

## Contract

- Schema types and compatibility tables are defined here once. TypeScript
  copies are generated from this crate; hand edits fail the drift check.
- Round-trip gates use synthetic fixtures only. No real session, credential,
  prompt or user path enters the repository.
- Dependencies are limited to `serde` and `serde_json`, pinned with `=`, matching
  the other `native/` crates.

## Checks

```sh
cargo check --locked --manifest-path native/omk-contract/Cargo.toml
cargo test --locked --manifest-path native/omk-contract/Cargo.toml
cargo clippy --locked --manifest-path native/omk-contract/Cargo.toml -- -D warnings
cargo fmt --manifest-path native/omk-contract/Cargo.toml --check
```

The repository pins Rust 1.99.0 in the root `rust-toolchain.toml`.

## Status

Stage K0 units T001, T002, T003 and T008 are complete: the toolchain pin, the
crate skeleton, the compatibility tables and the extension-host wire types
(`src/host_wire.rs`, ten tests covering the 28 events, the 24 API methods, the
specifier map, the version check, the frame bound and host-loss disposition).
Later units (generator, fixtures, wire types, capability matrix, CI) are tracked
in `specs/120-rust-core/tasks.md`.
