---
phase: 02-native-extensions-and-explicit-migration
plan: 05
subsystem: testing
tags: [extensions, inventory, preservation, native, compatibility, privacy, vitest]
status: complete
completion-scope: owned inventory and selected source preservation only
requires:
  - phase: 02-02
    provides: typed native loader construction policy and real source imports
  - phase: 02-04
    provides: import-only Atelier port without registration-body changes
provides:
  - exact 89-entry public identity and registration ledger
  - separate ledger for all seven harness factories and three inserted builtins
  - real native/compatibility entry matrix and selected safe behaviors
  - isolated synthetic user-original and installed-dependency controls
  - external metadata-only private ledger with no activation/runtime certification
affects: [02-06, native-extension-artifact-acceptance]
tech-stack:
  added: []
  patterns: [table-driven exact registry contracts, actual-factory isolated harness, explicit UNVERIFIED rows]
key-files:
  created:
    - scripts/native-extension-inventory.mjs
    - packages/coding-agent/test/fixtures/native-extension-inventory.json
    - packages/coding-agent/test/fixtures/native-extension-harness.ts
    - packages/coding-agent/test/native-extension-inventory.test.ts
    - packages/coding-agent/test/native-repository-extension-preservation.test.ts
    - packages/coding-agent/test/native-example-extension-preservation.test.ts
    - packages/coding-agent/test/native-builtin-extension-preservation.test.ts
    - packages/coding-agent/test/native-user-extension-preservation.test.ts
  modified: []
key-decisions:
  - Registry expectations are handwritten from reviewed source and the compatibility contract, never refreshed from native output.
  - Every row retains explicit UNVERIFIED behavior; counts and registration are not feature parity.
  - Private historical names remain external and are not inputs to public tests.
  - No commit, staging, root check, state advancement, or whole-phase acceptance in this disjoint worker.
requirements-completed: []
requirements-addressed: [V2-CORE-01, V2-MIGRATE-01, V2-API-01]
requirement-disposition: parent-owned; this evidence does not complete the broad requirements
coverage:
  - id: inventory
    description: Exact public identity/schema ledger and separate builtin membership
    verification:
      - kind: unit
        ref: node scripts/native-extension-inventory.mjs --check
        status: pass
    human_judgment: false
  - id: registry
    description: Each public entry independently matches reviewed registrations in both dialects
    verification:
      - kind: integration
        ref: native-repository-extension-preservation.test.ts and native-example-extension-preservation.test.ts
        status: pass
    human_judgment: false
  - id: external-acceptance
    description: Actual private, terminal, platform, network/provider, and packaged runtime behavior
    verification: []
    human_judgment: true
    rationale: Not exercised by this source-only worker; see each ledger row and parent acceptance gates.
duration: 42min
started: 2026-11-05T12:51:10Z
completed: 2026-11-05
completed-at: 2026-11-05T13:32:50Z
commits: 0
plan_head_before: 0d6e74b0d21cdb810c88c42381457eff944b935f
plan_head_after: 0d6e74b0d21cdb810c88c42381457eff944b935f
actuals:
  tokens: 32167
  tasks: 3
  commits: 0
actuals-measurement: new-file diff characters divided by four; external private metadata excluded from public diff
---

# Phase 2 Plan 5: Extension Inventory and Selected Preservation Summary

**Exact 89-entry native/compatibility registration contracts, actual builtin composition, and synthetic user byte-preservation controls with per-row unknowns.**

## Accomplishments

