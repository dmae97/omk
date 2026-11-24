# Spec 121 execution units

Scope and baseline: [spec.md](spec.md). Research and roadmap are authored under
`packages/coding-agent/docs/harness-research-2026-11.md` and
`packages/coding-agent/docs/harness-roadmap-2026-11.md`.

## Delivered locally

- [x] H1 Mark historical checkpoint evidence explicitly.
  > baseline: `3045c4ca2f`; two new expectations failed on existing output
  > files: `src/core/durable-goal-checkpoint.ts`, the two checkpoint tests, `docs/run-protocol.md` under coding-agent
  > result: 12 focused tests pass; current/absent checkpoints and mutable-state trust boundary preserved
  > verification: `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/durable-goal-checkpoint.test.ts test/goal-controller-checkpoint.test.ts`
  > activation: source only; no installed runtime rebuild, no schema/default/authority change

- [x] H2 Compose repeated offline TB audits without replacing single-run behavior.
  > files: `scripts/tb21-repeat-audit.mjs`, `scripts/lib/tb21-repeat-audit.mjs`, composition seam in `scripts/lib/tb21-audit.mjs`, `scripts/test/tb21-repeat-audit.test.mjs`, user doc
  > initial test: missing new CLI reproduced; this is an unavailable entry-point result, not a numerical regression
  > verification: four `tb21-*-audit` test files listed in the user doc, strict JS typecheck, repository check
  > claim: numerical/validation infrastructure only. No paid model trial, superiority measurement, CI workflow edit or activation

## H1/H2 local verification — 2026-11-12

- `npm run check`: exit 0 after correcting the H1 formatter layout. The repository
  script-test stage reported 639 passed, 30 skipped, zero failures; this is not
  the full Vitest suite. Fresh recording matched all ten fixtures, 19 generated
  artifacts matched, and the capability matrix passed with 75 features.
- The H1 Vitest command above: exit 0, two files and 12 tests passed.
- `node --test scripts/test/tb21-repeat-audit.test.mjs scripts/test/tb21-audit.test.mjs scripts/test/tb21-audit-inputs.test.mjs scripts/test/tb21-audit-completion.test.mjs`:
  exit 0, 88 tests passed, none skipped.
- The strict JS typecheck command in `docs/tb21-repeat-audit.md`: exit 0.
  LSP cache/hints were not used as proof of a clean check.
- `git diff --check` and unchanged-workflow diff: exit 0. Local links in the new
  research, roadmap, audit and specification documents resolve.
- Self-review: generation labels do not grant authority; repeat composition keeps
  the single-run report shape, fails closed, bounds inputs and redacts raw IDs and
  paths. No new dependency or model invocation. Observational evidence cannot
  establish trial independence, truthful grading or performance superiority.

No installed-runtime rebuild, full build, paid benchmark or new macOS/Windows run
was performed. Historical CI and the earlier full local K0 gate remain separately
identified in spec 120; these results are not overall CI or release approval.

## H3a/H7a local result — 2026-11-12

- [x] Prepare K1 direct-candidate metadata and checksum/build-script review in
  [the B1 review](../120-rust-core/k1-dependency-review.md). The first preparation
  was unresolved; the later J1-authorized review below records its resolution.
  No runtime manifest/lockfile changed and final B1 approval remains pending.
- [x] Freeze 20 recovery cases and seven attack/control pairs in [corpus.json](corpus.json).
  Reuse 32 existing tests; add two real Linux network-isolation cases.
- [x] Add `scripts/verify-harness-corpus.mjs` and strict report/inventory validation.
  Missing, skipped, renamed or duplicate evidence and failed hooks fail closed.
- [x] Tighten the writer-scope attack to assert the original workspace is unchanged.
- [x] Record final focused and repository-check outcomes for this unit.

The initial guard test failed at the missing `harness-corpus.mjs` API (exit 1),
then passed after implementation. That RED establishes missing measurement
infrastructure, not a previously failing runtime safety guarantee. The first
real corpus execution passed all 20 recovery cases and 7+7 security cases.
Final verification after network-client cleanup and the stronger scope assertion:

| Command | Observed result |
| --- | --- |
| `node --test scripts/test/harness-corpus.test.mjs` | exit 0; 23 passed, none skipped |
| `node scripts/verify-harness-corpus.mjs` | exit 0; 20 recovery, 7 attacks, 7 controls passed exactly once |
| `node node_modules/typescript/bin/tsc --noEmit --allowJs --checkJs --strict --target ES2022 --module NodeNext --skipLibCheck --types node scripts/verify-harness-corpus.mjs scripts/lib/harness-corpus.mjs` | exit 0 |
| `npm run check` | exit 0; script tests 662 passed, 30 skipped; fresh ten-fixture comparison passed |
| `git diff --check` | exit 0 |
| Diff of CI workflows and all five native Cargo manifest/lockfile pairs | unchanged |

