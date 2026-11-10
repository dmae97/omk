# Tasks: Rust core, stage K0 (contracts)

**Input**: [spec.md](spec.md), [plan.md](plan.md), [decisions.md](decisions.md)
**Output**: task list with execution metadata

Each task ends in a state its `verify` command checks. A task that adds behavior writes the
failing test first and records the failure before the fix. No task is started.

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

- [ ] T004 Generate the Node core's compatibility tables from the crate and add the drift check. Blocked while `pi-compat.ts` holds another session's uncommitted changes
  > role: coder
  > deps: T003
  > files: [`native/omk-contract/src/bin/omk-contract-gen.rs`, `scripts/check-contract-drift.mjs`, `scripts/test/check-contract-drift.test.mjs`, `packages/coding-agent/src/core/pi-compat.ts`]
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

- [ ] T006 [P] Define the session JSONL types and round-trip every session fixture
  > role: coder
  > deps: T005
  > files: [`native/omk-contract/src/session.rs`, `native/omk-contract/tests/roundtrip.rs`]
  > metric: RC1 round trip, sessions
  > baseline: fixtures from T005 at `48fb8e33a8`
  > target: every fixture re-encodes to the same bytes
  > regression-floor: zero differing fixtures
  > verify: `cargo test CARGO_K0 --test roundtrip session`
  > evidence: test output in the pull request
  > gate: command-pass
  > risk: high

- [ ] T007 [P] Define the public RPC wire types and round-trip every RPC fixture
  > role: coder
  > deps: T005
  > files: [`native/omk-contract/src/rpc.rs`, `native/omk-contract/tests/roundtrip.rs`]
  > metric: RC1 round trip, RPC
  > baseline: fixtures from T005 at `48fb8e33a8`
  > target: every fixture re-encodes to the same bytes
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

- [ ] T009 Generate TypeScript declarations for T006 to T008 and extend the drift check to them
  > role: coder
  > deps: T004, T006, T007, T008
  > files: [`native/omk-contract/src/bin/omk-contract-gen.rs`, `scripts/check-contract-drift.mjs`, `packages/protocol/src/`]
  > verify: `node scripts/check-contract-drift.mjs && npm run check`
  > gate: command-pass
  > risk: medium

## Phase 4: Capability matrix (spec §6)

- [ ] T010 List every user-visible feature and all 25 files under `src/core/extensions/builtin` with one disposition each: ported, hosted or refused. Mark the safety gates that F4 sends to K3. Add a check that fails on a missing or duplicate entry
  > role: architect
  > deps: T008
  > files: [`specs/120-rust-core/capability-matrix.json`, `scripts/check-capability-matrix.mjs`, `scripts/test/check-capability-matrix.test.mjs`]
  > verify: `node scripts/check-capability-matrix.mjs`
  > gate: command-pass
  > risk: medium

## Phase 5: Checks and platforms

- [ ] T011 Add the Rust checks to `npm run check` and add the cargo, macOS and Windows jobs to CI. This is the only task that edits workflow files (C3, C7)
  > role: coder
  > deps: T002
  > files: [`package.json`, `scripts/check-native.mjs`, `.github/workflows/ci.yml`]
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
