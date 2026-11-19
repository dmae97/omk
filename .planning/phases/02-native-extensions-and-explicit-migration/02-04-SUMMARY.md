---
phase: 02-native-extensions-and-explicit-migration
plan: "04"
subsystem: extensions
tags: [atelier, native-loading, provenance, typescript, tdd]
requires:
  - phase: 02-03
    provides: Pristine 17-file baseline and complete import/registry/theme expectations
  - phase: 02-01
    provides: Main-owned native ResourceLoader construction policy
provides:
  - Remaining nine import-only vendor migrations and native/compatibility package registration parity
  - Native-only Atelier type/test aliases and exactly 17 reviewed local hash updates
  - Regenerated tracked-source inventory with explicit concurrent doctor-extraction limitation
affects: [02-05, 02-06]
tech-stack:
  added: []
  patterns: [Exact import-node substitutions before provenance reconciliation, isolated local test homes]
key-files:
  created: []
  modified:
    - .omk/extensions/atelier/vendor/extensions/index.ts
    - .omk/extensions/atelier/vendor/src/sidebar.ts
    - .omk/extensions/atelier/vendor/src/subagent-cost-image.ts
    - .omk/extensions/atelier/vendor/src/subagent-usage-view.ts
    - .omk/extensions/atelier/vendor/src/workspace-pulse.ts
    - .omk/extensions/atelier/vendor/src/overlay-lifecycle.ts
    - .omk/extensions/atelier/vendor/src/state.ts
    - .omk/extensions/atelier/vendor/src/todos.ts
    - .omk/extensions/atelier/vendor/src/sidebar-panels.ts
    - .omk/extensions/atelier/test/discovery.test.ts
    - .omk/extensions/atelier/test/import-migration.test.ts
    - .omk/extensions/atelier/tsconfig.json
    - .omk/extensions/atelier/vitest.config.ts
    - .omk/extensions/atelier/UPSTREAM.json
    - specs/108-pi-decoupling/pi-inventory.generated.json
key-decisions:
  - Select the exact Atelier package path before comparing its full registry; injected builtins remain outside this package-specific assertion.
  - Preserve all upstream metadata and all nonmatching manifest entries; change only reviewed localSha256 fields.
  - Run remaining Atelier tests with fresh external HOME, OMK_CODING_AGENT_DIR and short TMPDIR roots.
requirements-completed: []
requirements-contributed: [V2-CORE-01, V2-MIGRATE-01, V2-API-01]
actuals:
  tokens: 6586
  tasks: 3
  commits: 0
commits: 0
plan_head_before: 0d6e74b0d21cdb810c88c42381457eff944b935f
plan_head_after: 0d6e74b0d21cdb810c88c42381457eff944b935f
duration: 16min
completed: 2026-11-05
status: complete
integration_acceptance: pending-main-root-check-and-concurrent-inventory-review
---

# Phase 02 Plan 04: Atelier native package and provenance Summary

All 24 original imports in 17 Atelier vendor files now target owned APIs; exact native and compatibility registrations, both themes and local provenance pass focused verification.

## Scope and evidence

This summary marks the assigned source/test work complete, not overall phase or activation acceptance. Root `npm run check`, shared planning state and broad requirement completion remain main-owned. No staging, commits, pushes, installation, builds, default changes or engine activation occurred.

External evidence directory: `/mnt/omkdata/tmp/opencode/atelier-phase02-03-04-85xQca` (called `E` below). Main's original backup remains `/mnt/omkdata/tmp/opencode/omk-phase2-native-extensions-backup`. No baseline was refreshed over drift.

## Accomplishments

