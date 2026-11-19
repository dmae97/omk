# Spec 108 — pi decoupling

Status: Draft (step 1 inventory delivered) · Owner: Harness Engineer · Reviewer: Tech Lead · Criteria: Agent Researcher

## Goal

Make omk independent of the pi ecosystem (`@mariozechner/*`, `@earendil-works/pi-*`, `@oh-my-pi/*`)
through staged boundaries, so the binary work in spec 109 can start from an omk-only module graph.
The 1.x default preserves compatibility. The owner-approved 2.0 milestone may
deliberately remove implicit compatibility after its migration and acceptance gates.

## 2.0 staging contract

The first native slice was managed-package manifest selection, not a replacement
runtime. `DefaultPackageManager` added an immutable construction option,
`packageManifestDialect: "omk" | "omk+pi"`; omission retains the current `omk+pi`
behavior. That slice introduced no environment flag, persisted setting, CLI switch or
automatic default change based on the package version.

Explicit `omk` mode accepts authoritative `omk` manifests and convention-only
packages. A Pi-only manifest is a terminal policy rejection: it must not become
ordinary manifest absence, malformed JSON, or permission to load conventional
files. Apply the selected dialect to filtered/unfiltered resources and nested or
automatic extension discovery. Keep existing path validation and `omk` precedence.

**Harness impact: preserve for existing defaults.** Preserve default resource
selection, path validation, tool/permission boundaries and absence of new runtime
requests. The explicit native mode must load a real native extension and admit
zero resources from the rejected Pi-only fixture, including conventional fallback
files. The source baseline is `0d6e74b0d21cdb810c88c42381457eff944b935f` plus the
pre-existing local overlay; a SHA alone does not identify that overlay or an
installed executable. Retain pre-edit source digests and observed RED/GREEN output.

Run the bounded acceptance from `packages/coding-agent`:

```sh
node ../../node_modules/vitest/dist/cli.js --run test/package-manifest-boundary.test.ts test/package-manifest.test.ts test/package-manager.test.ts test/extensions-discovery.test.ts test/extensions-pi-provider-compat.test.ts test/extension-loader-lazy-imports.test.ts test/package-doctor.test.ts test/package-doctor-cli.test.ts test/package-manifest-auto-boundary.test.ts test/package-manifest-branch-boundary.test.ts
```

Then run `npm run check` from the root and record results in the GSD phase evidence.
These checks do not satisfy the broader benchmark/equivalence gates below and
make no solve-rate, cost or latency improvement claim. This slice adds no R oracle
coverage and does not satisfy the milestone's required R acceptance gates.

Runtime aliases remain unchanged in this first slice. The final 2.0 default must
separately remove implicit Pi runtime compatibility, with tests for locally
installed Pi packages, transitive imports and subpaths. Merely deleting a Jiti
alias does not prevent ordinary module resolution. Direct extension loading,
compiled binaries, clipboard replacement and desktop/platform acceptance are
separate gates. Preserve original licenses, notices and user data throughout.

### Explicit consumer staging, 2026-11-05

The additive source consumer path now accepts `--package-manifest-dialect omk|omk+pi`
(space or equals syntax) for the CLI and independently for `omk package doctor
<source>`. The selected primitive reaches each recreated CLI resource loader.
Programmatic consumers use `DefaultResourceLoader` construction and the existing
public `createAgentSession({ resourceLoader })` injection, without a second SDK flag.
Invalid/repeated CLI selections fail before evaluation; project trust and explicit
extension-load failures retain their existing authority.

Explicit native loading supplies no implicit Pi aliases in Node/Jiti or Bun
virtual tables. Boundary A permits ordinary installed user dependencies, including
Pi packages, subpaths and transitive imports, with their own identity. It does not
enforce dependency declarations at runtime or blacklist a publisher namespace.
Static native doctor errors distinguish undeclared literal legacy imports from
exact runtime dependency declarations. A declared-dependency warning is not proof
of installation or compatibility. Doctor preparation remains compatibility-based
and static, preserving originals and scan limits.

