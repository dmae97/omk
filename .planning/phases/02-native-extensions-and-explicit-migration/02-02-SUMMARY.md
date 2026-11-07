---
phase: 02-native-extensions-and-explicit-migration
plan: "02"
subsystem: extensions
tags: [cli, sdk, package-doctor, native-loading, static-analysis, lifecycle]
status: complete
integration_status: pending-root-check
owned_files_frozen_at: "2026-11-05T13:35:19.191690+00:00"
requires:
  - phase: 02-01
    provides: Explicit native loader options and immutable DefaultResourceLoader selection
provides:
  - Validated explicit CLI dialect selection with real offline tool execution
  - Static native doctor target and exact declared-dependency diagnostics
  - Public SDK injection, bound tool validation and real provider-owner assertions
  - Passing reload and cwd/session lifecycle tests after the parent-owned stale-runtime fix
affects: [02-05, 02-06, native-extension-lifecycle]
tech-stack:
  added: []
  patterns: [immutable CLI primitive capture, compatibility-only inspection preparation, public loader injection]
key-files:
  created:
    - packages/coding-agent/src/core/package-doctor-runtime-imports.ts
    - packages/coding-agent/test/cli-native-extensions.test.ts
    - packages/coding-agent/test/package-doctor-native-profile.test.ts
    - packages/coding-agent/test/package-doctor-native-cli.test.ts
    - packages/coding-agent/test/sdk-native-extensions.test.ts
    - packages/coding-agent/test/native-extension-lifecycle.test.ts
  modified:
    - packages/coding-agent/src/cli/args.ts
    - packages/coding-agent/src/cli/help.ts
    - packages/coding-agent/src/main.ts
    - packages/coding-agent/src/core/package-doctor.ts
    - packages/coding-agent/src/commands/package-doctor-cli.ts
    - packages/coding-agent/test/args.test.ts
    - packages/coding-agent/docs/packages.md
    - packages/coding-agent/docs/omk-2-migration.md
    - specs/108-pi-decoupling/spec.md
key-decisions:
  - Preserve omission/undefined compatibility, 1.5.10, trust and fail-closed explicit-extension diagnostics.
  - Diagnose native imports statically without runtime declaration enforcement or installation certification.
  - Retain the stale-reload regression, accept the parent's minimal invalidation fix, and verify it without editing unowned lifecycle sources.
requirements-completed: []
coverage:
  - id: D1
    description: Explicit CLI selection and actual native/compatibility fixture execution
    verification:
      - kind: e2e
        ref: packages/coding-agent/test/cli-native-extensions.test.ts
        status: pass
    human_judgment: false
  - id: D2
    description: Static target diagnosis and unchanged compatibility JSON/originals
    verification:
      - kind: integration
        ref: packages/coding-agent/test/package-doctor-native-profile.test.ts
        status: pass
      - kind: e2e
        ref: packages/coding-agent/test/package-doctor-native-cli.test.ts
        status: pass
    human_judgment: false
  - id: D3
    description: Public SDK bound-tool execution and extension-owned provider registrations
    verification:
      - kind: integration
        ref: packages/coding-agent/test/sdk-native-extensions.test.ts
        status: pass
    human_judgment: false
  - id: D4
    description: Native lifecycle selection, trust and stale-context preservation
    verification:
      - kind: integration
        ref: packages/coding-agent/test/native-extension-lifecycle.test.ts
        status: pass
    human_judgment: false
actuals:
  tokens: 16898
  tasks: 3
  commits: 0
commits: 0
plan_head_before: 0d6e74b0d21cdb810c88c42381457eff944b935f
plan_head_after: 0d6e74b0d21cdb810c88c42381457eff944b935f
duration: 52min
completed: 2026-11-05
---

# Phase 2 Plan 2: Explicit native CLI, doctor and SDK consumers Summary

**Explicit native CLI/doctor selection, SDK tool/provider ownership and lifecycle guards pass the bounded source checks.**