1. **Task 1:** Migrated the five remaining runtime-graph files, with the root factory import changed last. The same native package errors-array assertion changed from missing legacy TUI resolution to successful real factory registration.
2. **Task 2:** Migrated four state/overlay type-import files after independent AST assertion RED. `E/remaining-state-type-erasure.json` proves their five declarations were type-only and erased by installed TypeScript before their migration, not assumed runtime dependencies.
3. **Task 3:** Removed exactly two legacy entries from each Atelier config. Updated exactly 17 `localSha256` values after checking every whole-file transformation. Ran the existing inventory generator without adding untracked/private files to its input.
4. Discovery now checks omission, explicit `omk+pi` and explicit `omk`, each with isolated cwd/agent directory and in-memory settings. Each retains exactly `atelier`/`atelier-theme`, shortcuts `ctrl+q`/`ctrl+shift+r`/`f6`, the reviewed 18 event registrations and no package tools, flags or message renderers. Both named themes are required.
5. The full isolated Atelier suite passes, including existing real local tmux, rendering, editor, TODO, accounting, theme, cleanup and notification-adapter regressions. This is not broad 89-entry/builtin preservation or platform visual acceptance.

## Verification

Commands ran from the checkout root. Every Atelier test run after the safety update set fresh task-owned `HOME`, `OMK_CODING_AGENT_DIR` and `TMPDIR`; the corresponding `.root` receipts identify those directories. Final tests use short roots such as `/mnt/omkdata/tmp/opencode/at-XXXXXX`, avoiding Unix socket path limits.

| Command | Exit/result | Evidence under E |
| --- | --- | --- |
| `npm --silent --prefix .omk/extensions/atelier test -- test/import-migration.test.ts -t 'native package' --reporter=junit --outputFile=E/native-package-red.xml` before runtime migration | 1; planned errors-array assertion, zero collection errors | `native-package-red.xml`, `.log`, `.exit`, `.json` |
| `node /home/dmae97/.config/opencode/gsd-core/bin/gsd-tools.cjs check tdd-red-evidence native-package-red.json --raw` from E | 0; `RED_EVIDENCE_OK` | `native-package-red-classifier.log` |
| `npm --prefix .omk/extensions/atelier test -- test/import-migration.test.ts -t 'native package'` after runtime migration and fixture correction | 0; native package passed | `native-package-isolated-green.log`, `.exit`, `.root` |
| Same command repeated as tracer feedback gate before expansion | 0; native package passed | `native-package-tracer-gate.log`, `.exit`, `.root` |
| `npm --silent --prefix .omk/extensions/atelier test -- test/discovery.test.ts -t 'batch B state' --reporter=junit --outputFile=E/batch-b-state-red.xml` before state imports | 1; four intended AST assertion failures, zero collection errors | `batch-b-state-red.xml`, `.log`, `.exit`, `.json`, `.root` |
| Same GSD classifier targeting `batch-b-state-red.json` from E | 0; `RED_EVIDENCE_OK` | `batch-b-state-red-classifier.log` |
| `npm --prefix .omk/extensions/atelier test -- test/discovery.test.ts test/graphics.test.ts test/integration.test.ts test/usage-integration.test.ts` with short isolated temp root | 0; 22 passed | `batch-b-regressions-short-tmp.log`, `.exit`, `.root` |
| Alias test with `-t 'final aliases' --reporter=junit --outputFile=E/aliases-red.xml` before config changes | 1; reached tsconfig legacy-alias assertion | `aliases-red.xml`, `.log`, `.exit`, `.json`, `.root` |
| Same unchanged alias test after tsconfig removal, before Vitest removal | 1; reached Vitest AST legacy-alias assertion | `vitest-aliases-red.xml`, `.log`, `.exit`, `.json`, `.root` |
| Same GSD classifier targeting each alias JSON record from E | 0 for both; `RED_EVIDENCE_OK` | `aliases-red-classifier.log`, `vitest-aliases-red-classifier.log` |
| `npm --prefix .omk/extensions/atelier test -- --reporter=verbose` after both alias removals and final hash updates | **0; 88 passed, 1 existing skip across 14 files** | `final-full-suite.log`, `.exit`, `.root` |
| `npm --prefix .omk/extensions/atelier run typecheck` | **0** | `final-typecheck.log`, `.exit`, `.root` |
| `npm --prefix .omk/extensions/atelier run check:vendor` | **0; 31 pinned files verified** | `final-vendor.log`, `.exit` |
| `env -u PI_INVENTORY_ROOT -u PI_INVENTORY_OUT npm run inventory:pi` | 0; existing generator only | `inventory-regenerate.log`, `.exit`, `inventory.diff` |
| `env -u PI_INVENTORY_ROOT -u PI_INVENTORY_OUT npm run check:pi-inventory` | **0; 9 manifest deps, 20 import/mention rows, 3 tracked alias consumers** | `final-inventory-check.log`, `.exit` |
| `git diff --check -- .omk/extensions/atelier specs/108-pi-decoupling/pi-inventory.generated.json` | 0 | Final source review and execution transcript |
| `npm run check` | Not run by this agent; explicitly delegated to main | Pending integrated receipt |

