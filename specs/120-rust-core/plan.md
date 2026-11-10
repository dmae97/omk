# Implementation plan: Rust core, stage K0 (contracts)

**Branch**: `2.0.0` | **Date**: 2026-11-10 | **Spec**: [spec.md](spec.md) | **Decisions**: [decisions.md](decisions.md)
**OMK Preset**: `omk`

This plan covers K0 only. K1 to K5 get their own plans when K0's gates pass.

## Summary

K0 adds one Rust crate, `native/omk-contract`, that owns the types for session JSONL, the
public RPC wire, the extension-host wire and the `omk+pi` compatibility tables. A generator
in the same crate writes the TypeScript copies, and a drift check fails when a copy is edited
by hand. K0 also produces the capability matrix that K5 is judged against. Nothing in
production calls the crate when K0 ends. The Node core keeps running exactly as it does now.

## Harness evidence plan

Spec 120 is a `preserve` spec. K0 carries three of its gates.

| Metric | Baseline | Target | Regression floor | Command | Artifact |
| --- | --- | --- | --- | --- | --- |
| RC1 round trip | Synthetic sessions and RPC transcripts recorded from the TypeScript implementation at `48fb8e33a8` | Every fixture decodes and re-encodes to the same bytes | Zero differing fixtures | `cargo test --locked --manifest-path native/omk-contract/Cargo.toml` | Test output in the pull request |
| PA2 table drift | `packages/coding-agent/src/core/pi-compat.ts` at the commit that lands T004 | Regenerating produces no diff | Zero differing lines | `node scripts/check-contract-drift.mjs` | Script exit status |
| G0 default behavior | `packages/coding-agent/test/suite/g0-session-hash.ts` on the base | Unchanged | Unchanged | `npm run check`, then the G0 suite as the repository runs it | Check output |

No comparative row applies. K0 makes no model call and measures no cost, latency or solve rate.

## Runtime inventory

- **Harness**: not present. K0 runs no agent harness.
- **MCP scope**: none.
- **Skills**: `pstack` verifiable units and test-first, `programming`.
- **Authority**: The owner keeps final authority. The agent writes and verifies each unit and
  does not merge.

## Units

Each unit ends in a state one command checks. A unit starts only when the one before it is
green. Units that record fixtures land separately from units that replay them, so a fixture
is never produced by the code it judges.

| Order | Unit | Ends when |
| --- | --- | --- |
| 1 | Toolchain pin and crate skeleton | `cargo check` passes on an empty crate |
| 2 | Compatibility tables in Rust | Table tests pass after first failing |
| 3 | Table generator and drift check | PA2 passes; a hand edit makes it fail |
| 4 | Synthetic fixture recorder | Fixtures exist and carry no private data |
| 5 | Session JSONL types | RC1 passes for sessions |
| 6 | RPC wire types | RC1 passes for RPC transcripts |
| 7 | Extension-host wire types | Frame bound and version tests pass |
| 8 | TypeScript declarations for units 5 to 7 | Regeneration produces no diff |
| 9 | Capability matrix | Every feature and all 25 built-in extension files have one disposition |
| 10 | Rust checks in `npm run check` and CI, three platforms | The crate builds and its tests pass on Linux, macOS and Windows runners |

## Project structure

```text
rust-toolchain.toml                      # unit 1
native/omk-contract/
├── Cargo.toml                           # serde and serde_json only, pinned with =
├── Cargo.lock
├── README.md
├── THIRD-PARTY-NOTICES.md
├── src/
│   ├── lib.rs
│   ├── compat.rs                        # unit 2
│   ├── session.rs                       # unit 5
│   ├── rpc.rs                           # unit 6
│   ├── host_wire.rs                     # unit 7
│   └── bin/omk-contract-gen.rs          # units 3 and 8
└── tests/
    ├── compat.rs
    ├── roundtrip.rs
    └── fixtures/                        # unit 4, synthetic only
scripts/check-contract-drift.mjs         # unit 3
specs/120-rust-core/capability-matrix.json   # unit 9
```

## Complexity check

| Concern | Decision | Rationale |
| --- | --- | --- |
| New dependencies | None | `serde` and `serde_json` at the exact versions the four existing crates pin (A3, spec §10) |
| Breaking changes | No | No production caller. Generated TypeScript must equal today's source byte for byte |
| Parallel tasks | 2 | Units 5 and 6 are independent after unit 4 |
| Secret exposure | None | Fixtures are synthetic (A5). No credential, prompt or user path enters the repository |

## Known obstacles

- `packages/coding-agent/src/core/pi-compat.ts` has uncommitted changes from another session
  in this working tree. Unit 3 generates that file, so it waits until those changes are
  committed or the owner of that work agrees on the order.
- Unit 10 edits workflow files. Decision C3 covers a macOS job, a Windows job and a cargo
  job, and nothing else.
- The pre-commit hook runs `npm run check` over the whole working tree. A failure caused by
  another session's uncommitted work blocks a commit here. Such a failure is reported, not
  bypassed.

## Quality gates

- **Rust**: `cargo fmt --check`, `cargo clippy -- -D warnings` and `cargo test`, each with
  `--locked --manifest-path native/omk-contract/Cargo.toml`.
- **Repository**: `npm run check`.
- **Drift**: `node scripts/check-contract-drift.mjs`.
- **Fixtures**: a search of `tests/fixtures/` for home paths, credentials and prompts, run
  before each commit that adds one.