- Added a read-only public inventory command rooted at `.omk/extensions` and `packages/coding-agent/examples/extensions`. It records helper/test/vendor/non-autoload exclusions, honors declarations and authoritative empty/malformed selections, refuses external declarations/root overrides, and never reads user settings or a private home.
- The reviewed JSON lists each of the 10 repository entries and 79 examples individually: full path, discovery source, baseline/source review, exact command/tool/flag-default/event-count/shortcut/message-renderer/provider keys, selected case or family reference, and explicit UNVERIFIED reasons. Sparse registry fields mean empty collections, not wildcards. Relevant resource and event-bus channel identities are named separately.
- Every entry loads independently in both `omk+pi` and `omk`; no shared owner state or load-count substitution can hide missing registrations. Factories and handlers are actual loaded code. The harness isolates HOME, agentDir and cwd and fails on unintended child-process, HTTP or fetch calls.
- Selected execution covers typed greeting/result contracts, resource paths, headless guards, streaming-aware input via the real runner, dynamic tool registration/execution, event-bus delivery/disposal, local payload logging, message-renderer fallback, local Stagehand status and skill-message dispatch. These do not certify the unexercised UI/live features.
- The real `DefaultResourceLoader` composition accounts separately for all seven `HARNESS_FACTORIES`, command safety, fallback todo and Tencent memory. Checks cover exact order, default registries, all ten disable/re-enable controls, noExtensions semantics, user-todo precedence, safety short-circuit order, reload subscriptions, actual loop/pair/prompt/goal handlers and local non-capturing memory status.
- Synthetic user fixtures prove omission/explicit compatibility, native absent-dependency failure, local installed Pi root/transitive-subpath identity, static doctor non-execution, and byte equality for source, manifest, metadata, session and synthetic auth sentinels.

## Evidence Boundary

There are **178 individual public registration checks** (89 entries times two dialects), not 178 feature-preservation verdicts. The public ledger declares 34 rows with table-driven selected behaviors and five further example rows with custom selected cases. Seven other rows reference observed existing family tests; those family tests do not prove the entry's entire behavior. The remaining 43 rows have registration evidence only in this worker and explain their unexercised behavior individually. Every one of the 99 public/builtin rows retains UNVERIFIED limitations.

No actual private extension was read, copied, imported, executed or rewritten. The external private ledger contains only the 44 names supplied by the operator, individually classified as 14 directories, 18 TS/JS files, 8 tests, 1 disabled file and 3 MJS files. All activation values say settings are inaccessible; all behavior values say not executed. The unchanged 1.5.10 default/explicit compatibility route is recorded, not runtime acceptance. MJS explicit-path possibility is distinguished from autoload. Historical hints are marked historical, not refreshed evidence.

External output: `/mnt/omkdata/tmp/opencode/omk-phase2-native-extensions-backup/private-extension-ledger.json` (mode 0600). Exact supplied-name set, uniqueness, category totals and all UNVERIFIED states passed validation. No private names or source were copied into the public fixture or tests; coincidentally shared repository example basenames are repository-owned identities.

## Baseline Provenance

- Expected keys were reviewed from source, not generated from the native candidate. Compatibility and native must each match the same fixed expectations.
- The original loader backup has SHA-256 `5dcedae7ae2326041bb8837fc11e962720b7df6ffedefb263f97880db324bcc6`. TypeScript-printed comparisons verified `createExtensionRuntime`, `createExtensionAPI`, `createExtension` and `loadExtensionFromFactory` remain identical to that compatibility baseline.
- Atelier's original `vendor/extensions/index.ts` backup has SHA-256 `0b73c1e7fd5d11d806e6526770456503ab0f73d337366e8ed8069516ac017839`. Its entire non-import AST matches the candidate. The original HEAD `vendor/src/config.ts` establishes default shortcut `f6`; the expectation is not a newly blessed native snapshot.
- Unrelated dirty subagent write-scope/authority changes were inspected and preserved. This worker changed no source, vendor, existing tests, documentation, workflow, dependency or lock file.

## Verification Receipts

Latest combined run, exit **0**: **21 explicit files, 524 passed, 0 failed, 0 skipped**, 52.60 seconds. Of those, the five new scoped suites account for 316 tests; the 16 existing family files account for 208 tests. These counts describe test execution only.

