---
phase: "02"
slug: native-extensions-and-explicit-migration
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-11-05
---

# Phase 2 executable validation and source coverage audit

This is a plan, not a completed acceptance record. Main's saved
`task1-valid-red.log` was read during planning: **5 intended assertion failures,
3 positive passes, zero harness errors** against unchanged production. The earlier
harness-error run is superseded as RED evidence, not erased. No GREEN, artifact
or full feature-preservation result has been observed by this planner.

The log and the 36-file backup manifest are in main's external
`omk-phase2-native-extensions-backup` evidence directory. That manifest's original
planning-text hashes are historical because this revision edits planning text;
the frozen implementation/test digests and pre-edit vendor source are separate
invariants. Never rebaseline production or vendor drift over an unrelated change.

## Contract and execution gates

- Boundary A per D-01 removes implicit aliases. Installed user Pi sentinels MUST
  execute as their own dependencies in native mode. A missing dependency is the
  negative control. Runtime declaration enforcement/firewall research A2 is
  superseded and is not an acceptance gate.
- Current compatibility defaults and 1.5.10 remain unchanged. Separate activation
  needs old spec-108 criteria disposition and all applicable gates. Six source-work
  steps are not ROADMAP Phase 6 or full milestone completion.
- No new dependencies/upgrades, paid/provider-network calls, test bypass, global
  install, commits/staging/push/release or engine activation. Only executor 02-06
  may build and install exact reviewed packages in an isolated local prefix.
- Static doctor is advisory and bounded. A declared-dependency warning does not
  prove it is installed or compatible, nor grant permission to execute it.

## Plan dependency and ownership map

| Wave | Plan | Needs | Creates | Modified paths / tasks |
|---|---|---|---|---|
| 1 | 02-01 | Accepted frozen phase-1 construction contract | Native services tracer, separate direct discovery, source resolver matrix | 9 / 3 |
| 2 | 02-02 | 02-01 native loader | CLI/doctor target, public SDK and lifecycle checks, staged docs | 14 / 3 |
| 3 | 02-03 | 02-02 root-check stable point | First 8 Atelier import files and pristine baseline proof | 9 / 2 |
| 4 | 02-04 | 02-03 matched import-only diffs | Remaining 9 files, native package, final local hashes and inventory | 15 / 3 |
| 5 | 02-05 | 02-02 consumer and 02-04 vendor graph | Exact 89-entry plus builtin ledger and selected behavior checks | 9 / 3 |
| 6 | 02-06 | 02-05 source/preservation results | Real Node/Bun/types receipts and unresolved gate disposition | 10 / 3 |

No task modifies more than five files. No same-wave write overlap. The sequence
also handles non-file coupling: root check reads the tracked vendor inventory,
so it must not race a partial Atelier migration. 02-03 records the deliberately
unreconciled hash/inventory state as nonzero, never green. 02-04 owns final vendor
and root-green acceptance. Plans run without checkpoints or commits; failures
halt and report, not auto-approve. Calibration query returned factor 1, sample
count 0, confidence low; all six estimates use those values, not self-rated confidence.

## Task-to-test map

All entries below are planned except the explicitly observed RED above. New tests
are created in their owning TDD task before production edits. Existing phase-1
implementation/tests stay frozen, including package-doctor-cli.test.ts; new CLI
diagnostic cases belong to package-doctor-native-cli.test.ts.

