---
phase: 02-native-extensions-and-explicit-migration
plan: "06"
subsystem: testing
tags: [artifact-tooling, node, bun, offline, candidate-identity]
requires:
  - phase: 02-05
    provides: Main-owned preservation work and the approved local-candidate package audit
provides:
  - Bounded artifact preparation, installed-consumer, compiled-host and receipt tooling
  - Offline harness counterexamples with observed RED and GREEN evidence
affects: [02-artifact-acceptance, native-default-activation]
tech-stack:
  added: []
  patterns: [stdlib-only tooling, freeze-digest gate, copied dependency trees, exact installed bytes]
key-files:
  created:
    - scripts/native-extension-artifact-gate.mjs
    - scripts/native-extension-artifact-candidate.mjs
    - scripts/native-extension-artifact-bun.mjs
    - scripts/test/native-extension-artifact-gate.test.mjs
    - scripts/fixtures/native-extension-consumer.mjs
    - scripts/fixtures/native-extension-artifact-extension.ts
    - scripts/fixtures/native-extension-api-consumer.ts
  modified: []
key-decisions:
  - Actual artifact execution waits for main's explicit candidate-freeze notification.
  - Unknown locked resolutions stop before installation; no registry substitution or dependency upgrade.
  - Host compilation requires Linux network namespace isolation to prohibit runtime downloads.
requirements-completed: []
actuals:
  tokens: 18859
  tasks: 0
  commits: 0
commits: 0
plan_head_before: 0d6e74b0d21cdb810c88c42381457eff944b935f
plan_head_after: 0d6e74b0d21cdb810c88c42381457eff944b935f
duration: 28min
completed: 2026-11-08
status: complete
completion-scope: authorized six-step source and artifact acceptance only; broad requirements and activation remain blocked
---

# Phase 2 Plan 6: Native Extension Artifact Tooling Summary

