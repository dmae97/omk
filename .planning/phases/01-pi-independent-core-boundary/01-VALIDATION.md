---
phase: "01"
slug: pi-independent-core-boundary
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-11-05
---

# Phase 1 validation coverage

V2-BOUNDARY-01 has initial automated coverage for both tasks, but the later code
review found two missing cases. CR-01 native wrapper-directory admission and
CR-02 automatic wildcard expansion now have real-file RED/GREEN regressions.
The later directory-valued and CR-03 branch-order counterexamples also have
observed real-file RED/GREEN corrections.
Final independent code review resolves CR-01/CR-02/CR-03 with no blockers or
warnings. The affected security threat is verified closed.

## Test infrastructure

| Property | Value |
|---|---|
| Framework | Existing Vitest |
| Config | `packages/coding-agent/vitest.config.ts` |
| Quick check | Manifest boundary and resolver files |
| Phase check | Ten explicit files listed below |
| Repository check | `npm run check` from the root, separate from Vitest |
| Full Vitest suite | Not run, prohibited by repository rules for this task |

Run the quick check from `packages/coding-agent`:

```sh
node ../../node_modules/vitest/dist/cli.js --run test/package-manifest-boundary.test.ts test/package-manifest.test.ts
```

Run the phase check from the same directory:

```sh
node ../../node_modules/vitest/dist/cli.js --run test/package-manifest-boundary.test.ts test/package-manifest.test.ts test/package-manager.test.ts test/extensions-discovery.test.ts test/extensions-pi-provider-compat.test.ts test/extension-loader-lazy-imports.test.ts test/package-doctor.test.ts test/package-doctor-cli.test.ts test/package-manifest-auto-boundary.test.ts test/package-manifest-branch-boundary.test.ts
```

## Per-task verification map

| Task ID | Plan | Wave | Requirement | Verification | Existing files | Status |
|---|---|---|---|---|---|---|
| 01-01-01 | 01 | 1 | V2-BOUNDARY-01 | Quick check exercises native registration and terminal Pi rejection | Both present | Green |
| 01-01-02 | 01 | 1 | V2-BOUNDARY-01 | Phase check and root check cover negative controls and existing compatibility | All present | Green |
| 01-01-02 review correction | 01 | 1 | V2-BOUNDARY-01 | Auto/branch tests cover all review cases, siblings, cycles and compatibility | Present | Green, independently reviewed |

## Requirement coverage

| Behavior | Evidence |
|---|---|
| Real native extension registration | Boundary integration test invokes `loadExtensions` |
| No Pi-only declared or conventional resources | All four resource types, filters, nested and automatic discovery controls |
| Immutable and validated construction policy | Caller mutation, explicit `null`, unknown values and omitted policy controls |
| Existing compatibility behavior | Pi defaults, authoritative `omk`, conventions and nested index fallback controls |
| Policy distinct from JSON decoding | Resolver error controls |
| Intermediate native wrapper and wildcard declarations | Real-file user/project automatic-discovery controls with managed/default comparisons |
| Bounded nested discovery | Self/symlink cycles, canonical aliases and depth controls |
| Complete directory collection and independent branches | Real-file directory-glob/literal parity, both filtered-branch orders and both shallow/deep orders |

## Sampling and observed results

- The first integration pair ran against unchanged source and produced one intended
  assertion failure, one pass and zero harness errors.
- The executor ran focused checks during implementation and the initial eight-file phase check.
- Main independently reran that check with 239 passed tests, before the two review findings.
- The two findings reproduced as four real-file assertion failures with zero harness errors.
- After correction, main independently reran nine files with 258 passed tests,
  including 19 new regression/control cases.
- The directory/branch correction then produced six assertion failures and 21
  passes before source edits. Main's latest rerun passes 266 tests across ten files.
- Main ran `npm run check`, which exited 0 with 555 passed script tests, 30 skipped and zero failed.
- The independent goal verifier reran selected behavioral and resolver controls.
- No new framework, dependency or test setup was required. No watch mode was used.

## Manual-only verifications

None for V2-BOUNDARY-01. This coverage does not include installed binaries,
direct imports, visual behavior, R parity, Rust ownership or desktop platforms.
The skipped R tests remain a separate milestone gap.

## Validation sign-off

- [x] Both tasks have automated verification and existing test files.
- [x] No sequence of three unverified tasks exists.
- [x] Add and verify the CR-01 and CR-02 regressions with existing infrastructure.
- [x] Commands name explicit files and do not activate the full Vitest suite.
- [x] Observed RED and GREEN evidence is retained in the plan summary.
- [x] Restore `nyquist_compliant: true` after the review gaps close.

No commits were created because the operator did not authorize them.
