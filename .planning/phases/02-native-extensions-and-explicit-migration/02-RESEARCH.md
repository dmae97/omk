# Phase 2: Native extensions and explicit migration - Research

**Researched:** 2026-11-05
**Domain:** Extension import resolution, explicit migration, public API and distribution boundaries
**Confidence:** Source observations are code-reading evidence only; native runtime and artifact acceptance remain pending.

## Binding planning correction after Boundary A confirmation

The owner's current handoff and `02-CONTEXT.md` D-01 through D-14 override the
historical enforcement proposal below. Native mode removes OMK's implicit Pi alias
and virtual mappings. It MUST allow explicitly installed user Pi dependencies to
execute as those dependencies, including transitive and delayed routes. No runtime
dependency-declaration check, deny hook, sandbox or process-wide firewall is wanted.
An installed sentinel executing with its own identity is a POSITIVE native result.
A missing package is the negative control, not a prohibited installed package.

Research assumption A2 (a transitive import firewall) is SUPERSEDED and inapplicable.
Historical A2 references and denial proposals are retained as research history only;
they are not plan requirements, threats or activation gates. A1 is resolved by the
immutable loader option and existing services/SDK injection. A3 is resolved by the
explicit non-sandbox boundary. A4 remains an actual offline artifact-harness gate.

Direct discovery is not compatibility-equivalent to the phase-1 managed resolver.
Keep its four index suffixes for declared directories, authoritative empty/malformed
manifest behavior, shallow discovery, ordering and deduplication independently.
Do not alter frozen phase-1 code/tests to share the different algorithms.

Current migration baseline is 24 legacy import declarations across 17 Atelier
vendor files, not 26. Baseline vendor verification precedes edits; final-batch
local hashes must match only those reviewed import changes. Preservation includes
the 10 repository and 79 example static entrypoints and the builtins, with named
registration/behavior evidence and explicit unverified states, not count acceptance.

The planner read main's valid RED log: 5 intended failures, 3 positive passes,
zero harness errors. Production is unchanged. Build and isolated artifact
installation are authorized for the executor's sixth source-work step, NOT for
this planner; no artifact execution has occurred. Default activation and broad
V2-CORE-01 completion remain blocked by separate recorded gates.

**Planning update:** `02-CONTEXT.md` was added after this research started. Use
that file and the final phase-1 summary as the current constraints. The phase-1
review correction adds `package-extension-entries.ts` and automatic-discovery
regressions; this research did not review or certify those changes.

## User Constraints

Original research initialization returned `"has_context": false` and `"commit_docs": false`. Context was subsequently supplied and is now authoritative; current locked decisions are D-01 through D-14 in 02-CONTEXT.md. The quoted research-only restrictions below describe that earlier research operation, not the executor's later step-6 authorization.

Operator constraints, quoted verbatim:

> This is RESEARCH ONLY, not implementation. Do not start another onboarding workflow. Do not change source/tests/docs/defaults, stage, commit, install, build, invoke providers or publish.
>
> Phase-1 implementation/tests are now frozen under independent verification. DO NOT repeat/review the phase-1 manifest/manager implementation/tests. Limit input there to the public construction API and staging docs if needed.
>
> Keep 1.5.10 versions and current defaults until a clearly gated activation step; no premature 2.0 version bump or release.
>
> Do not propose source-text rewrite of user's packages or automatic migration as approval. Distinguish trusted owned source updates from user data.
>
> Never copy operator-private skill/corpus content into this repository.

The frozen construction contract is an input, not a finding reopened here: `packageManifestDialect: "omk" | "omk+pi"`, omission/undefined preserves compatibility, invalid untyped inputs reject, and native Pi-only packages contribute zero resources. The staging document explicitly says this is “not a CLI setting or an automatically propagated session SDK policy.” [VERIFIED: packages/coding-agent/docs/omk-2-migration.md:253-265; operator handoff]

TUI/native desktop, Rust execution ownership and actual independent R acceptance remain later gates; Windows blueprint comparison remains unavailable. [VERIFIED: .planning/PROJECT.md:27-45; .planning/ROADMAP.md:24-50]

## Project Constraints (from AGENTS.md)

- Preserve existing spec-kit governance; constitution wins on release/versioning/governance. Do not duplicate behavioral rules into the alternate entry-point document. [VERIFIED: AGENTS.md:6-20]
- Public user documentation belongs under the coding-agent package, not the ignored root working-doc tree; do not publish links into ignored working material. [VERIFIED: AGENTS.md:39-41]
- Toolchain declarations are `Node >=22.19.0` and `npm 11.14.1`. Installation, if separately authorized, uses `npm install --ignore-scripts`. [VERIFIED: AGENTS.md:43-55]
- After a future runtime change, update source, relevant user docs and targeted tests; run the targeted tests and `npm run check`. Do not directly run the full Vitest suite or build without authorization; restart a rebuilt TUI before interactive command acceptance. [VERIFIED: AGENTS.md:57-68]
- Strict TypeScript, erasable syntax, no avoidable `any`, top-level imports, inline single-call/single-line helpers, registered default keybindings, module-size ratchet; read complete files before broad edits and ask before removing intentional code. Existing lazy-loading exceptions are not permission to introduce arbitrary dynamic imports. [VERIFIED: AGENTS.md:70-80]
- Do not hand-edit generated catalogs or regenerate them during this phase; provider additions require their dedicated wiring/test matrix and keyless-test gates. No provider addition is recommended here. [VERIFIED: AGENTS.md:82-103]
- One concern per PR, no unreviewed dependency, no workflow edits without owner approval, no CI bypass, approved current SHA before merge, no amend/rebase/force-push after PR creation; paid benchmarks require an owner-set cap. [VERIFIED: AGENTS.md:111-136]
- Preserve existing default-on flags and the opt-out baseline; do not turn this phase into unrelated flag/default changes. [VERIFIED: AGENTS.md:138-174; operator scope]
- Shared-tree discipline: stage only explicitly owned paths if later authorized; never broad-add, stash, destructive-reset/clean, bypass hooks or commit without authorization. Never guess secret destinations or expose secrets. [VERIFIED: AGENTS.md:176-183]
- Preserve licenses/copyright; copied code must satisfy the repository's MIT/Apache-2.0 provenance rules. No rankings or unsupported performance claims. [VERIFIED: AGENTS.md:130-136]
- Release only through the constitution's gated CI procedure, preserve released changelog sections, and keep private agent-home material out of repository/artifacts; do not weaken the private-home guard. Treat generated wiki content as leads, not authority, and do not hand-edit it here. [VERIFIED: AGENTS.md:185-216]

## Summary

The remaining boundary is **execution/import reachability**, not manifest parsing. The loader unconditionally adds legacy mappings in both Node and binary tables. Its public direct-discovery function separately reads manifests and ultimately calls the same file loader. The resource loader constructs the package manager without the explicit dialect and invokes the file loader without an execution policy. These are distinct integration seams beyond phase 1. [VERIFIED: packages/coding-agent/src/core/extensions/loader.ts:165-193,448-456,568-603,653-701; packages/coding-agent/src/core/extensions/bundled-virtual-modules.ts:46-68; packages/coding-agent/src/core/resource-loader.ts:169-178,369-378]

