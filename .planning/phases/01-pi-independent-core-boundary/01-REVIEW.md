---
phase: 01-pi-independent-core-boundary
reviewed: 2026-11-05T08:35:59Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - packages/coding-agent/src/core/package-manifest.ts
  - packages/coding-agent/src/core/package-manager.ts
  - packages/coding-agent/src/core/package-extension-entries.ts
  - packages/coding-agent/test/package-manifest.test.ts
  - packages/coding-agent/test/package-manifest-boundary.test.ts
  - packages/coding-agent/test/package-manifest-auto-boundary.test.ts
  - packages/coding-agent/test/package-manifest-branch-boundary.test.ts
  - packages/coding-agent/docs/packages.md
  - packages/coding-agent/docs/omk-2-migration.md
  - specs/108-pi-decoupling/spec.md
findings:
  critical: 0
  warning: 0
  info: 0
  total: 0
  necessity: 0
status: clean
---

# Phase 1: Code Review Report

**Reviewed:** 2026-11-05T08:35:59Z
**Depth:** standard
**Files Reviewed:** 10
**Status:** clean
**Verdict:** PASS for V2-BOUNDARY-01 code closure only.

## Summary

CR-01, CR-02 and CR-03 are resolved against the frozen sources. No additional evidence-backed blocker, warning or necessity finding was identified in this bounded review. Counts above include unresolved findings only, not the historical blockers below.

Read all ten scoped files, the plan, summary and preserved reports. Compared the initial slice with `/mnt/omkdata/tmp/opencode/omk-v2-first-slice-ch6d0wsb/` originals and the latest correction with `/mnt/omkdata/tmp/opencode/omk-native-discovery-correction-bt74_tow/`. Review did not use unrelated dirty changes as task deltas.

## Narrative Findings (AI reviewer)

### Historical finding dispositions

The original report is preserved at `/mnt/omkdata/tmp/opencode/omk-manifest-review-fix-3rM1a8nA/initial-REVIEW.md`. The preceding closure report, including the remaining directory reproduction and CR-03, is preserved at `/mnt/omkdata/tmp/opencode/omk-native-branch-correction-NnqXllJa/prior-REVIEW.md`. Original severity is retained; resolution is not a severity downgrade.

#### CR-01: Native wrapper manifests admit Pi-only extension directories

**Classification:** BLOCKER, historical.
**Disposition:** RESOLVED; earlier closure remains valid.
**Original file:** `/home/dmae97/Project/omk/packages/coding-agent/src/core/package-manager.ts:574-581` before extraction.
**Issue:** A native wrapper admitted an existing declared directory without checking that directory's Pi-only manifest.
**Fix applied:** `/home/dmae97/Project/omk/packages/coding-agent/src/core/package-extension-entries.ts:99-123` applies native policy through the shared directory collector and returns a terminal empty result for policy rejection instead of reviving a directory or index fallback.
**Evidence:** `/home/dmae97/Project/omk/packages/coding-agent/test/package-manifest-auto-boundary.test.ts:50-83` covers both user and project roots, an allowed sibling, managed/automatic selection, successful real command registration and an absent legacy execution sentinel. These tests passed in this reviewer's rerun. The directory-collection cases at lines 146-185 additionally retain nested Pi rejection after the latest collector change. No further fix requested.

#### CR-02: Native automatic discovery drops valid OMK wildcard entries

**Classification:** BLOCKER, historical.
**Disposition:** RESOLVED, including the previously unresolved directory-valued glob and literal cases.
**Original files:** `/home/dmae97/Project/omk/packages/coding-agent/src/core/package-manager.ts:574-581` before extraction; preceding closure cited `/home/dmae97/Project/omk/packages/coding-agent/src/core/package-extension-entries.ts:64-68,76-85`.
**Issue:** The first correction expanded file globs but still emitted conventional directories themselves instead of their extension files.
**Fix applied:** Current `/home/dmae97/Project/omk/packages/coding-agent/src/core/package-extension-entries.ts:72-85,111-123,140-198` expands native declarations and passes directory matches through the same collector used by managed collection at `/home/dmae97/Project/omk/packages/coding-agent/src/core/package-manager.ts:514-520,2126-2128,2316-2333`. No second convention scanner or manager callback was introduced.
**Evidence:** `/home/dmae97/Project/omk/packages/coding-agent/test/package-manifest-auto-boundary.test.ts:146-185` now selects `groups/one/native.ts`, not the unresolved `groups/one` directory, for both `./groups/*` and `./groups/one` under both automatic roots. Each case asserts managed parity, retains an allowed sibling, loads two real extensions without errors and leaves the nested Pi sentinel absent. File-glob and exclusion controls at lines 85-102 and 202-210 also pass. Omitted and explicit compatibility selections remain their historical results. No further fix requested.

#### CR-03: Global traversal deduplication suppresses independent sibling branches