```bash
node --check scripts/native-extension-inventory.mjs &&
node scripts/native-extension-inventory.mjs --check &&
(cd packages/coding-agent &&
  TMPDIR=/mnt/omkdata/tmp/opencode LIVE_E2E=0 env -u OMK_CODING_AGENT_DIR \
  node ../../node_modules/vitest/dist/cli.js --run \
    test/native-extension-inventory.test.ts \
    test/native-repository-extension-preservation.test.ts \
    test/native-example-extension-preservation.test.ts \
    test/native-builtin-extension-preservation.test.ts \
    test/native-user-extension-preservation.test.ts \
    test/command-safety-gate.test.ts \
    test/builtin-todo-checklist.test.ts \
    test/tencent-memory.test.ts \
    test/deepseek-harness.test.ts \
    test/tool-pair-repair-nonmutating.test.ts \
    test/deliverable-guard-extension.test.ts \
    test/finish-check.test.ts \
    test/builtin-harness-loop.test.ts \
    test/reverse-skill.test.ts \
    test/aside-policy.test.ts \
    test/aside-session-binding.test.ts \
    test/git-merge-and-resolve-extension.test.ts \
    test/trigger-compact-extension.test.ts \
    test/compaction-extensions-example.test.ts \
    test/subagent-loop-guard.test.ts \
    test/suite/regressions/018-b2c-correctness-wall.test.ts)
```

The inventory command reports exact 89 public and 10 builtin identities/schema and prints `NOT feature acceptance`. Relevant existing observed case names include:

| Existing family file | Actual case, not an invented test name |
| --- | --- |
| `command-safety-gate.test.ts` | `tool_call handler blocks bash block-tier commands` |
| `builtin-todo-checklist.test.ts` | `defers to an installed todo extension instead of exposing two checklist tools` |
| `tencent-memory.test.ts` | `is inert until configured and has no automatic capture hooks` |
| `deepseek-harness.test.ts` | `trims the middle once at 80%, preserving the source, ids and metadata` |
| `tool-pair-repair-nonmutating.test.ts` | `never mutates its input, including repair cases` |
| `deliverable-guard-extension.test.ts` | `restores at settle before the finish-check turn is sent` |
| `finish-check.test.ts` | `adds one verification turn before prompt() resolves, then stops` |
| `builtin-harness-loop.test.ts` | `blocks the sixth identical bash call through the live runner` |
| `git-merge-and-resolve-extension.test.ts` | `sends conflict report as a follow-up` |
| `trigger-compact-extension.test.ts` | `only auto-compacts when context usage crosses the threshold` |

Additional observed checks:

- Scoped TypeScript compiler-API diagnostics: **0** across the six owned TS modules, `noEmit`; diagnostics were filtered to those owned files, not presented as a root check.
- All seven owned code modules remain below 250 pure LOC even after read-only Biome formatting, measured with the repository's actual `countPureLoc`: inventory script 121, harness 241, inventory tests 84, repository tests 20, example tests 106, builtin tests 200, user tests 132.
- Stub scan found only initialized fixture accumulators and synthetic host boundaries, no production stubs, TODO/FIXME placeholders or fake expected production-tool results. The synthetic todo factory is only an ownership sentinel; its result is never used as preservation evidence.
- Exact external private ledger validation and public/private metadata boundary check: exit 0.
- HEAD remains `0d6e74b0d21cdb810c88c42381457eff944b935f`; measured `git rev-list --count <start>..HEAD` is 0. No staging or commit commands ran.

## TDD and Diagnostic History

1. Inventory RED: two named assertions failed on the intended missing/same-count identity substitution acceptance (exit 0 instead of 1). The classifier returned `RED_EVIDENCE_OK`; implementing identity/schema validation made them green.
2. Synthetic-user RED: the new fixture adapter initially omitted the dialect, so the named native absent-dependency assertion saw one compatibility-loaded extension rather than zero. The classifier returned `RED_EVIDENCE_OK`; forwarding the typed fourth options argument made the fixture controls green. This is evidence for the test adapter seam, not a claim that this worker fixed production native loading.
3. The initial 258-test matrix had 78 failures from a harness context binding, an incomplete terminal-theme boundary and handwritten expectation errors. A subsequent 314-test run had 10 failures from setup/expectation errors. Corrections were checked against source: default finish-check is headless, omitted API options forward undefined, streaming follow-up requires non-idle context, and event-bus delivery requires its actual session-start handlers. These failures were not misreported as production RED or hidden by weakening source code.
4. Final named entry titles contain full paths rather than truncated parameter displays. Final 524-test execution has no skipped cases. The five filter exclusions in the narrow RED reporter below were subsequently executed successfully.

