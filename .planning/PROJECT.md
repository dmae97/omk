# OMK 2.0.0 migration

## Execution contract

GSD tracks execution of the existing OMK migration. It does not replace the
repository's spec-kit governance. `specs/constitution.md`, existing specifications
and current source contracts remain authoritative.

The owner approved work toward a Pi-independent OMK 2.0.0, including the previously
declared native workbench, Rust execution-host migration and independent R oracle.
The initial execution scope is contract alignment and the first independently
verifiable Pi-boundary slice, not a claim that the whole milestone is ready.

## Owner direction, 2026-11-10

The owner widened the target: replace every remaining Pi dependency, migrate the
core itself to Rust, and keep existing extensions working. The end state is a Rust
core that is the single writer, with Node reduced to an extension host. The staging
rules below still apply to every step toward it. Plan:
`packages/coding-agent/docs/omk-2-rust-core.md`. Survey:
`packages/coding-agent/docs/harness-survey-2026-11.md`.

Decided the same day: 2.0.0 ships at stage K5; extensions run on Node in a host
process; the Rust terminal UI takes the look of the OpenTUI status panel header.
The `omk+pi` adapter is kept and moves entirely to Rust; the Rust core supports
Linux, macOS and Windows at parity with the Node core on each.
Contract: `specs/120-rust-core/spec.md`.

The owner then delegated the 41 remaining decisions. They are recorded by ID in
`specs/120-rust-core/decisions.md`. The release now depends on Phase 2, Phase 4 as
limited, Phase 7 and Phase 6; the desktop workbench, the terminal observation phase
and the rest of the execution-host ownership follow 2.0.0. Still needing the owner:
the K1 dependency review bundle and the wire cost threshold.

## Current baseline

- Published/workspace version: 1.5.10; do not change it before release gates.
- Source HEAD: `0d6e74b0d21cdb810c88c42381457eff944b935f` plus pre-existing local work.
- Existing specification: `specs/108-pi-decoupling/spec.md`.
- Existing delivery map: `packages/coding-agent/docs/omk-2-migration.md`.
- Initial `npm run check`: passed; its script tests reported 555 passed,
  30 skipped and zero failed. This is not an application or R parity pass.

The working tree contains substantial unrelated tracked and untracked work.
Back up touched existing files, preserve those changes, and distinguish the new
diff from the baseline. Do not regenerate catalogs or unrelated baselines.

## Target ownership

- OMK owns its extension, tool, provider, state and permission contracts.
- Production starts with the current Node owner; migrate execution boundaries to
  Rust only after authority, settlement and recovery acceptance. Since 2026-11-10
  the declared end state is a Rust-owned core; this bullet governs how each
  boundary gets there, not whether it does.
- Extensions are a preserved surface. A core change that breaks the documented
  extension API needs a tested mapping or an owner-approved exception.
- TUI/native views project observations and submit explicit intents; rendering
  must not acquire execution authority.
- R is a development/acceptance oracle, never part of the production agent loop.
- Pi compatibility is a migration concern, not the final default core contract.

## Boundaries

- Preserve sessions, original data, provider authentication, safety gates and notices.
- Same-publisher packages are not automatically Pi runtime dependencies.
- A small source slice does not certify installed binaries or desktop platforms.
- No paid benchmarks, dependency installation, commits, pushes or publication
  follow automatically from GSD routing or a passing check.
- Windows blueprint comparison remains unavailable until the material is provided
  in an accessible location; do not claim it was reviewed.
