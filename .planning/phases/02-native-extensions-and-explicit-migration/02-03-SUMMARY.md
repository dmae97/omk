---
phase: 02-native-extensions-and-explicit-migration
plan: "03"
subsystem: extensions
tags: [atelier, imports, typescript, provenance, tdd]
requires:
  - phase: 02-01
    provides: Explicit native DefaultResourceLoader selection supplied by the main agent
provides:
  - Eight import-only vendor migrations with original bytes retained externally
  - Complete 17-path, 24-declaration import AST expectations and native package acceptance test
affects: [02-04, 02-05, 02-06]
tech-stack:
  added: []
  patterns: [TypeScript import-node binding and type-marker assertions, exact baseline substitution checks]
key-files:
  created: [.omk/extensions/atelier/test/import-migration.test.ts]
  modified:
    - .omk/extensions/atelier/vendor/src/text.ts
    - .omk/extensions/atelier/vendor/src/footer.ts
    - .omk/extensions/atelier/vendor/src/run-activity.ts
    - .omk/extensions/atelier/vendor/src/subagent-cost-chart.ts
    - .omk/extensions/atelier/vendor/src/editor.ts
    - .omk/extensions/atelier/vendor/src/menu.ts
    - .omk/extensions/atelier/vendor/src/image-compositor.ts
    - .omk/extensions/atelier/vendor/src/settings-workspace.ts
key-decisions:
  - Keep provenance hashes and both legacy aliases unchanged until the final batch.
  - Keep all work uncommitted and leave shared state and root checks to the main agent under the scoped execution grant.
requirements-completed: []
requirements-contributed: [V2-CORE-01, V2-MIGRATE-01, V2-API-01]
actuals:
  tokens: 3368
  tasks: 2
  commits: 0
commits: 0
plan_head_before: 0d6e74b0d21cdb810c88c42381457eff944b935f
plan_head_after: 0d6e74b0d21cdb810c88c42381457eff944b935f
duration: 13min
completed: 2026-11-05
status: complete
---

# Phase 02 Plan 03: Atelier first import batch Summary

Eight Atelier modules now use owned OMK imports, with binding/type-marker AST tests and unchanged implementation bodies.

## Scope and baseline

- The owner explicitly prohibited staging, commits, pushes, installation, builds, default activation and writes outside this agent's allowlist. Shared STATE/ROADMAP/REQUIREMENTS updates remain with the main session.
- External evidence directory: `/mnt/omkdata/tmp/opencode/atelier-phase02-03-04-85xQca` (called `E` below).
- `E/baseline.json` records the starting HEAD, all 24 original declarations across 17 files, all upstream/local hashes, MIT digest and 22 owned baseline file digests.
- All 22 existing owned inputs matched both main's original `manifest.json` hashes and its preserved file bytes. All 17 vendor import files were read in full before the first vendor edit; `E/full-read-receipt.txt` records that review.
- `node .omk/extensions/atelier/scripts/verify-vendor.mjs` and `npm --prefix .omk/extensions/atelier run check:vendor` both exited 0 before vendor edits, verifying 31 pinned files.
- `npm --prefix .omk/extensions/atelier test` exited 0 before new tests or vendor edits: 61 passed, one existing skipped test. Complete output: `E/baseline-full-suite.log`; exit: `E/baseline-full-suite.exit`.

## Accomplishments

1. **Task 1:** Migrated only import literals in `text.ts`, `footer.ts`, `run-activity.ts` and `subagent-cost-chart.ts`.
2. **Task 2:** Migrated only import literals in `editor.ts`, `menu.ts`, `image-compositor.ts` and `settings-workspace.ts`.
3. Authored the full handoff test before production edits. Installed TypeScript 5.9.3 parses executable declarations, including multiline imports, preserving binding order, aliases and both declaration-level and per-binding type markers.
4. Added concrete text padding/truncation/sanitation, native `CustomEditor` inheritance, editor/menu framing, image method lookup and settings viewport checks.
5. Authored real native package acceptance with isolated cwd/agent directory, in-memory settings, exact commands/shortcuts/events/tools/flags/renderers and both theme names. This case remains intentionally RED at this intermediate boundary.