Semantic RED assessment: the native target reached real `DefaultResourceLoader.reload()` and failed at the expected load-errors assertion. State and config targets failed their intended AST/alias assertions. The JUnit classifier accepted each named target with no report errors. No collection error was used as RED authority.

### Existing skipped platform test

`test/native-notification.test.ts` retains the pre-existing `describe.skipIf(process.env.ATELIER_NATIVE_NOTIFICATION !== "1")` gate. The skipped case is `real WSL Windows notification > delivers through the production adapter and observes native process exit`. This agent did not enable it, change the guard or claim native OS delivery. The complete baseline also had this one skip.

## Final 17-file provenance allowlist

All paths below are relative to `.omk/extensions/atelier/vendor/`. The table records final local hashes, not new upstream identities.

| File | Final localSha256 |
| --- | --- |
| `extensions/index.ts` | `39ad243d9862389df2dcfa9694543bd2b69f7e690e250514a70cba15f8392b86` |
| `src/editor.ts` | `2fc6d0d5fc00c0aa8d631038e131055e7a54e237db399900782393881923485a` |
| `src/footer.ts` | `2cd85716f7208ab0f4e4d11548f66e980b546db918ef5c776a8828afeae3f95a` |
| `src/image-compositor.ts` | `17ef9caef0162b75b70c0a8af082f8feb85b6757bdb89c1b5d6a2b892f6432c9` |
| `src/menu.ts` | `6c0a8c5972f5c9879cb94452e0c0835ba1645a7693ccbb270d886cb41a7ca3bb` |
| `src/overlay-lifecycle.ts` | `5b9eef835955e9e151883019cc36a2d27036e6328256cf193900fb099b51dafe` |
| `src/run-activity.ts` | `ba65de31dbd519eee18cd0c01378d1defee2338fdf48a70eac4891f789e7b54b` |
| `src/settings-workspace.ts` | `9a5628580b963ee92dc9f92e612ddd3bcd76aec8e766921b196dfc1cea85702b` |
| `src/sidebar-panels.ts` | `789c8c151033946fa5a19a2d837eefc3c9689b99e14aa2305c736a6c34b85ad2` |
| `src/sidebar.ts` | `5a13d194eaafa967b7206121e3c3ca2971395152f9f433ff9d9bd81525188b21` |
| `src/state.ts` | `989d42061f01eb7fe137ad08d865fa83d9de69af668e1c7283c52ff6dc05d468` |
| `src/subagent-cost-chart.ts` | `96f8e85e58716c37ad9f88f0e27a9234354bfeab0a9ce5943d8ae03d377ea2e5` |
| `src/subagent-cost-image.ts` | `e71a36772fe72129715f7f1f315355fa430d5019b6e6d819be7b7e2130a42b9b` |
| `src/subagent-usage-view.ts` | `38e7bffbb24f4c51fe52929bdd095a50369673a06cbd197c8f7939f46402e2c9` |
| `src/text.ts` | `9ef5848780ecf295a4c0f04d39b0986fcc6677575c3823b1d49744dc8ac1a782` |
| `src/todos.ts` | `6ebac3c689f528190341603c6f07150f4aa50ff20eb9a11dd6679caf45d59679` |
| `src/workspace-pulse.ts` | `037d008ae630337e036fa524d2a4eaa33f0a0f180e7f89406c0456a0e4a093ad` |

