---
phase: 01-pi-independent-core-boundary
verified: 2026-11-05T08:48:14Z
status: passed
score: 4/4 must-haves verified
covered_files: [
    ".planning/phases/01-pi-independent-core-boundary/01-01-PLAN.md",
    ".planning/phases/01-pi-independent-core-boundary/01-01-SUMMARY.md",
    ".planning/phases/01-pi-independent-core-boundary/01-REVIEW-DISPOSITION.md",
    ".planning/phases/01-pi-independent-core-boundary/01-REVIEW.md",
    ".planning/phases/01-pi-independent-core-boundary/01-SECURITY.md",
    ".planning/phases/01-pi-independent-core-boundary/01-VALIDATION.md",
    "packages/coding-agent/docs/omk-2-migration.md",
    "packages/coding-agent/docs/packages.md",
    "packages/coding-agent/src/core/package-extension-entries.ts",
    "packages/coding-agent/src/core/package-manager.ts",
    "packages/coding-agent/src/core/package-manifest.ts",
    "packages/coding-agent/test/package-manifest-auto-boundary.test.ts",
    "packages/coding-agent/test/package-manifest-boundary.test.ts",
    "packages/coding-agent/test/package-manifest-branch-boundary.test.ts",
    "packages/coding-agent/test/package-manifest.test.ts",
    "specs/108-pi-decoupling/spec.md"
  ]
covered_digest: "v4:sha256:b67ab8f08439a322edaad06a4c6f47271bd9d9263f3ccad77f42b7ba01739e62"
behavior_unverified: 0
overrides_applied: 0
decision_coverage:
  honored: 0
  total: 0
  not_honored: []
human_verification: []
---

# Phase 1: Pi-independent core boundary Verification Report

**Phase Goal:** Deliver the first tested native/legacy boundary and align the migration contract while preserving the current release baseline and unrelated local work.
**Verified:** 2026-11-05T08:48:14Z
**Status:** passed
**Scope:** V2-BOUNDARY-01 only. This is not OMK 2.0 readiness or release acceptance.
**Re-verification:** Fresh final assessment after CR-01/CR-02/CR-03 correction. No previous `*-VERIFICATION.md` was present at entry; the earlier goal-verifier PASS was not inherited.

The bounded goal is achieved. Phase and requirement state remain pending until the owner accepts this report. No completion workflow or other state update was performed.

## Goal Achievement

### Observable Truths

ROADMAP defines the goal but no additional success-criteria array. These are all four current PLAN truths, checked against code and behavioral evidence rather than SUMMARY claims. Paths abbreviated below are relative to `packages/coding-agent/`.

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | Explicit native managed-package resolution loads an OMK extension. | VERIFIED | `src/core/package-manager.ts:688-696,1950-1982,2126-2128` selects real manifest paths. `test/package-manifest-boundary.test.ts:80-95` passes those paths to real `loadExtensions`, asserts exact paths for all four resource types, zero loader errors and command registration. Independently rerun, 1 passed. |
| 2 | Pi-only manifests are terminal policy rejections in native mode, not absent manifests eligible for convention fallback. | VERIFIED | `src/core/package-manifest.ts:109-120,128-138` throws `PackageManifestPolicyError` outside the JSON-decoding catch. Manager validates before filters at `:1956`; local-source catch at `:1104-1120` cannot reach fallback after rejection. Helper `:99-123` returns terminal `[]` for rejected nested packages. Independent unfiltered, filtered, wrapper, directory and branch controls passed; rejected sentinels remain absent. |
| 3 | Omitted policy preserves the current 1.x behavior and legacy runtime aliases. | VERIFIED | Dialect default is explicitly `omk+pi` at `src/core/package-manifest.ts:10,107,125`; the manager copies the validated primitive at `:529-535`. Wrapper/directory/branch tests assert omitted and explicit compatibility results. Original compatibility tests and moved collector/ignore bodies remain unchanged as detailed below. Independently rerun legacy alias loading registers `legacy-pi` through Node and exercises the virtual-module seam. Invalid constructor values and caller-option mutation controls also passed. |
| 4 | This slice does not claim direct-loader, installed-binary or full Pi-independence acceptance. | VERIFIED | `docs/packages.md:94-118`, `docs/omk-2-migration.md:244-272` and `specs/108-pi-decoupling/spec.md:12-50` explicitly limit the API and claims. Loader and alias files match saved pre-edit digests. Version remains 1.5.10. No native default, SDK/session propagation, import firewall, sandbox, installed-artifact or full-milestone acceptance is asserted. |