## Verification and TDD evidence

All commands ran from the checkout root unless explicitly noted.

| Command | Exit/result | Evidence under E |
| --- | --- | --- |
| `npm --silent --prefix .omk/extensions/atelier test -- test/import-migration.test.ts --reporter=tap-flat` | 1; 19 intended assertion failures, 2 behavior passes, no collection errors | `import-migration-red.tap`, `.stderr`, `.exit` |
| Same test with `--reporter=junit --outputFile=E/import-migration-red.xml` | 1; same intended RED | `import-migration-red.xml`, `import-migration-junit-red.log`, `.exit`, `.json` |
| `node /home/dmae97/.config/opencode/gsd-core/bin/gsd-tools.cjs check tdd-red-evidence import-migration-junit-red.json --raw` from E | 0; `RED_EVIDENCE_OK`, no report errors | `import-migration-junit-red-classifier.log` |
| `npm --prefix .omk/extensions/atelier test -- test/import-migration.test.ts -t 'batch A text'` | 0; 5 passed | `batch-a-text-green.log`, `.exit` |
| Same tracer command, repeated before expansion | 0; 5 passed | `batch-a-tracer-gate.log` |
| `npm --prefix .omk/extensions/atelier test -- test/import-migration.test.ts -t 'batch A'` | 0; 10 passed | `batch-a-green.log`, `.exit` |
| `npm --prefix .omk/extensions/atelier test -- test/graphics.test.ts test/integration.test.ts test/native.test.ts` | 0; 18 passed | `batch-a-regressions.log`, `.exit` |
| `npm --prefix .omk/extensions/atelier run typecheck` | 0 | `batch-a-typecheck.log`, `.exit` |
| `node .omk/extensions/atelier/scripts/verify-vendor.mjs` after batch A | 1, expected stale local hash for reviewed editor import change | `batch-a-vendor-expected-red.log`, `.exit` |
| `npm run check:pi-inventory` after batch A | 1, expected generated inventory mismatch | `batch-a-inventory-expected-red.log`, `.exit` |
| Native package case with `-t 'native package' --reporter=junit --outputFile=E/native-package-red.xml` | 1; reached errors-array assertion, missing legacy TUI dependency from sidebar | `native-package-red.xml`, `.log`, `.exit`, `.json` |
| Same GSD classifier targeting `native-package-red.json` from E | 0; `RED_EVIDENCE_OK`, one intended failure, no report errors | `native-package-red-classifier.log` |

Semantic RED assessment: actual AST values differed only in the requested module identities. The native test reached `DefaultResourceLoader.reload()` and failed at `expect(loaded.errors).toEqual([])`; the ordinary missing dependency was captured by the loader, not a test collection/import failure. Existing behavior cases passed before implementation.

The first classifier invocation had a cwd/path mismatch. The unchanged Vitest TAP report was then rejected as malformed because multiline diagnostic values are not accepted by this classifier. Neither rejection authorized implementation. A real JUnit rerun was retained unchanged and classified successfully before any vendor edit. Records live in the explicitly authorized external evidence workspace; the classifier was run from that workspace, not through an out-of-root symlink.

## Exact preservation

- `E/batch-a-byte-check.json` confirms all eight complete files equal their pristine backups transformed only at actual import-node string literal contents.
- Those eight files contain 11 migrated declarations. The remaining nine import files were still byte-identical at this boundary.
- `UPSTREAM.json`, both alias configurations, MIT license, revision and all upstream digests remained unchanged throughout this plan.
- No implementation body, binding, type marker, export, comment or notice was changed.
- No new stubs, skipped tests, network endpoints or security-relevant runtime surfaces were introduced.

## Task Commits