> **2026-11-08 result:** combined artifact `verify` passed for candidate `2962df3d…`. See [Final combined acceptance](#final-combined-acceptance-2026-11-08). The halted handoff below is retained as history.

**Artifact tooling and 25 harness tests are implemented; actual source snapshot, build, tarballs, installation, Node/Bun execution and installed declarations remain unrun pending main's explicit freeze.**

## Execution boundary

- Started 2026-11-05T12:53:48Z. Tooling verification finished 2026-11-05T13:21:43Z.
- This handoff authorizes tooling and counterexamples now, not an artifact run against the mutable shared candidate.
- No candidate fingerprint or snapshot was taken. No build, pack, install, provider call, global activation, staging, commit, push or release occurred.
- No production source, loader, CLI, inventory, dependency/lock file, workflow, package documentation, validation, STATE, ROADMAP or requirement checkbox was edited by this worker.
- Main owns integration `npm run check`, source/preservation results, package documentation and validation updates.
- No plan task meets its artifact-dependent done criterion yet: **0/3 tasks complete**. Unit results are not artifact acceptance.

## Implemented paths

| File | Responsibility |
|---|---|
| `scripts/native-extension-artifact-gate.mjs` | Read-only `fingerprint`, explicit `prepare/node/bun/types/verify`, CLI/SDK fixtures and strict combined receipts |
| `scripts/native-extension-artifact-candidate.mjs` | Fresh external roots, exact dirty public input hashes, copied/reflinked installed dependencies, checked links, existing build, seven audited tarballs, offline local consumer resolution/install and byte identities |
| `scripts/native-extension-artifact-bun.mjs` | Fresh host-only existing build-binaries invocation, network-isolated compile, extracted binary/assets and normal-entry behavior comparison |
| `scripts/test/native-extension-artifact-gate.test.mjs` | 25 stdlib Node harness tests, including independent false-acceptance counterexamples |
| `scripts/fixtures/native-extension-consumer.mjs` | Public installed roots/subpaths, supplied loader, actual synthetic tool/provider ownership, reload and new cwd/session construction |
| `scripts/fixtures/native-extension-artifact-extension.ts` | Synthetic completion/tool cycle, native subpaths, cache ordering, delayed installed identity and lifecycle/network/environment markers |
| `scripts/fixtures/native-extension-api-consumer.ts` | Installed declaration consumer using constructor options, existing loader injection and owned public types without aliases |

Measured pure LOC for the three scripts: gate **209**, candidate **207**, Bun **55**. No new dependency or framework was added.

## Observed verification

### RED

1. `node --test --test-reporter=tap scripts/test/native-extension-artifact-gate.test.mjs`
   - Exit 1, **15 intended assertion failures, 2 passes, 0 skipped** against explicit initial no-op validators.
   - Full unmodified report: `/mnt/omkdata/tmp/opencode/native-artifact-red-vSVBxi.log`.
2. Targeted dirty-source digest counterexample:
   - Command: `node --test --test-reporter=tap --test-name-pattern='^rejects source identity changes even at the same HEAD$' scripts/test/native-extension-artifact-gate.test.mjs`.
   - Exit 1, named test failed with `ERR_ASSERTION: Missing expected exception` after changing actual temporary-file bytes.
   - GSD `check tdd-red-evidence` returned **RED_EVIDENCE_OK**, `target_test_failed`, 1 discovered assertion failure and no report errors.
   - Semantic inspection confirmed the intended assertion executed; there was no import, parser, setup or discovery failure. Its transient classifier JSON was held in this owned summary path before conversion to the final handoff format.
3. Independent HOME-leak counterexample after initial GREEN:
   - Command: `node --test --test-reporter=tap --test-name-pattern='a leaked original HOME fails even when all candidate hashes match' scripts/test/native-extension-artifact-gate.test.mjs`.
   - Exit 1 on the intended missing rejection, then environment containment was implemented.
   - Full report: `/mnt/omkdata/tmp/opencode/native-artifact-env-red-YqcnZz.log`.

### GREEN

- `node --test --test-reporter=tap scripts/test/native-extension-artifact-gate.test.mjs`: **exit 0, 25 passed, 0 failed, 0 skipped**.
- Final complete report: `/mnt/omkdata/tmp/opencode/native-artifact-final-unit-O00Voa.log`.
- `node --check` on all three tooling scripts and all three consumer/extension fixtures: **exit 0**.
- Generated Node network/identity guard checked with `node --input-type=module --check`: **exit 0**.
- Scoped Biome invocation processed zero files because the existing repository configuration excludes `scripts/`; that invocation is **not** recorded as a lint pass. Main's integration check remains required.
- Context7 lookup hit its monthly quota. Version-specific npm install/pack semantics were checked against the installed npm 11.20.0 documentation instead; no key or package installation was attempted.

The 25 tests cover unsafe/reused roots, source and emitted-byte changes, traversal, write-through dependency links, environment scrubbing, same-version registry bytes, source aliases and wrong checkout origin, unknown/upgraded dependency resolutions, nested registry internals, private/linked tarball members, missing receipts/declaration evidence, candidate/output mismatch, fake version-only binaries, independently missing startup/worker evidence, HOME/source-loader leaks, omitted compatibility controls and failed preservation gates. A structurally complete synthetic receipt test is explicitly **unit-only**, not an artifact run.

## Artifact execution preconditions and commands

**Blocking precondition: main has not sent an explicit candidate-freeze notification.**

After that notification, the executor must still establish:

1. Main's source checks/LSP or compiler review are ready and the entire public candidate, including package docs and the tooling, is frozen.
2. `OMK_NATIVE_ARTIFACT_ROOT` names a **nonexistent**, uniquely owned destination under `/mnt/omkdata/tmp/opencode`; enough disk exists for source, installed dependency and npm-cache copies, outputs, tarballs and logs.
3. Existing Node/npm/Bun, reviewed installed dependency versions, npm cache contents and host-native clipboard/photon prerequisites suffice. Unknown identities or cache misses halt; there is no online or upgrade fallback.
4. The existing Linux `unshare --user --map-current-user --net -- true` operation is supported. The Bun command refuses compilation if network isolation is unavailable; do not install a replacement or silently compile online. This capability has **not been probed** before freeze.

Then run from the original checkout, preserving all external output:

```sh
node scripts/native-extension-artifact-gate.mjs fingerprint
# Use the returned digest only after main explicitly freezes that exact candidate.
node scripts/native-extension-artifact-gate.mjs prepare --work "$OMK_NATIVE_ARTIFACT_ROOT" --frozen-inputs FROZEN_SHA256
node scripts/native-extension-artifact-gate.mjs node --work "$OMK_NATIVE_ARTIFACT_ROOT"
node scripts/native-extension-artifact-gate.mjs bun --work "$OMK_NATIVE_ARTIFACT_ROOT"
node scripts/native-extension-artifact-gate.mjs types --work "$OMK_NATIVE_ARTIFACT_ROOT"
node scripts/native-extension-artifact-gate.mjs verify --work "$OMK_NATIVE_ARTIFACT_ROOT"
```

The frozen source receipt is `candidate.json`; subsequent stages rehash original inputs and candidate outputs. A concurrent change invalidates old receipts. `prepare` copies dependencies without linking back to the checkout, checks workspace/native links before build, invokes only the existing isolated `npm run build`, packs all seven exact packages with scripts disabled, audits member types/public boundaries/licenses and preserves unpacked-byte hashes.

The ordinary consumer prefix uses a cache-only `--package-lock-only` resolution preflight before installing anything. Every third-party name/version/resolved URL/integrity must match the reviewed lock. Every internal resolution must name the exact local tarball, including nested shrinkwrap entries. The actual local install uses `--prefix`, `--offline`, `--ignore-scripts`, `--package-lock=false`, `--no-audit`, `--no-fund` and all seven tarballs, never `--global`. It retains an owned consumer shrinkwrap and rejects changed internal package bytes, even at version 1.5.10.

Node execution uses installed exports, an explicit stdlib-only network/module-identity guard, isolated HOME/agent/project roots and no inherited credentials, NODE_PATH, NODE_OPTIONS, tsconfig aliases or source loader. Bun compilation invokes the reviewed existing production build script in an isolated network namespace with all three skip flags and a new `--out` path; those flags skip installs and duplicate package builds, not compilation. Its runtime is outside both source and the installed consumer, preventing installed SDK fallback from masking missing bundled namespaces.

## Main-owned source receipt contract

`verify` deliberately rejects an absent or failed external `source.json`. Main must supply observed results, not a completion assertion:

- Top-level `status: "pass"`, `candidate: candidate.json.candidate`, `outputs: candidate.json.outputsDigest`.
- `groups` contains `phase1`, `native-loader`, `cli-sdk`, `doctor`, `preservation`, `atelier`, `root-check`.
- Each group has its exact `command`, `status: "pass"`, `exitCode: 0`, and nonempty `logs` containing `{path, sha256}`. Paths resolve inside the owned work root and log hashes are rechecked.
- Each group must cover the corresponding explicit plan/validation commands. In particular, `atelier` includes tests, typecheck and vendor checks; `preservation` is per-entry/builtin evidence rather than load-count smoke; `root-check` is main's integration check.

The other expected receipts are `installed.json`, `node.json`, `bun.json` and `types.json`, with individual command logs and behavior JSONL files. **None exists from an actual run in this worker's handoff.** No exact artifact root or artifact digest is claimed.

## Task and six-step disposition

| Plan task | Status |
|---|---|
| 1, packaged Node/public SDK/real CLI | Tooling and counterexamples implemented; actual prepare/install/execution **blocked by freeze** |
| 2, compiled Bun production startup | Tooling and rejection controls implemented; actual compile/execution **unrun** |
| 3, installed declarations and combined acceptance | Type fixture and verifier implemented; actual declarations/source groups/combined gate **unrun**, documentation and validation owned by main |

The other five source-work steps are owned by main and its assigned workers; this summary does not certify them. All-six success remains blocked until their observed receipts and actual artifact gates pass. Broad V2-CORE-01/V2-MIGRATE-01/V2-API-01 checkboxes remain unchanged.

Old spec-108 equivalence counts, benchmark/swap/deprecation semantics, one-module-per-PR obligations and final native-default activation remain unresolved separate gates. Release, installed-engine activation, desktop/TUI/UI/live/private-resource behavior, other platforms, minimum Node/npm, independent R, Rust ownership and clipboard classification are **not accepted by this tooling/unit result**. Current 1.5.10 versions and compatibility defaults remain unchanged.

## Deviations and retained issues

- Per the approved plan's D-13 and AGENTS.md, **no commits or completion-state updates** were made. All new owned files remain uncommitted for main; no existing staged work was touched.
- Per the newer handoff, actual task preconditions are held pending explicit main freeze rather than auto-approved. This is an intentional stop, not plan completion.
- Added a fail-closed Linux network-namespace prerequisite for Bun compilation to prevent unauthorized host-runtime downloads. Other host compilation is explicitly unsupported by this harness until separately implemented/reviewed.
- One GREEN iteration exposed a test setup issue: its expected consumer directory was absent. The fixture now creates that owned directory; no assertion was weakened.
- No placeholder acceptance, TODO, skipped unit test or forced-virtual/version-only success substitutes for an unrun artifact gate. No unrelated existing failures were repaired.

## TDD Gate Compliance

RED and GREEN behavior evidence are recorded above. Commits are intentionally absent because both project rules and the approved plan prohibit staging/commit. This halted summary does not claim any completed artifact task or broad requirement.

## Self-Check: PASSED

- All seven owned implementation/test/fixture files and this summary exist.
- Final suite: 25 passed, 0 failed, 0 skipped. All owned executable files and the generated Node guard parse successfully.
- HEAD remains `0d6e74b0d21cdb810c88c42381457eff944b935f`; measured `git rev-list --count 0d6e74b0d21cdb810c88c42381457eff944b935f..HEAD` is 0. No commit is claimed.
- No TODO/FIXME/placeholder implementation was found in the tooling/consumer files.
- Self-check applies only to the tooling handoff. Actual artifacts, installed declarations and combined acceptance remain blocked/unrun.

## Final combined acceptance, 2026-11-08

Work root: `/mnt/omkdata/tmp/opencode/omk-v2-sdk092-20261108-115739/`. The candidate was built from the task-owned worktree `.worktrees/verify-buncjs-20261108`. Its frozen public inputs, `2962df3dd7df590254d4ef2067daa8c0ea80c7d746e9f221cfb10b262177b17c` (3,751 files with modes), equal the main checkout fingerprint before and after every stage. Emitted output digest: `e2c16a641fcd541c70095bb68bea52f83b1f23092c1a27346c05ed67ca70e25e`. Base HEAD is `48fb8e33a8`, with uncommitted changes.

| Stage | Command | Result |
|---|---|---|
| prepare | `native-extension-artifact-gate.mjs prepare --frozen-inputs 2962df3d…` | exit 0; seven packages built, packed and audited |
| node | `… node` | exit 0; five CLI cases and SDK four-tool reload/cwd receipt |
| bun | `… bun` | exit 0; real Linux x64 compiled binary, all five cases incl. installed CJS subpath; tool receipts equal Node |
| types | `… types` | exit 0; strict NodeNext installed consumer, no `skipLibCheck`, 0 errors |
| source | `source-checks.mjs` (all seven groups) | every group exit 0; inputs equal candidate before and after each group |
| verify | `… verify` | **exit 0**, `{"status":"pass","activation":"not-authorized"}` |

Source groups ran in the worktree with an isolated HOME and agent directory, `LIVE_E2E=0` and one Vitest worker:

| Group | Observed |
|---|---|
| phase1 (unchanged ten files) | 266 passed |
| native-loader | 33 passed |
| cli-sdk | 117 passed |
| doctor | 33 passed |
| preservation | inventory: 89 public entries and 10 builtins; 316 + 114 tests passed |
| atelier | 88 passed, 1 skipped (`native-notification`); typecheck exit 0; vendor 31 pinned files verified |
| root-check | `npm run check` exit 0; 588 passed, 30 skipped, 0 failed |

The runner `source-checks.mjs` reuses the 2026-11-07 group definitions, and `assemble-source.mjs` refuses stale or failed groups. Both are retained in the work root. Two failed environment attempts are kept: `source-attempt1-nodist/` (workspace `dist` absent in the worktree) and `source-attempt2-extdeps/` (ignored `.omk/extensions/omk-computeruse-stagehand/node_modules` absent). They were fixed by an ordinary `npm run build` in the worktree and by copying the main checkout's ignored extension dependency trees. No test, expectation or gate changed. Fixes that made this candidate pass are recorded in [the 2026-11-08 acceptance record](02-ACCEPTANCE-20261108.md): Bun `--compile-autoload-package-json`, the SDK-free `GoogleThinkingLevel`, and `@anthropic-ai/sdk` 0.92.0 with the ambient-header guard.

### Six-step disposition

| Step | Status | Evidence |
|---|---|---|
| 02-01 native loader | pass | phase1 and native-loader groups; [02-01 summary](02-01-SUMMARY.md) |
| 02-02 CLI/doctor/SDK/lifecycle | pass | cli-sdk and doctor groups |
| 02-03 Atelier batch A | pass | atelier group |
| 02-04 Atelier batch B and vendor hashes | pass | atelier group, vendor check |
| 02-05 inventory and preservation | pass | preservation group |
| 02-06 artifact acceptance | pass | node, bun, types, verify above |

All six authorized source-work steps have observed passing results for one candidate.

### Superseded by the native default, 2026-11-08

The owner then approved the `omk` default. Candidate `019d076c…` passed all gate stages and combined `verify` with the default switched. spec-108 dispositions are in [the acceptance record](02-ACCEPTANCE-20261108.md#continuation-native-default-omk-2026-11-08). The first bullet below is historical.

### Not accepted by this result

- **V2-CORE-01, final default.** Omitted and undefined dialects remain `omk+pi`. No default flip or engine activation was authorized or performed. spec-108 marks alias-layer removal as decided separately.
- **spec-108 obligations: unresolved, with no owner decision recorded.** 108-2 Terminal-Bench equivalence (±3pp CI) needs free runs or a posted dollar cap. Token/time ratios, deterministic tool-order replay and identical pass/fail/skip counts against main were not run. One-module-per-PR (108-3) was not applied to this uncommitted batch. Swap order step 4 deprecation semantics are undecided.
- Minimum Node/npm, platforms other than Linux x64, clipboard classification, private user resources, live providers, TUI/UI, R parity, Rust ownership and desktop. Versions remain 1.5.10. Nothing was committed, pushed or published.