**Score:** 4/4 truths verified, 0 behavior-unverified, 0 overrides. No coincidental-reliance qualification was needed: defaults, validation, awaited loading, branch-local ancestry and final deduplication are enforced by code, not test-only ordering.

### Review Counterexamples

| Finding | Actual correction and evidence | Final disposition |
|---|---|---|
| CR-01, native wrapper admits a Pi-only directory | `package-extension-entries.ts:103-123` recursively checks directory manifests before collection; a rejection returns `[]`, never an index fallback. Both user/project wrapper cases select and load the allowed sibling only, with no Pi sentinel. | RESOLVED; independently rerun 2 cases. |
| CR-02, wildcard and directory-valued declarations | Shared `resolveManifestPaths` expands globs at `:72-85`; native directory matches enter the existing `collectAutoExtensionEntries` at `:114-120`. Manager uses that same collector at `package-manager.ts:514-520,2316-2333`. All four user/project glob/literal cases select actual files, match managed resolution and load two real extensions without errors. | RESOLVED; independently rerun 4 directory cases; file-glob/exclusion controls also pass in the inspected final 266-test receipt. |
| CR-03, earlier filtered/depth-truncated branch suppresses an independent route | `package-extension-entries.ts:91-98,114-123,143-154,187-190` carries only active canonical ancestors, copying the set per branch. There is no global completed cache. Existing manager canonical dedup remains at `:2374-2391`. Both declaration orders retain the allowed file; the deep-only route remains truncated. | RESOLVED; independently rerun all 4 branch cases. |

Self/symlink cycles, shallow/deep traversal and canonical single-load controls were also independently rerun. Inversion checks targeted admission bypass, hollow directory results and order-dependent suppression; none remained reproducible on the frozen inputs.

### Required Artifacts

All ten owned files exist and are substantive. Production wiring and test assertions were read, not inferred from existence.

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `packages/coding-agent/src/core/package-manifest.ts` | Validated dialect and distinct terminal policy error | VERIFIED | Own-key authority, unchanged lexical path validation, compatibility default and separate decode/policy handling. |
| `packages/coding-agent/src/core/package-manager.ts` | Immutable policy propagated through managed discovery | VERIFIED | Constructor, all manifest reads, filtered/unfiltered collection, local paths and user/project automatic discovery use the selection. |
| `packages/coding-agent/src/core/package-extension-entries.ts` | Shared glob/convention collection and bounded native traversal | VERIFIED | One reused collector; branch-local ancestry, depth64, ignore rules and native terminal rejection. No helper-to-manager import cycle. |
| `packages/coding-agent/test/package-manifest.test.ts` | Resolver and compatibility controls | VERIFIED | 22 active cases in final receipt; exact error/diagnostic/path assertions. Original compatibility block unchanged. |
| `packages/coding-agent/test/package-manifest-boundary.test.ts` | Real native registration and resource rejection | VERIFIED | 46 active cases; real filesystem, manager and loader; all four resource types and immutable/invalid options covered. |
| `packages/coding-agent/test/package-manifest-auto-boundary.test.ts` | Wrapper, globs, directory, cycle/depth and compatibility controls | VERIFIED | 23 active cases; exact selected paths, real loading and sentinel absence. |
| `packages/coding-agent/test/package-manifest-branch-boundary.test.ts` | Independent filtered/depth-truncated branches | VERIFIED | 4 active cases; both orders, managed parity, deep-only negative and compatibility controls. |
| `packages/coding-agent/docs/packages.md` | Actual constructor API and exclusions | VERIFIED | Native selection, shared discovery, compatibility and separate trust/import boundaries documented; spec link resolves to a tracked file. |
| `packages/coding-agent/docs/omk-2-migration.md` | Staged migration, not full acceptance | VERIFIED | Appended bounded construction contract; broader existing migration material preserved. |
| `specs/108-pi-decoupling/spec.md` | Authoritative staging contract | VERIFIED | Current 1.x compatibility and later 2.0 gates distinguished; existing broader equivalence criteria retained. |