None, as explicitly required by D-13 and the execution handoff. `git rev-list --count 0d6e74b0d21cdb810c88c42381457eff944b935f..HEAD` measured 0. This is approved uncommitted work, not a claimed committed task. Actual tokens use realized diff characters divided by four; `E/02-03-metrics.json` retains the measurement.

## Deviations from Plan

- The main session explicitly retained ownership of root `npm run check`, shared planning state and requirement updates. This agent did not run or claim root-check success, including at the intermediate batch boundary.
- No dependency or source changes were made to resolve reporter format validation; the existing runner's JUnit reporter supplied valid RED evidence.

## Deferred Issues and limits

- Baseline and batch-A runs preceded the later explicit test-home isolation update. Their logs prove the observed source behavior, not isolation from the original HOME. Plan 02-04 reran the complete acceptance suite with fresh owned HOME/agent/temp roots; no private-user preservation claim relies on those early runs.
- At this boundary, final native package loading, remaining nine files, legacy alias removal, final local hashes and generated inventory belong to 02-04. The two intermediate nonzero checks above are not passes.
- Overall requirement completion, broader 89-extension/builtin parity and isolated packaged Node/Bun acceptance remain outside this plan.
- Headless and owned local tmux regressions do not establish native TUI screenshots, desktop/platform parity or OS notification delivery. No visual/platform acceptance is claimed.

## Self-Check: PASSED

All nine deliverable paths existed at the boundary. Eight exact allowed vendor substitutions and unchanged remaining vendor/config/provenance bytes were mechanically verified. No task commits were expected or claimed.

Final on-disk self-check also confirmed this summary and both test paths exist, with unchanged HEAD/index and final isolated acceptance receipts retained by 02-04.

## Post-integration test formatting follow-up

Parent's integrated root check reported formatting and non-null-assertion diagnostics in the two owned Atelier tests. The authorized follow-up changed only those tests and these owned summaries. In `import-migration.test.ts`, formatter layout and an explicit missing-entry guard replaced the non-null assertion; all import/binding/type-marker and complete registry/theme expectations remain unchanged.

Fresh backups and receipts are in `/mnt/omkdata/tmp/opencode/atelier-test-format-asbvDS` (`F`). `F/baseline.json` binds both original test bytes and 34 frozen vendor/config/provenance files. All repository edits used patches, not formatter write mode. `F/test-delta-review.json` compares actual parsed TypeScript leaf tokens against the original tests plus only the two authorized guards, allowing formatting/trailing commas. It confirms unchanged expectations, all 34 frozen digests and the Git index. The earlier standalone-scanner comparison was superseded because template literals require parser context; it was not treated as source drift or a pass.

| Command from checkout root | Exit/result | Evidence under F |
| --- | --- | --- |
| `node node_modules/@biomejs/biome/bin/biome check --error-on-warnings .omk/extensions/atelier/test/discovery.test.ts .omk/extensions/atelier/test/import-migration.test.ts` | 0; two files checked, no warnings or fixes applied | `scoped-biome-after.log`, `.exit` |
| `npm --prefix .omk/extensions/atelier test -- test/discovery.test.ts test/import-migration.test.ts --maxWorkers=1` | 0; 28 passed | `targeted.log`, `.exit`, `.root` |
| `npm --prefix .omk/extensions/atelier test -- --reporter=verbose --maxWorkers=1` | 0; 88 passed, same one existing platform skip | `full.log`, `.exit`, `.root` |
| `npm --prefix .omk/extensions/atelier run typecheck` | 0 | `typecheck.log`, `.exit`, `.root` |

Every test/typecheck command above used fresh short task-owned HOME, OMK_CODING_AGENT_DIR and TMPDIR roots. Production/vendor code, hashes, configs, generated inventory and unrelated interactive-mode formatting were not edited. Root `npm run check` was not rerun by this agent, and no root pass is claimed. Historical initial-delivery metrics above remain distinct from this follow-up's retained test diffs. No staging, commits, shared-state updates or additional agents were used.