**Classification:** BLOCKER, historical.
**Disposition:** RESOLVED for both filtered-first and depth-truncated-first routes.
**Original file:** `/home/dmae97/Project/omk/packages/coding-agent/src/core/package-extension-entries.ts:42-45,64-71` in the preceding correction.
**Issue:** A global visited set made an earlier excluded or depth-truncated route suppress a later independent allowed route.
**Fix applied:** Current `/home/dmae97/Project/omk/packages/coding-agent/src/core/package-extension-entries.ts:88-98,114-123,140-154,187-190` carries a `ReadonlySet` of active canonical ancestors and clones it per branch. There is no completed-result cache. Final canonical deduplication remains in `/home/dmae97/Project/omk/packages/coding-agent/src/core/package-manager.ts:2374-2391`.
**Evidence:** `/home/dmae97/Project/omk/packages/coding-agent/test/package-manifest-branch-boundary.test.ts:42-80` asserts the selected native file in both declaration orders, checks that the deep route alone remains truncated, compares managed selection and preserves omitted/explicit compatibility controls. All four cases passed in this reviewer's rerun. Self/symlink-cycle, bounded-depth and canonical single-load controls at `/home/dmae97/Project/omk/packages/coding-agent/test/package-manifest-auto-boundary.test.ts:104-144` also passed. No further fix requested.

### Additional adversarial checks

- Independently compared TypeScript function bodies. `toPosixPath`, `prefixIgnorePattern` and `addIgnoreRules` match their saved manager bodies exactly. The automatic collector body matches after removing only the added native ancestry/depth plumbing. The entire `DefaultPackageManager` class declaration matches the latest correction baseline exactly.
- Traced helper imports through manifest, patterns and path utilities. No helper-to-manager cycle or duplicate manager scanner/ignore implementation was introduced. Shared glob options and the source/override split retain the original managed behavior.
- A separate real-filesystem Node probe imported the production helper without dependency stubs. For each of `.gitignore`, `.ignore` and `.fdignore`, native declared-directory collection retained the allowed file and nested index, excluded ignored files/directories, skipped dot entries and `node_modules`, rejected a nested Pi directory, and did not inherit the parent ignore rule. Compatibility collector and literal-directory controls retained their existing results. All nine assertions passed; the scratch fixture root was removed.
- The earlier malformed-JSON sibling-loss suggestion remains unsubstantiated, not an open finding. Decode/read failures become diagnostics at `/home/dmae97/Project/omk/packages/coding-agent/src/core/package-manifest.ts:128-138`; native nested diagnostics return an empty result at `/home/dmae97/Project/omk/packages/coding-agent/src/core/package-extension-entries.ts:108-110`. No newly identified failing real-file input remains.
- The alias regression still asserts the exact canonical selected path. Replacing a manifest-read-count spy with successful real loading and command registration at `package-manifest-auto-boundary.test.ts:128-144` removes an implementation constraint, not a public-behavior assertion. The existing selection assertions were retained.

## Review evidence and limits

### Reused verification

Evidence directory: `/mnt/omkdata/tmp/opencode/omk-native-branch-correction-NnqXllJa/`.

- Inspected `red.xml`: 27 tests, six assertion failures, 21 passes, zero harness errors. Four failures are the user/project directory-glob/literal cases; two are filtered-first/deep-first routes. Reverse-order controls passed. The retained RED process exit is 1.
- Parsed `green-main.xml` and worker `green-final-offline.xml`: each records 266 tests across ten files, zero failures/errors/skips. Main's exit 0 is recorded in `verification-main.json`; the worker's retained exit receipt is also 0. These are reused runs, not new reviewer runs.
- Matched the full `root-check-main.log` SHA-256 to `verification-main.json`. Its script summary records 555 passed, 30 skipped, zero failed; the receipt records root-check exit 0. No root check was rerun by this reviewer.
- All ten current scoped file digests matched `verification-main.json` before and after review tests/probes. All sixteen initial backups and six latest-correction backups matched their manifests. All ten backed-up non-owned current files remained unchanged, including the loader lifecycle overlay, aliases and inventories. Hashes are local integrity observations, not authentication or correctness proofs.
- HEAD remains `0d6e74b0d21cdb810c88c42381457eff944b935f`. Git index-entry SHA-256 remains `4cceb1d78c4a7e21456ad50f24e3d90b6d30467cf4f2a35b6a9d9618454d1b9e`.

### Independent narrow rerun

From `packages/coding-agent`:

```sh
TMPDIR=/mnt/omkdata/tmp/opencode LIVE_E2E=0 npm_config_offline=true GIT_ALLOW_PROTOCOL=file node ../../node_modules/vitest/dist/cli.js --run --no-cache test/package-manifest-auto-boundary.test.ts test/package-manifest-branch-boundary.test.ts
```

Result: exit 0, two files and 27 tests passed, no failures or skips. This includes every corrected directory/branch case and the CR-01, compatibility, cycle, depth and single-load controls in those files.

### Boundaries

- This is code closure for constructor-selected managed-resource resolution only. It does not close the whole phase or replace the separate security auditor's register closure.
- No direct-loader sandbox/import-firewall or universal filesystem quota was required or certified. SDK/session/CLI propagation, default-native activation, installed artifacts, R parity, Rust execution ownership and desktop/platform acceptance remain later gates.
- The only persistent artifact written by this reviewer is this report. No source, test, documentation, state, alias, inventory, lock or version edits; no staging, commits, installation, build, provider invocation or full/root tests. No structural fallow pre-pass was supplied.

---

_Reviewed: 2026-11-05T08:35:59Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
