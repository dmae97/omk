# V2 development checkpoint, 2026-11-10

## Scope and capture

- Captured at **2026-11-10 10:30:15 KST / 01:30:15 UTC** from local `2.0.0`.
- Parent: `48fb8e33a84d01fde163091ed36a8bca981d3bbe`.
- Captured 164 changed/new v2 files into an independent worktree after two-pass file-digest, HEAD, index-entry and inventory checks.
- Includes native extension/default-dialect migration, packaged Bun/declaration fixes and their reviewed SDK pin, native workbench streaming, Rust execution/reconnect/GC/provenance/deadline and grant-retention work, tests and existing planning evidence.
- Does not merge `main`, the 1.x Anthropic/Fable PR, edit-feedback PR, local operator configuration or installed engine changes.
- Only checkpoint-local edits after capture are formatting the two new grant-retention/phase-deadline tests and adding this record. No source behavior was rewritten for the checkpoint.

The active session's source files, local `2.0.0` HEAD and index are not moved, staged,
restored or cleaned. Source updates made by the other session after capture are not
silently folded into this checkpoint or overwritten by its frozen copies. In particular,
execution-host documentation/supervision/deadline, grant-retention tests and Rust-host
notes continued changing while verification ran.

## Observed checks of the frozen copy

| Check | Observed result |
| --- | --- |
| `npm ci --ignore-scripts --no-audit --no-fund` | Exit 0, isolated dependencies from captured lockfile |
| `node_modules/.bin/tsgo --noEmit --pretty false` | Exit 0 |
| `npm run build` | Exit 0, all seven npm workspaces |
| `npm run check` | Exit 0, unchanged repository gates |
| AI SDK/header/declaration tests, two explicit files | 3 passed, no skips |
| Protocol reconnect test | 9 passed, no skips |
| Coding-agent changed tests, 37 explicit files with one worker and the real Rust binary | 466 passed, no skips |
| `cargo test --manifest-path native/omk-execution/Cargo.toml --locked --offline -- --test-threads=1` | 15 passed |
| `cargo test --manifest-path native/omk-workbench/Cargo.toml --locked --offline -- --test-threads=1` | 16 passed |
| Both crates: `cargo fmt ... -- --check` and `cargo clippy ... --all-targets --locked --offline -- -D warnings` | Exit 0 |
| `gitleaks git --staged --redact --no-banner` | Exit 0, no leaks found |
| `git diff --cached --check` | Exit 0 |

The TypeScript file lists are exactly the `.test.ts` entries in the 164-file capture,
run package-locally with `--maxWorkers=1 --no-file-parallelism`. Rust output uses a
separate task-owned Cargo target directory; integration tests explicitly select that
release binary through `EXECUTION_HOST_TEST_BINARY`. Heavy work used two CPUs, one
Cargo job and a 4096 MiB Node heap cap.

Two setup corrections are retained rather than presented as product regressions:

- The initial root check stopped on formatting in two in-progress test files. Only
  the isolated copies were formatted; the active session files were not changed.
- The first native integration matrix rejected the task-built executable because
  inherited build permissions made it group-writable (`0775`). Tightening only that
  task-owned artifact to `0700` satisfied the existing trust check; the whole 37-file
  matrix then passed without source, timeout, assertion or security-gate changes.

## Boundary

This is a dated **development checkpoint**, not completion of Phase 2, the Rust-host
migration or milestone 2.0.0. Versions remain **1.5.10**. Historical artifact acceptance
records retain their original candidate identity; this checkpoint does not relabel them
or claim fresh installed Node/Bun artifact, desktop/platform or R acceptance.

Publishing the checkpoint branch does not activate a different installed engine, publish
npm packages, create a release tag, deploy or merge v2 into `main`. The active checkout
may remain on the original parent with ongoing modifications while remote `2.0.0` and
`v2-checkpoint-20261110` record the same frozen commit; reconcile that checkout deliberately
instead of resetting or overwriting its ongoing work.