Omission/undefined remain `omk+pi`; versions remain 1.5.10. Source tests are not
packaged Node, compiled Bun, complete extension-feature or lifecycle acceptance.
The six authorized source-work steps are not ROADMAP Phase 6 or desktop/R/Rust
completion. No activation or publication is authorized by this staging note.
The equivalence/benchmark and one-module-per-PR criteria below remain unchanged;
they have not been satisfied or waived and need disposition before a default flip.

## Key finding from step 1

omk already ships its own forks (`omk-ai`, `omk-agent-core`, `omk-tui`, `open-multi-agent-kit`, all MIT).
**No workspace manifest depends on a `pi-*` runtime package.** The remaining pi surface is:

1. **Runtime alias layer** – `packages/coding-agent/src/core/pi-compat.ts` maps 14 legacy pi specifiers
   (`@{mariozechner,earendil-works}/pi-{coding-agent,agent-core,agent-core/node,ai,ai/compat,ai/oauth,tui}`)
   onto omk packages, so third-party pi extensions keep loading. Consumers: 4 call sites
   (`ai/src/index.ts:10`, `extensions/loader.ts:17`, `extensions/bundled-virtual-modules.ts:23`, `package-doctor.ts:11`).
2. **Native clipboard** – `@mariozechner/clipboard@0.3.9` (MIT, optionalDependency) + 6 platform binaries pinned in
   `scripts/cross-platform-clipboard/package.json`; loaded by `require` at `coding-agent/src/utils/clipboard-native.ts:22`
   and copied by `scripts/build-binaries.sh:93-180`.
3. **Vendored pi code** – `.omk/extensions/atelier/vendor/` is a copy of `pi-atelier` (MIT, © 2026 Michael,
   see `UPSTREAM.md`). 24 imports of `@earendil-works/pi-coding-agent` / `pi-tui`, resolved through the alias layer.
4. **Test fixtures / docs** – 18 mentions in `coding-agent/test` + 1 in `tui/test` (string-literal extension
   sources that exercise the alias layer), 1 JSDoc example (`agent/src/types.ts:382`), `vitest.config.ts:30-35` aliases.
5. Not pi, same publisher namespace: `@earendil-works/gondolin@0.12.0` (Apache-2.0) in the `gondolin` example
   extension and its signature-guard test. Listed for completeness; out of scope for swapping.

Licenses re-confirmed from `node_modules/*/package.json` after `npm ci` (2026-10-22, linux-x64): `@mariozechner/clipboard` MIT,
`@mariozechner/clipboard-linux-x64-gnu` MIT, `@earendil-works/gondolin` Apache-2.0. The other 5 platform binaries are
not installed on linux-x64 and remain registry-verified (`npm view`, MIT).

## Inventory (generated)

Source of truth: `specs/108-pi-decoupling/pi-inventory.generated.json`, produced by `scripts/pi-inventory.mjs`
(no new deps). Regenerate: `npm run inventory:pi`. Verify: `npm run check:pi-inventory` (exit 1 on any diff).
CI: `check:pi-inventory` runs inside `npm run check` (CI job `build-check-test`, `.github/workflows/ci.yml` step "npm run check"); a stale or tampered inventory fails CI. No workflow file is edited.

### Packages

| Package | Version | License | Where | Kind |
|---|---|---|---|---|
| @mariozechner/clipboard | 0.3.9 | MIT | packages/coding-agent | optionalDependencies |
| @mariozechner/clipboard{,-darwin-arm64,-darwin-x64,-linux-arm64-gnu,-linux-x64-gnu,-win32-arm64-msvc,-win32-x64-msvc} | 0.3.9 | MIT | scripts/cross-platform-clipboard | dependencies (binary build only) |
| @earendil-works/gondolin (not pi) | 0.12.0 | Apache-2.0 | examples/extensions/gondolin | dependencies |

### Imports by omk module (45 entries)

