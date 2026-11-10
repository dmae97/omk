# Spec 120 decision record

Date: 2026-11-10. Branch `2.0.0`, base `48fb8e33a8`.

## Who decided

The owner decided five points directly on 2026-11-10: 2.0.0 ships at K5, extensions run on
Node, the Rust terminal UI takes the OpenTUI status panel header look, the `omk+pi` adapter
moves to Rust, and Linux, macOS and Windows are all supported.

The agent then put 41 further decisions to the owner, each with options and a
recommendation. The owner delegated them ("decide yourself"). Every row below is the
recommendation the agent had already stated, with two refinements made afterwards. B1 was
stated as approval per crate and is recorded as approval per review bundle. H1 was stated
as the three new files and is recorded as all new files plus the one-line index row.

The owner can reverse any row by its ID. A reversal is recorded here with its date. Rows are
not edited in place.

Two rows waive or widen an existing rule and are marked **rule change**. They rest on the
delegation and on nothing else.

## A. Contract stage (K0)

| ID | Decision | Chosen |
| --- | --- | --- |
| A1 | Start K0 | Yes, after this record is committed |
| A2 | Crate location | `native/omk-contract`, with its own `Cargo.lock` like the four existing crates |
| A3 | TypeScript declarations | A generator written in this repository. No new crate |
| A4 | Rust toolchain | Pin 1.99.0 in a root `rust-toolchain.toml`. Nothing pins it today |
| A5 | Round-trip fixtures | Synthetic only. No real session enters the repository |
| A6 | Rust checks in `npm run check` | Yes, in the same change as C7, so the pre-commit hook and CI agree |
| A7 | Plan and task files | `plan.md` and `tasks.md` for K0 only |

## B. Dependencies (K1 and later)

| ID | Decision | Chosen |
| --- | --- | --- |
| B1 | Approval bar for a new crate | The owner approves each review bundle. A bundle is the direct crates of one stage with their resolved graph, and records license, build scripts, procedural macros and transitive count. Versions are pinned with `=` |
| B2 | Execution model for providers | `tokio` |
| B3 | HTTP client | `reqwest` |
| B4 | TLS | `rustls`. The review picks the cryptography provider |
| B5 | Offline builds | Registry and lockfile with `--locked`. No committed vendor directory |
| B6 | Copying code from other harnesses | Allowed under the existing rule: MIT or Apache-2.0, source named in the file, `NOTICE` updated. Each copy is named in its pull request |
| B7 | Provider order | `anthropic-messages`, `openai-responses`, `openai-completions`, then the other six API kinds |

B2 to B4 select candidates. None enters a lockfile before its B1 review is approved.

## C. Platforms

| ID | Decision | Chosen |
| --- | --- | --- |
| C1 | Native Windows sandbox | Keep today's refusal. A backend is a later spec |
| C2 | Release targets | The six the Bun build already ships: darwin arm64 and x64, linux x64 and arm64, windows x64 and arm64 |
| C3 | Workflow file edits | **Rule change.** Allowed for three additions only: a macOS job, a Windows job and a cargo job. Any other workflow edit still needs the owner |
| C4 | macOS evidence | A GitHub-hosted macOS runner |
| C5 | Windows evidence | A GitHub-hosted Windows runner. WSL2 counts as Linux |
| C6 | Release builds | Native builds on those runners. No cross-compilation |
| C7 | Rust in CI | Add `cargo fmt --check`, Clippy with warnings denied, and tests |

## D. Release gates for 2.0.0

| ID | Decision | Chosen |
| --- | --- | --- |
| D1 | Desktop workbench (U1) and desktop platform acceptance (P0) | After 2.0.0 |
| D2 | Phase 3, terminal observation ownership (V2-UI-01, V2-UI-02) | Merged into K6, after 2.0.0 |
| D3 | Phase 4, independent oracle and recovery (V2-R-01, V2-RECOVERY-01) | Kept, limited to the policies ported in K0 to K5 |
| D4 | Phase 5 remainder: grant ledger and scheduler ownership in Rust | Moved to K7, after 2.0.0. Slices H1 to H2i stay as delivered |
| D5a | Spec 108 tokens-per-turn criterion, never measured | **Rule change.** Waived. Measuring needs provider calls and a dollar cap, and none is set |
| D5b | Spec 108 one-module-per-change criterion | Kept. The existing work is split by module when it is committed |

After D1 to D4 the 2.0.0 release depends on Phase 2, Phase 7 and the headless platform
acceptance in spec 120.

## E. Distribution and selection

| ID | Decision | Chosen |
| --- | --- | --- |
| E1 | Delivering the Rust binary | GitHub Release assets. The user sets the path. The seven npm packages are unchanged |
| E2 | Selecting the Rust core | `OMK_RUST_CORE` set to an absolute path, pinned like `OMK_RUST_EXECUTION_HOST` |
| E3 | Locating Node for the host | `node` on `PATH`, checked against `>=22.19.0`, with an explicit path override |
| E4 | Bun-compiled binary as host | No. The host is Node |

## F. Extension host

| ID | Decision | Chosen |
| --- | --- | --- |
| F1 | Must-pass extension list | Kept outside the repository. Only counts are reported. The private agent home never enters a tracked file |
| F2 | Conformance threshold | Every must-pass case and every example case passes. The owner approves each exception by name |
| F3 | Extension-registered providers | Hosted. The core calls the host for those models |
| F4 | Built-in extensions that import core internals | Safety gates are ported to Rust by K3. The others are refused under the Rust core in 2.0.0 |
| F5 | Wire cost | Measured and reported at K4. The pass threshold is approved before K5 |

## G. Pi-zero

| ID | Decision | Chosen |
| --- | --- | --- |
| G1 | Clipboard in the Node core | A native addon built on `arboard` for the six targets, subject to B1 |
| G2 | The five `PI_*` variables exported to bash | Export `OMK_*` names alongside them. Keep the `PI_*` names |
| G3 | `gondolin` example extension | Keep. It is a separate Apache-2.0 project |

## H. Process

| ID | Decision | Chosen |
| --- | --- | --- |
| H1 | Committing this session's documents | Commit the new files and the one-line `specs/README.md` row. Files that also hold other sessions' uncommitted changes stay uncommitted |
| H2 | Features from the harness survey | None approved. The survey failed its audit: no metric, baseline or threshold. Each feature needs its own spec |

## Still open

- The terminal UI engine: port the existing renderer or build on a Rust library. It is K6
  work and does not block 2.0.0.

## Not verified when these were decided

- Whether the read replica can serve a read that follows a write inside one handler.
- Whether Rust can reproduce provider request bodies byte for byte.
- What each internal import of a built-in extension does. Only the counts were taken.
- The Actions billing state of this account. The repository is public.
- Whether G2 changes the G0 session hash.
- Whether `arboard` covers image paste on all six targets.
