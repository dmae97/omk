---
description: "Lazy-load interactive-mode from main and move tool renderers to TUI-only modules so omk -p / workers skip omk-tui"
---

# Feature Specification: Lazy Interactive Mode + TUI-only Tool Render

**Feature Branch**: `024-lazy-interactive-mode` / `perf/start-rss-lazy-interactive`
**Created**: 2026-10-06
**Status**: Draft
**Input**: Tech Lead: main이 interactive-mode를 지연 로드하게 하고, tool render를 TUI 전용으로 빼서 `-p`와 워커에서 omk-tui(약 6MB)를 없앨 것. #77 위에 스택.
**OMK Preset**: `omk` (DAG-optimized, parallel-agent ready)
**Base**: PR #77 tip `98148ffe56` (`perf/start-rss-theme-models`)
**Constitution**: [Project constitution](../constitution.md)

## 1. 목표 (Goal)

Stack on #77. Make `main` **lazy-load** `interactive-mode`, and move tool `renderCall` / `renderResult` into **TUI-only modules** so headless `omk -p` and worker cold paths do not load `omk-tui` (~6MB) via tool renderers or the interactive component tree.

#77 removed highlight.js from the cold path, but `main` → `interactive-mode`, tool renderers, and related `omk-tui` value edges still pay for the TUI package. This cut removes that.

## CLI Harness Target Impact

**Classification**: advance (startup/worker RSS and module-graph efficiency; not benchmark task success)

| Dimension | Baseline | Acceptance target | Regression floor | Verification command | Evidence artifact |
| --- | --- | --- | --- | --- | --- |
| Module graph (`omk-tui`) | #77 tip `98148ffe56`: `omk-tui` / `packages/tui/dist` present on `omk -p` | Zero `omk-tui` / `packages/tui` paths on extension-free `omk -p` / worker module list | Must not reintroduce static `omk-tui` on headless entry | Build + EXITMEM_MODS / import-hook module list for `-p` | PR body + module list snippet |
| Exit RSS / module count | Same mock `-p` harness as #74/#77 vs #77 tip | Lower module count; RSS drop if stable (document if noisy) | No intentional RSS regression vs #77 beyond noise | `nice -n 19` mock `-p` interleaved runs | PR measurement table or "noise, graph proof only" |
| Interactive startup | Interactive mode starts on #77 | Interactive still starts (`OMK_STARTUP_BENCHMARK=1` or smoke) | Must not break tool TUI rendering | Automated interactive init / scoped vitest | PR notes |
| Maintainability | Tool defs mix execute + TUI render | Headless defs have no `omk-tui`; TUI renderers live under interactive | Gates pass (biome, module-size, import-cycles, tsgo, scoped vitest) | Listed gate commands | CI / local gate log |

## 2. 수용 기준 (Acceptance Criteria)

1. **A1 — `omk-tui` absent on `-p` / worker cold path**: module list (or import graph) for extension-free `omk --provider mock --model mock-1 -p "…"` contains **zero** `omk-tui` / `packages/tui/dist` entries.
2. **A2 — Interactive still starts**: interactive path init succeeds (at least `OMK_STARTUP_BENCHMARK=1` or equivalent automated smoke).
3. **A3 — Measured vs #77 tip**: document exit RSS and/or loaded module count vs `98148ffe56` on the same harness; if RSS is noisy, ship with module-graph proof (A1) and say so.
4. **A4 — Gates**: biome on changed files; `node scripts/check-module-size.mjs`; `node scripts/check-import-cycles.mjs`; `packages/coding-agent` `tsgo --noEmit -p .`; scoped vitest (tool-execution + related).
5. **A5 — Stacked PR**: base = `perf/start-rss-theme-models`; no force-push, merge, or npm publish. PR body links this `spec.md`.

## Agent-Oriented Requirements

### Requirement 1 - Lazy-load interactive-mode from main (Priority: P1)

**Agent**: coder
**Skills**: omk-typescript-strict
**Evidence Gate**: file-exists + command-pass + module-list
**Risk**: medium

**What**: Replace static `InteractiveMode` (and other TUI-only CLI) imports in `main.ts` with dynamic `import()` on the interactive (and resume / missing-cwd) paths only. Print/json `-p` must not evaluate `interactive-mode.ts` or static `omk-tui` from main.

**Verify**: After build, `-p` module list has no `interactive-mode` / `omk-tui` from main’s static graph; interactive smoke still runs.