| Task | Required distinguishing evidence | Automated target | State |
|---|---|---|---|
| 02-01.1 | Real services factory/tool result, provider owner, immutable options | native-extension-services.test.ts selected tracer | RED baseline exists; expansion/GREEN pending |
| 02-01.2 | Four declared index suffixes, authoritative empty/malformed manifests, order/dedup, native terminal selection | extensions-native-import-boundary.test.ts, extensions-native-discovery.test.ts, existing discovery | RED baseline exists; new controls/GREEN pending |
| 02-01.3 | Local ESM/CJS/transitive/subpath/delayed identities, no declaration enforcement, missing controls | extensions-native-resolution-routes.test.ts | Pending |
| 02-02.1 | Real CLI selected path/tool receipt and invalid input before evaluation | args.test.ts, cli-native-extensions.test.ts | Pending |
| 02-02.2 | Static target/declarations, originals unchanged, trust/cleanup, bounded scan | package-doctor-native-profile.test.ts, package-doctor-native-cli.test.ts, existing doctor/transitive | Pending |
| 02-02.3 | Public SDK injection, bound tool, provider owner, reload/cwd replacement | sdk-native-extensions.test.ts, native-extension-lifecycle.test.ts, public export controls | Pending |
| 02-03.1 | Pristine vendor verifier and four-file native text/render behavior | Atelier import-migration.test.ts, batch A text | Pending |
| 02-03.2 | Four more import-only modules and existing feature tests | Atelier batch A editor, graphics/integration/native, typecheck | Pending |
| 02-04.1 | Five remaining runtime-graph files make the actual native package RED turn GREEN | Atelier import-migration.test.ts, native package | Pending |
| 02-04.2 | Four remaining type-import modules and named native/compatibility discovery/feature parity | Atelier discovery/graphics/integration/usage | Pending |
| 02-04.3 | Only matched local hashes, immutable upstream/MIT, no legacy test aliases | Atelier full tests/types/vendor, Pi inventory and root check | Pending |
| 02-05.1 | Exact path set/contract schema, named behavior slice; counts cannot substitute | native-extension-inventory.test.ts, inventory --check | Pending |
| 02-05.2 | Individual 10 + 79 registry contracts and selected behavior/family evidence | native-repository-extension-preservation.test.ts, native-example-extension-preservation.test.ts | Pending |
| 02-05.3 | HARNESS_FACTORIES plus safety/todo/memory, flags/order; synthetic user originals | native-builtin-extension-preservation.test.ts, native-user-extension-preservation.test.ts, existing family tests | Pending |
| 02-06.1 | Exact installed Node SDK/CLI behavior, resolved internal bytes and tarballs | Artifact gate prepare + node, harness unit tests | Authorized, unrun |
| 02-06.2 | Actual compiled host binary normal startup and same matrix | Artifact gate bun, rejection controls | Authorized, unrun |
| 02-06.3 | Installed types, full bounded matrix, honest six-step/activation report | Artifact gate types + verify, all source/Atelier/root groups | Authorized, unrun |

## Runnable bounded commands

Working directory for this inherited **unchanged ten-file phase-1 command** is
`packages/coding-agent`. Retain these files unchanged and compare their digests
before/after execution. This is not the full repository suite.

```sh
node ../../node_modules/vitest/dist/cli.js --run test/package-manifest-boundary.test.ts test/package-manifest.test.ts test/package-manager.test.ts test/extensions-discovery.test.ts test/extensions-pi-provider-compat.test.ts test/extension-loader-lazy-imports.test.ts test/package-doctor.test.ts test/package-doctor-cli.test.ts test/package-manifest-auto-boundary.test.ts test/package-manifest-branch-boundary.test.ts
```

Working directory for each following source command is `packages/coding-agent`.
Run after its listed companion files have been created by the owning task, not
before. Keep complete failure output and exact exit status.

```sh
LIVE_E2E=0 node ../../node_modules/vitest/dist/cli.js --run test/extensions-native-import-boundary.test.ts test/native-extension-services.test.ts test/extensions-native-discovery.test.ts test/extensions-native-resolution-routes.test.ts
LIVE_E2E=0 node ../../node_modules/vitest/dist/cli.js --run test/args.test.ts test/cli-native-extensions.test.ts test/package-doctor-native-profile.test.ts test/package-doctor-native-cli.test.ts test/sdk-native-extensions.test.ts test/native-extension-lifecycle.test.ts
LIVE_E2E=0 node ../../node_modules/vitest/dist/cli.js --run test/package-doctor-transitive-scan.test.ts test/pi-compat-exports.test.ts test/sdk-tool-execution-settings.test.ts
LIVE_E2E=0 node ../../node_modules/vitest/dist/cli.js --run test/native-extension-inventory.test.ts test/native-repository-extension-preservation.test.ts
LIVE_E2E=0 node ../../node_modules/vitest/dist/cli.js --run test/native-example-extension-preservation.test.ts test/native-builtin-extension-preservation.test.ts test/native-user-extension-preservation.test.ts
LIVE_E2E=0 node ../../node_modules/vitest/dist/cli.js --run test/command-safety-gate.test.ts test/builtin-todo-checklist.test.ts test/tencent-memory.test.ts test/deepseek-harness.test.ts test/tool-pair-repair-nonmutating.test.ts test/deliverable-guard-extension.test.ts test/finish-check.test.ts
```

Working directory for these checks is the checkout root. The first inventory
command is new and must exist after 02-05. The existing Atelier npm scripts and
root inventory/check commands were grounded in their current package manifests.