Jiti resolves aliases and then tries ordinary ESM-compatible/native resolution, including CommonJS evaluation. Under confirmed Boundary A this is expected: native mode must retain ordinary installed dependency identity. Alias selection alone does not prove migration, consumer wiring, feature preservation or artifacts, but transitive installed execution is not a firewall defect. No runtime probe was executed by the original researcher. [CITED: https://raw.githubusercontent.com/unjs/jiti/v2.7.0/src/resolve.ts] [CITED: https://raw.githubusercontent.com/unjs/jiti/v2.7.0/src/eval.ts]

**Current recommendation:** deliver one additive, explicitly selected native loading tracer through the existing resource-loader/services boundary, then expand installed dependency identity, transitive routes and separate direct discovery. Preserve current defaults. Implement the agreed CLI selection, SDK loader injection, static target diagnostics, owned import migration/preservation and actual artifact gates. The obsolete A2 enforcement checkpoint is not applicable.

## Architectural Responsibility Map

This is a recommended responsibility assignment, grounded in the existing composition below, not a browser/server redesign.

The reusable construction field is quoted verbatim: `resourceLoaderOptions?: Omit<DefaultResourceLoaderOptions, "cwd" | "agentDir" | "settingsManager">;`. [VERIFIED: packages/coding-agent/src/core/agent-session-services.ts:33-41]

| Capability | Primary tier | Secondary tier | Rationale / evidence |
|---|---|---|---|
| Choose native versus explicit compatibility at construction | Local API/backend composition | CLI/SDK caller | Reuse `resourceLoaderOptions`, whose exact type is quoted above. [VERIFIED: packages/coding-agent/src/core/agent-session-services.ts:33-41,139-153] |
| Discover and select resources | Resource-loading backend | Package-management backend | Keep the frozen package boundary; wire callers rather than reimplementing it. Existing call: `new DefaultPackageManager({ cwd: this.cwd, agentDir: this.agentDir, settingsManager: this.settingsManager })`. [VERIFIED: packages/coding-agent/src/core/resource-loader.ts:169-178] |
| Select owned alias namespaces without remapping user dependencies | Extension execution/loading backend | Node/Bun-specific adapter | Parameterize `loadExtensionModule` and virtual tables by an immutable per-load dialect; preserve ordinary dependency resolution under Boundary A. |
| Migration diagnosis | Static inspection backend | CLI presentation | Doctor explicitly performs static-only inspection and CLI returns JSON, not extension execution. [VERIFIED: packages/coding-agent/src/core/package-doctor.ts:130-142; packages/coding-agent/src/commands/package-doctor-cli.ts:20-25,83-101] |
| Provider/tool registration and ownership | Existing OMK runtime | Model registry | Preserve provider ownership and pre-bind queue; do not move execution into a renderer or migration utility. [VERIFIED: packages/coding-agent/src/core/extensions/loader.ts:275-282,416-427; packages/coding-agent/src/core/extensions/runner.ts:282-315] |
| Public contract/distribution parity | Package API and build tooling | Installed consumer | Declaration exports, Node aliases and binary namespace registration are separate acceptance surfaces. [VERIFIED: packages/coding-agent/package.json:13-24,35-44; packages/coding-agent/src/bun/register-bundled-coding-agent.ts:10-13] |
| Sessions, credentials and installed user resources | Existing storage owners | Read-only migration report | Preserve originals and authentication; do not bulk rename user files. [VERIFIED: .planning/PROJECT.md:29-43] |

<phase_requirements>
## Phase Requirements

| ID | Description, verbatim | Research support |
|---|---|---|
| V2-CORE-01 | Final default production core has no reachable Pi runtime dependency or implicit legacy import aliases; verify source and installed artifacts. | Resolver sentinel matrix, direct discovery, SDK/service propagation and separate artifact gates below. [VERIFIED: .planning/REQUIREMENTS.md:9] |
| V2-MIGRATE-01 | Legacy resources have explicit migration diagnostics; preserve originals and never turn compatibility into approval. | Reuse static doctor and bounded source walk, preserve scan limitations, migrate only reviewed repository-owned sources. [VERIFIED: .planning/REQUIREMENTS.md:10] |
| V2-API-01 | OMK owns its versioned extension/provider/tool contract and tests source, packaged Node and bundled entry points. | Public root/type fixtures, native registration contract and installed consumer tests; keep package versions unchanged during staging. [VERIFIED: .planning/REQUIREMENTS.md:11] |
</phase_requirements>

## Standard Stack

Reuse the installed stack; **no new dependency or upgrade is recommended**. Manifest pins are observations, not a claim that these are registry-latest releases. Registry lookups confirmed the pinned versions and publication timestamps; timestamps alone do not establish package legitimacy. [VERIFIED: packages/coding-agent/package.json:46-85; npm view commands observed this session]

| Component | Existing pin / declared contract | Purpose | Provenance |
|---|---|---|---|
| OMK public runtime packages | `"version": "1.5.10"`; dependencies include `"omk-agent-core": "^1.5.10"`, `"omk-ai": "^1.5.10"`, `"omk-tui": "^1.5.10"` | Owned extension/provider/tool types and implementation | [VERIFIED: packages/coding-agent/package.json:2-3,58-62; packages/ai/package.json:2-3; packages/agent/package.json:2-3] |
| Jiti | `"jiti": "2.7.0"`; published 2026-05-05T21:02:47.918Z | Existing TS/ESM extension evaluator | [VERIFIED: packages/coding-agent/package.json:56; node_modules/jiti/package.json:2-6] [CITED: https://registry.npmjs.org/jiti] |
| TypeBox | `"typebox": "1.3.11"`; published 2026-08-06T11:42:49.751Z | Existing tool schemas; do not replace validation | [VERIFIED: packages/coding-agent/package.json:64; packages/coding-agent/src/core/extensions/types.ts:469-475] [CITED: https://registry.npmjs.org/typebox] |
| Vitest | `"vitest": "4.1.11"`; published 2026-08-18T14:27:07.240Z | Targeted source/fixture tests | [VERIFIED: packages/coding-agent/package.json:85] [CITED: https://registry.npmjs.org/vitest] |
| TypeScript | `"typescript": "5.9.3"`; published 2025-09-30T21:19:38.784Z | Consumer declaration/type contract checks, not a new runtime parser dependency | [VERIFIED: packages/coding-agent/package.json:84] [CITED: https://registry.npmjs.org/typescript] |
| Node and Bun | Node declaration `"node": ">=22.19.0"`; current probes: Node `v26.12.1`, Bun `1.4.4` | Different execution adapters; test both actual artifact paths | [VERIFIED: packages/coding-agent/package.json:117-119; node --version / bun --version output] |

**Installation:** none. A future proposal to install anything requires explicit dependency review and the package-legitimacy gate; registry existence is not sufficient approval.

## Package Legitimacy Audit

Planning revision narrows the authorized artifact install to exact locally built
workspace tarballs. It is not authority to add or upgrade a registry dependency.
The planner read the seven current manifests: all are MIT, version 1.5.10, with
the existing build scripts; no prepare/install/postinstall entry was present on
these seven workspace packages. This is local source-origin verification, not a
registry-latest, tarball-safety or artifact-pass claim.

| Package | Exact source | Version/license | Legitimacy | Install/postinstall disposition |
|---|---|---|---|---|
| omk-ai | packages/ai/package.json | 1.5.10, MIT | [VERIFIED] existing local workspace origin | Only exact candidate tarball; --ignore-scripts |
| omk-tui | packages/tui/package.json | 1.5.10, MIT | [VERIFIED] existing local workspace origin | Only exact candidate tarball; --ignore-scripts |
| omk-agent-core | packages/agent/package.json | 1.5.10, MIT | [VERIFIED] existing local workspace origin | Only exact candidate tarball; --ignore-scripts |
| omk-protocol | packages/protocol/package.json | 1.5.10, MIT | [VERIFIED] existing local workspace origin | Only exact candidate tarball; --ignore-scripts |
| omk-adaptorch-wpl | packages/adaptorch-wpl/package.json | 1.5.10, MIT | [VERIFIED] existing local workspace origin | Only exact candidate tarball; --ignore-scripts |
| open-multi-agent-kit | packages/coding-agent/package.json | 1.5.10, MIT | [VERIFIED] existing local workspace origin | Only exact candidate tarball; --ignore-scripts |
| omk-book-to-skill | packages/book-to-skill/package.json | 1.5.10, MIT | [VERIFIED] existing local workspace origin | Only exact candidate tarball; --ignore-scripts |

02-06 must revalidate manifests and exact tarball digests, preserve MIT notices,
check public members and require already reviewed locked transitive identities.
No global install. Missing cache, unknown/changed registry package, unexpected
lifecycle execution or substituted nested internal package stops the operation.
An external/new package needs a separate legitimacy audit and blocking human
review before any installation; it is not implicitly approved by this table.

## Architecture Patterns

### System architecture and data flow

```text
CLI construction / SDK caller / explicit migration inspection
                    |
       existing services + resource-loader composition
                    |
          select construction-time loading context
             /                         \
       execution path              static doctor
             |                    bounded source walk
   managed resolution OR          -> migration report
   direct discovery/path                   |
             |                      no code execution
    selected immutable dialect            no approval
        /              \
  native OMK maps     explicit compatibility maps
  ordinary installed  existing supported aliases
  dependencies        plus historical normal fallback
       |              |
 Node/Jiti resolution OR Bun bundled namespace
       |              |
 native extension factory -> OMK tool/provider registration
       |
 source receipt -> packaged Node receipt -> real binary receipt
```

Selected immutable loading context is proposed implementation, not an existing feature. Its contract is now resolved by Boundary A and D-03; preserve the existing separate trust/permission gates. Managed Pi-only resource rejection remains the frozen phase-1 contract, separate from execution of an explicitly supplied file/dependency.

### Component responsibilities and precise remaining seams

Classifier definitions, quoted verbatim rather than inferred from publisher names: [VERIFIED: packages/coding-agent/src/core/pi-compat.ts:1,19-20]

```typescript
export type PiCompatibilityTarget = "coding-agent" | "agent-core" | "agent-core-node" | "ai" | "ai-oauth" | "tui";

const LEGACY_PI_IMPORT =
	/^@(mariozechner|earendil-works|oh-my-pi)\/pi-(?:agent-core|ai|coding-agent|natives|tui|utils)(?:\/|$)/u;
```

| Source | Observed contract / gap | Planning action |
|---|---|---|
| Coding-agent compatibility classifier | Uses the exact type/regex quoted above; alias namespaces are `"@earendil-works"`, `"@mariozechner"`. [VERIFIED: packages/coding-agent/src/core/pi-compat.ts:1-23] | Reuse classification and explicit alias metadata; distinguish recognized legacy imports from supported aliases. Do not blacklist a whole publisher namespace. |
| Node alias/resolution adapter | Host package lookup first tries `` `${specifier}/package.json` `` then walks `"node_modules"`; workspace targets win when present. Native aliases include `"omk-agent-core/node"`, `"omk-ai/oauth"`, `"omk-ai/prompt-hash"`. [VERIFIED: packages/coding-agent/src/core/extensions/loader.ts:42-82,119-193] | Test workspace-present and installed-only layouts, package-export restrictions, subpaths and actual resolved identities; never infer installed behavior from a monorepo test. |
| Shared evaluation boundary | Existing options are `moduleCache: false` and `binaryMode ? { virtualModules: await buildVirtualModulesLazily(), tryNative: false } : { alias: getAliases() }`; file import uses `jiti.import(extensionPath, { default: true })`. [VERIFIED: packages/coding-agent/src/core/extensions/loader.ts:448-456] | Add native behavior here rather than only hiding discovery results; preserve lazy loading and error collection. |
| Binary namespace adapter | Static native imports and `buildVirtualModules()` map both native names and the legacy table. `"omk-ai/prompt-hash"` appears in the Node alias table; binary's explicit native table lists `"omk-ai"`, `"omk-ai/oauth"`, `"omk-agent-core/node"` and other roots. [VERIFIED: packages/coding-agent/src/core/extensions/loader.ts:180-192; packages/coding-agent/src/core/extensions/bundled-virtual-modules.ts:15-23,52-68] | Establish required native-subpath parity, including prompt-hash; table omission is not proof that ordinary runtime resolution cannot find a subpath. Keep static imports and startup injection; do not reintroduce the index/core cycle. |
| Direct loader/discovery | `resolveExtensionEntries` calls `readPackageManifest(packageJsonPath)`; `discoverAndLoadExtensions` searches local/global locations and configured paths before `loadExtensions(allPaths, resolvedCwd, eventBus)`. [VERIFIED: packages/coding-agent/src/core/extensions/loader.ts:568-603,653-701] | Carry the selected boundary into direct directory/file loading too; do not assume managed-package selection protects this exported route. |
| Resource loader and SDK | Current manager construction omits a dialect. SDK supports `resourceLoader?: ResourceLoader`; default SDK construction creates/reloads its own loader. [VERIFIED: packages/coding-agent/src/core/resource-loader.ts:169-178; packages/coding-agent/src/core/sdk.ts:99-100,344-374] | Reuse loader injection for an additive tracer; expose the existing manifest option narrowly in resource-loader construction, without changing the frozen manager. Keep import enforcement a separately specified responsibility. |
| CLI services and replacement | Services already spread `options.resourceLoaderOptions`; runtime factory recreates cwd-bound services. CLI feeds this boundary and preserves trust gating. [VERIFIED: packages/coding-agent/src/core/agent-session-services.ts:139-153; packages/coding-agent/src/core/agent-session-runtime.ts:24-36,51-56; packages/coding-agent/src/main.ts:681-709] | Prefer this existing options channel over an environment flag, persisted setting, or a second top-level SDK switch. Ensure construction context survives reload/session replacement; preserve custom resource loaders. |
| Closed verified-run composition | It constructs a loader with `noExtensions: true` and explicitly says `No reload/discovery: arbitrary project or user code must not enter this host runtime.` [VERIFIED: packages/coding-agent/src/core/verified-run-session.ts:22-33] | Preserve the closed adapter; do not enable discovery merely to unify construction code. |
| AI compatibility helper | `openAIResponsesApi()` returns the owned streamers via local relative imports; public AI index re-exports it. [VERIFIED: packages/ai/src/pi-compat.ts:1-12; packages/ai/src/index.ts:4-10] | Do not delete functionality because its filename contains Pi. Native naming/hygiene is distinct from a dependency on an upstream runtime. |

### Reuse the current API, not a replacement SDK

- Existing public extension exports include `ExtensionAPI`, `ExtensionFactory`, `ProviderConfig`, `ToolDefinition`, `defineTool`, `discoverAndLoadExtensions`, and `ExtensionRunner`. The root delegates through `export * from "./core/public-extension-exports.ts"`. Test these public entry points, not an assumed public export of every internal loader helper. [VERIFIED: packages/coding-agent/src/core/public-extension-exports.ts:24-34,47-52,70-89; packages/coding-agent/src/index.ts:238-240]
- Existing factory contract is `export type ExtensionFactory = (omk: ExtensionAPI) => void | Promise<void>;`; provider config permits `streamSimple?`, and tools have TypeBox `parameters` plus an asynchronous `execute(...)`. Reuse synthetic local providers/tools to prove registration without calling a model. [VERIFIED: packages/coding-agent/src/core/extensions/types.ts:458-505,1365-1376,1428-1429]
- Keep package-versioned API fixtures at the current `"version": "1.5.10"` while staging; do not invent a second runtime ABI/version-negotiation system without a demonstrated requirement. [VERIFIED: packages/coding-agent/package.json:2-3; .planning/REQUIREMENTS.md:11]

## Recommended Tracer and Dependency Ordering

### Minimum next end-to-end tracer

Current tracer after the owner's A-policy decision:

1. Construct an explicitly native resource loader through the existing services options channel, retaining the existing frozen manager API for resource selection. Inject that loader into SDK/session composition rather than adding global policy state. [ASSUMED: A1]
2. Load a small repository-authored native extension using public OMK imports; observe a registered tool, queued/flushed synthetic provider, and a deterministic lifecycle receipt without inference or external services. Start from the native hello example rather than a private extension. [VERIFIED: packages/coding-agent/examples/extensions/hello.ts:5-26; packages/coding-agent/src/core/agent-session-services.ts:155-168; packages/coding-agent/src/core/extensions/runner.ts:282-315]
3. Place a real synthetic Pi package in the extension's nearest dependency directory. Through relative and ordinary bare ESM/CJS helpers, require its native identity and sentinel execution rather than secret OMK remapping. Use a separate absent-package case for ordinary resolution failure. No runtime manifest-declaration enforcement or denial hook.
4. Prove omitted/undefined selection still follows the current compatibility behavior, native/compatibility construction does not leak through cached tables, and direct discovery cannot bypass selection. Do not reopen phase-1 manifest tests; add phase-2 companions. [ASSUMED: A1, A2]
5. Feed the fixture to static doctor separately: native-target diagnostics must describe migration rather than promise implicit aliases; originals stay byte-identical. Doctor success must not be substituted for execution acceptance. [VERIFIED: packages/coding-agent/src/core/package-doctor.ts:106-121,130-151,235-237]

**Do not stop at a unit-tested alias table.** Require actual factory/tool/provider/lifecycle receipts, installed identity controls and separate missing-package failure, then real installed/compiled artifact gates. A resolvable installed user dependency is not prohibited under Boundary A.

### Staged sequence and gates

| Stage | Prerequisite | Deliverable / acceptance | Activation rule |
|---|---|---|---|
| 0. Handoff and contract | Main's independent phase-1 closeout | Record overlay ownership, define supported import coverage and construction policy; preserve manager internals/tests | No default change |
| 1. Resolver tracer | Confirmed A, intended assertion RED | Native factory/tool registration and real installed/transitive identity plus missing control | Explicit selection, compatibility omission unchanged |
| 2. Reachability closure | Tracer works | Direct loading/discovery, services, SDK injection, reload/replacement, late imports and Node/Bun-adapter matrix | No process-wide mutable policy |
| 3. Owned sources + migration report | Native contract established | Migrate reviewed in-repo imports, aliases in owned test/type configs, provenance hashes and doctor semantics; preserve user originals | No automatic user rewrite/approval |
| 4. Distribution closure | Reviewed source candidate and local package audit | Exact candidate Node consumer + real compiled Bun, declarations, subpaths, resources and resolved identities | Authorized for executor step 6 only; currently UNRUN |
| 5. Native-default activation | Stages 1-4 accepted, migration path documented, governance conflicts resolved | Deliberate construction/default cutover, with explicit migration/compatibility separated from final native core | Not inferred from version and not released as an unnoticed 1.x semantic change |
| 6. Milestone release | Later TUI/native, R, Rust ownership/recovery and platform gates | Constitution milestone procedure and separately authorized publication | Keep all current versions until these gates pass |

These are recommendations, not completed implementation or release authority; phase and milestone ownership follows the existing dependency map. [VERIFIED: .planning/ROADMAP.md:17-50; specs/108-pi-decoupling/spec.md:12-18,45-50; specs/constitution.md:45-57]

### Rejected alternatives

| Alternative | Reject because |
|---|---|
| Delete aliases and call native complete | Consumer wiring, owned migration, per-feature preservation and actual artifact gates still require evidence. Ordinary installed resolution itself is allowed. |
| Treat the manifest dialect as a firewall or sandbox | Staging explicitly excludes that claim; direct file loading is a separate route. [VERIFIED: packages/coding-agent/docs/omk-2-migration.md:261-269; packages/coding-agent/src/core/extensions/loader.ts:489-510,653-701] |
| Disable try-native and assume every transitive import is intercepted | Jiti's evaluator has affirmative native ESM/CommonJS branches beyond that optimization. [CITED: https://raw.githubusercontent.com/unjs/jiti/v2.7.0/src/eval.ts] |
| Global flag, persisted policy or version-triggered switch | Existing services/loader injection is reusable; phase-1 staging forbids implicit version-based activation. [VERIFIED: packages/coding-agent/src/core/agent-session-services.ts:33-41,147-153; specs/108-pi-decoupling/spec.md:14-18] |
| Install a replacement loader, parser or sandbox immediately | Existing evaluator/classifier/doctor seams should be exhausted first; no new dependency without review. [VERIFIED: AGENTS.md:118-120; packages/coding-agent/src/core/pi-compat.ts:19-28] |
| Rewrite installed user source, move sessions or treat doctor as permission | Original-data and permission boundaries remain independent. [VERIFIED: .planning/REQUIREMENTS.md:10; packages/coding-agent/docs/omk-2-migration.md:264-270] |
| Reject an entire publisher or strip upstream attribution | Classifier targets named Pi runtime families, not clipboard or Gondolin; license notice must remain. [VERIFIED: packages/coding-agent/src/core/pi-compat.ts:19-23; .omk/extensions/atelier/vendor/LICENSE:3-7] |

## Owned Resource Migration and Static Diagnostics

**Owned source versus user data:** the repository Atelier wrapper already imports `"open-multi-agent-kit"`, but its vendored extension imports `"@earendil-works/pi-coding-agent"` and `"@earendil-works/pi-tui"`; the vendored editor has runtime imports of both legacy families. Its own test/type configuration also maps legacy names to source. Migrate that reviewed owned source and matching test/type wiring, not arbitrary installed packages. [VERIFIED: .omk/extensions/atelier/index.ts:1-10; .omk/extensions/atelier/vendor/extensions/index.ts:1-10; .omk/extensions/atelier/vendor/src/editor.ts:1-4; .omk/extensions/atelier/vitest.config.ts:7-17; .omk/extensions/atelier/tsconfig.json:7-16]

The vendor verifier checks each `hashes.localSha256` and asserts `Copyright (c) 2026 Michael`. Preserve the upstream record and notice; review each intentional import-only change before updating its local digest, without replacing upstream digests or blessing unrelated drift. [VERIFIED: .omk/extensions/atelier/scripts/verify-vendor.mjs:6-16; .omk/extensions/atelier/UPSTREAM.json:2-18; .omk/extensions/atelier/vendor/LICENSE:3-7]

The native hello and custom-provider examples already import `"omk-ai"` and `"open-multi-agent-kit"`; no broad rewrite of examples is justified by their publisher history. Authored context templates explicitly describe `PI_PROVIDER`, `PI_MODEL`, `PI_REASONING_LEVEL` as compatibility metadata, not an upstream runtime dependency. Preserve those semantics unless separately changed. [VERIFIED: packages/coding-agent/examples/extensions/hello.ts:5-6; packages/coding-agent/examples/extensions/custom-provider-anthropic/index.ts:24-46; packages/coding-agent/examples/context/AGENTS.md:53-58]

Use only authored distributable templates. Existing init code chooses `project ? "project-context" : "context"`, preserves existing documents, and creates with `{ flag: "wx", mode: project ? 0o644 : 0o600 }`; reuse its non-overwrite discipline rather than importing operator-private instructions. [VERIFIED: packages/coding-agent/src/commands/init-cli.ts:155-185]

Doctor reuse and limits:

- Reuse `inspectPackageCompatibility`, `importedSpecifiers`, `scanPackageExtensionSources`, the legacy classifier and the existing CLI injection/cleanup seam. Current diagnostic statuses are `"pass" | "warning" | "error"`; result `schemaVersion: 1`; compatibility is `checks.every((item) => item.status !== "error")`. A warning currently remains compatible, not approved. [VERIFIED: packages/coding-agent/src/core/package-doctor.ts:26-42,106-121,220-237; packages/coding-agent/src/commands/package-doctor-cli.ts:13-18,83-101]
- Current messages say `"Legacy Pi runtime imports will use OMK compatibility aliases"` for supported aliases and error for unsupported families. Parameterize diagnosis for the explicitly selected target before activation, preserving existing output under omission; do not unconditionally change the 1.x CLI verdict. Reuse `"runtime-imports"` and `"scan-coverage"` where appropriate instead of inventing another diagnostic engine. [VERIFIED: packages/coding-agent/src/core/package-doctor.ts:26-36,106-121,210-216]
- Its bounded walk follows **relative** imports, performs realpath/containment/no-follow/inode checks, and limits files/bytes: `MAX_EXTENSION_FILES = 256`, `MAX_EXTENSION_BYTES = 1_048_576`. The parser uses literal import/export/require regexes; bare dependencies are deliberately excluded. Preserve these protections; report uncovered bare/computed routes rather than marking them proven safe. [VERIFIED: packages/coding-agent/src/core/package-doctor-source-scan.ts:4-6,81-107,120-175]
- CLI preserves its trust gate before preparation and invokes cleanup in `finally`. Do not import extensions to “improve” static diagnosis or turn remote preparation into installation. [VERIFIED: packages/coding-agent/src/commands/package-doctor-cli.ts:58-63,83-101]

The current inventory is a **lead**, not a deny policy: its publisher regex is deliberately broad and its input is `git("ls-files", "-z")`, so fresh untracked work is outside that input set. It only writes the generated inventory outside `--check`; future owned-import changes must include reviewed inventory regeneration, not a blanket namespace removal. [VERIFIED: scripts/pi-inventory.mjs:8-23,54-68]

## Don't Hand-Roll

| Problem | Reuse instead | Important boundary |
|---|---|---|
| Native/legacy manifest selection | Frozen manager construction contract | Pass it through callers; do not duplicate its parser. [VERIFIED: packages/coding-agent/src/core/package-manager.ts:136-144; packages/coding-agent/docs/omk-2-migration.md:253-259] |
| Legacy family detection and supported alias list | Existing classifier/table | Recognized legacy and aliased legacy are different sets. [VERIFIED: packages/coding-agent/src/core/pi-compat.ts:3-28] |
| Safe migration source inspection | Existing bounded doctor walker | Diagnostic evidence only, not arbitrary JS dependency execution or sandboxing. [VERIFIED: packages/coding-agent/src/core/package-doctor-source-scan.ts:81-107,109-175] |
| Tool/provider contract | Existing public types, TypeBox and runner ownership | Preserve queue flushing, tool validation and provider owner attribution. [VERIFIED: packages/coding-agent/src/core/extensions/types.ts:469-505,1365-1398,1500-1521; packages/coding-agent/src/core/extensions/runner.ts:282-315] |
| Binary package namespace | Existing startup registration injection | Do not import the public index from the loader and recreate its cycle. [VERIFIED: packages/coding-agent/src/bun/register-bundled-coding-agent.ts:1-13] |
| Distribution assets and install layout | Existing build/copy/shrinkwrap pipeline | Extend acceptance around it, not a second ad hoc packaging tree. [VERIFIED: packages/coding-agent/package.json:35-44; packages/coding-agent/scripts/copy-assets.mjs:29-64] |

## Runtime State Inventory

This phase includes owned-source migration, not authorization to migrate live user state.

| Category | Explicit inventory answer | Required action |
|---|---|---|
| Stored data | Live sessions/datastores were **not inspected**; the project requires preserving sessions/original data. Source template still names compatibility model-metadata variables. [VERIFIED: .planning/PROJECT.md:39; packages/coding-agent/examples/context/AGENTS.md:53-58; operator scope] | No data migration in the tracer. Before a later data rename, obtain a read-only inventory and reversible, separately approved migration. Do not report zero records. |
| Live service config | External service/UI configurations were **not inspected**; no service mutation is in this research scope. [VERIFIED: operator scope] | No live-service edits; diagnosis/compatibility is not approval. |
| OS-registered state | Launchers, schedulers and running installations were **not inspected**; a source slice does not certify installations. [VERIFIED: .planning/PROJECT.md:40-43; operator scope] | Keep running processes unchanged. Obtain launcher/executable identity for later artifact activation. |
| Secrets/env vars | No secret values or private configuration were read. Public config declares ``export const ENV_AGENT_DIR = `${APP_NAME.toUpperCase()}_CODING_AGENT_DIR`;`` and uses it in `getAgentDir()`. [VERIFIED: packages/coding-agent/src/config.ts:500-526; research operation scope] | Do not rename auth/env/session storage as fallout from import migration; no raw environment dumps. |
| Build artifacts / installed packages | Output presence/freshness was **not accepted**. Generator declarations include `"outDir": "./dist"`; binary build emits `--outfile "$OUTPUT_DIR/$platform/omk"` or its executable variant. [VERIFIED: packages/coding-agent/tsconfig.build.json:3-4; scripts/build-binaries.sh:129-138] | Rebuild/repack only after authorization in an isolated candidate workspace, then test actual emitted artifacts. Existing dist or binary files are not proof of this dirty source candidate. |

## Common Pitfalls

1. **Native remapping mistaken for ordinary installed identity.** A resolvable local sentinel must execute as its own dependency in native mode, while a separate missing package fails. Test ESM/CJS and subpaths so a successful OMK alias cannot mask the identity distinction.
2. **Static diagnosis mistaken for transitive runtime evidence.** Doctor follows contained relative sources and excludes bare/computed dependencies. Preserve its bounds and use independent runtime identity fixtures, without turning the scanner into enforcement.
3. **Global/cached policy leakage.** Node aliases use one `_aliases` cache; binary namespace registration is module state. Select loading context immutably per construction/load strategy and test both loading orders before asserting independent SDK instances. [VERIFIED: packages/coding-agent/src/core/extensions/loader.ts:37,107-108,173-195; packages/coding-agent/src/core/extensions/bundled-virtual-modules.ts:30-35] [ASSUMED: A1, A2]
4. **Source tests silently use built code.** Vitest maps public names to source, while the Jiti loader explicitly prefers workspace dist targets. Preserve/record resolved identities; neither a source import nor a helper that forces virtual modules is a real compiled-artifact test. [VERIFIED: packages/coding-agent/vitest.config.ts:28-44; packages/coding-agent/src/core/extensions/loader.ts:77-82,119-163,460-463]
5. **Assuming transactional rollback.** Existing factory failure handling is not a transaction. Assert no factory receipt for missing imports before evaluation, preserve owner/queue/subscription lifecycle behavior, and distinguish a late dependency error from undoing already completed legitimate work. Do not add a rollback/firewall feature as part of Boundary A.
6. **False artifact confidence from fast paths.** Bun `--version` skips namespace registration; current packed smoke only exercises version/help, not a native extension or prohibited-import fixture. Help exits before the normal diagnostics gate, so do not use its exit code as a negative-load verdict. [VERIFIED: packages/coding-agent/src/bun/cli.ts:11-18; scripts/packed-npm-smoke.mjs:24-34; packages/coding-agent/src/main.ts:801-813,849-858]
7. **Same publisher mistaken for Pi runtime.** The real example declares `"@earendil-works/gondolin": "0.14.0"`; the historical spec's `0.12.0` is not its current manifest pin. Clipboard is separately declared as `"@mariozechner/clipboard": "0.3.9"` and is actually required by the native helper. Preserve Gondolin; scope/classify clipboard separately. [VERIFIED: packages/coding-agent/examples/extensions/gondolin/package.json:11-13; packages/coding-agent/package.json:74-76; packages/coding-agent/src/utils/clipboard-native.ts:17-30; specs/108-pi-decoupling/spec.md:68-73]

## Negative Test Matrix

All following rows are **future acceptance requirements**, not test results. Use synthetic local package trees and marker files/counters, never install real Pi packages or execute private extensions for the fixture.

| Route | Fixture / assertion |
|---|---|
| Supported aliases | Generate cases from the existing table. Compatibility retains historical mappings; native installed sentinels execute with their own identity, and missing-package controls fail with the actual specifier. |
| Recognized but unsupported legacy | Cover oh-my-pi and natives/utils classifier families without adding a runtime ban. Installed dependencies may resolve normally; static doctor separately diagnoses migration/declaration state. |
| Subpaths and boundary precision | Cover existing aliased subpaths, deeper exports, owned OMK subpaths and benign same-publisher packages. Native resolution preserves real installed identity at depth; no blanket namespace deny. |
| Relative transitive graph | Extension -> relative import/re-export -> Pi package; include extensionless/index forms and emitted-JS-to-TS resolution already recognized by doctor. Runtime assertion is independent from the scanner assertion. [VERIFIED: packages/coding-agent/src/core/package-doctor-source-scan.ts:66-97] |
| Bare transitive dependency | Extension -> installed ordinary ESM/CJS helper -> installed Pi dependency, with import/require conditions; native marker executes and identifies that dependency. Doctor intentionally does not follow this graph. |
| Delayed/computed loading | Dynamic import, require and createRequire after factory return preserve normal installed identities and normal missing errors. No temporary/global load hook or declaration enforcement. |
| Entry/discovery variations | Explicit file, configured directory, local/global auto-discovery, symlinked entry and direct exported discovery API; native rejection must not become conventional fallback. Do not modify/repeat frozen managed-manifest tests. [VERIFIED: packages/coding-agent/src/core/extensions/loader.ts:568-603,616-647,653-701; operator handoff] |
| Cache and session isolation | Omitted/undefined compatibility baseline; invalid untyped new selection rejects; native->compatibility and reverse loading order, independent instances, reload and cwd/session replacement. Preserve prior goal-cost metadata transfer. [VERIFIED: packages/coding-agent/src/core/extensions/loader.ts:37,507,528; packages/coding-agent/src/core/agent-session-runtime.ts:24-36,51-56] [ASSUMED: A1, A2] |
| Failure cleanliness | Missing imports before evaluation have no successful factory receipt; real errors name the actual dependency rather than unrelated auth/model/harness failure. Preserve existing lifecycle semantics without asserting transactional rollback for late errors. |
| Distribution | Repeat native positive, missing-legacy negative and installed identity controls through source composition, installed Node and actual compiled Bun. Forced virtual modules are source evidence only. |

Arbitrary trusted code/native/child-process confinement is explicitly outside this non-sandbox contract per D-01. Do not invent an escape-prevention requirement.

## Package and Artifact Acceptance

- **Advertised public API:** package exports declare `"import": "./dist/index.js"`, `"types": "./dist/index.d.ts"` and `"./hooks"`; internal source imports are not a substitute for consuming those exports. The build runs `tsgo -p tsconfig.build.json`; its output configuration is `"outDir": "./dist"`, `"rootDir": "./src"`. These are generation contracts, not observations that fresh outputs exist. [VERIFIED: packages/coding-agent/package.json:13-24,35-44; packages/coding-agent/tsconfig.build.json:3-17]
- **Install-only resolution:** test from a prefix outside the checkout's ancestor lookup chain, with no workspace/source alias assistance. The current link helper creates local workspace links with `symlinkSync(rel, linkPath)`; the loader prefers workspace files when they exist. A monorepo success does not exercise installed fallback. [VERIFIED: packages/coding-agent/scripts/link-workspace-deps.mjs:16-22,24-50; packages/coding-agent/src/core/extensions/loader.ts:42-82]
- **Candidate identity:** reuse/extend packed-consumer machinery only after authorization. Its existing script packs all seven local packages and performs an installation. The shrinkwrap generator maps internal packages to `registryTarballUrl(name, packageJson.version)`; therefore verify every actually loaded internal package's path/digest/version instead of assuming same-version registry artifacts are this dirty candidate. [VERIFIED: scripts/packed-npm-smoke.mjs:13-30; scripts/generate-coding-agent-shrinkwrap.mjs:127-129,196-207]
- **Actual Bun startup:** compile the real entry that imports registration before the CLI; test native factory/provider/tool receipts and prohibited imports after extraction. The build script uses `./dist/bun/cli.js` and an explicit worker entry and copies `package.json`, docs, examples and resources alongside each executable. Preserve asset and worker staging. [VERIFIED: scripts/build-binaries.sh:129-156; packages/coding-agent/src/bun/cli.ts:15-18; packages/coding-agent/scripts/copy-assets.mjs:29-47]
- **Bun runtime is not binary mode:** config detects binary mode through `import.meta.url.includes("$bunfs") || import.meta.url.includes("~BUN") || import.meta.url.includes("%7EBUN")`, separately from `!!process.versions.bun`. Running source under Bun or forcing the unit-test helper does not demonstrate compiled-path resolution. [VERIFIED: packages/coding-agent/src/config.ts:15-23; packages/coding-agent/src/core/extensions/loader.ts:460-463]
- **No inference needed:** use public types with a local synthetic provider/model, empty isolated configuration and deterministic receipts. A positive headless CLI fixture must satisfy model selection: normal noninteractive startup exits when `!session.model`. The exact offline fixture/harness is not yet demonstrated. [VERIFIED: packages/coding-agent/src/main.ts:849-858; packages/coding-agent/src/core/extensions/types.ts:1365-1376] [ASSUMED: A4]
- **Not completed here:** builds, installation, pack generation, binary execution and source test execution were excluded by this operator scope. V2-CORE-01/V2-API-01 cannot be closed from this research or source checks alone. [VERIFIED: operator scope; .planning/REQUIREMENTS.md:9-11]

## Ownership and Concrete Change Conflicts

Observed baseline is HEAD `0d6e74b0d21cdb810c88c42381457eff944b935f` plus a substantial dirty overlay, not a clean implementation baseline. All work below belongs to pre-existing sessions/owner until main assigns it; this researcher owns only this research file. An unrelated deletion was already staged. Nothing was staged, reset or rewritten by this research. [VERIFIED: git rev-parse HEAD; git status --short; git diff --cached --name-only; .planning/PROJECT.md:16-25]

| Overlapping work | Concrete collision / coordination requirement |
|---|---|
| Loader | Dirty additions import `transferGoalCostSink` and return `transferGoalCostSink(api, extension)` in both file/factory paths. Preserve both and coordinate edits at loading/factory returns. The accounting module canonicalizes a private slot across Jiti graphs; don't replace its fix with a parallel SDK graph. [VERIFIED: packages/coding-agent/src/core/extensions/loader.ts:19,507,528; packages/coding-agent/src/core/extensions/builtin/goal-cost-accounting.ts:63-73; git diff for loader.ts] |
| Resource loader | Dirty built-in Tencent-memory factory wiring overlaps reload/composition. Do not replace the surrounding factory list or reset that hunk when adding policy plumbing. [VERIFIED: packages/coding-agent/src/core/resource-loader.ts:426-439; git diff for resource-loader.ts] |
| SDK, services, main | Dirty domain-scope propagation crosses these same option objects. Preserve `domainScopeHints` and scoped policy changes while using the existing resource-loader options channel. [VERIFIED: packages/coding-agent/src/core/sdk.ts:110-117; packages/coding-agent/src/core/agent-session-services.ts:63-64,209-210; packages/coding-agent/src/main.ts:768-770; corresponding git diffs] |
| Public export surface | Dirty root exports now include `CONFIG_DIR_NAME` and delegate extension exports to an untracked authored `public-extension-exports` module; the extension barrel/types also carry lifecycle changes. Coordinate ownership before editing or re-exporting, and include that module in candidate identity. [VERIFIED: packages/coding-agent/src/index.ts:7,238-240; packages/coding-agent/src/core/public-extension-exports.ts:1-100; packages/coding-agent/src/core/extensions/index.ts:37-42; git status/diffs] |
| Packaging and other resources | Package manifest, lock/shrinkwrap, publish helper, examples/subagent and many docs already have changes; packed smoke is untracked. Do not conflate their publication/terminal/provider work with this phase's native loader change. [VERIFIED: git status --short and scoped git diffs] |
| Frozen phase 1 | Manager/manifest implementation and related tests remain owned by main's independent verification. Only the public construction option and staging docs were used for their contract here. [VERIFIED: operator handoff; packages/coding-agent/src/core/package-manager.ts:136-144] |

Overlay identity samples from this session's `sha256sum` (recheck before implementation; not signatures or proof of artifact identity):

| Source, already read above | SHA-256 |
|---|---|
| loader | `5dcedae7ae2326041bb8837fc11e962720b7df6ffedefb263f97880db324bcc6` |
| bundled virtual modules | `e39061977f455e0642ad9868ad7eef808ee077fad8139d19eb6892306141d43d` |
| resource loader | `a9be447401dc82680de380e58b90ed01b04653000d2b9e116e7c99fd34cd2a6a` |
| SDK | `885ec5023d899f172e9f639c2a0d991dca5c18e6e46c450fece75884f5f5d5de` |
| services | `dc852029c9224459c84da36830f34485d07d2e8a031bea783edeebad983f385a` |
| root public index | `e9b4fd19d4a04997892acc9490fa7de72f48e400949c2a097da3b6937b78f65e` |

All table digests are observations from the read-only `sha256sum` command, not frozen promises about subsequent concurrent work. [VERIFIED: sha256sum output observed this session]

## Code Examples

These are verbatim existing-source excerpts, not a claimed new native-policy API.

### Native owned factory registration

The example's exact imports and factory are quoted below; `helloTool` is defined with `defineTool` in the same example. [VERIFIED: packages/coding-agent/examples/extensions/hello.ts:5-8,24-26]

```typescript
import { Type } from "omk-ai";
import { defineTool, type ExtensionAPI } from "open-multi-agent-kit";
```

```typescript
export default function (omk: ExtensionAPI) {
	omk.registerTool(helloTool);
}
```

### Existing composition pass-through

This exact construction is the narrow reusable place for new resource-loader options; it already reloads before provider registration processing. [VERIFIED: packages/coding-agent/src/core/agent-session-services.ts:147-168]

```typescript
	const resourceLoader = new DefaultResourceLoader({
		...(options.resourceLoaderOptions ?? {}),
		cwd,
		agentDir,
		settingsManager,
	});
	await resourceLoader.reload();
```

### Existing loader error result

Preserve this result/error collection rather than inventing a second discovery result protocol. Exact result fields are `extensions`, `errors: Array<{ path: string; error: string }>`, and `runtime`. [VERIFIED: packages/coding-agent/src/core/extensions/types.ts:1622-1627; packages/coding-agent/src/core/extensions/loader.ts:508-510]

```typescript
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { extension: null, error: `Failed to load extension: ${message}` };
	}
```

## State of the Art

| Existing approach | Required next approach | Evidence / effect |
|---|---|---|
| Alias-backed compatibility under current defaults | Explicit native path first; native default only after acceptance | Staging preserves 1.x and separately requires installed sentinels/transitive/subpath/artifact gates. [VERIFIED: specs/108-pi-decoupling/spec.md:9-18,45-50] |
| Safe relative static diagnosis | Keep it, plus independently proven execution-level coverage | Bare dependencies are outside the scanner's declared source boundary. [VERIFIED: packages/coding-agent/src/core/package-doctor-source-scan.ts:81-107] |
| Runtime namespace table unit tests / version smoke | Real public consumer and compiled-startup receipts | The forced-virtual helper and version fast path bypass parts of actual distribution startup. [VERIFIED: packages/coding-agent/src/core/extensions/loader.ts:460-463; packages/coding-agent/src/bun/cli.ts:11-18] |

Do not label the current compatibility path deprecated/removed before the migration contract and activation step actually say so. Historical spec language about an opt-out deprecation is a governance ambiguity to resolve, not a fact to silently rewrite. [VERIFIED: specs/108-pi-decoupling/spec.md:131-140]

## Governance and Activation Questions

1. **Clarify spec 108's older swap criteria before deliberate breaking activation.** Its staging section requires final-default implicit compatibility removal, while the older swap order says aliases become an opt-out deprecation. Its behavior-identical counts, benchmark/equivalence rules and one-module-per-PR criteria also need an explicit applicability decision for a breaking native default. Do not silently drop those criteria or claim they passed. [VERIFIED: specs/108-pi-decoupling/spec.md:45-50,115-140]
2. **A milestone-major exception already exists.** Constitution text requires `OMK_ALLOW_MAJOR_RELEASE=1` and a milestone declaration in release notes; ordinary bump types remain patch/minor, and completion requires the tag, GitHub Release and all seven npm latest surfaces. The flat no-major statement in project rules does not erase the constitution's exception. No version/release action is authorized here. [VERIFIED: specs/constitution.md:45-57; AGENTS.md:14-15,185-191]
3. **Clipboard scope needs classification, not guilt by namespace.** It is a real reachable optional native helper and packaged platform component, but distinct from the Pi runtime families. If the final requirement is intended to ban it too, keep a separately accepted replacement/platform gate rather than claiming phase 2 removed it. Gondolin is not a Pi runtime dependency and is not a proposed swap. [VERIFIED: packages/coding-agent/src/utils/clipboard-native.ts:17-30; scripts/build-binaries.sh:158-180; packages/coding-agent/src/core/pi-compat.ts:19-23; specs/108-pi-decoupling/spec.md:61-69]
4. **No broad governance change is implemented.** If clarification changes specification obligations, constitution amendments require matching template and constitution-test updates; GSD does not replace those authored sources or mirrors. [VERIFIED: specs/constitution.md:63-67; .planning/PROJECT.md:3-7]

## Assumptions Log

Historical assumption tags are research provenance, not authority to override the later locked decisions. Current dispositions follow.

| # | Claim / proposed choice | Section | Risk if wrong |
|---|---|---|---|
| A1, RESOLVED | D-03/D-05/D-06 select immutable loader options, agreed additive CLI syntax and existing SDK loader injection | Summary, tracer, test plan | Implement/tests still required; do not add a second SDK flag |
| A2, SUPERSEDED | Transitive import firewall proposal is inapplicable under owner-confirmed Boundary A | Historical tracer, matrix and pitfalls only | Do not implement a guard that rejects legitimate installed user dependencies |
| A3, RESOLVED | D-01 explicitly excludes a sandbox or runtime dependency-declaration enforcement | Runtime matrix | Do not report finite tests as arbitrary-code confinement |
| A4 | A synthetic provider/model and receipt fixture can traverse real noninteractive Node/Bun startup with zero inference/network | Artifact acceptance | Smoke fails for unrelated model/auth reasons or accidentally invokes a provider |

## Question dispositions for execution

- **Resolved, no firewall:** Ordinary installed resolution is allowed under Boundary A. Do not investigate or add Node global hooks to prohibit it. Keep Node/Jiti and Bun source tests separate from actual artifact acceptance.
- **Compatibility delivery, resolved for staging:** explicit `omk+pi` construction and CLI selection retain existing compatibility while native `omk` selection supplies no legacy aliases. Plans 02-01/02 and synthetic user controls in 02-05 verify this. Separation of the final-default legacy adapter and spec-108 equivalence obligations remain blocking activation gates in 02-06, not implicit approvals or waived requirements.
- **Binary native subpaths and installed namespace identity, assigned:** plans 02-01/02 test source routes, 02-06 tests isolated packaged Node and the actual compiled Bun entry, including public declarations and dependency identities. Missing or failing artifact receipts keep the gate open; virtual tables do not substitute for compiled execution.
- **Independent parity and platform material, deferred blocking gates:** retain ROADMAP phases 3-6 and V2-R-01/V2-HOST-01/V2-DESKTOP-01/V2-PLATFORM-01 as pending. Actual R, Rust ownership, native platform behavior and unavailable Windows blueprint are not phase-2 completion evidence and block broader milestone/default-release acceptance as applicable. No substitute or waiver is planned.

## Environment Availability

| Dependency | Available observation | Planning consequence |
|---|---|---|
| Node | `v26.12.1` | Declaration is `>=22.19.0`; acceptance on the minimum declared Node version was not run. [VERIFIED: node --version; packages/coding-agent/package.json:117-119] |
| npm | `11.20.0`; project declares `"packageManager": "npm@11.14.1"` | Record/align the acceptance toolchain later; do not silently rewrite package-manager declarations. [VERIFIED: npm --version; package.json:5] |
| Bun | `1.4.4` | Tool available, binary compilation/execution NOT RUN. [VERIFIED: bun --version; operator scope] |
| Rust compiler | `rustc 1.99.0 (b940084d7 2026-09-28)` | Availability only, not production execution ownership/parity acceptance. [VERIFIED: rustc --version; .planning/PROJECT.md:30-34] |
| R | `Rscript: NOT_FOUND` | Later independent oracle acceptance remains blocked; no substitute declared. [VERIFIED: explicit command -v Rscript probe] |
| Existing Jiti | Installed metadata `"version": "2.7.0"` | Inspect installed source and tagged upstream documentation; no installation performed. [VERIFIED: node_modules/jiti/package.json:2-6] |
| Context7 | Resolve requests returned `Monthly quota exceeded` | Fell back to official tagged Jiti source and versioned Node docs; no successful Context7 content claimed. [VERIFIED: Context7 resolve-library-id responses] |

Research initialization reported graph support disabled. Referenced external GSD instruction-file reads were denied by the context tool's project-root boundary; those files were not read via a bypass. No graph, paid provider, private corpus, Windows material or live-service evidence is claimed. [VERIFIED: gsd graphify status; ctx_read denial; operation record]

## Validation Architecture

Validation/security were not explicitly disabled in the planning config (`"commit_docs": false`, `"branching_strategy": "none"` are its recorded settings). This is a future validation design; **no test, build or artifact acceptance was run here**. [VERIFIED: .planning/config.json:1-6; operator scope]

### Test framework and commands

Existing framework is `"vitest": "4.1.11"`, Node environment, `testTimeout: 30000`, project-specific setup files and source aliases. Those aliases are useful for source tests but must not be inherited by the installed-consumer gate. [VERIFIED: packages/coding-agent/package.json:85; packages/coding-agent/vitest.config.ts:13-44]

The first two companion files, `test/extensions-native-import-boundary.test.ts` and `test/native-extension-services.test.ts`, now exist with valid baseline RED. Native doctor and expanded discovery/consumer/preservation/artifact tests are planned, not yet implemented. Keep all frozen phase-1 implementation/tests unchanged, including existing doctor CLI controls.

Quick tracer command, after Wave 0 creates its proposed file; working directory is the coding-agent package:

```sh
node ../../node_modules/vitest/dist/cli.js --run test/extensions-native-import-boundary.test.ts
```

Bounded phase suite, after Wave 0; this is not the repository-wide suite:

```sh
node ../../node_modules/vitest/dist/cli.js --run test/extensions-native-import-boundary.test.ts test/native-extension-services.test.ts test/package-doctor-native-profile.test.ts test/package-doctor-transitive-scan.test.ts test/pi-compat-exports.test.ts
```

These commands and new paths are proposed under A1; the existing transitive-doctor and public-export tests are source examples, not proof of the new native behavior. Measure quick-test duration rather than assuming the matrix finishes in thirty seconds. [ASSUMED: A1] [VERIFIED: packages/coding-agent/test/package-doctor-transitive-scan.test.ts:33-113; packages/coding-agent/test/pi-compat-exports.test.ts:5-11]

### Phase requirements to tests

| Requirement | Required behavior | Test type / command reference | Coverage state |
|---|---|---|---|
| V2-CORE-01 | Native registration, installed identity and separate missing control, transitive/subpath/direct/late/cache coverage | Current 02-VALIDATION.md groups | Valid baseline RED only; GREEN/artifacts/final default pending |
| V2-MIGRATE-01 | Native-target migration report, bounded/unknown scan coverage, originals unchanged, no executed extension | Native-profile companion + existing transitive-doctor test | Existing safe walker reusable, new target cases required |
| V2-API-01 | Public types/exports, queue/owner/tool behavior through composition | Services companion + public export fixtures | Source cases needed; installed declaration/Node/Bun gates separate |
| V2-CORE-01, V2-API-01 | Actual candidate artifact identities and compiled startup | Extend isolated packed consumer and binary receipt harness after build/install authorization | NOT RUN; source suite cannot waive this gate |

Test assignments above implement the requirement text, not assertions of coverage already achieved. [VERIFIED: .planning/REQUIREMENTS.md:9-11] [ASSUMED: A1, A2, A4]

### Sampling and Wave 0

- Per future task: run the relevant new companion file; preserve failing output and sentinel receipts.
- Per wave: bounded phase suite, then repository `npm run check` after non-doc changes; retain existing failures separately rather than weakening guards. No direct full Vitest invocation. [VERIFIED: AGENTS.md:57-66]
- Phase gate: source matrix AND actual packaged Node/compiled Bun receipts; phase-wide completion remains pending until separately authorized artifact work is possible. [VERIFIED: .planning/REQUIREMENTS.md:9-11; operator scope]
- Wave 0: add companion fixtures with isolated cwd/agent directories and nearest local package sentinels, source-versus-installed resolution receipts, a no-provider lifecycle harness, and public declaration consumer checks. Do not use private-home content or regenerate unrelated baselines. [ASSUMED: A1, A2, A4] [VERIFIED: .planning/PROJECT.md:23-25,39-43]

## Security Domain

Use **ASVS v4.0.3 category numbering explicitly**, as a threat-review vocabulary for this local CLI boundary, not a web-app compliance certification or a claim this is the newest ASVS release. Category names and the fail-secure/schema/no-secret-logging controls are taken from the versioned official CSV. [CITED: https://raw.githubusercontent.com/OWASP/ASVS/v4.0.3/4.0/docs_en/OWASP%20Application%20Security%20Verification%20Standard%204.0.3-en.csv]

| ASVS category | Applicability to this phase | Required pattern |
|---|---|---|
| V2 Authentication | Preserve provider authentication; not a new login implementation | No credential migration or exposure. Existing SDK accepts auth storage separately. [VERIFIED: packages/coding-agent/src/core/sdk.ts:60-63,349-353] |
| V3 Session Management | Web-token controls not introduced; preserve OMK session/reload ownership | Do not equate transcript/session objects with browser auth sessions; keep replacement teardown/recreation. [VERIFIED: packages/coding-agent/src/core/agent-session-runtime.ts:51-56] |
| V4 Access Control | Applies to trust and load-time enforcement boundaries | Trusted composition chooses policy, rejects fail-open fallback, preserves command/project permission gates. [VERIFIED: packages/coding-agent/src/main.ts:681-709; packages/coding-agent/docs/omk-2-migration.md:264-266] |
| V5 Validation, Sanitization and Encoding | Applies to options, paths, diagnostics and tool schemas | Runtime-validate new untyped policy inputs, preserve containment/size/symlink checks and TypeBox tool validation. [VERIFIED: packages/coding-agent/src/core/package-doctor-source-scan.ts:120-165; packages/coding-agent/src/core/extensions/types.ts:469-475] |
| V6 Stored Cryptography | No new crypto protocol | Reuse platform hashing for candidate/vendor identity; hashes are not permission, authenticity or parity proofs. [VERIFIED: .omk/extensions/atelier/scripts/verify-vendor.mjs:1-16] |
| V7 Error Handling and Logging | Applies to migration reports | Preserve source redaction and bounded messages; do not log credentials or user code. [VERIFIED: packages/coding-agent/src/core/package-doctor.ts:68-101] |

| Threat pattern | STRIDE lens | Mitigation / acceptance |
|---|---|---|
| Core aliases silently replace an explicitly installed user's dependency | Tampering | Native mode resolves the local sentinel's real identity; explicit compatibility retains the existing alias behavior. Installed dependency execution is allowed, not a threat requiring a firewall. |
| Static scan traverses outside supplied package | Information disclosure | Preserve existing realpath, containment, no-follow/inode and byte/file bounds. [VERIFIED: packages/coding-agent/src/core/package-doctor-source-scan.ts:120-168] |
| Doctor verdict or migration interpreted as execution permission | Spoofing / elevation of privilege | Keep advisory output, install policy, project trust and tool authorization separate. [VERIFIED: packages/coding-agent/docs/omk-2-migration.md:264-266; packages/coding-agent/src/commands/package-doctor-cli.ts:58-63] |
| Same version or stale dist substituted for candidate | Tampering / repudiation | Bind source overlay, tarball/executable digests and actual resolved module identities; test isolated consumer layout. [VERIFIED: scripts/generate-coding-agent-shrinkwrap.mjs:196-207; packages/coding-agent/src/core/extensions/loader.ts:77-82] |
| Migration overwrites user files or leaks credentials | Tampering / information disclosure | Preserve originals; authored-template non-overwrite discipline; sanitized reports, no private corpus copying. [VERIFIED: packages/coding-agent/src/commands/init-cli.ts:159-185; packages/coding-agent/src/core/package-doctor.ts:68-101; AGENTS.md:193-201] |

## Sources

### Primary local evidence

- Source files cited inline were opened with line-numbered Read in this session, including loader, alias/virtual tables, service/SDK composition, public exports/types, doctor/walker, build/asset/shrinkwrap scripts and owned Atelier provenance.
- Phase-1 input was restricted to the public construction options and staging documents; its manifest/manager implementation and test acceptance were not re-reviewed or rerun.
- Read-only commands: git HEAD/status/scoped diffs, package/runtime metadata, registry pinned-version/date queries, availability probes and selected source digests; no implementation/test/build/provider/release action was performed.

### Official external references

- Tagged Jiti `v2.7.0` README and `src/{jiti,resolve,require,eval}.ts`: aliases, virtual modules, ordinary resolution and native fallback paths. [CITED: https://raw.githubusercontent.com/unjs/jiti/v2.7.0/README.md]
- Versioned Node `v22.19.0` module docs: synchronous hooks, createRequire, registration/load order and process scope. [CITED: https://nodejs.org/download/release/v22.19.0/docs/api/module.html]
- Versioned OWASP ASVS `v4.0.3` CSV: category labels and relevant review controls. [CITED: https://raw.githubusercontent.com/OWASP/ASVS/v4.0.3/4.0/docs_en/OWASP%20Application%20Security%20Verification%20Standard%204.0.3-en.csv]
- npm registry metadata was queried only for the existing pinned versions/publication dates; no legitimacy or latest-version recommendation follows from that observation.

### Research method and limits

The research-plan seam selected Context7 for Jiti/Node; both resolve calls failed on quota, so official version-tagged sources were fetched directly with no private source in queries. Confidence classification returned `LOW` for `codebase --verified` and `webfetch --verified`, and `MEDIUM` for `context7 --verified` and `websearch --verified`; these are classifier outputs, not claims of successful Context7/search retrieval. This report conservatively retains LOW for enforcement/acceptance conclusions rather than inventing HIGH confidence. No research-store write, configuration repair, installation or model invocation was requested; the only authored output is this file. [VERIFIED: research-plan / classify-confidence / Context7 / webfetch operation results; operator write scope]

## Metadata

| Area | Confidence | Reason |
|---|---|---|
| Existing stack/contracts | LOW conservative seam tier; exact local observations | Pins, exports and source paths read directly; runtime/API compatibility was not executed |
| Native implementation and artifacts | Pending execution | A1/A3 resolved, A2 superseded; actual expanded source and Node/Bun/type gates still required |
| Pitfalls/artifact acceptance | LOW for closure | Source/upstream branches identify concrete risks; no sentinel, build, installed consumer or binary acceptance ran |

**Valid until:** relevant source/dirty-overlay changes; re-read touched definitions before planning/execution. Dates, compiler availability and source excerpts do not establish later phase acceptance.