## Deviations and Ownership

- **[Rule 2 - Missing critical boundary check]** The new inventory checks lexical containment before probing declared files and canonical containment before reading discovery roots, preventing a manifest/root symlink from turning a public inventory into a private-tree read. This affects only the newly owned script; final syntax/schema/tests passed.
- Parent explicitly retains `native-extension-services.test.ts`, source/vendored migration, CLI/doctor implementation and integration root check. This worker neither modified nor re-ran the services count smoke; its supersession/renaming remains parent-owned.
- `npm run check`, root formatting, packaged Node/Bun acceptance, requirement disposition and shared STATE/ROADMAP writes are parent-owned and were not performed here. No full Vitest suite, build, installation, paid/provider call, live extension network request, persistent global-state operation, default flip or nested agent was run. A Context7 documentation lookup returned a quota error; no dependency or tool was installed as a workaround.
- The `goal-controller-acceptance.test.ts` file remains a family lead, **not an observed receipt**: it creates temporary git commits and invokes real verifier processes. Its broader acceptance paths are unverified here; the actual composed goal's isolated empty-status handler was exercised in both dialects. Subagent child-worker smoke was not run; observed pure guard-family tests are not delegation/accounting acceptance.
- No per-task or metadata commits, git ledger writes, WINDOWS edits, STATE/ROADMAP advancement or whole-phase completion were made under the explicit disjoint-worker/no-commit grant. Requirement IDs are addressed, not marked fully completed by this summary.

## Unverified Gates and Handoff

- Consult each row's `features` and `unverified` fields; they are part of the deliverable, not optional caveats. In particular, all real provider/OAuth streams, native OS/VM/sandbox/PowerShell behavior, browser/SSH/Telegram services, actual terminal/editor/IME/layout/animation behavior and unexercised persistence/command paths remain UNVERIFIED.
- The private historical ledger does not establish current file existence, activation, installed dependencies or runtime compatibility. Permitted metadata/source access and a separately approved acceptance gate would be necessary to change those statuses.
- Main must run its integration root check and own source/artifact gates. The parent reported separate Atelier migration tests; those reports are not added to this worker's 524-test count.
- This summary completes only the authorized inventory/selected preservation work. It does not complete Phase 2 acceptance, native-default activation, desktop/R/Rust acceptance, release or the milestone.

## Preserved Raw RED Records

Both records below were separately accepted by `gsd-tools.cjs check tdd-red-evidence ... --raw` with `RED_EVIDENCE_OK` before their GREEN steps. Outputs are retained unmodified.

