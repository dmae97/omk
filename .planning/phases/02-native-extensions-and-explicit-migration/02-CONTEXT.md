# Phase 2 context

## Approved direction

The owner approved proceeding with GSD and OMK toward a Pi-independent OMK 2.0.
The target includes OMK-owned extension, tool and provider contracts. Native
desktop, TUI ownership, Rust execution ownership and independent R acceptance
remain in the roadmap and must not disappear from the migration.

## Decisions

These IDs label the owner's existing decisions and the current execution handoff,
not new product decisions by the planner. They override superseded research proposals.

- **D-01, Boundary A:** Native `omk` supplies no implicit legacy Pi aliases in Node/Jiti or Bun virtual modules. Explicitly installed user dependencies, including Pi packages and transitive dependencies, resolve to their own identity. Missing dependencies fail ordinary resolution. This is neither runtime declaration enforcement nor a sandbox/import firewall.
- **D-02, staged defaults:** Keep workspace versions at 1.5.10 and omission/undefined at `omk+pi`. No default flip or installed-engine activation in these six steps while activation gates remain. Record a disposition for the older spec-108 equivalence, benchmark and swap criteria before separate activation; do not waive or silently rewrite them.
- **D-03, construction policy:** Add `packageManifestDialect?: "omk" | "omk+pi"` to the existing loader construction/options channel. Validate untyped values and capture the primitive immutably per loader; pass it to the frozen manager and file loader without process-global policy state.
- **D-04, direct discovery:** Keep direct discovery separate from managed-package resolution. Preserve compatible directory entries with index.ts/index.js/index.mjs/index.cjs, authoritative empty/malformed manifests, local/global/configured ordering and deduplication. Native Pi-only directory selection is terminal; do not reuse the managed resolver as if its semantics were equivalent or modify frozen phase-1 implementation/tests.
- **D-05, CLI consumer:** Implement the additive `--package-manifest-dialect omk|omk+pi` selection and the same target syntax on `omk package doctor <source>`. Syntax is agreed, implementation/help/validation and real CLI tests are still required. No environment switch or persisted setting.
- **D-06, SDK consumer:** Use the existing supplied `DefaultResourceLoader` injection into `createAgentSession`, not another SDK flag. Verify public consumption, deterministic tool execution, synthetic provider ownership, lifecycle, reload and cwd/session replacement.
- **D-07, preservation:** Account individually for the current 10 repository and 79 example static entrypoints, plus all `HARNESS_FACTORIES` and the command-safety, todo and Tencent-memory builtins. Require registration parity and selected behavior regressions per extension/feature family. Record platform/live/network/UI behavior as unverified where not exercised; load counts alone are not feature preservation.
- **D-08, Atelier provenance:** Migrate the actual 24 import declarations across 17 vendored files in two reviewable batches. Verify the pristine vendor baseline before edits. Only the final batch may update `localSha256`, and only for changes matched exactly to the intended import edits. Preserve every `upstreamSha256`, upstream revision, MIT notice and unrelated local change.
- **D-09, diagnosis:** Keep doctor static, bounded and advisory. Native-target undeclared legacy imports are migration errors; declared dependencies receive a warning that installation/runtime compatibility is unverified. Preserve omission output, scan limitations, trust and cleanup, redaction and byte-identical originals. Doctor is not approval or evidence of loading.
- **D-10, local user resources:** Preserve compatibility without rewriting, executing or copying private user extensions. Historical metadata described 44 static entries, not 44 loaded extensions: 14 directories, 18 TS/JS files, 8 tests, 1 disabled file and 3 MJS files. Any per-file metadata/ledger stays outside public artifacts. Respect access denials; no root-access workaround.
- **D-11, artifact acceptance:** Execute source Node and forced-virtual-module tests AND actual isolated packaged Node and compiled Bun gates. Bind receipts to exact dirty-source inputs, tarballs, resolved package identities and binary digest. Version/help smoke or forced virtual tables cannot substitute. No paid/provider-network calls.
- **D-12, ownership:** Preserve unrelated dirty work, goal-cost transfer, domain-scope propagation, public-export wiring, builtins and closed verified-run composition. Preserve trust/authorization gates and existing spec-kit governance. Do not weaken tests, widen size baselines or delete intentional behavior.
- **D-13, operations:** No new dependencies/upgrades, global install, broad staging, commit, push, release, catalog refresh or engine activation. Planning only edits this phase's permitted planning files. Later execution of step 6 is authorized to build and install exact existing candidate packages in an isolated temporary prefix; it does not authorize publication or activation.
- **D-14, six-step scope:** Execute all six discussed source-work steps: inventory, native wiring, repository/example migration, local-user preservation, diagnostics/documentation, and verification including actual artifacts. These are not ROADMAP Phase 6 and do not include desktop, independent R or Rust acceptance.

