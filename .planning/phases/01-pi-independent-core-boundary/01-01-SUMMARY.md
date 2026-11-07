---
phase: 01-pi-independent-core-boundary
plan: 01
subsystem: packages
tags: [typescript, package-manifest, pi-migration, compatibility]
requires: []
provides:
  - Immutable constructor-selected managed-package manifest dialect.
  - Terminal rejection of Pi-only managed resources in explicit native mode.
  - Real package-manager-to-extension-loader regression coverage.
affects: [native-extensions-and-explicit-migration]
actuals:
  tasks: 2
  commits: 0
tech-stack:
  added: []
  patterns:
    - Validate the dialect once and retain the primitive independently of caller options.
    - Keep policy rejection distinct from malformed JSON and absent manifests.
key-files:
  created:
    - packages/coding-agent/test/package-manifest-boundary.test.ts
    - packages/coding-agent/test/package-manifest-auto-boundary.test.ts
    - packages/coding-agent/test/package-manifest-branch-boundary.test.ts
    - packages/coding-agent/src/core/package-extension-entries.ts
  modified:
    - packages/coding-agent/src/core/package-manifest.ts
    - packages/coding-agent/src/core/package-manager.ts
    - packages/coding-agent/test/package-manifest.test.ts
    - packages/coding-agent/docs/packages.md
    - packages/coding-agent/docs/omk-2-migration.md
    - specs/108-pi-decoupling/spec.md
key-decisions:
  - Omission and undefined preserve current 1.x compatibility.
  - Native activation remains constructor-only in this slice.
  - Runtime aliases and direct-loader import enforcement remain separate gates.
requirements-completed: [V2-BOUNDARY-01]
coverage:
  - id: D1
    description: Native managed packages register a command through the real loader.
    requirement: V2-BOUNDARY-01
    verification:
      - kind: integration
        ref: packages/coding-agent/test/package-manifest-boundary.test.ts
        status: pass
    human_judgment: false
  - id: D2
    description: Native rejection blocks declared and conventional Pi-only resources without changing compatibility defaults.
    requirement: V2-BOUNDARY-01
    verification:
      - kind: integration
        ref: packages/coding-agent/test/package-manifest-boundary.test.ts
        status: pass
      - kind: unit
        ref: packages/coding-agent/test/package-manifest.test.ts
        status: pass
    human_judgment: false
  - id: D3
    description: Native automatic discovery enforces nested policy, expands globs and terminates cycles.
    requirement: V2-BOUNDARY-01
    verification:
      - kind: integration
        ref: packages/coding-agent/test/package-manifest-auto-boundary.test.ts
        status: pass
      - kind: integration
        ref: packages/coding-agent/test/package-manifest-branch-boundary.test.ts
        status: pass
    human_judgment: false
completed: 2026-11-05
status: complete
---

# Explicit native managed-package manifest selection

`DefaultPackageManager` accepts `packageManifestDialect?: "omk" | "omk+pi"`.
Explicit native selection rejects Pi-only resources without changing current defaults.

## Accomplishments

- Added `PackageManifestPolicyError` outside the JSON-decoding catch.
- Propagated the immutable selection through manifest reads, resource filters,
  nested extension discovery and automatic discovery.
- Preserved authoritative `omk` precedence, convention-only packages and historical
  compatibility-mode nested index fallback.
- Rejected explicit `null` and unknown untyped values with `TypeError`.
- Documented the construction API and its exclusions in the package guide,
  migration notes and spec 108.

## Changed files

- `packages/coding-agent/src/core/package-manifest.ts` defines the dialect and policy error.
- `packages/coding-agent/src/core/package-manager.ts` carries the selected dialect through discovery.
- `packages/coding-agent/src/core/package-extension-entries.ts` shares manifest glob expansion and bounds native directory traversal.
- `packages/coding-agent/test/package-manifest-boundary.test.ts` exercises real registration and rejection.
- `packages/coding-agent/test/package-manifest.test.ts` covers resolver and error distinctions.
- `packages/coding-agent/test/package-manifest-auto-boundary.test.ts` covers the two review findings and cycle/compatibility controls.
- `packages/coding-agent/test/package-manifest-branch-boundary.test.ts` verifies order-independent filtered and depth-truncated branches.
- `packages/coding-agent/docs/packages.md` describes the supported construction API.
- `packages/coding-agent/docs/omk-2-migration.md` records the staged migration boundary.
- `specs/108-pi-decoupling/spec.md` retains the authoritative scope and deferred gates.

## Test evidence

The main agent ran this command from `packages/coding-agent` after implementation:

```sh
node ../../node_modules/vitest/dist/cli.js --run test/package-manifest-boundary.test.ts test/package-manifest.test.ts test/package-manager.test.ts test/extensions-discovery.test.ts test/extensions-pi-provider-compat.test.ts test/extension-loader-lazy-imports.test.ts test/package-doctor.test.ts test/package-doctor-cli.test.ts test/package-manifest-auto-boundary.test.ts test/package-manifest-branch-boundary.test.ts
```