```sh
node scripts/native-extension-inventory.mjs --check
npm --prefix .omk/extensions/atelier test
npm --prefix .omk/extensions/atelier run typecheck
npm --prefix .omk/extensions/atelier run check:vendor
npm run check:pi-inventory
npm run check
```

Working directory for artifact commands is the checkout root. Only execute after
02-06 creates the harness, reviews the local-package audit and sets
`OMK_NATIVE_ARTIFACT_ROOT` to a fresh owned external work directory. `prepare`
builds an isolated exact-source candidate, `node` performs local-prefix installation,
`bun` compiles/runs the real production host entry, `types` consumes installed
declarations and `verify` rejects missing/wrong receipts. None has run during planning.

```sh
node --test scripts/test/native-extension-artifact-gate.test.mjs
node scripts/native-extension-artifact-gate.mjs prepare --work "$OMK_NATIVE_ARTIFACT_ROOT"
node scripts/native-extension-artifact-gate.mjs node --work "$OMK_NATIVE_ARTIFACT_ROOT"
node scripts/native-extension-artifact-gate.mjs bun --work "$OMK_NATIVE_ARTIFACT_ROOT"
node scripts/native-extension-artifact-gate.mjs types --work "$OMK_NATIVE_ARTIFACT_ROOT"
node scripts/native-extension-artifact-gate.mjs verify --work "$OMK_NATIVE_ARTIFACT_ROOT"
```

## Evidence distinctions and stop rules

| Evidence | Required receipt | Cannot prove |
|---|---|---|
| Static inventory | Exact identities, reviewed contracts/features/unknown states | Factory evaluation or preservation by count |
| Source Node | Resolved identity and real factory/tool/provider/lifecycle results | Installed module lookup |
| Forced virtual source | Executed native factory and dependency identities | Compiled Bun startup |
| Packaged Node | Dirty-input/build/tarball and actual resolved-path/file digests, public SDK/CLI/types | Every platform or native-default activation |
| Compiled Bun | Exact executable/assets, normal namespace startup, same behavior matrix | Other targets or desktop/IME/R/Rust acceptance |
| Private-user preservation | Synthetic original-byte controls; permitted metadata only outside public outputs | Actual private code loading or feature certification |

Stop on intended behavior failure, new unrelated check failure, candidate identity
mismatch, unavailable/unknown package, missing tool/cache, unauthorized private
access or incomplete artifact receipt. Report blocked results with full evidence.
Do not substitute version/help, fake executable, source table, aliases, named skip,
compiler availability, an unchanged version number or an npm-success line.

## Multi-source coverage audit

`COVERED` means assigned executable work, NOT a completed requirement. The final
default goal is deliberately gated by the owner's D-02, not silently narrowed or
marked done. These plans cover the authorized six source-work steps, including
actual artifacts. Unresolved final-default/equivalence/full-feature gates block
broad requirement completion even after source execution passes.