**Acceptance**:
1. `main.ts` has no static `from "omk-tui"` and no static `InteractiveMode` import.
2. `runPrintMode` stays statically reachable; `runRpcMode` / interactive / package-manager / list-models / export-html / session-picker load only when needed.
   - *Note (PR #83 review follow-up)*: the package-manager part is verified through `main()` itself, not only through the word list in `cli/package-commands.ts`. `test/main-package-routing.test.ts` checks that importing `main.ts` and running a command handled earlier (`package doctor`) never load `package-manager-cli.ts`, and that `install` / `uninstall` / `list` / `config` reach its handlers with the original argv.
   - *Note (PR #83 review follow-up)*: `package doctor` routes the same way. `cli/package-commands.ts` owns `isPackageDoctorCommand(argv)`; `main.ts` checks it and only then imports `commands/package-doctor-cli.ts` (with `core/package-doctor*.ts`). `runPackageDoctorCli` keeps using the same predicate, so the two cannot drift. `test/main-package-routing.test.ts` checks the module is not loaded by importing `main.ts` or by a package command, and is loaded once for `package doctor`.
3. Print/json skips unnecessary `initTheme` when headless output does not need TUI chrome.
   - *Note (PR #83 review)*: "skip" means **defer**, not "never". The no-UI extension context still exposes `ctx.ui.theme`, so the `theme` proxy initializes the theme lazily on first access (with the configured theme name recorded by `setLazyThemeName()` in print/json). An extension that reads `ctx.ui.theme` in `-p` (e.g. `examples/extensions/sandbox`) must keep working; if no extension touches it, no theme loads.

---

### Requirement 2 - TUI-only tool render modules (Priority: P1)

**Agent**: coder
**Skills**: omk-typescript-strict
**Evidence Gate**: file-exists + command-pass + module-list
**Risk**: medium

**What**: Move builtin tool `renderCall` / `renderResult` / `renderShell` (and their `omk-tui` / theme / highlight helpers) out of `core/tools/*` into `modes/interactive/tool-renderers/**`. Headless tool definitions execute without pulling `omk-tui`. `ToolExecutionComponent` (and HTML export when needed) attach renderers from the TUI-only registry.

**Verify**: `rg 'from "omk-tui"' packages/coding-agent/src/core/tools` is empty (value imports); `-p` module list has no `omk-tui`; `test/tool-execution-component.test.ts` passes.

**Acceptance**:
1. `core/tools/{bash,read,write,edit,grep,find,ls}.ts` have no `omk-tui` value imports and no inline renderers.
2. `modes/interactive/tool-renderers/` exports a registry used by interactive tool execution.
3. Interactive tool rendering behavior remains intact for builtins.

---

### Requirement 3 - Remaining Node cold-path `omk-tui` edges (Priority: P1)

**Agent**: coder
**Evidence Gate**: module-list
**Risk**: low

**What**: Remove or lazy remaining Node `-p` edges that would still load `omk-tui` after R1/R2 (e.g. `theme.ts` `getCapabilities` value import; `bundled-virtual-modules` only needed for Bun binary virtual modules).

**Verify**: Same A1 module list.

**Acceptance**:
1. *Note (PR #83 review)*: dropping the `getCapabilities` import must not change the color mode. `theme.ts` picks truecolor exactly as omk-tui `getCapabilities().trueColor` does (COLORTERM, plus WezTerm / iTerm / VS Code / Windows Terminal / kitty / Ghostty / Alacritty / Zed / JetBrains, and tmux/screen rules), and it follows `setCapabilities()` overrides. `utils/terminal-truecolor.ts` mirrors the rule without importing omk-tui, and `test/terminal-truecolor-parity.test.ts` checks it against `detectCapabilities()`.
2. *Note (PR #83 review)*: builtin `update_todo` only imports its TUI widget when `ctx.hasUI`, so headless workers that use todos stay free of omk-tui.

## 3. 안 하는 것 (Out of Scope)

- `models.generated` / ModelRegistry catalog redesign
- undici / http-dispatcher (#76/#78)
- Staff tiktoken WeakMap (`023-*` reserved)
- Tech Lead ChatContainer / TUI windowing (`022-*` / #79 reserved)
- OMK worker-rss investigation PR (`025-*` reserved)
- session-memory (#72–75)
- Rewriting already-approved #65–#78 (including #77 history)
- Mandatory Bun binary verification (note if unverified)
- merge, force-push, npm publish

## 4. 건드리는 파일 / Expected Files

- `specs/024-lazy-interactive-mode/spec.md` — this specification
- `packages/coding-agent/src/main.ts` — lazy interactive / TUI CLI
- `packages/coding-agent/src/cli/missing-session-cwd-prompt.ts` — TUI cwd prompt extracted from main
- `packages/coding-agent/src/modes/interactive/theme/theme.ts` — no `omk-tui` value import on cold path
- `packages/coding-agent/src/core/extensions/lazy-imports.ts` — lazy `bundled-virtual-modules`
- `packages/coding-agent/src/core/extensions/loader.ts` — use lazy virtual modules
- `packages/coding-agent/src/core/tools/{bash,read,write,edit,grep,find,ls,render-utils}.ts` — headless-only
- `packages/coding-agent/src/modes/interactive/tool-renderers/**` — TUI-only renderers + registry
- `packages/coding-agent/src/modes/interactive/components/tool-execution.ts` — use registry
- `packages/coding-agent/src/core/export-html/**` / `agent-session` export path — attach renderers only when exporting
- `packages/coding-agent/test/tool-execution*.ts` (+ related) — keep green
- `packages/coding-agent/test/terminal-file-links.test.ts` — import path update if needed
- Review follow-up (PR #83): `utils/terminal-truecolor.ts`, `packages/tui/src/terminal-image.ts` (capabilities cache on `globalThis`), `core/extensions/builtin/todo-checklist.ts`, `cli/package-commands.ts`, `package-manager-cli.ts`, plus tests `terminal-truecolor-parity`, `print-mode-extension-theme`, `todo-checklist-headless-import`, `package-commands`, `main-package-routing`; `commands/package-doctor-cli.ts` (shared doctor predicate)

## Verification Commands

```bash
export PATH=/workspace/tools/node-v22.23.3-linux-x64/bin:$PATH
npx biome check <changed files>
node scripts/check-module-size.mjs
node scripts/check-import-cycles.mjs
cd packages/coding-agent && ../../node_modules/.bin/tsgo --noEmit -p .
nice -n 19 npx vitest --run test/tool-execution-component.test.ts # + scoped related
# After build: module list for omk -p must show zero omk-tui / packages/tui
```

## Assumptions

- Worktree under `/workspace` only; base commit is #77 tip `98148ffe56`.
- Node 22.23.3 via `/workspace/tools/node-v22.23.3-linux-x64/bin`.
- Spec numbers 022 / 023 / 025 are reserved by other room workstreams; this feature is **024**.
- RSS comparisons may be noisy (±5MB); module absence is the hard acceptance gate.
