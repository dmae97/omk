# Tasks: Rust core, stage K0 (contracts)

**Input**: [spec.md](spec.md), [plan.md](plan.md), [decisions.md](decisions.md)
**Output**: task list with execution metadata

Each task ends in a state its `verify` command checks. A task that adds behavior writes the
failing test first and records the failure before the fix. Checkboxes record completed units,
not completion of K0 or platform acceptance.

In `verify`, `CARGO_K0` stands for `--locked --manifest-path native/omk-contract/Cargo.toml`.

## Phase 1: Scaffold

- [x] T001 Pin the Rust toolchain at 1.99.0 in `rust-toolchain.toml`
  > role: coder
  > deps: none
  > files: [`rust-toolchain.toml`]
  > verify: `cargo --version` prints 1.99.0 from the repository root, and the four existing crates still pass `cargo test --offline --locked`
  > gate: command-pass
  > risk: low

- [x] T002 Create the `native/omk-contract` crate with `serde` and `serde_json` pinned to the versions the existing crates use
  > role: coder
  > deps: T001
  > files: [`native/omk-contract/Cargo.toml`, `native/omk-contract/Cargo.lock`, `native/omk-contract/src/lib.rs`, `native/omk-contract/README.md`, `native/omk-contract/THIRD-PARTY-NOTICES.md`]
  > verify: `cargo check CARGO_K0`
  > gate: command-pass
  > risk: low

## Phase 2: Compatibility tables (spec §5a)

- [x] T003 Define the dialect values, the 14-entry alias table, the legacy-import classifier and the migration hint in Rust, test-first against the values in `packages/coding-agent/src/core/pi-compat.ts`
  > role: coder
  > deps: T002
  > files: [`native/omk-contract/src/compat.rs`, `native/omk-contract/tests/compat.rs`]
  > verify: `cargo test CARGO_K0 --test compat`
  > gate: command-pass
  > risk: low

- [x] T004 Generate the Node core's compatibility tables from the crate and add the drift check. Unblocked on 2026-11-11 once `pi-compat.ts` had no uncommitted changes
  > role: coder
  > deps: T003
  > files: [`native/omk-contract/src/compat.rs`, `native/omk-contract/src/bin/omk-contract-gen.rs`, `native/omk-contract/tests/compat.rs`, `scripts/contracts/compat-table.mjs`, `scripts/contracts/typescript.mjs`, `scripts/check-contract-drift.mjs`, `scripts/generate-contracts.mjs`, `scripts/test/compat-table.test.mjs`, `packages/coding-agent/src/core/pi-compat.ts`, `packages/protocol/src/generated/rust-contracts/manifest.json`]
  > result: the regenerated body equals the pre-T004 source byte for byte; the only diff is the two-line generated header. A hand edit fails the drift check. `pi-inventory --check` is unchanged
  > metric: PA2 table drift
  > baseline: `pi-compat.ts` at the commit that lands this task
  > target: regeneration produces no diff
  > regression-floor: zero differing lines
  > verify: `node scripts/check-contract-drift.mjs && npm run check`
  > evidence: script exit status in the pull request
  > gate: command-pass
  > risk: medium

## Phase 3: Wire and session types

- [x] T005 Record synthetic session and RPC fixtures from the TypeScript implementation with the offline faux provider. This task adds no Rust
  > role: coder
  > deps: T002
  > files: [`scripts/record-contract-fixtures.mjs`, `native/omk-contract/tests/fixtures/`]
  > verify: `node scripts/record-contract-fixtures.mjs --check`, and a search of the fixtures finds no home path, credential or prompt text
  > gate: command-pass
  > risk: medium

- [x] T006 [P] Define the session JSONL types and round-trip every session fixture
  > role: coder
  > deps: T005
  > files: [`native/omk-contract/src/session.rs`, `native/omk-contract/src/session_message.rs`, `native/omk-contract/src/session_jsonl.rs`, `native/omk-contract/src/lib.rs`, `native/omk-contract/Cargo.toml`, `native/omk-contract/tests/roundtrip.rs`, `native/omk-contract/README.md`]
  > metric: RC1 round trip, sessions
  > baseline: unchanged T005 v2 corpus, recorded at `437ae8fdf7` with source digest in `tests/fixtures/manifest.json`
  > target: all 24 G0 JSONL records re-encode byte-identically; six archived scenarios replay 22 typed trace-entry projections with explicit `<T>` numeric timestamp normalization, not raw archive-byte parity
  > coverage: header, all nine entry kinds, known/extension message roles, unknown fields, explicit null, malformed inputs; the metrics-only seventh archive has no session entries
  > dependency: enable existing pinned serde_json's `raw_value` feature only; no new dependency or lockfile change
  > regression-floor: zero differing fixtures
  > verify: `cargo test CARGO_K0 --test roundtrip session`
  > evidence: test output in the pull request
  > gate: command-pass
  > risk: high

- [x] T007 [P] Define the public RPC wire types and round-trip every RPC fixture
  > role: coder
  > deps: T005
  > files: [`native/omk-contract/src/rpc*.rs`, `native/omk-contract/src/jsonl.rs`, `native/omk-contract/src/session_jsonl.rs`, `native/omk-contract/src/lib.rs`, `native/omk-contract/tests/roundtrip.rs`, `native/omk-contract/tests/support/rpc_*.rs`, `native/omk-contract/README.md`]
  > metric: RC1 round trip, RPC
  > baseline: unchanged T005 v2 RPC transcript at `437ae8fdf7`, source/fixture digests in `tests/fixtures/manifest.json`
  > target: all 35 transcript rows re-encode to the same bytes, with 4 input and 31 output messages independently checked against their directional types
  > coverage: 29 command/success/error shapes, state/data, nine UI methods, UI response guards, session/provider/assistant-stream events, unknown fields, nullable versus omitted data and malformed inputs; command/UI inventories match current TypeScript source
  > preservation: existing session tests unchanged; shared JSON record implementation keeps T006 behavior; no fixture, dependency or lockfile changes
  > regression-floor: zero differing fixtures
  > verify: `cargo test CARGO_K0 --test roundtrip rpc`
  > evidence: test output in the pull request
  > gate: command-pass
  > risk: high