`E/pre-manifest-review.json`, `E/final-manifest-review.json` and `E/final-source-review.json` provide the mechanical receipts:

- Every entire vendor file equals its verified original bytes with only quoted import-node contents mapped from `@earendil-works/pi-coding-agent` to `open-multi-agent-kit` or `@earendil-works/pi-tui` to `omk-tui`.
- Exactly 24 declarations across exactly 17 files changed. Bindings, type markers, bodies, exports, comments and notices remain unchanged.
- Exactly those 17 `localSha256` fields changed in the complete raw manifest. Every `upstreamSha256`, revision, repository/version/license metadata, `adaptedFiles` entry and all other file entries are unchanged.
- LICENSE SHA-256 remains `ddd19b6568834edec81aa7edec92c4eb6cba4ba01f96812f82d1ed9c06688eb7`.
- Config files equal their baseline bytes with only the two specified legacy alias lines removed from each. Native targets and all unrelated settings remain intact.
- Final HEAD and the entire Git index equal their starting snapshots. No unrelated dirty work was staged or reset.

## Inventory review and integration handoff

`E/inventory-review-pending.json` and `E/inventory.diff` preserve the exact generated delta. Manifest entries and all 14 compatibility runtime alias entries are byte-equivalent in JSON data. No import rows were added. All 24 removed rows came from reviewed Atelier `vendor/src/` imports: 22 declarations plus the generator's two duplicate multiline-menu mention rows. The root `vendor/extensions/index.ts` is outside this generator's `src/test/scripts` scope, so the full 24-declaration proof comes from AST expectations, not its count.

The extra alias-consumer change was surfaced rather than silently accepted as a line-number-only delta: the concurrent CLI/doctor agent extracted the import from tracked `package-doctor.ts` to new, currently untracked `package-doctor-runtime-imports.ts:4`. Read-only inspection confirmed that new file still imports both compatibility predicates from `./pi-compat.ts`. The unchanged generator deliberately reads `git ls-files`, so it does not include that new file. Main must review this integration observation; no untracked/private files were added to the generator input, no manual inventory rows were invented and the generator was not weakened. Regenerate again whenever the tracked input set changes.

## Deviations from Plan

### Auto-fixed issues

1. **[Rule 1 - Test fixture] Scope native path assertion to the Atelier package.** The first post-migration run correctly loaded Atelier but failed because the test expected the entire loader registry to contain only Atelier, ignoring intentionally injected builtins. The fixture now selects the package subtree, then asserts its exact entry path and unchanged complete registry/theme expectations. Production code and builtin injection were not altered. Original failure retained in `E/native-package-green.log` and `.exit`; corrected isolated run and tracer passed.
2. **[Rule 3 - Test environment] Shorten owned temp root for local tmux sockets.** The first isolated regression run had 21 passes and one setup failure because the nested evidence path exceeded Unix socket limits. Fresh short external roots fixed it without editing/skipping the existing tmux test. Failure retained in `E/batch-b-regressions.log` and `.exit`; the rerun passed all 22 cases.

### Explicit execution adjustments

- Main owns root checks and shared planning updates under the execution handoff; this agent did not modify STATE, ROADMAP, REQUIREMENTS or the cross-phase defect ledger.
- The safety update arrived after the original baseline/batch-A runs. Those earlier receipts did not set fresh HOME/agent roots, so they are not used as proof of user-home isolation. Final package, compatibility, feature and full-suite acceptance was rerun with fresh owned roots. Actual private-user feature preservation remains unverified, not inferred.
- At the initial source handoff, the native package fixture correction was the sole 02-04 change to the previously authored import-migration test. The later authorized formatting follow-up below adds layout changes and safe entry narrowing only; all 17 path/binding/type-marker expectations and complete registry/theme expectations remain unchanged.

## Task Commits and TDD Gate Compliance

None, per explicit D-13/owner prohibition. `git rev-list --count 0d6e74b0d21cdb810c88c42381457eff944b935f..HEAD` measured 0, and HEAD/index are unchanged. No commit-backed completion is claimed. `E/02-04-metrics.json` records realized diff characters divided by four, including the small fixture correction, rather than harness token usage.