## Status

- All three scoped tasks are complete. The parent-owned stale-reload fix is verified; root integration verification remains pending under the parent's coordination.
- No staging, commits, pushes, version changes, publication, global installation or provider calls.
- No STATE, ROADMAP or requirement completion updates. The parent owns integration and broader phase state.
- Current compatibility defaults and the older spec-108 equivalence/benchmark/module-swap criteria remain unchanged.

## Evidence and preservation

Owned pre-edit bytes, initial scoped diff and index snapshot are preserved under:

`/mnt/omkdata/tmp/opencode/omk-phase2-plan02-02-owned-nBnGx3/`

This is separate from the parent's original 36-file backup. The directory contains the original halted-handoff logs/digests. Final continuation evidence is in its `continuation-2Snuos/` subdirectory, including `owned-final.diff`, `actuals-final.json`, verification logs and `owned-freeze-final.json`.

- Index raw entries and HEAD are unchanged from this lane's start.
- The pre-existing main.ts domain-routing/scope block remains byte-identical.
- Everything from `## Key finding from step 1` onward in spec 108 remains byte-identical to the pre-edit bytes, including its equivalence and swap criteria.
- Final actuals are `ceil(67590 realized-diff characters / 4)`, measured against this lane's exact backups, including new files. The parent's unowned one-line session fix is credited separately, not counted as this lane's owned diff. Commit count is measured with `git rev-list --count <start>..HEAD`, not narrated.

## Task 1: CLI selection

Implemented space/equal forms, missing/empty/invalid/duplicate diagnostics and reservation from extension flags. main.ts captures the primitive once and passes it into each existing runtime factory's resource-loader options. Existing trust and explicit-extension diagnostics remain in place.

Actual source CLI subprocess assertions cover:

- Native selection executes the registered `native_receipt` tool with `{ value: 41 }` and obtains `42`, the fixture cwd and print mode.
- A local authored `@earendil-works/pi-ai/identity` dependency returns `user-installed-identity`, not an OMK alias.
- Omission and explicit compatibility execute a supported legacy alias and return `compatibility-alias`.
- Startup reports the legitimate trusted-project state; shutdown reports `quit`.
- An explicit missing legacy import reports an extension-load error before model/auth failure.
- Invalid selections never write the extension evaluation marker.
- A discovery-only missing extension remains a warning. Existing fail-closed behavior when `-e` is present was not weakened.
- Each fixture process guards fetch and socket connection attempts; observed attempt count is zero.

## Task 2: static doctor

The early-dispatched doctor parses its own target option before preparation, accepts either position around the single source, and retains usage exit 2. Preparation explicitly remains `omk+pi` so legacy files can be inspected without evaluation.

Native checks report Pi-only manifests as policy diagnostics without convention fallback. Literal legacy imports use the existing classifier and exact scoped package root. Runtime, peer and optional declarations produce unverified warnings; missing, similarly prefixed, development-only or malformed declarations do not satisfy that advisory check. Omission and explicit compatibility retain identical JSON, including actual local CLI output.

Tests preserve original bytes and side-effect sentinels, relative-source scanning, symlink containment, bare dependency exclusion, redaction and cleanup on scan failure. Existing doctor and transitive-scan tests pass unchanged.

## Task 3: SDK and lifecycle

Public exports supply a reloaded `DefaultResourceLoader` through the existing `createAgentSession` injection. The session consumes that exact loader/result. A registered tool runs through the real synthetic-provider/session executor, produces `42`, and rejects invalid arguments without a second tool-side receipt. Queued provider registrations flush; both queued and post-bind provider owners equal the actual extension path. No SDK source was changed and the fetch guard observed no calls.

Passing lifecycle controls verify native selection and goal-cost sink metadata through reload, new-session creation and a switch to a second cwd. Stored test-project trust is established through the real trust gate. Reload subscriptions do not duplicate, new/resume captures become stale, stale provider registration is rejected, and native selection does not grant trust to an unapproved project.