Corpus SHA-256: `1b88f5760e65cf0d7615c53e3a68a8f1f9f3c4d730a004e08923864a814cab6c`.
The runner also reported each selected test file's digest. Scope is the current
working tree at source HEAD `3045c4ca2f`, not a clean-commit or remote-CI claim.
The 30 repository-script skips are not corpus skips: every selected corpus case
was required to pass. LSP probes were inconclusive; explicit compiler and test
results above are the verification evidence.

Self-review retained the existing production authority, epoch, receipt and process
boundaries. The network pair owns a temporary loopback listener and drains the
sandbox through the existing broker; it calls no outside endpoint. The runner
refuses selection drift and reports no private test payload. No platform/security
certification or model improvement follows from these finite cases. H3 preflight,
macOS/Windows corpus runs remained outstanding at this checkpoint. The B1 graph
was subsequently resolved under the separate J1 authorization below.

Reviewable units / suggested commit messages (not committed):

1. `docs: K1 의존성 후보와 그래프 승인 경계 기록`
2. `test: 복구와 권한 corpus를 누락 없이 검증`

## K1 resolution-only review — J1, 2026-11-12

The owner explicitly approved a temporary resolution manifest/lockfile, with no
build or production incorporation. [Decision J1](../120-rust-core/decisions.md#j-k1-resolution-only-review-2026-11-12)
records the boundary. [B1 review](../120-rust-core/k1-dependency-review.md) and its
JSON artifact now contain six Linux-host target graphs: 90–93 packages per target,
99 selected identities in the union (94 transitive), 134 in the lock overall.
Thirteen selected build-script packages and five proc-macro packages were inventoried.

`cargo generate-lockfile`, seven metadata reads (six filtered, one unfiltered) and
six Cargo tree reads exited 0. All archive hashes matched lock/index checksums.
The pinned RustSec snapshot yielded 61 matching-name records: 58 patched-range
matches, one unaffected and two withdrawn, not a cargo-audit pass. Explicit Ring
initialization, Windows ARM64 Clang and non-MIT-only notice obligations need owner
review. No package was compiled; final B1 approval and actual incorporation remain
separate. Repository `npm run check` was not rerun because it would compile native
code outside the approved scope.

## Follow-up, not implemented

- [ ] H3 Resume smoke and ownership checks through existing Goal/Run contracts.
  > deps: H1
  > first deliverable: H3a corpus delivered; opt-in resume preflight remains unimplemented
  > gate: no lost durable entry, duplicate effect, revived grant or silent unknown outcome; positive controls pass

- [ ] H7 Adversarial and benign permission/receipt corpus.
  > deps: current authority/sandbox paths
  > first deliverable: H7a Linux corpus delivered; cross-platform expansion remains unimplemented
  > gate: scoped unauthorized effects and false-pass count zero; legitimate controls preserved

- [ ] H4 Context and compaction ablation.
  > deps: H2, preregistered trial conditions and dollar cap
  > first deliverable: held-out mandatory-information and raw-recall tasks, then one default-off candidate
  > gate: roadmap's success noninferiority, token/latency and hard-constraint floors

- [ ] H5 Measured delegation policy, observation-only first.
  > deps: H2, H7, model spend approval
  > first deliverable: frozen sequential/parallel/conflict/tool-heavy task bands and single-agent control
  > gate: roadmap's quality-or-cost threshold, no safety/authority regression; host policy still decides execution

- [ ] H6 Calibrated advisory evaluator.
  > deps: H2, fixed rubric and dollar cap
  > first deliverable: deterministic outcome assertions plus 30 human-labelled calibration cases
  > gate: unknown permitted, no deterministic failure promoted, quality/cost measured on held-out tasks

- [ ] H8 Component-removal study at model upgrades.
  > deps: H2 and each evaluated candidate
  > first deliverable: full / baseline / one-component-off manifest
  > gate: no regression in safety or required success, measured cost/latency benefit. Security controls excluded

K1 to K8 retain spec 120's separate ownership and dependency-review gates. This
list schedules no paid run and does not treat unimplemented study plans as completed
features. Commit/push/PR/release and platform jobs are not performed by this task.