| Source | ID | Item | Plans | Planning coverage / execution boundary |
|---|---|---|---|---|
| GOAL | G-01 | Final default has no implicit Pi compatibility | 02-01, 02-06 | COVERED staged capability + gate disposition; final default/activation remains BLOCKED, no flip |
| GOAL | G-02 | Migrate owned resources | 02-03, 02-04, 02-05 | COVERED import migration and per-entry feature evidence; unrun |
| GOAL | G-03 | Extension/provider/tool API across artifacts | 02-01, 02-02, 02-06 | COVERED source, installed Node/types, compiled Bun; unrun |
| REQ | V2-CORE-01 | Final production/default source and installed independence | 02-01, 02-03, 02-04, 02-05, 02-06 | COVERED authorized work; broad final-default completion still BLOCKED |
| REQ | V2-MIGRATE-01 | Diagnostics, originals, no compatibility approval | 02-02, 02-03, 02-04, 02-05, 02-06 | COVERED static diagnosis, import-only provenance and preservation; unrun |
| REQ | V2-API-01 | Owned versioned API source/Node/Bun contract | 02-01, 02-02, 02-05, 02-06 | COVERED at unchanged 1.5.10; artifact and full-feature results pending |
| RESEARCH | R-01 | Immutable options/services propagation, cache isolation | 02-01, 02-02 | COVERED through existing composition |
| RESEARCH | R-02 | Separate direct discovery and managed selection | 02-01 | COVERED compatibility counterexamples, no managed resolver substitution |
| RESEARCH | R-03 | Alias/virtual roots/subpaths and normal transitive fallback | 02-01, 02-06 | COVERED own installed identities per confirmed A; firewall proposal A2 SUPERSEDED |
| RESEARCH | R-04 | Static doctor bounds/trust/redaction/cleanup and limitations | 02-02, 02-05 | COVERED without following bare dependency graphs or executing user code |
| RESEARCH | R-05 | Owned Atelier migration, license and exact local hash adaptation | 02-03, 02-04 | COVERED 24 declarations/17 files, pristine baseline and final-batch hashes |
| RESEARCH | R-06 | Public factory/tool/provider owner/queue and lifecycle | 02-01, 02-02, 02-05, 02-06 | COVERED actual selected behavior, not registration count |
| RESEARCH | R-07 | Lazy imports/startup injection/no index cycle | 02-01, 02-06 | COVERED existing lazy controls and real binary startup |
| RESEARCH | R-08 | Exact dirty source, nested shrinkwrap, installed identities/types/assets | 02-06 | COVERED rejection controls plus actual builds/local install; unrun |
| RESEARCH | R-09 | Same-publisher precision, clipboard/Gondolin and old spec-108 gates | 02-02, 02-04, 02-05, 02-06 | COVERED classification/disposition, not unauthorized replacements or waived obligations |
| RESEARCH | R-10 | Sessions/auth/private originals and closed verified-run | 02-01, 02-02, 02-05 | COVERED no migration/discovery expansion or secret exposure |
| RESEARCH | R-11 | Environment availability versus real platform acceptance | 02-06 | COVERED host/minimum-runtime gate reporting; other roadmap phases excluded |
| RESEARCH | R-12 | Existing stack only, local package legitimacy | 02-01 through 02-06 | COVERED no new dependencies; exact seven-package audit gates isolated install |
| CONTEXT | D-01 | Boundary A, installed identities, no firewall | 02-01, 02-02, 02-06 | COVERED |
| CONTEXT | D-02 | Staged defaults/version and separate activation | 02-01, 02-02, 02-06 | COVERED, activation BLOCKED while unresolved |
| CONTEXT | D-03 | Immutable loader construction option | 02-01, 02-02 | COVERED |
| CONTEXT | D-04 | Preserve distinct direct-discovery compatibility | 02-01 | COVERED |
| CONTEXT | D-05 | Agreed CLI/doctor selection syntax | 02-02, 02-06 | COVERED implementation and real consumer tests |
| CONTEXT | D-06 | Existing SDK injection, tool/provider/lifecycle/cwd | 02-02, 02-06 | COVERED |
| CONTEXT | D-07 | 10 repository + 79 examples + builtins, features/unknowns | 02-03, 02-04, 02-05 | COVERED per-entry ledger and selected behaviors, not full live acceptance |
| CONTEXT | D-08 | Two Atelier batches, 24/17, final matched local hashes | 02-03, 02-04 | COVERED |
| CONTEXT | D-09 | Bounded static target diagnosis, originals | 02-02, 02-05 | COVERED |
| CONTEXT | D-10 | Private user originals/metadata boundary and truthful 44-static history | 02-02, 02-05, 02-06 | COVERED, no private access bypass/copy |
| CONTEXT | D-11 | Source + actual Node/Bun/types identity receipts | 02-01, 02-02, 02-06 | COVERED, artifacts unrun |
| CONTEXT | D-12 | Preserve unrelated work, trust, costs, governance/builtins | All | COVERED |
| CONTEXT | D-13 | Bounded operations and only isolated step-6 build/install | All | COVERED |
| CONTEXT | D-14 | Literal six source-work steps, not roadmap Phase 6 | 02-02, 02-05, 02-06 | COVERED with separate completion/activation disposition |

Research's historical import-denial proposals A2 and arbitrary escape prevention
are explicitly superseded by D-01, not dropped active requirements. Deferred
desktop/R/Rust/release work remains in its assigned roadmap phases. Actual private
user behavior and live/platform feature gaps remain unknown, not accepted by count.

## Sign-off at planning handoff

- [x] Six bounded plan files and explicit task-to-test/source audit authored.
- [x] Valid baseline RED log read, 5 intended failures / 3 passes / 0 harness errors.
- [ ] Expanded companion tests and all GREEN results observed.
- [ ] Exact owned-entry/builtin registration and selected behavior ledger accepted.
- [ ] Packaged Node, actual compiled Bun and installed declaration receipts accepted.
- [ ] Old spec-108 equivalence and all final-default activation criteria disposed.
- [ ] Broad phase requirements complete. This cannot be checked by assertion while gates remain.