- [x] T008 Define version 1 of the extension-host wire: handshake, frame bound, the 28 events, the 24 API methods, the specifier map and host-loss reporting. Types and bound tests only, no transport
  > role: architect
  > deps: T003
  > files: [`native/omk-contract/src/host_wire.rs`, `native/omk-contract/tests/host_wire.rs`]
  > verify: `cargo test CARGO_K0 --test host_wire`
  > gate: command-pass
  > risk: high

- [x] T009 Generate TypeScript declarations for T006 to T008 and extend the drift check to them
  > role: coder
  > deps: T004, T006, T007, T008
  > files: [`native/omk-contract/src/bin/omk-contract-gen.rs`, `native/omk-contract/tests/generator.rs`, `scripts/generate-contracts.mjs`, `scripts/check-contract-drift.mjs`, `scripts/contracts/`, `scripts/test/check-contract-drift.test.mjs`, `scripts/test/contract-declarations.test.mjs`, `packages/protocol/src/generated/rust-contracts/`]
  > scope: wire declarations only. When T009 landed T004 was still blocked; T004 has since added `pi-compat.ts` to the drift check. The generated files are type-only and are not exported from the package root
  > coverage: deterministic output, changed/missing/extra/symlinked artifacts, Rust field and variant renames, fail-closed unsupported syntax and serde attributes, pinned digests for hand-written serde implementations, recorded session/RPC rows and all 29 command samples compiled against the types, invalid command/UI/host/session shapes rejected
  > verify: `node scripts/check-contract-drift.mjs && npm run check`
  > gate: command-pass
  > risk: medium

## Phase 4: Capability matrix (spec §6)

- [x] T010 List every user-visible feature and all 25 files under `src/core/extensions/builtin` with one disposition each: ported, hosted or refused. Mark the safety gates that F4 sends to K3. Add a check that fails on a missing or duplicate entry
  > role: architect
  > deps: T008
  > files: [`specs/120-rust-core/capability-matrix.json`, `scripts/lib/capability-matrix.mjs`, `scripts/check-capability-matrix.mjs`, `scripts/test/check-capability-matrix.test.mjs`]
  > result: 75 features and 25 built-in files. Modes, built-in tools and built-in slash commands are read from source, so a new one without an entry fails. Only `command-safety-gate.ts` is a safety gate (ported, K3). `identical-loop.ts` and `finish-check-reverify-stage.ts` also block tool calls; they are classified as refused and carry a `reviewNote` for the owner
  > open: refusing a default-on built-in (for example `identical-loop`) under the Rust core needs a defined trigger before K5; CM1 decides how it is observed
  > verify: `node scripts/check-capability-matrix.mjs`
  > gate: command-pass
  > risk: medium

## Phase 5: Checks and platforms

- [x] T011 Add the Rust checks to `npm run check` and add the cargo, macOS and Windows jobs to CI. This is the only task that edits workflow files (C3, C7)
  > role: coder
  > deps: T002
  > files: [`package.json`, `scripts/check-native.mjs`, `scripts/test/check-native.test.mjs`, `native/omk-policy/tests/reduction.rs`, `rust-toolchain.toml`, `.github/workflows/ci.yml`]
  > progress: local half done. `npm run check` runs `check:native`: `cargo fmt --check`, Clippy with `-D warnings` and `cargo test`, `--locked`, for every crate under `native/`. A missing cargo fails. One existing Clippy finding in `omk-policy` tests was fixed
  > progress: CI jobs added as three new jobs in `ci.yml`, with no change to existing jobs or triggers: `cargo` (ubuntu-22.04, every native crate), `rust-macos` (macos-15) and `rust-windows` (windows-2025), the last two for `omk-contract`, the K0 crate. `omk-execution` is a Linux sandbox supervisor and is not built on the other two. `rust-toolchain.toml` now lists `rustfmt` and `clippy` so rustup installs them with the pinned toolchain
  > result: `cargo`, `rust-macos` and `rust-windows` passed on `workflow_dispatch` run 42988270672 at `09b6389aac` (the CI `pull_request` trigger covers `main` only). `check:native` runs before `check:constitution` so one sequential step installs the toolchain; parallel test files racing a rustup auto-install broke the earlier run
  > open: on that run `build-check-test` still fails in 24 tests of `native-extension-artifact-gate.test.mjs` and `native-extension-consumer-lock.test.mjs`, which hardcode `/mnt/omkdata/tmp/opencode`. They predate this task (`abfea02d76`) and are not T011 work
  > verify: `npm run check` locally, and the three CI jobs pass on the pull request
  > gate: command-pass
  > risk: high

- [ ] T012 Run the K0 gates and update the user documents
  > role: qa
  > deps: T004, T009, T010, T011
  > files: [`packages/coding-agent/docs/omk-2-rust-core.md`, `packages/coding-agent/docs/omk-2-migration.md`]
  > metric: G0 default behavior
  > baseline: the G0 suite on `48fb8e33a8`
  > target: unchanged
  > regression-floor: unchanged
  > verify: `npm run check`, the G0 suite, and `cargo test CARGO_K0`
  > evidence: check output in the pull request
  > gate: command-pass
  > risk: low