Installed GSD `query verify.artifacts` returned exit 0, 6/6 declared artifacts passed. The four additional owned test/document artifacts above were checked manually.

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `src/core/package-manager.ts` | `src/core/package-manifest.ts` | Selected dialect for manifest reads | WIRED | Imports at `:43-49`; constructor `:535`; read `:2082`; filters validate at `:1956,2006,2057`. |
| `test/package-manifest-boundary.test.ts` | `src/core/extensions/loader.ts` | Real loader consumes manager-selected paths | WIRED | Import `:5`; path mapping and awaited loading `:83-94`; actual loader awaits each factory at `loader.ts:489-507,534-552`. |
| `test/package-manifest-boundary.test.ts` | `src/core/package-manager.ts` | Pi-only rejection through unfiltered/filtered discovery | WIRED | Import `:6`, constructor `:45-48`, assertions `:97-122,232-271`; both key rejection checks independently rerun. |
| `src/core/package-manager.ts` | `src/core/package-extension-entries.ts` | Shared expansion and directory collection | WIRED | Imports `:34-41`; collection `:519,1990,2015,2075,2127,2221,2271,2326`; helper recursively retains the dialect. |

Installed `query verify.key-links` returned exit 1 with four heuristic `Target not referenced in source` results. These are disproved by the relative imports and actual calls above; no override was applied. Manual wiring verification establishes all four links.

### Data-Flow Trace (Level 4)

There is no rendered UI in this foundation slice. The equivalent runtime data trace was checked.

| Artifact/output | Real source | Flow | Status |
|---|---|---|---|
| Manifest resources | Filesystem `package.json`, `readFileSync` and `JSON.parse` | Authority and dialect determine parsed resources or terminal rejection. | FLOWING |
| Selected extension paths | `globSync`, `statSync`, directory entries and ignore files | Shared collector applies nested policy and branch-local bounds; manager produces canonically deduplicated paths. | FLOWING |
| Registered native command | Selected extension source file | Real Jiti import, awaited factory, `registerCommand`, observed command map. | FLOWING |

Empty arrays on rejected, filtered or depth-truncated branches are intentional terminal results, not static substitutes for valid resource data.

### Behavioral Spot-Checks

This verifier ran the following named-test selections from `packages/coding-agent`. Each completed in under 10 seconds and exited 0. No full/root suite was repeated.

Exact command template, substituting the file and selector from each row:

```sh
TMPDIR=/mnt/omkdata/tmp/opencode LIVE_E2E=0 npm_config_offline=true GIT_ALLOW_PROTOCOL=file node ../../node_modules/vitest/dist/cli.js --run --no-cache test/FILE -t "SELECTOR"
```

| File | Exact selector | Result | Status |
|---|---|---|---|
| `package-manifest-boundary.test.ts` | `registers a native command through manager-selected paths and the real loader` | 1 passed | PASS |
| `package-manifest-boundary.test.ts` | `rejects a Pi-only package without declared or conventional resource contribution` | 1 passed | PASS |
| `package-manifest-boundary.test.ts` | `rejects filtered Pi-only packages` | 3 passed | PASS |
| `package-manifest-boundary.test.ts` | `copies the dialect primitive instead of retaining the caller's options object` | 1 passed | PASS |
| `package-manifest-boundary.test.ts` | `rejects an untyped constructor dialect` | 6 passed | PASS |
| `package-manifest.test.ts` | `does not turn a policy error into a JSON diagnostic` | 1 passed | PASS |
| `package-manifest-auto-boundary.test.ts` | `rejects a Pi-only directory declared by a native wrapper` | 2 passed | PASS |
| `package-manifest-auto-boundary.test.ts` | `collects native conventional directories` | 4 passed | PASS |
| `package-manifest-auto-boundary.test.ts` | `terminates a native manifest` | 2 passed | PASS |
| `package-manifest-auto-boundary.test.ts` | `bounds native manifest traversal` | 2 passed | PASS |
| `package-manifest-auto-boundary.test.ts` | `selects and loads a canonical native extension only once across directory aliases` | 1 passed | PASS |
| `package-manifest-branch-boundary.test.ts` | `retains an independently allowed shared branch` | 2 passed | PASS |
| `package-manifest-branch-boundary.test.ts` | `retains a short route after depth truncation` | 2 passed | PASS |
| `extensions-discovery.test.ts` | `loads supported legacy Pi imports through Node aliases and Bun virtual modules` | 1 passed | PASS |