## Decisions carried forward

- Keep existing spec-kit governance. GSD records execution and verification.
- Keep current package versions at 1.5.10 during staged work.
- Preserve existing default behavior until a distinct, verified activation step.
- Phase 1 adds only `DefaultPackageManager` construction policy.
  `packageManifestDialect?: "omk" | "omk+pi"` defaults to compatibility.
- Confirmed **A (core independence + complete extension preservation)**:
  - Under native `"omk"` mode, OMK core and bundled resources have zero Pi runtime dependencies and provide zero implicit legacy Pi aliases in Node/Jiti or Bun virtual modules.
  - User extensions that explicitly declare/install their own dependencies (including Pi packages or transitive dependencies) are not prohibited merely for doing so; in native `"omk"` mode they resolve to their own installed package identity without secret OMK alias remapping, while undeclared legacy Pi imports fail module resolution cleanly.
  - All 10 repository extensions in `.omk/extensions/` (including vendored Atelier sources) and all 79 shipped example extensions in `packages/coding-agent/examples/extensions/` must be migrated and individually verified under native `"omk"` mode; this is a target, not an observed result.
  - Existing user extensions remain preserved without mutating user files via the default/explicit `"omk+pi"` compatibility dialect and static migration diagnostics in `package-doctor`.
- Native managed-resource rejection is not an import firewall or sandbox.
- Do not automatically rewrite user packages, discard originals or turn static
  compatibility diagnostics into code approval.
- Preserve original licenses and distinguish same-publisher dependencies from
  actual Pi runtime coupling.

## Required planning evidence

Identify the minimum next end-to-end runtime test and the actual loader entry point.
Test explicit native behavior alongside unchanged compatibility controls.
Include installed-package sentinels, transitive imports and subpaths wherever the
planned claim covers them. Keep source, packaged Node and compiled-binary
acceptance separate. A fixture-only source pass cannot satisfy artifact acceptance.

Use actual constructor, SDK and CLI wiring. Do not document propagation that has
not been implemented. Prefer the existing policy boundary over additional flags,
settings or speculative abstractions. A plan may propose a new seam only after
showing why the existing one is insufficient.

The final default change is a compatibility-breaking decision. Put it after the
required tests and migration diagnostics, not in the initial tracer. Resolve the
remaining spec-108 compatibility/equivalence criteria before activation.
The constitution already permits a declared milestone-major exception, requiring
`OMK_ALLOW_MAJOR_RELEASE=1` and the declaration in the release notes. No release
opt-in, version bump or publication is performed by this planning work.

## Working-tree and execution boundaries

- The checkout has substantial pre-existing tracked and untracked work.
- `extensions/loader.ts` contains unrelated lifecycle changes, including
  `transferGoalCostSink`. Preserve them and compare against an exact pre-edit backup.
- Do not widen module-size allowances, weaken tests or rewrite inventory baselines
  to hide an unverified boundary.
- No commits, staging, pushes, installation, catalog refresh, builds, engine
  activation or publication are performed by the planner.
- The owner has authorized later execution through source-work step 6, including
  isolated builds and local artifact installation. Artifact acceptance remains
  pending until observed. No global install or installed-engine activation.

## Current observed evidence

Main's repaired fixture uses legitimate project trust rather than bypassing it.
The saved `task1-valid-red.log` reports 5 intended assertion failures, 3 positive
passes and zero harness errors against unchanged production. It does not prove
native mode, complete preservation or any artifact gate. Two of the positive
passes are load-count smoke tests and must be strengthened under D-07.

## Deferred Ideas

Desktop/platform visual acceptance, independent R parity, Rust execution ownership,
release/publication and default activation remain outside the authorized six-step
execution. They remain required milestone gates, not deleted requirements.

## Unavailable evidence

`Rscript` is absent and actual R parity remains unverified. The Windows blueprint
has not been accessible or reviewed. Installed artifacts, desktop platforms and
Rust execution ownership have not passed milestone acceptance.
