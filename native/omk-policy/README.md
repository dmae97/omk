# Finite DAG policy prototype

Unpublished, dependency-free Rust port of the existing TypeScript tool-DAG
reduction and closure-allocation decision. Nothing in production imports or
launches this crate. It is not a scheduler, execution host, authority service or
replacement for `omk-workbench-wire` or the N02 fixture.

## Contract

- At most 16,370 nodes and 1,000,000 input edges, in fixed topological order.
- Each predecessor row is unique, ascending and strictly earlier than its node.
- Closure budget: integer bytes from zero through 16,777,216 inclusive.
- Preserve exact reachability with a minimal subgraph and ascending output rows.
- Preserve the TypeScript `already-reduced`, `bitset` and `traversal` decisions.
- Matrix-allocation failure falls back to exact traversal, not partial output.
- The closure budget does not bound total memory, input allocation or process life.

Typed inputs do not model JavaScript sparse arrays, negative `usize`, NaN or
fractional values. The fixture executable additionally bounds each TSV file to
16 MiB and rejects noncanonical unsigned integer strings. No float tolerance or
cross-language random seed is used. Allocation-failure injection is not covered.

## Verification

Use an external `CARGO_TARGET_DIR`, an isolated Cargo/home directory and an
offline, read-only-source sandbox. This crate has no dependency build scripts,
procedural macros, network calls or third-party runtime dependencies. `--offline`
alone is not a sandbox.

```sh
cargo test --offline --locked --manifest-path native/omk-policy/Cargo.toml
cargo clippy --offline --locked --manifest-path native/omk-policy/Cargo.toml -- -D warnings
cargo fmt --manifest-path native/omk-policy/Cargo.toml --check
cargo build --offline --locked --manifest-path native/omk-policy/Cargo.toml --bin policy-fixtures
```

See [the cross-language gate](../../packages/coding-agent/docs/policy-parity.md).
It requires actual R verification and exact Rust output for the same existing
2,214 DAG and 16 allocation cases. WPL remains TypeScript/R only. These bounded
checks establish neither execution ownership nor a general proof or release gate.