**Fresh result:** 29 selected cases passed across 14 named selections, zero failures. Other cases reported as skipped by these `-t` filters were not executed in these spot-checks; they are not disabled tests or additional acceptance evidence.

### Reused Broader Evidence and Preservation Checks

Inspected `/mnt/omkdata/tmp/opencode/omk-native-branch-correction-NnqXllJa/verification-main.json`, parsed `red.xml` and `green-main.xml`, and read the root-check log. These are reused observations, not commands newly run by this verifier.

| Evidence | Independently inspected result |
|---|---|
| Latest correction RED | 27 cases, 6 intended assertion failures, 21 passes, zero errors. Four directory cases and filtered-first/deep-first routes failed before the fix. |
| Main ten-file GREEN | 266 tests, zero failures/errors/skips; receipt records exit 0. |
| Main root `npm run check` | Receipt records exit 0; log records 555 passed script tests, 30 skipped, zero failed. Full log SHA-256 matches the receipt. |
| Final independent code review | Current REVIEW resolves CR-01/CR-02/CR-03 with zero unresolved findings. Its separate 27-test run and nine filesystem assertions are reviewer evidence, not this verifier's runs. |
| Frozen source integrity | All 10 current owned-file digests match main's receipt before and after spot-checks. All 16 initial and 6 correction backups match their saved manifests. All 10 backed-up non-owned current files match the originals, including loader, aliases and inventories. |
| Scoped structural comparisons | TypeScript AST body comparisons confirm unchanged moved `toPosixPath`, `prefixIgnorePattern` and `addIgnoreRules`, unchanged original validation/parser bodies and original compatibility test block. The existing automatic collector body matches after removing only native ancestry/depth plumbing. The entire manager class matches the latest-correction backup. |
| Size controls | Manager 2160/2289, helper 168/250, auto test 208/250, branch test 74/250 pure LOC; measured with the existing counter, no baseline edit. |
| Git and version controls | HEAD remains `0d6e74b0d21cdb810c88c42381457eff944b935f`; index-entry SHA-256 matches the saved baseline. Root and coding-agent versions remain 1.5.10. Scoped `git diff --check` passes. |

Hashes establish local snapshot consistency, not authentication or correctness. Existing dirty manifests, locks and unrelated module-size-baseline entries were not attributed to this task; no clean-tree or full-repository acceptance claim is made. None was edited by this verifier.

### Probe Execution

Not applicable. No shell probe is declared by this PLAN/SUMMARY and no `scripts/**/tests/probe-*.sh` was found. The independent named behavioral checks above execute production paths rather than substituting SUMMARY PASS markers.

### Requirements Coverage

| Requirement | Source plan | Description | Status | Evidence |
|---|---|---|---|---|
| V2-BOUNDARY-01 | `01-01-PLAN.md` | Classify and test native versus legacy extension resolution without accidentally releasing breaking 2.0 semantics as 1.x. | SATISFIED for this verification | All four truths, real loading/rejection controls, unchanged compatibility default and explicit staged documentation. Requirement checkbox and phase status remain pending owner acceptance. |

Coverage is 1/1 assigned requirements. No orphaned Phase 1 requirement was found. V2-CORE-01, V2-MIGRATE-01, V2-API-01 and later requirements are not claimed here.

### Decision Coverage

No CONTEXT.md - nothing to check. Installed decision-coverage query exited 0 and explicitly skipped the gate. No PLAN human-check blocks, backstop truths or prohibition entries require separate disposition.

### Test Quality Audit

| Test file | Linked requirement | Active cases in inspected final GREEN | Disabled | Circular expected outputs | Strongest relevant assertion | Verdict |
|---|---|---|---|---|---|---|
| `test/package-manifest.test.ts` | V2-BOUNDARY-01 | 22 | 0 | None found | Exact resources, diagnostics and thrown policy error | PASS |
| `test/package-manifest-boundary.test.ts` | V2-BOUNDARY-01 | 46 | 0 | None found | Real registration, exact paths and absent execution sentinel | PASS |
| `test/package-manifest-auto-boundary.test.ts` | V2-BOUNDARY-01 | 23 | 0 | None found | Managed/automatic parity, real loading, cycle/depth controls | PASS |
| `test/package-manifest-branch-boundary.test.ts` | V2-BOUNDARY-01 | 4 | 0 | None found | Both orders plus deep-only negative result | PASS |