**Resolved by the parent:** the retained test at `native-extension-lifecycle.test.ts:224` originally failed because the captured `api.getActiveTools()` did not throw after reload. The parent added the existing `this._extensionRunner.invalidate()` call after successful resource-loader reload and before `_buildRuntime()` in `AgentSession._reload()`. Exact comparison with the parent's `agent-session-before-reload-fix.ts` backup confirmed that this was its only source change. This lane did not edit session/loader source.

The parent's preserved `stale-reload-red-main.log` confirms the intended failing API assertion; `stale-reload-green-main.log` records 54 passing tests across lifecycle, interactive reload, settlement and runner files. Both logs were read from `/mnt/omkdata/tmp/opencode/omk-phase2-native-extensions-backup/`. The independent final consumer rerun below passes all 161 tests, including both captured-API and captured-context stale assertions. No lifecycle test was skipped or weakened.

Scoped typechecking subsequently found three calls to the optional `ResourceLoader.getEventBus` method in the new lifecycle test. Type-only non-null assertions preserve the existing runtime calls, which still throw if absent; no behavioral assertion was removed. The scoped compiler config includes the existing source ambient declarations, matching the real root compiler environment without changing its strict options. The corrected scoped typecheck passes.

## RED/GREEN verification

Commands run from `packages/coding-agent` unless stated otherwise.

| Run | Actual result | Evidence |
|---|---|---|
| Task 1 JUnit RED, `args.test.ts cli-native-extensions.test.ts` | 91 passed, 11 intended failures, 0 errors | `evidence/02-02-task1-red.json`, `.xml` |
| Task 2 JUnit RED, both native doctor companions | 10 passed, 15 intended failures, 0 errors | `evidence/02-02-task2-red.json`, `.xml` |
| Initial task 1/2 GREEN, seven explicit files | 145 passed | `task1-2-green.log` |
| Expanded CLI tool/identity controls | 106 passed across two files | `task1-consumer-green.log` |
| Public SDK injection test | 1 passed | `task3-sdk.log` |
| Nineteen-file frozen phase-1 plus consumer/adjacent group | 414 passed, 2 failed | `final-targeted.log`; one failure was the discovery fixture assumption corrected without production changes |
| Pre-parent-fix ten-file passing group | 158 passed, 0 failed | `final-owned-passing.log` |
| Pre-parent-fix lifecycle group | 2 passed, 1 failed, 0 errors/skips | `evidence/02-02-lifecycle-final.xml`, `task3-lifecycle-final.log` |
| Parent stale-reload RED then GREEN | 1 intended RED failure; then 54 passed across four files | Parent `stale-reload-{red,green}-main.log` |
| Final independent eleven-file consumer group, `--maxWorkers=1` | 161 passed, 0 failed/skipped | `continuation-2Snuos/final-consumer-frozen-green.log` |
| Scoped source/test core typecheck, inherited strict root options | Exit 0 | `continuation-2Snuos/core-typecheck-green.log` |
| Scoped read-only Biome check, 12 source/test files | Passed, no writes | `biome-final.log`; repeated after final edits |
| Local doc links in the three edited docs | 12 checked, 0 missing | Observed local check |
| Scoped `git diff --check` | Passed | Observed local check |

Both initial assertion RED records and the retained stale-reload RED record return `RED_EVIDENCE_OK` from `gsd-tools check tdd-red-evidence`, rechecked during continuation. Semantic inspection confirmed planned assertions, not fixture/import/collection errors. Initial TAP output was rejected as malformed by the classifier; complete original TAP logs remain preserved, and the real tests were rerun using JUnit before production edits. No source was reverted to manufacture a second RED after the parent's fix.

The latest passing command was:

```sh
LIVE_E2E=0 node ../../node_modules/vitest/dist/cli.js --run test/args.test.ts test/cli-native-extensions.test.ts test/package-doctor-native-profile.test.ts test/package-doctor-native-cli.test.ts test/package-doctor-cli.test.ts test/package-doctor.test.ts test/package-doctor-transitive-scan.test.ts test/sdk-native-extensions.test.ts test/pi-compat-exports.test.ts test/sdk-tool-execution-settings.test.ts test/native-extension-lifecycle.test.ts --maxWorkers=1
```

Scoped typecheck from the repository root:

```sh
node node_modules/@typescript/native-preview/bin/tsgo.js --noEmit -p .planning/phases/02-native-extensions-and-explicit-migration/evidence/02-02-typecheck.json
```

This checks the owned source/test entrypoints and their imports with the existing ambient declarations. It is not the full root `npm run check` or an installed declaration/artifact gate.

The unchanged package-manager tests in the nineteen-file run printed expected nonexistent-package npm `ETARGET` and nonexistent-repository Git failures. Those negative tests passed. That broader run is not zero-network evidence; the zero-attempt claim is limited to the guarded CLI fixtures.

## Deviations and scope

1. Extracted the existing import-check logic into the focused new `src/core/package-doctor-runtime-imports.ts` helper to avoid exceeding the doctor size ceiling. Final pure LOC: doctor 219, helper 47, args 237; main remains at its existing 745 ceiling. New lifecycle test is 250 pure LOC. No size baseline was changed.
2. main.ts captures the selection in the existing parse destructuring and inlines a single-use offline predicate, retaining its original pure-LOC ceiling and behavior.
3. Corrected the new discovery warning fixture to use only discovery. The existing resource-path classifier deliberately fails closed whenever explicit sources exist; it was not modified.
4. No commits by explicit D-13/operator restriction. Assertion RED/GREEN evidence is on disk; commit-based TDD history was not created.
5. Root `npm run check` and broader phase/artifact groups were not run concurrently. The parent owns the coordinated integration pass. No complete feature, installed-artifact, desktop, R or Rust acceptance is claimed.
6. The parent resolved the pre-existing stale-reload defect with one existing-method call. This lane only added three erased non-null assertions to its own lifecycle test after strict typechecking; owned production/docs stayed unchanged during continuation. The first scoped typecheck's missing ambient declaration was a config-coverage fault, corrected by including the existing declarations rather than adding dependencies or relaxing strictness.

No new production stubs, skipped tests, endpoints, schema or auth paths were introduced. `.planning/WINDOWS.md` entry 1 is now fixed, with the parent's command and RED/GREEN proof plus this lane's final verification recorded. Entry 2 remains open because the coordinated root check has not run in this lane; it was not waived or cleared.

## Parent integration and artifact-freeze handoff

1. Owned production, test and doc files are frozen for artifact preparation. The final 15-file byte/digest manifest is `/mnt/omkdata/tmp/opencode/omk-phase2-plan02-02-owned-nBnGx3/continuation-2Snuos/owned-freeze-final.json`, SHA-256 `f08bb084236e7a23053e9f7da0292b2c79741955a1208e6e43ac134254e17dab`.
2. The parent still runs the full bounded integration matrix and root `npm run check` when all workers are ready. Close WINDOWS entry 2 only after that actual check passes.
3. The focused `package-doctor-runtime-imports.ts` helper and staged docs are ready for integration review. No further owned source/test/doc edits are planned in this lane.

Default activation, full extension preservation, real artifact acceptance and broad requirements remain separate gates. This file does not mark the phase or milestone complete.

## Self-Check: PASSED

All 15 owned source/doc paths and this summary exist. Original backups remain intact. Final continuation digests bind the three type-only test assertions and all unchanged production/docs; HEAD and index entries remain unchanged. The 12-file read-only Biome check, final 161-test consumer run and scoped strict core typecheck pass. The parent's minimal lifecycle fix is separately evidenced. Root verification remains explicitly pending, and no phase/milestone completion or release is claimed.
