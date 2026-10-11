---
description: "Define which Pi packages and extensions run unmodified in omk, and add an opt-in Pi adapter for the gaps that a thin layer can close"
---

# Feature Specification: Pi package and extension compatibility scope

**Specification ID**: `048-pi-compat`
**Feature Branch**: `spec/048-pi-compat` (off main `0391505`; code facts below were read on `eda87d0`, and `0391505` changes none of the files cited)
**Created**: 2026-10-11
**Status**: Draft (scope only; no code in this PR). Tech Lead answered the open questions on #118 (2026-10-11); see "Decisions".
**Constitution**: [specs/constitution.md](../constitution.md)
**Input**: 인호 wants deep pi.dev integration: Pi packages and extensions should run in omk. Tech Lead assigned 048 to Staff Engineer, with the compatibility scope first. Runtime Engineer noted in the room that "pi package install is blocked"; this spec finds out what that means.
**Related**: 039 (pi-ask-user dropped from the intake list), 043 (worker startup diet, paired measurement), 047 (browser control, Runtime Engineer), 051 (prompt-cache prefix stability guard, #117, open).

## Facts this spec is built on

### Upstream naming and fork point

- Upstream Pi has moved. `@mariozechner/pi-coding-agent` is deprecated on npm at `0.73.1` ("please use @earendil-works/pi-coding-agent instead"); the current package is `@earendil-works/pi-coding-agent` `1.1.0` (2026-10-07), repository `github.com/earendil-works/pi` (`npm view`, 2026-10-11). The other packages follow the same scope: `@earendil-works/pi-ai`, `pi-agent-core`, `pi-tui`. pi.dev's install line is `npm install -g --ignore-scripts @earendil-works/pi-coding-agent`. The assumed `badlogic/pi-mono` / `@mariozechner/pi-*` names are the old ones.
- omk did not fork Pi directly and has no shared git history with it. README "Acknowledgments": omk "began from the oh-my-pi fork" (`can1357/oh-my-pi`), and "the vendored tree was removed in this release line". `origin/main` starts at a new root, `0d2ac57` (2026-09-22). Older refs in the repo (tags `release-v0.92.0` … `v0.96.2`, branch `feat/tb21-model-contract`) carry the oh-my-pi history: `b85d3f6` "integrate upstream changes through v0.31.1" (2026-01-02), ports of pi-mono commit ranges up to `1287533f` (`0667a27`, 2026-01-18), and the last explicit port, "port upstream Pi 0.82.0" (`a8b0103` and `1bd8bac`, 2026-07-25, first in `release-v0.93.0`). There is no NOTICE file; `LICENSE` keeps Mario Zechner's 2025 MIT copyright line. The constitution says upstream version parity is not a goal.
- The nearest fork point to name is therefore **Pi 0.82.0 API surface (ported 2026-07-25), via oh-my-pi**. Upstream has since shipped 0.83–0.99 and 1.0 (2026-10-01) and 1.1. The 1.0 → 1.1 extension types diff only adds things (OMK research note `/workspace/omk-research/PI1_API_COMPAT_20261011.md` §0).

### What "pi package install is blocked" means

Nothing in `omk install` refuses a Pi package. What exists, from the code on `eda87d0`:

| Mechanism | Where | Effect on a Pi package | Enforced on `omk install`? |
| --- | --- | --- | --- |
| Procurement scanner: `legacy-import` (`@(mariozechner\|earendil-works)/pi-`), `legacy-package-path` (`pi-coding-agent`), `legacy-cli-invocation` (`pi install\|update`), `legacy-home-path` (`~/.pi/`), `legacy-project-path` (`.pi/`) are all `severity: "block"` → verdict `legacy-hardcoded` → adoption `reject` | `src/core/package-procurement.ts:526-545`, `decideAdoption` `:827-830` | Every unmodified Pi package is "reject" | **No.** Only `pi-package-intake.ts` (the P0/P1 port-candidate list shown in the footer) and the gallery's version check call it. It decides what omk *bundles or ports*, not what a user installs |
| `omk package doctor` | `src/core/package-doctor.ts`, `package-doctor-source-scan.ts` | Pi imports and `.pi` paths are warnings; a Pi-only event name is an **error** → `compatible: false`, exit 1. On the four packages below: pi-cache-optimizer and pi-mcp-adapter exit 1, pi-goal-x and pi-background-tasks exit 0 | **No.** Advisory, separate command |
| Intake list | `src/core/pi-package-intake-candidates.ts` (039 removed `pi-ask-user` in #98) | Lists port candidates; no install effect | No |
| Agent working rules | room rules, OMK's research notes ("정책상 설치나 실행을 하지 않았어요") | Agents do no global installs; the research was read-only | Not code |
| Version floors | npm metadata | Newer packages declare Pi `>=1.0` peers, some Node `>=24` (`HARNESS_PI_SKILLS_20261011.md`); omk runs on Node 22 | Peers are not resolved (`--legacy-peer-deps`), Node engines only warn |

So "blocked" is a policy statement (omk's own intake rejects Pi code for bundling), not a runtime or installer block. `omk install npm:<pi-package>` / `omk -e <path>` resolve the `pi` manifest key (`package-manifest.ts`, priority `omk` > `pi` > conventional dirs) and the loader maps Pi imports to omk modules for every extension, always (`pi-compat.ts`, `extensions/loader.ts` aliases, `bundled-virtual-modules.ts` for the Bun binary).

One install-path fact matters for security: `omk install` runs npm lifecycle scripts. `installNpm` / `installNpmBatch` call `getNpmInstallArgs(…, ignoreScripts = false)` (`package-manager.ts:1060, 1665-1687, 1759`), and git sources run `npm install` in the clone (`getGitDependencyInstallArgs`). Pi itself tells users to install with `--ignore-scripts`.

## Empirical check (2026-10-11, omk `eda87d0` built from source, Node 22.23.3)

**Method.** No global installs. Package tarballs were unpacked under `/workspace/omk-spec048-pi/` (the four from OMK's research tarballs, plus `npm pack --ignore-scripts pi-mcp-adapter@5.2.0`); `pi-background-tasks` dependencies were installed in its own directory with `--ignore-scripts --legacy-peer-deps --omit=dev` (2 packages). `pi-mcp-adapter`'s dependencies were **not** installed. Each extension ran in its own process under `unshare -rn` (no network), with `HOME` and `cwd` in temp directories, in two steps (`/workspace/omk-spec048-pi/e2e.mjs`):

1. `loadExtensions([path])` from omk's `dist` loader (the factory runs, Pi imports go through the existing aliases).
2. `createAgentSession` with the faux provider, `DefaultResourceLoader({ additionalExtensionPaths })`, `bindExtensions({ mode: "print" })`, one prompt, then a second prompt that calls one of the package's tools where listed. Extension errors come from `onError`.

A static scan (`/workspace/omk-spec048-pi/static-scan.mjs`) compared each named import from `@earendil-works/pi-*` with the real export list of the omk module it is aliased to, and `pi.on(...)` / `pi.<method>(` against omk's types. Raw output: `e2e.jsonl`, `static.json` in that directory.

### Third-party packages

| Package (license) | Loaded | Prompt + tool call in omk | What breaks or differs |
| --- | --- | --- | --- |
| pi-background-tasks 2.6.9 (ISC; peer `pi-coding-agent ^0.81–^0.84`) — `background-tasks.js` | yes: 11 tools, 10 commands | `bg_run {command:"echo …"}` started the job; the completion notification arrived as a custom message and **triggered a follow-up turn** (`triggerTurn`) | Writes job output to `<cwd>/.pi/tasks/` (Pi path in the project). |
| — `anthropic-attribution.js` (same package) | **no** | — | Throws `pi_anthropic_attribution_host_adapter_missing: the host must expose compat.anthropicMessagesApi`. `@earendil-works/pi-ai/compat` is aliased to omk-ai's root, which has no `anthropicMessagesApi` |
| pi-goal-x 0.32.3 (MIT; peer `>=0.83 <2`) | yes: 8 tools, 16 commands, 18 events | `get_goal`, `create_goal` succeeded | Goal files go to `<cwd>/.pi/goals/`. Subscribes to `session_compact_failed`, which omk never emits (accepted silently) |
| pi-cache-optimizer 2.8.24 (MIT) | yes: 1 command, 11 events | prompt OK, no errors | Feature-detects `pi.getSettings` / `pi.registerVirtualModel` and degrades ("unsupported"); `cache_warming_decision`, `before_provider_headers` handlers never fire. Wrote `~/.omk/agent/pi-cache-optimizer-stats.d` (it uses `getAgentDir()`, which returns omk's dir) |
| pi-mcp-adapter 5.2.0 (MIT; most-installed on pi.dev's list) | yes: `mcp` tool, 3 commands, 1 flag | `mcp {}` → "MCP: 0/0 servers, 0 tools" | Its own `agent-dir.ts` reads `~/.pi/agent` (from the host's `piConfig`, absent in omk), so it ignores omk's MCP config. `registerMcpServer` / `getMcpServers` / `mcp_servers_change` are Pi-only. Real MCP servers not tried (deps not installed, no network) |

### Upstream examples (`@earendil-works/pi-coding-agent` 1.1.0 `examples/extensions`, 79 entries)

68 of 79 loaded and finished a prompt with no extension error (`notify.ts` included: its OSC escape broke the harness's line match, a manual rerun is clean). The 11 others:

| Cause | Examples | Class |
| --- | --- | --- |
| Pi-only API called at load: `registerEntryRenderer` | `entry-renderer.ts`, `debug-provider.ts` | thin adapter (no-op or map to message renderer) |
| Pi-only API: `registerVirtualModel` | `jev-router.ts` | not feasible as a shim |
| Missing export `CONFIG_DIR_NAME` from `pi-coding-agent` → `join(undefined)` | `preset.ts`, `provider-payload.ts` | thin adapter (omk has it in `config.ts`, not exported from the index) |
| `before_agent_start` `event.systemPromptOptions.sections` is undefined in omk | `prompt-customizer.ts` | not feasible in v1 (omk's system prompt has no named sections) |
| Third-party dependency not installed (example's own `package.json`) | `with-deps`, `sandbox`, `gondolin`, `custom-provider-anthropic` | not an omk gap |
| Watches `/tmp/agent-trigger.txt`, which does not exist | `file-trigger.ts` | environment, not omk |

Latent, not reached by the smoke run: `uuidv7` missing from the `pi-ai` alias (`custom-compaction`, `handoff`, `summarize`); `collapseSystemMessages`, `getCurrentSystemPrompt`, `getCurrentTools` (`custom-provider-anthropic`); `anthropicMessagesApi`, `openAIResponsesApi` from `pi-ai/compat` (`custom-provider-gitlab-duo`); `project_trust`, `provider_stream_event` events.

## Compatibility table (Pi 1.1 → omk `eda87d0`)

"Works" means it works today with no new code. Evidence is the run above unless a file is named.

| Surface | Pi 1.1 | omk | Class | Evidence |
| --- | --- | --- | --- | --- |
| Package manifest | `package.json` `"pi": {extensions, skills, prompts, themes}`; conventional dirs; `pi-package` keyword | Reads `omk` then `pi` then conventional dirs; Pi directory entries resolve `index.*` | works | `package-manifest.ts`, `package-manager.ts:2235-2245`, docs/packages.md |
| Install sources | `npm:`, `git:`, URL, local; `-e` for one run; `--local` | Same syntax (`omk install`, `omk -e`) | works | `package-manager-cli.ts:84-99` |
| Install safety | Docs: install with `--ignore-scripts`; project packages load only after project trust | Runs lifecycle scripts; no project-trust gate for project packages (MCP has its own trust summary) | gap (security, Requirements 5 and 7, P0 PR) | `package-manager.ts:1060,1759`; `core/mcp/trust-summary.ts` |
| Import paths | `@earendil-works/pi-{coding-agent,agent-core,ai,ai/compat,ai/oauth,tui}`, `typebox` | Aliased to omk modules for both `@earendil-works` and `@mariozechner`; `typebox` and `@sinclair/typebox` aliased to omk's typebox 1.3.11 (Pi pins 1.3.27) | works | `pi-compat.ts`, `loader.ts:162-190` |
| Exported values | Pi index exports | All names used by 68 examples and 4 packages resolve, except `CONFIG_DIR_NAME`, `uuidv7`, `collapseSystemMessages`, `getCurrentSystemPrompt`, `getCurrentTools`, `compat.anthropicMessagesApi`, `compat.openAIResponsesApi` | thin adapter for `CONFIG_DIR_NAME`, `uuidv7`; provider internals out of scope (decision 4) | `static.json` |
| Factory | `export default (pi: ExtensionAPI) => void \| Promise<void>` | Same | works | loader |
| Events | 41 | 31 shared. Pi-only: `agent_before_settle`, `before_provider_headers`, `cache_warming_decision`, `context_with_system`, `mcp_servers_change`, `project_trust`, `provider_stream_event`, `session_compact_failed`, `ui_prompt_start`, `ui_prompt_end`. omk's `on()` accepts unknown names silently and never fires them | works for the 31; Pi-only ones: diagnostic only (thin), real emission is per-event work outside 048 | `types.d.ts` vs `types.ts` diff |
| `pi.on()` return | unsubscribe function | `void` | thin adapter | `loader.ts:264` |
| `before_agent_start.systemPromptOptions.sections` | named sections, mutable | not present | not feasible in v1 | `prompt-customizer.ts` |
| `tool_call` result | `{block, reason, terminate}`, `parentToolCallId` | `{block, reason}` | out of scope; separate spec later (decision 3) | PI1 notes §2 |
| `tool_result` result | adds `structuredContent`, `usage` | `{content, details, isError}` | ignored fields; works for packages that only read them back | PI1 notes §2 |
| `turn_end` result | `BoundaryResult{entries?, continue?}` | void | not feasible as a shim (changes the loop) | PI1 notes §2 |
| Tool definition | `name, label, description, parameters, execute, renderCall/Result, promptSnippet, promptGuidelines, prepareArguments, executionMode` | Same | works | 4 packages registered 21 tools; 4 tool calls ran |
| Tool definition, Pi-only | `exposure, namespace, defaultActive, prepareLoadout, outputSchema, annotations, constrainedSampling` | ignored | thin adapter for `defaultActive:false` only; rest ignored | PI1 notes §2 |
| Tool `execute` ctx | `ExtensionToolContext` (+ `tools`, `executeTool()`) | `ExtensionContext` | gap; no tested package used `executeTool` | PI1 notes §2 |
| Registration API | `registerTool/Command/Shortcut/Flag/MessageRenderer/Provider`, `sendMessage` (`triggerTurn`, `deliverAs`), `sendUserMessage`, `appendEntry`, `exec`, tools, model, thinking, `events` | Same; `registerProvider(Provider)` object overload missing | works | bg-tasks follow-up turn ran |
| Pi-only API | `getSettings`, `registerEntryRenderer`, `registerToolRenderer`, `registerMarkdownTransformer`, `register/unregisterMcpServer`, `getMcpServers`, `register/unregisterVirtualModel` | absent; calling one at load fails the extension (`… is not a function`) | `getSettings` read-only: thin; renderers: thin no-op; MCP and virtual models: not feasible as shims | 3 examples |
| ExtensionContext | `isProjectTrusted()`, `scopedModels` | absent (omk adds `getSubagentLaneAuthority`) | thin adapter: `isProjectTrusted()` returns the project trust gate's result, `false` without a decision (decision 2) | PI1 notes §2 |
| UI context | `select, confirm, input, notify, setStatus, setWidget, setFooter, custom, editor …` | Same (superset); `hasUI=false` headless | works | — |
| TUI components | `@earendil-works/pi-tui` `Container, Text, Markdown, Editor, Key, matchesKey, truncateToWidth …` | Aliased to omk-tui; names resolve | works for names; rendering under omk's TUI not tested (all runs headless) | `static.json` |
| Settings files | `~/.pi/agent/settings.json`, `.pi/settings.json` | `~/.omk/agent/settings.json`, `.omk/settings.json` | different by design; no fallback read (Non-goals) | `config.ts:495-526` |
| Agent dir in packages | `getAgentDir()` → `~/.pi/agent` | `getAgentDir()` → `~/.omk/agent` (packages that call it follow omk); packages with their own resolver or hard-coded `.pi/` keep using Pi paths | works for `getAgentDir()` users; hard-coded paths stay (doctor warns) | cache-optimizer vs mcp-adapter, bg-tasks, goal-x |
| Skills | `SKILL.md` frontmatter; user then project | Same format; omk scans project then user; `.agents/skills` in packages | works; precedence differs | PI1 notes §2, `skills.ts:545` |
| Prompt templates, themes | `prompts/*.md`, `themes/*.json` | `.omk/prompts`, `.omk/themes`, package dirs | works (not run here) | `resource-loader.ts:815-871` |
| SDK / RPC | `createAgentSession`, RPC over stdio | omk has both, diverged | out of scope | — |

## CLI Harness Target Impact

**Classification**: preserve. Nothing changes for benchmark runs: the adapter is off by default, and benches never load third-party packages. Its only measured requirement is that flag-off costs nothing (below).

## Delivery order (Tech Lead, #118)

1. **P0 security PR** (separate, first): Requirement 5 (install scripts off by default) and Requirement 7 (project trust gate). Independent of Pi compatibility; the risk exists today for every package.
2. **048 adapter PR** (after the P0 PR): Requirements 2, 3, 6 and the docs (1, 4), including the spec 051 prompt-cache case once #117 has merged.

## Requirements

### Requirement 1 - Compatibility statement in the docs (P0, docs only)

- `docs/packages.md` gets a "Pi packages" section with the table above, condensed: what works unmodified, what needs `OMK_PI_COMPAT=1`, what does not work, and the empirical results with versions.
- It states plainly that installing a Pi package runs third-party code with the user's privileges, and that `omk package doctor` is advisory.

### Requirement 2 - Opt-in Pi adapter (P1)

Flag: env `OMK_PI_COMPAT=1`, or the setting `piCompat: true` read **only from the user-global settings** (`~/.omk/agent/settings.json`). A `piCompat` key in a project's `.omk/settings.json` is ignored (with one diagnostic naming the file), so cloning a repository can never turn the adapter on. The env var wins over the setting; `OMK_PI_COMPAT=0` turns it off even if the user setting is on. The value is resolved once, before extensions load. **Off by default.** Off means: the adapter modules are never imported, and behavior is byte-for-byte today's, including the existing always-on aliases and `pi` manifest support, which 048 does not touch.

When on, the loader dynamically imports `src/core/pi-compat/adapter.ts` once and applies it to extensions whose source imports a Pi namespace (the loader already knows the specifier; `isLegacyPiRuntimeImport`):

1. **Export shims.** Pi aliases resolve to small wrapper modules that re-export the omk module plus the missing names with omk semantics: `CONFIG_DIR_NAME` (omk's, i.e. `.omk`), `uuidv7` (RFC 9562 v7, local implementation). Provider internals (`anthropicMessagesApi`, `openAIResponsesApi`, `collapseSystemMessages`, `getCurrentSystemPrompt`, `getCurrentTools`) are out of scope (decision 4); custom providers use omk's `registerProvider`.
2. **`on()` returns an unsubscribe function** for adapted extensions.
3. **Pi-only events**: `on()` still accepts them; the adapter records one diagnostic per extension and event ("`<event>` is never emitted by omk"), visible in `/extensions` or the startup notice and in `omk package doctor`.
4. **Pi-only API methods with honest semantics only**: `getSettings()` returns a frozen read-only snapshot of omk's merged settings; `registerEntryRenderer`, `registerToolRenderer`, `registerMarkdownTransformer` are accepted as no-ops with one diagnostic. `registerVirtualModel`, `registerMcpServer`, `getMcpServers` stay undefined, so packages that feature-detect (`typeof pi.getSettings === "function"`, as pi-cache-optimizer does) keep degrading cleanly instead of calling a stub that pretends to work.
5. **`ExtensionContext.isProjectTrusted()`** returns the result of the project trust gate (Requirement 7) for the session's cwd. With no gate decision (gate not shipped, not yet asked, or cannot decide) it returns `false`.
6. `ToolCallEventResult.terminate` is out of scope; a separate spec later (decision 3).

Not in the adapter: `ToolCallEventResult.terminate`, `systemPromptOptions.sections`, `turn_end` `BoundaryResult`, `agent_before_settle`, `context_with_system`, virtual models, MCP registration, `ExtensionToolContext.executeTool`. Each changes runtime behavior and needs its own spec if wanted.

### Requirement 3 - Doctor alignment (P1)

- `omk package doctor` reports Pi-only events as a **warning** ("never fires in omk"), not an error. The run above shows they do not stop loading; today the doctor marks pi-mcp-adapter and pi-cache-optimizer incompatible while both load and run.
- The doctor's event scan matches the handler names extensions really use (it missed goal-x's `session_compact_failed`); the event list comes from the same source as the adapter's.
- The doctor reports missing Pi exports by comparing named imports against the alias target's export list (the method of `static-scan.mjs`).

### Requirement 4 - Procurement scope stays as is (P0, docs only)

`package-procurement.ts` decides what omk bundles or ports; its `legacy-import` block stays. A code comment and `docs/packages.md` say that it does not apply to user installs. 048 changes no procurement rule.

### Requirement 5 - Install safety for any third-party package (P0 security PR, ships first)

Applies to all packages, flag or not, because the risk exists today. Ships in the P0 security PR together with Requirement 7, before the adapter.

- **No lifecycle scripts by default**: managed npm and git installs (user, project and `-e` temporary scope, and `omk update`) pass `--ignore-scripts`. Pi's own install guidance does the same.
- **Explicit opt-in**: `omk install --allow-scripts <source>` (also `omk update --allow-scripts`, `omk -e … --allow-scripts`) runs scripts for that one command.
- **Failure names the option**: when an install or a package's first load fails after scripts were skipped (npm exit with a lifecycle/`gyp`/`node-pre-gyp`/`prebuild` signature, or a missing native `.node` binding at load), the error says scripts were skipped and gives the exact `--allow-scripts` command to retry. Native-build packages otherwise break with no hint.
- **CHANGELOG**: an `[Unreleased]` `### Changed` entry describing the new default and `--allow-scripts`.
- **No auto-install**: omk never installs a package because a settings file, a project, or an extension asks for it. `omk -e npm:…` keeps using its temporary scope; `omk install` stays an explicit user command.
- **Confirmation**: interactive `omk install` of a source with extension code prints the doctor summary (Pi imports, hard-coded `.pi` paths, Pi-only events and APIs, child-process and network capabilities from `scanSourceCapabilities`) and asks before writing settings; `--yes` skips the prompt; non-TTY without `--yes` refuses.
- **Provenance**: the installed version (npm exact version + integrity, or git commit SHA) is recorded in the settings entry or install metadata, and `omk list` shows it.
- Project-level package trust: Requirement 7.

### Requirement 7 - Project trust gate (P0 security PR, ships first)

Independent of Pi compatibility: loading packages and extensions declared by a cloned repository (`.omk/settings.json` `packages`/`extensions`, `.omk/extensions/`) is an existing risk. Ships with Requirement 5.

- **What it gates**: installing and loading project-scoped packages and extensions, and any other project setting that loads code. User-global (`~/.omk`) resources are not gated.
- **Interactive**: the first time a project's code-loading resources are about to load, omk asks once (list of what would load, trust / don't trust). The answer is stored per project path in the user-global agent dir, not in the project. Until answered, nothing project-scoped loads.
- **`-p` / print / json mode and workers**: deny by default, never prompt. Only an explicit environment variable opens it (proposed name `OMK_TRUST_PROJECT=1`; exact name decided in the P0 PR). Workers inherit the parent's decision only through that variable.
- A project setting cannot grant its own trust.
- The gate's result is what `ExtensionContext.isProjectTrusted()` returns (Requirement 2, item 5).
- The existing MCP project trust summary (`core/mcp/trust-summary.ts`) is left as is; aligning it with the gate is out of scope.

### Requirement 6 - Pi resources do not move the cacheable prefix mid-session (P0)

Spec 051 (#117) checks that the system prompt hash, the tools hash and the earlier messages stay byte-identical across a session. Pi compatibility must not add a new source of change:

- Pi extensions, skills and prompt templates load at session start (or `/reload`, which is a user action and a new prefix by design), never in the middle of a user prompt. The adapter registers nothing lazily on first use of an event or API.
- Adapter diagnostics (Pi-only events, no-op renderers, missing APIs) go to the UI, `/extensions` and the doctor, never into the system prompt, tool descriptions or messages.
- `getSettings()` returns the same snapshot for the whole session; nothing in the adapter reads a clock or a counter into model-visible text.
- What an extension itself does (for example `before_agent_start` rewriting the system prompt, or `setActiveTools` per turn) is the extension's behavior and is the same with the flag on or off; the adapter must not make it worse. The doctor reports `before_agent_start` handlers that return `systemPrompt` and `setActiveTools` calls outside `session_start` as cache-relevant warnings.

## Zero cost when off (Perf Engineer's standard)

**(1) Flag off = main, measured.** 20 interleaved main/PR pairs on the same box. Metrics: CLI startup time, worker startup time, idle RSS, first paint of a 100k-line session. Judged with `paired_verdict.py --noreg` (`/workspace/omk-bench-analyst/paired_verdict.py`), tolerance **+10 ms** for startup metrics and **+5 MiB** for RSS, for example `--noreg cli_startup_ms=10 --noreg worker_startup_ms=10 --noreg first_paint_100k_ms=10 --noreg idle_rss_mib=5`. Load is logged per pair with the #106 harness (`specs/043-worker-startup-diet/bench/run-ab.sh`); pairs where `load1 > 2` are re-measured. Perf Engineer runs it; the report lists the table and the re-measured pairs.

**(2) Adapter not loaded, tested in CI.** A vitest in the style of PR #91's `test/main-package-routing.test.ts`: `vi.resetModules()`, then `vi.doMock("../src/core/pi-compat/adapter.ts", async (importOriginal) => { loaded.adapter += 1; return await importOriginal(); })`, and assert:
- importing `../src/main.ts` loads the adapter 0 times;
- with `OMK_PI_COMPAT` unset, `loadExtensions()` of a fixture extension that imports `@earendil-works/pi-coding-agent` loads the adapter 0 times (and the extension still loads through today's aliases);
- with `OMK_PI_COMPAT=1`, the same call loads it exactly once, and loading a second Pi extension does not load it again.

This is stronger evidence than the paired numbers and is an acceptance criterion. A `--cpu-prof` or module-trace check by Perf Engineer may back it up but does not replace the test.

## Tests

1. `test/pi-compat-lazy.test.ts`: the CI test in (2) above.
2. `test/pi-compat-adapter.test.ts` (flag on): `CONFIG_DIR_NAME` and `uuidv7` resolve; `uuidv7()` output is version 7 and time-ordered; `on()` returns an unsubscribe that removes the handler; a Pi-only event yields exactly one diagnostic; `getSettings()` is frozen and does not write; `registerEntryRenderer` is a no-op with a diagnostic; `registerVirtualModel` stays `undefined`.
3. `test/pi-compat-flag-off.test.ts`: with the flag off, the same fixtures behave as on main (`on()` returns `undefined`; `pi.registerEntryRenderer` is not a function; `CONFIG_DIR_NAME` import is `undefined`), so off is today's behavior.
4. Fixtures under `test/fixtures/pi-compat/`: small hand-written extensions that reproduce the cases above (`preset`-like `CONFIG_DIR_NAME` use, `entry-renderer`-like registration, a Pi-only event, `getSettings` feature detection). No third-party code is vendored.
5. Doctor: `test/package-doctor.test.ts` cases for Requirement 3 (Pi-only event → warning; missing export reported).
6. Install safety (P0 PR): the npm/git install argv contains `--ignore-scripts` unless `--allow-scripts`, for install, update and `-e`; a simulated script-dependent failure produces an error that contains the `--allow-scripts` retry command; non-TTY install without `--yes` refuses; the recorded provenance has version + integrity or a commit SHA.
6a. Project trust gate (P0 PR): interactive first use asks once and remembers the answer outside the project; print mode and workers load no project package or extension without the env var and never prompt; with the env var they load; a project `.omk/settings.json` cannot mark itself trusted.
6b. Flag scope (adapter PR): `piCompat: true` in user-global settings turns the adapter on; `piCompat: true` in a project `.omk/settings.json` (with the user setting and env unset) leaves it off, the adapter module is loaded 0 times (same `vi.doMock` counter as test 1), and one diagnostic names the ignored file; `OMK_PI_COMPAT=0` overrides the user setting.
6c. `isProjectTrusted()` (adapter PR): returns the gate's result when trusted / not trusted, and `false` when the gate has no decision.
7. Prompt-cache case (spec 051): in `test/suite/prompt-cache-stability.test.ts`, a variant with `OMK_PI_COMPAT=1`, two hand-written Pi fixture extensions (one registers a tool and a Pi-only event at load, one calls `getSettings()` and a no-op `registerEntryRenderer`) and one skill from a Pi-manifest fixture package: every call of both user tasks has the first call's system and tools hashes, and each main-lane call extends the previous one. Decision 8: this case goes into 048's implementation PR after #117 merges.
8. Manual compatibility sweep (not CI, needs packages on disk): rerun `/workspace/omk-spec048-pi/e2e.mjs` over the 79 examples and 4 packages with the flag off and on; on must fix `preset.ts`, `provider-payload.ts`, `entry-renderer.ts`, `debug-provider.ts` and break none of the 68 that pass today.

## Acceptance criteria

- **Zero cost when off.** With `OMK_PI_COMPAT` unset: (a) Perf Engineer's 20 interleaved pairs, judged by `paired_verdict.py --noreg`, are `PASS(no regression)` for CLI startup and worker startup at **+10 ms** max, idle RSS at **+5 MiB** max, and 100k first paint at +10 ms; (b) the CI test `test/pi-compat-lazy.test.ts` (PR #91 style) shows the compat adapter module is loaded 0 times on `main.ts` import and on loading a Pi extension; (c) `test/pi-compat-flag-off.test.ts` passes.
- **No mid-session prefix change.** With `OMK_PI_COMPAT=1`, loading Pi extensions and a Pi package skill does not change the system prompt or tools within a session: the spec 051 case in test 7 passes (added in the adapter PR after #117 merges, decision 8).
- **A project cannot enable the adapter.** Test 6b passes: `piCompat` in a project `.omk/settings.json` leaves the adapter off and unloaded; only the env var or the user-global setting turns it on.
- **P0 PR first.** The adapter PR is opened only after the P0 security PR (Requirements 5 and 7, tests 6 and 6a, CHANGELOG `Changed` entry) has merged.
- With `OMK_PI_COMPAT=1`: the sweep in test 8 passes ≥ 72 of 79 examples, and the 4 packages give the same tool results as above.
- `omk package doctor` on pi-mcp-adapter 5.2.0 and pi-cache-optimizer 2.8.24 returns `compatible: true` with warnings.
- `npm run check` passes; the module-size baseline is not raised.

## Non-goals

- Reading `~/.pi/agent/settings.json` or `.pi/settings.json`, or loading packages installed by Pi. Pulling code from another tool's config would load extensions the user never approved for omk. `omk config import-pi` is not planned; it is added only when someone needs it (decision 6).
- Redirecting hard-coded `.pi/` paths inside packages (env tricks, fs hooks). Packages that hard-code them keep their own state there; the doctor warns.
- `ToolCallEventResult.terminate` (separate spec later) and Pi's provider internal exports.
- Emitting the 10 Pi-only events, virtual models, MCP server registration from extensions, `turn_end` boundary results, named system-prompt sections.
- Bundling or porting any Pi package into omk (that stays the intake/procurement path, spec 039).
- `pi install` / `pi` CLI compatibility, Pi's SDK/RPC protocol.
- Running third-party packages in benchmarks.

## Security

- An extension is code that runs in the omk process with the user's privileges: files, credentials in the environment, network, child processes. The adapter does not sandbox anything and must not be described as making packages safe. The project trust gate (Requirement 7) only controls what loads; it is not a boundary either (Pi's own `docs/security.md` says the same).
- Today's install path runs npm lifecycle scripts; Requirement 5 turns that off by default. This is the largest risk found and is independent of the flag.
- `piCompat` is honored only from user-global settings, so a cloned repository cannot turn the adapter on; project packages need the trust gate in any case.
- Pi packages can include skills that tell the model to run programs; skills from packages load like omk skills.
- Fixtures are hand-written; no third-party package source is committed to the repo.

## Decisions (Tech Lead on #118, 2026-10-11; former open questions, resolved)

1. **Flag form**: both env `OMK_PI_COMPAT` and the setting `piCompat`, but the setting is read only from user-global settings (`~/.omk`). A project `.omk/settings.json` cannot enable it; acceptance test 6b.
2. **`isProjectTrusted()`**: returns the project trust gate's result (decision 5); `false` when there is no gate or it cannot decide.
3. **`ToolCallEventResult.terminate`**: out of scope; a separate spec later.
4. **Pi provider internal exports**: out of scope.
5. **Project trust gate**: yes, independent of Pi compatibility. Interactive: ask once on first use. `-p` and workers: deny by default, opened only by an explicit env var. Ships in the P0 security PR (Requirement 7), not in the adapter PR.
6. **`omk config import-pi`**: not now; only when someone needs it.
7. **Install safety**: ships first as a separate P0 PR, before the adapter, together with the trust gate. Install scripts off by default, an explicit option to enable them (`--allow-scripts`), and a failure message that names that option. CHANGELOG entry under `Changed`.
8. **Spec 051 case**: goes into the 048 implementation PR after #117 merges.

## Expected Files

- `specs/048-pi-compat/spec.md`: this spec (first commit; this PR has only this file)
- P0 security PR (first): `src/core/package-manager.ts`, `src/package-manager-cli.ts` (Requirement 5: `--ignore-scripts` default, `--allow-scripts`, failure message), a project trust gate module under `src/core/` and its wiring in the resource loader and print/worker startup (Requirement 7), `CHANGELOG.md` `[Unreleased]` `### Changed`, `docs/packages.md`, `docs/security.md`, `docs/environment-variables.md`, tests 6 and 6a.
- 048 adapter PR (after the P0 PR and #117): `src/core/pi-compat/adapter.ts`, `src/core/pi-compat/exports/*.ts` (shim modules), `src/core/extensions/loader.ts` (flag check, dynamic import), the `piCompat` user-global setting, `src/core/package-doctor*.ts`, `test/suite/prompt-cache-stability.test.ts` (051 case), `docs/packages.md`, `docs/environment-variables.md`, tests 1–5, 6b, 6c, 7 and fixtures.

## What was not verified

- Rendering of Pi TUI components and UI-heavy extensions in omk's interactive TUI: every run was headless print mode with the faux provider.
- pi-mcp-adapter with real MCP servers (dependencies not installed, no network); pi-background-tasks' delegate, Fusion and attested-run tools (they start model processes).
- Behavior under the Bun binary (`virtualModules` path); only the Node `dist` build was run.
- Other popular packages (pi-lens, pi-subagents, pi-posthorse); pi-lens is a 28 MB bundle with native modules (PI1 notes §3-2).
- Whether every exported value with a matching name also has matching signatures and behavior; only names were compared.