All ten phase-listed test files were scanned for disabled/todo/snapshot patterns. `pendingProviderRegistrations` was a regex false positive, not a pending test. Requirement regressions use manually constructed filesystem inputs and literal expected paths, not expectations generated by the implementation; new boundary tests do not mock the manifest resolver, manager, collector or loader. The removed read-count constraint was replaced by an exact selected-path assertion and successful single real load.

### Security Closure

Current SECURITY records 6/6 mitigated threats closed, zero open threats and no accepted or transferred risks. Its retrospective ASVS L1 depth is not isolation certification. Actual code checks support immutable validated policy, authoritative keys and lexical paths, rejection before fallback, branch-local depth/cycle bounds, existing final deduplication and preserved trust/script-opt-in call sites. No additional in-scope security blocker was found.

### Anti-Patterns Found

| File/scope | Pattern checked | Classification | Impact |
|---|---|---|---|
| Ten owned files | Unreferenced TBD/FIXME/XXX, TODO/HACK/PLACEHOLDER, stubs and weakened tests | None found | No BLOCKER or WARNING. |
| Collector and resolver | Empty arrays/null | Intentional terminal/absence results | Valid resource branches are populated from actual files and exercised through real loading. |
| Out-of-scope existing dirty files | Baseline differences against HEAD | Excluded from task attribution | Not evidence of a phase regression; original-overlay comparisons used instead. |

No unresolved must-have, broken link, hollow artifact, debt marker or reproducible in-scope counterexample remains.

### Human Verification Required

None. Infrastructure/foundation phase with no new interactive surface; all bounded criteria have programmatic evidence. Owner acceptance of the report is a workflow decision, not an untested runtime truth.

### Scope Exclusions and Later Gates

- Phase 2 owns final native-default activation, removal of implicit Pi compatibility, owned-resource migration and extension/provider/tool API acceptance across artifacts. This report does not certify direct-loader import enforcement, locally installed Pi isolation, transitive/subpath imports, sandboxing or session/SDK propagation.
- No new environment flag, setting or CLI switch was introduced. Direct loading, installation and project trust retain separate contracts. The virtual-module test seam is not an installed Bun/compiled-binary acceptance run.
- Phase 4 owns independent R parity and recovery. R is unavailable in the retained environment evidence; no R oracle was run, and the root-check skips do not satisfy that milestone gap.
- Phase 5 owns Rust execution ownership and native workbench acceptance. Phase 6 owns installation, rollback, platform and release acceptance. Clipboard, visual/input/IME, real reconnect behavior and actual packaged/binary/platform acceptance are not established here.
- Observed local runtime is Node 26.12.1/npm 11.20.0 on Linux. This is not proof of minimum-runtime or other-platform acceptance, benchmark equivalence, performance improvement or release eligibility.

These are explicit scope boundaries, not failed Phase 1 must-haves deferred to manufacture a PASS. No in-scope gap was deferred.

### Gaps Summary

**No concrete blockers or warnings remain for V2-BOUNDARY-01.** All four truths are verified on the corrected snapshot. Earlier PASS narration was replaced by actual source tracing, preserved-baseline comparisons and independent named behavioral runs.

The installed `query verification.fingerprint` succeeded and supplied the coverage metadata above for exactly 16 inputs: final PLAN/SUMMARY, ten owned implementation/test/document files, and current VALIDATION/SECURITY/REVIEW/REVIEW-DISPOSITION. The report itself, STATE, ROADMAP, REQUIREMENTS and external logs are excluded. Only this report was written; no staging, commit, install, build, provider invocation, workflow initialization or phase completion was performed.

Write-time self-check: installed `query verification.status .planning/phases/01-pi-independent-core-boundary --pick status` returned `passed`, exit 0.

---

_Verified: 2026-11-05T08:48:14Z_
_Verifier: the agent (gsd-verifier)_