| Module / scope | Count | Files |
|---|---|---|
| .omk/extensions/atelier (vendored) | 24 | vendor/src/{editor,footer,image-compositor,menu,overlay-lifecycle,run-activity,settings-workspace,sidebar,sidebar-panels,state,subagent-cost-chart,subagent-cost-image,subagent-usage-view,text,todos,workspace-pulse}.ts |
| packages/coding-agent src | 1 | utils/clipboard-native.ts:22 (require clipboard) |
| packages/agent src | 1 | types.ts:382 (JSDoc only) |
| packages/coding-agent test | 18 | extensions-discovery 86-89, package-doctor 33/68-70/193, package-doctor-cli 75, package-procurement 314, pi-package-intake 48, clipboard-native 20-21, clipboard-image-bmp-conversion 62, gondolin-signature-guard 6/38/40 |
| packages/tui test | 1 | upstream-pi-exports.test.ts:5 |
| alias consumers of pi-compat.ts | 4 | listed above |

### Imports by symbol (vendored atelier, the only real code consumer)

- `pi-tui`: truncateToWidth 9, visibleWidth 8, Component 3, OverlayOptions 2, TUI 2, matchesKey 2, Container/SelectItem/SelectList/SettingItem/SettingsList/Text/OverlayHandle/allocateImageId/getCapabilities/getCellDimensions/Image 1 each
- `pi-coding-agent`: ExtensionContext 6, ExtensionAPI 5, CustomEditor/getSettingsListTheme/ExtensionEvent/ExecOptions/ExecResult 1 each (most type-only)
- test fixtures additionally use `pi-ai` Type, `pi-ai/compat` complete/StringEnum, `pi-tui` Key, `pi-utils`.

Full file:line, kind (static / type-only / side-effect / re-export / dynamic / require / mention) and scope are in the JSON.

## Steps and criteria

### 108-1 Inventory
- Script extracts static, type-only, side-effect, re-export, dynamic `import()` and `require()` pi imports plus the
  symbols they expose, manifest deps (deps/dev/peer/optional, root + workspaces), the runtime alias table and its consumers.
- **PASS** = zero missing entries vs. the committed list: `npm run check:pi-inventory` regenerates and fails on any diff.

### 108-2 Internal interface layer (behavior-identical)
- Introduce `omk-*` internal entry points (e.g. `packages/coding-agent/src/compat/`) that own the pi alias table,
  clipboard loading, and the types atelier needs.
- PASS requires all of:
  - pass/fail/skip counts identical to main;
  - outside the interface layer, zero direct pi imports, enforced by a lint rule (biome `noRestrictedImports` or a script check);
  - equivalence on a **free** Terminal-Bench subset: task-clustered 95% CI of the solve-rate difference within ±3pp;
  - tokens per turn ≤ 1.05× and wall time ≤ 1.05× of main;
  - tool-call order identical in deterministic (fixed-seed / replay) logs.

### 108-3 Swap one module per PR
- Each PR swaps exactly one module and must meet every 108-2 criterion.
- Each module's existing tests are run against its replacement unchanged.

**Budget:** paid benchmark runs need a dollar cap posted by 인호 in the room. Until then, free runs only.

## Proposed swap order (smallest blast radius first)

1. Doc/test hygiene – JSDoc `@mariozechner/agent` → `omk-agent-core`; vitest legacy aliases kept only where a test exercises the alias layer. No runtime change.
2. Vendored atelier – rewrite 24 imports to `omk-tui` / `open-multi-agent-kit` (symbols already exported; `upstream-pi-exports.test.ts` guards parity). Local to one extension.
3. Clipboard – wrap `@mariozechner/clipboard` behind an omk interface; later replace with an omk-owned native module or OS-tool fallback. Touches binary builds (spec 109), so after 1–2.
4. Alias layer `pi-compat.ts` – last. It is the compatibility contract for third-party pi extensions; removing it breaks users, so it becomes an opt-out deprecation with a package-doctor warning rather than a deletion, decided separately.

## Risks
- Removing aliases breaks third-party pi extensions (package-doctor tests cover detection, not migration).
- Clipboard replacement affects 6 platform binaries; needs per-platform smoke on the binary build.
- Regex-based scanner can miss unusual syntax (e.g. computed specifiers); mitigated by the `mention` catch-all for any scoped pi string literal.
- Non-host clipboard platform binaries are registry-verified only; re-check on each platform's binary build.

## Rollback
Each step is its own PR; revert the PR. Step 1 adds only a script, a generated JSON and two npm scripts.