```json
{
  "command": "(cd packages/coding-agent && TMPDIR=/mnt/omkdata/tmp/opencode LIVE_E2E=0 node ../../node_modules/vitest/dist/cli.js --run test/native-user-extension-preservation.test.ts -t 'native missing legacy dependency fails resolution and preserves every original byte' --reporter=tap-flat)",
  "exitCode": 1,
  "targetTest": "test/native-user-extension-preservation.test.ts > synthetic user originals (never actual private extensions) > native missing legacy dependency fails resolution and preserves every original byte",
  "targetFile": "packages/coding-agent/test/native-user-extension-preservation.test.ts",
  "expected": "Native fixture helper must pass the construction dialect so an absent Pi import fails resolution",
  "actual": "Helper omitted the dialect, so compatibility loaded one extension instead of zero",
  "semanticAssessment": "The selected assertion executed and failed on extension length 1 versus 0. Five other cases were filter-excluded for this RED run, not permanently skipped. No fixture/import failure occurred.",
  "output": "TAP version 13\n1..6\nnot ok 1 - test/native-user-extension-preservation.test.ts > synthetic user originals (never actual private extensions) > native missing legacy dependency fails resolution and preserves every original byte # time=824.47ms\n    ---\n    error:\n        name: \"AssertionError\"\n        message: \"expected [ { …(10) } ] to have a length of +0 but got 1\"\n    at: \"/home/dmae97/Project/omk/packages/coding-agent/test/native-user-extension-preservation.test.ts:34:29\"\n    actual: \"1\"\n    expected: \"0\"\n    ...\nok 2 - test/native-user-extension-preservation.test.ts > synthetic user originals (never actual private extensions) > compatibility undefined retains synthetic legacy registration without rewriting # SKIP\nok 3 - test/native-user-extension-preservation.test.ts > synthetic user originals (never actual private extensions) > compatibility omk+pi retains synthetic legacy registration without rewriting # SKIP\nok 4 - test/native-user-extension-preservation.test.ts > synthetic user originals (never actual private extensions) > native local installed Pi dependency and transitive subpath keep their actual fixture identity # SKIP\nok 5 - test/native-user-extension-preservation.test.ts > synthetic user originals (never actual private extensions) > declared but absent Pi dependency is not fabricated by native loading # SKIP\nok 6 - test/native-user-extension-preservation.test.ts > synthetic user originals (never actual private extensions) > doctor diagnoses but never imports synthetic code or rewrites adjacent user state # SKIP\n",
  "previousEvidence": {
  "command": "(cd packages/coding-agent && LIVE_E2E=0 node ../../node_modules/vitest/dist/cli.js --run test/native-extension-inventory.test.ts --reporter=tap-flat)",
  "exitCode": 1,
  "targetTest": "test/native-extension-inventory.test.ts > public extension inventory drift controls > rejects same-count identity substitution",
  "targetFile": "packages/coding-agent/test/native-extension-inventory.test.ts",
  "expected": "Inventory check exits 1 for same-count identity substitution",
  "actual": "Inventory check exits 0 without validating identities",
  "semanticAssessment": "Both target assertions executed and failed on exit status 0 versus 1. There were no fixture, import, or syntax errors.",
  "output": "TAP version 13\n1..2\nnot ok 1 - test/native-extension-inventory.test.ts > public extension inventory drift controls > rejects a missing entry instead of certifying a load count # time=49.66ms\n    ---\n    error:\n        name: \"AssertionError\"\n        message: \"expected +0 to be 1 // Object.is equality\"\n    at: \"/home/dmae97/Project/omk/packages/coding-agent/test/native-extension-inventory.test.ts:19:25\"\n    actual: \"0\"\n    expected: \"1\"\n    ...\nnot ok 2 - test/native-extension-inventory.test.ts > public extension inventory drift controls > rejects same-count identity substitution # time=92.02ms\n    ---\n    error:\n        name: \"AssertionError\"\n        message: \"expected +0 to be 1 // Object.is equality\"\n    at: \"/home/dmae97/Project/omk/packages/coding-agent/test/native-extension-inventory.test.ts:28:25\"\n    actual: \"0\"\n    expected: \"1\"\n    ...\n"
  }
}
```

## Self-Check: PASSED

- All eight implementation/test artifacts and this summary exist; the approved external metadata ledger exists with mode 0600.
- Preserved raw RED JSON parses; both intended assertion failures were machine-classified before GREEN.
- Exact identities, 99 explicit public/builtin UNVERIFIED rows, evidence distribution and external metadata states match the summary.
- Latest combined run: 524 passed, zero failed/skipped. Scoped types: zero owned-file diagnostics. All owned code modules remain within 250 formatted pure LOC.
- No commit is claimed: HEAD is unchanged, measured commit count is zero, and shared planning state was intentionally left to the parent.