| Check | Observed result |
|---|---|
| Initial two-test regression against unchanged source | Exit 1, one intended assertion failure, one pass, zero harness errors |
| Initial main targeted rerun | Exit 0, 239 tests passed across eight files |
| Review-correction RED | Four real-file assertion failures, zero harness errors |
| First correction main rerun | Exit 0, 258 tests passed across nine files |
| Branch/directory correction RED | Six assertion failures, 21 passes, zero harness errors |
| Latest main targeted rerun | Exit 0, 266 tests passed across ten files |
| Latest main root `npm run check` | Exit 0, script tests 555 passed, 30 skipped, zero failed |
| Initial independent verifier | Initial PASS superseded by later review; final phase-goal result is recorded separately |
| Final independent code review | PASS, CR-01/CR-02/CR-03 resolved, no blockers or warnings; 27 selected tests and nine real-filesystem assertions pass |
| Final security closure | Six threats closed, no open threats or accepted/transferred risks |
| Independent selected behavioral tests | Four selected tests passed, plus resolver controls |
| Scoped `git diff --check` | Exit 0 |
| Module-size guard after correction | Manager 2160/2289, helper 168/250, auto test 208/250, branch test 74/250 pure LOC |

The failed npm/Git diagnostics in package-manager tests come from negative fixtures.
They do not indicate a failed test run. R skips do not establish R parity.

## Evidence locations

Local evidence is under `/mnt/omkdata/tmp/opencode` and is not required by a fresh clone.

- `/mnt/omkdata/tmp/opencode/manifest-boundary-red-junit-KUZ8to.xml` records the intended assertion RED.
- `/mnt/omkdata/tmp/opencode/manifest-boundary-final-green-O9FN2e.log` records the worker's targeted GREEN.
- `/mnt/omkdata/tmp/opencode/omk-v2-first-slice-ch6d0wsb/root-check-main.log` retains the full root-check output.
- `/mnt/omkdata/tmp/opencode/omk-v2-first-slice-ch6d0wsb/verification-main.json` records main-run results and source digests.
- `/mnt/omkdata/tmp/opencode/omk-v2-first-slice-ch6d0wsb/manifest.json` identifies the pre-edit backups.
- `/mnt/omkdata/tmp/opencode/omk-manifest-review-fix-3rM1a8nA/red.xml` records both review defects before correction.
- `/mnt/omkdata/tmp/opencode/omk-manifest-review-fix-3rM1a8nA/green-main.xml` records main's earlier nine-file pass.
- `/mnt/omkdata/tmp/opencode/omk-manifest-review-fix-3rM1a8nA/root-check-main.log` retains main's post-correction root check.
- `/mnt/omkdata/tmp/opencode/omk-native-branch-correction-NnqXllJa/red.xml` records directory/branch regressions before source edits.
- `/mnt/omkdata/tmp/opencode/omk-native-branch-correction-NnqXllJa/green-main.xml` records main's ten-file pass.
- `/mnt/omkdata/tmp/opencode/omk-native-branch-correction-NnqXllJa/root-check-main.log` retains the latest root-check output.

These hashes are local integrity observations, not authentication or correctness proofs.

## Task commits

| Task | Commit status |
|---|---|
| 1. Contract alignment and production tracer | Uncommitted and unstaged, as required |
| 2. Negative controls and documentation | Uncommitted and unstaged, as required |

## Deviations and issues

- The enabled code review found CR-01 and CR-02 after the initial goal-verifier
  PASS. Native wrapper-directory admission and automatic wildcard expansion need
  real-file regressions and correction. This supersedes the initial completion
  assessment until those checks pass and review closes.
- The correction stays within managed-resource selection. It moves discovery and
  existing glob expansion into one focused helper to preserve the module-size
  allowance without duplication. Nineteen new tests cover the two defects and
  compatibility, exclusions, authoritative manifests, cycles and the depth bound.
- Closure review found directory-valued glob/literal collection incomplete and
  global traversal state suppressing valid sibling routes. The second correction
  reuses the existing automatic collector and ignore helpers, tracks active
  branch ancestry only, and leaves final canonical deduplication to the manager.
  Six real-file counterexamples failed before the fix and the final ten-file
  suite passes. An implementation-specific manifest-read-count assertion was
  replaced by canonical selection and one real successfully loaded extension.
- Replaced a package-guide link to the pre-existing untracked migration document
  with the tracked spec 108 link so a fresh checkout does not contain a broken link.
- Preserved the dirty loader, alias modules, inventories and all backed-up files
  outside the ten owned paths. HEAD and the Git index-entry digest stayed unchanged.
- GSD commit steps were not executed because commits were not authorized.

## Threat flags

The new mode governs managed resource selection. It does not prevent arbitrary
imports, sandbox extensions, prevent installation, or grant project trust.
Security review must not extend this claim to direct-loader or dependency isolation.

## Remaining milestone gates

Default-native activation, explicit runtime compatibility migration, direct loading,
installed Pi packages, transitive imports, subpaths, packaged Node and compiled
binaries remain unverified. Clipboard replacement, required R acceptance, Rust
execution ownership and native desktop/platform acceptance remain later work.
`Rscript` is unavailable. The Windows blueprint has not been reviewed.
The package version remains 1.5.10. No build, engine activation, push or release ran.

## Self-Check: PASSED

The counterexamples have observed RED/GREEN corrections, independent closure
review and security verification. The phase-goal report is a separate gate before
the orchestrator marks the phase complete.
