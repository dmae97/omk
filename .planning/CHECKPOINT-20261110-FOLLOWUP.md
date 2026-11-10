# V2 checkpoint follow-up, 2026-11-10

Parent: `abfea02d76e4385e09a447473ea4554919ee90cc`.
The six requested post-capture paths were frozen at **11:40:09 KST / 02:40:09 UTC**
into an independent worktree. The active checkout, its index and HEAD are not
advanced or rewritten.

## Included scope

- `native/omk-execution/src/supervisor.rs`: recheck the original boot-bound phase
  deadline after record persistence and immediately before spawning the sandbox.
- `native/omk-execution/src/phase_deadline.rs`: compare the existing 14 fixed clock
  cases with the production decoder and inclusive deadline decision.
- `packages/coding-agent/test/verified-run-grant-retention.test.ts`: force an actual
  compaction rewrite by dropping a disposable grant, then verify retained token,
  tombstone expiry, duplicate disposition and monotonic grant counter.
- `native/omk-execution/README.md` and
  `packages/coding-agent/docs/rust-execution-host.md`: document the original phase
  cap, conservative clock precision and unchanged authorization/retention boundary.
- `scripts/architecture/verify-phase-deadline.R`: include the project-local base-R
  oracle referenced by that README and missing from the parent checkpoint. The CSV
  fixture is already present and unchanged. This is developer-only, not a runtime
  dependency.

The sixth requested path, `verified-run-rust-phase-deadline.test.ts`, is already
byte-identical to the parent checkpoint. It was captured and rerun, not churned.
The captured source content is preserved without implementation or formatting
rewrites. Other new planning/result files and unrelated work are excluded.

## Fresh verification

| Command / scope | Observed result |
| --- | --- |
| `npm ci --offline --ignore-scripts --no-audit --no-fund` | Exit 0, separate worktree dependencies, unchanged lockfile |
| Execution host: `cargo check --all-targets --locked --offline` | Exit 0 |
| Execution host: `cargo test --locked --offline -- --test-threads=1` | 16 passed, no skipped/failed tests |
| Execution host: `cargo fmt -- --check` and `cargo clippy --all-targets --locked --offline -- -D warnings` | Exit 0 |
| Execution host: `cargo build --release --locked --offline --bins` | Exit 0, fresh explicitly selected binary |
| 27 explicit coding-agent native/authority/recovery test files, `--maxWorkers=1 --no-file-parallelism` | 171 passed, no skipped/failed tests |
| `Rscript --vanilla scripts/architecture/verify-phase-deadline.R native/omk-execution/tests/fixtures/phase-deadline.csv` | Exit 0, 14 cases passed |
| Same R command with one expected verdict deliberately changed in a temporary CSV | Expected exit 1, `case 1 status mismatch` |
| `npm run check` | Exit 0, including the actual TypeScript compiler and repository guards |
| Active TypeScript LSP probe on the two captured tests | Two unconfirmed checks, no clean-LSP claim |

Cargo ran with read-only source/toolchain, a cleared environment, no network,
a task-local home/cache/target and one build job. All eleven cached crate archive
hashes match the unchanged lockfile; Cargo freshly extracted their sources rather
than reusing the other session's unpacked source. Heavy checks used two CPUs.
The release binary SHA-256 is
`3356f685a96308d6fa0b695e6beda76d9a07038897a8bdb7a866a8e2837a0f3f`.
Native tests explicitly supplied it through `EXECUTION_HOST_TEST_BINARY`; no
installed binary or global selection was changed.

The first root check found missing generated npm CLI artifacts in the fresh
worktree, not a product regression. Every npm package's source and manifest is
unchanged from the previously built parent checkpoint. Its already verified
`dist` outputs were copied only into this worktree to satisfy the built-CLI gate,
and the root check then passed. No fresh full npm build or installed-artifact
acceptance is claimed. Native Rust output was built freshly from this follow-up.

## Review and preservation

Direct review covered pre-spawn ordering, fail-closed clock errors, no renewed
phase cap or grant expiry, real compaction persistence, finite-oracle limits and
unchanged dependency/publication boundaries. No independent-agent review or
whole-system correctness claim is made.

The active checkout's 4,292 captured files/symlinks, inventory, HEAD and index
entries were rechecked after verification and remained unchanged. Local evidence
and negative fixtures remain outside the repository. The commit is limited to
five changed requested paths, the directly referenced R oracle and this record.
Secret scanning and staged-diff checks are required before publication.

Remote `2.0.0` receives only a normal fast-forward, with a separate
`v2-followup-20261110` branch retaining the follow-up. The previous dated
checkpoint remains immutable. No merge into `main`, release, version bump,
package publication, deployment or engine activation is part of this work.
Phase 2 and the 2.0.0 milestone remain incomplete.