Assertion RED/GREEN evidence is retained for native loading, type-only imports and each alias config. No product-body refactor was needed. The missing RED/GREEN commits are an authorized execution constraint, not silently fabricated compliance.

## Deferred Issues and limits

- Main's integrated root `npm run check` and concurrent inventory-consumer review remain pending. This summary must not be used as a root-green or broad requirement-complete receipt.
- Broader repository/example/builtin preservation and actual packaged Node/Bun/types acceptance remain with 02-05/06.
- Real Windows notification delivery, native TUI screenshots, other terminal/desktop platforms, independent R and Rust acceptance remain unverified. No new visual design or live provider/network behavior was introduced or claimed.
- No new stubs, skipped source tests, auth paths, endpoints or schema boundaries were introduced. Existing missing-data fallbacks were preserved, not rewritten as part of this migration.

## Self-Check: PASSED

All 17 vendor paths, both tests, both configs, manifest and generated inventory exist. Final focused test/type/vendor/inventory commands exited 0. Exact import-only byte preservation, immutable upstream/license metadata and unchanged HEAD/index were checked against retained original receipts. Root integration acceptance remains explicitly pending above.

Final on-disk self-check matched all 17 summary hash rows to the actual manifest, checked all 23 owned code/test inputs, and confirmed all four final command exit receipts are 0. Receipt: `E/final-owned-inputs.json`.

## Post-integration test formatting follow-up

Parent's root check failed on formatting and the two test non-null assertions. Under the follow-up's test-only grant, both entry reads now use an explicit missing-entry error for safe narrowing, and both files match scoped Biome formatting. No expectation, test case, skip condition, lint policy or production file was changed. Every edit used the native patch tool; no formatter command replaced repository files.

Evidence and current-byte backups: `/mnt/omkdata/tmp/opencode/atelier-test-format-asbvDS` (`F`). The parsed-token receipt `F/test-delta-review.json` confirms only formatting/trailing commas and the authorized guards differ from its original test bytes. It also verifies all 34 frozen vendor/config/provenance digests and the Git index remain unchanged. The original test-content digests in E are historical; current test digests are recorded in F.

| Exact command from checkout root | Exit/result | Evidence under F |
| --- | --- | --- |
| `node node_modules/@biomejs/biome/bin/biome check --error-on-warnings .omk/extensions/atelier/test/discovery.test.ts .omk/extensions/atelier/test/import-migration.test.ts` | **0; two files checked, zero warnings, no fixes applied** | `scoped-biome-after.log`, `.exit` |
| `npm --prefix .omk/extensions/atelier test -- test/discovery.test.ts test/import-migration.test.ts --maxWorkers=1` | **0; 28 passed** | `targeted.log`, `.exit`, `.root` |
| `npm --prefix .omk/extensions/atelier test -- --reporter=verbose --maxWorkers=1` | **0; 88 passed, 1 existing opt-in notification skip** | `full.log`, `.exit`, `.root` |
| `npm --prefix .omk/extensions/atelier run typecheck` | **0** | `typecheck.log`, `.exit`, `.root` |

Tests and typecheck used separate fresh short HOME/OMK_CODING_AGENT_DIR/TMPDIR roots. The standalone-scanner comparison was replaced by actual parsed TypeScript token comparison to handle template literals correctly; no failing comparison was represented as a passing receipt.

Root validation remains parent-owned and has not been rerun by this agent. The parent's unrelated interactive-mode and other root diagnostics were not edited. Inventory limitations, actual OS notification delivery and broader platform/artifact gates above remain unchanged. No staging, commits, shared-state updates, builds or additional agents occurred.

### Follow-up Self-Check: PASSED

Both owned tests pass scoped warnings-as-errors validation, targeted/full isolated suites and typecheck. Parsed test tokens retain all original expectations. All 34 frozen inputs match the follow-up baseline. Exact command exits, temporary roots and current test digests are retained in F.
