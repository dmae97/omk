# omk-safety

Native Rust safety/sandbox probe for OMK (725 LOC: `src/lib.rs` + `src/main.rs`).

## Purpose

Deterministic, dependency-light validation primitives that back OMK's runtime
safety surfaces:

- run-id validation/sanitization (`validate-run-id`, `sanitize-run-id`)
- run-artifact path containment (`validate-artifact-path`,
  `validate-run-artifact`, `resolve-run-artifact`)
- theme snapshot/ASCII/glyph surfaces (`theme-snapshot`, `theme-list`,
  `theme-ascii`, `theme-glyphs`)
- a built-in `self-test` that exercises every check and prints
  `{ "ok": true, "checks": <n> }` JSON

A pure-TypeScript fallback (`src/util/native-safety.ts` at the repo root)
mirrors this behavior when the native binary is unavailable, so the binary is
an acceleration/hardening layer, not a hard dependency.

## Build

```bash
npm run native:build
# = scripts/build-native.mjs
#   → cargo build -p omk-safety --release
#   → copy target/release/omk-safety to dist/native/<platform-arch>/omk-safety
#   → chmod 755 (non-Windows)
#   → run `omk-safety self-test` and fail the build unless ok=true
```

Supported targets are gated in `scripts/build-native.mjs`; unsupported
platform/arch combinations fail fast instead of shipping an untested binary.

## Self-test

```bash
./target/release/omk-safety self-test
# {"ok":true,"checks":<n>}
```

`scripts/build-native.mjs` runs this automatically after every build and
rejects any output where `ok !== true` or `checks` is not a number.

## Milestone / policy

- Keep this crate as the native sandbox/safety probe for OMK.
- `publish = false` in `Cargo.toml`: never published to crates.io; it ships
  only as a compiled artifact at `dist/native/<platform-arch>/omk-safety`
  inside the npm package.
