---
description: "Cut what a headless `-p --mode json` worker loads at startup: subcommand handlers, verified-run coordinator, ACP, quota, Neo, resume-picker loaders and HTML export load only on their own paths"
---

# Feature Specification: Worker startup module diet

**Specification ID**: `043-worker-startup-diet`
**Feature Branch**: `perf/worker-startup-diet`
**Created**: 2026-10-11
**Status**: Draft
**Constitution**: [specs/constitution.md](../constitution.md)
**Input**: Tech Lead, after the worker cost measurement (Runtime Engineer, `/workspace/omk-perf-workers/perf-workers/RESULTS.md`): keep workers in TypeScript (no warm pool, no Go supervisor) and shrink the worker start path instead. List what `--mode json -p --no-session` actually loads, move what a worker does not need behind lazy imports the way #83 and #93 did, set targets from that list, and measure start time and idle RSS on a quiet box with interleaved medians, plus 16-concurrent start p90.
**OMK Preset**: `omk`
**Base**: main `c3ac89e`

## Problem (measured on main `c3ac89e`)

From `RESULTS.md` (mock provider, box busy, `nice -n 10`):

- One worker: **654 ms** median (p90 792) from spawn to first model request, **150 MiB** peak RSS, and idle RSS ≈ peak (150.0 MiB median while waiting on the model). Bare `node -e 0` is 44 MiB, so about 106 MiB is the omk runtime.
- 16 at once: start median 2.1–2.4 s (p90 2.6–2.7 s), CPU bound during startup.
- `--cpu-prof`: **62–68 %** of startup is ESM module resolve/read/compile/link of the runtime, 8–10 % is module top-level evaluation, about 10 % is omk setup.

## Module inventory (exact worker argv, main `c3ac89e`)

Method: `node --import trace-hook.mjs dist/cli.js --mode json -p --no-session --model mockprov/mock-model --append-system-prompt <file> "Task: …"` with `OMK_FINISH_CHECK=0 OMK_OFFLINE=1`, an empty `HOME`, an agent dir that holds only a mock `models.json`, and an OpenAI-compatible mock server. The hook (`module.registerHooks` `load`) records every module, ESM and CommonJS, until exit. Three runs gave identical lists. All of them load before the first request reaches the mock.

**1,812 modules: 1,775 files + 37 `node:` built-ins.**

| Group | Modules | Needed by a `-p` worker? |
| --- | ---: | --- |
| `typebox` (index + compile + value + schema + locale) | 660 | Yes: tool schemas use `Type`. `typebox/compile` + `typebox/value` alone are 291 of these (models.json validation at startup, tool-argument validation). Deferral is phase 2 below. |
| `open-multi-agent-kit` `dist/core/**` | 403 | Mostly. **Not needed: `core/verified-run/**` (62)**, reached only through `agent-session-services.ts` → `createVerifiedRunAgentSession` / `createRunCoordinator`. Also `core/export-html/**` (3), `core/neo/**` (2), codexbar/codex-web/onboarding/session-doctor helpers (≈10). |
| `openai` SDK | 154 | Yes for `openai-completions` providers (the mock and many real ones). Already loaded per provider. |
| `undici` | 109 | Yes: loaded on the first `fetch` (#78/#88). |
| `yaml` | 72 | Yes: skill/prompt frontmatter. |
| `omk-ai` / `omk-agent-core` / `omk-protocol` | 151 | Yes. One file, `omk-ai` `models.generated.js` (1.2 MB), costs about 23 ms to load on its own; see phase 2. |
| `dist/commands/**` | 22 | **No** except `init-cli` and `neo-cli`'s word check: doctor, stats, provider adopt/sync/doctor, sdk session, router-feedback, verified-run CLI. All reached from `main.ts` → `commands/run-command.ts`. |
| `omk-adaptorch-wpl` | 25 | **No**: only `commands/adaptorch-doctor-cli.ts` uses it on this path. |
| `dist/modes/acp/**` | 4 | **No**: `--mode acp` only. |
| `metacognition/**`, `guardrails/**`, `core/mcp/**` | 25 / 20 / 15 | Yes: the session uses them at run time. Out of scope here. |
| other npm (`diff`, `cross-spawn`, `minimatch`, `chalk`, …) | ≈60 | Yes. |

Not on the list any more, already lazy: interactive mode, `omk-tui`, tool renderers (#83), the package manager CLI and package doctor (#83/#93), undici until first fetch (#88). The theme module (`theme.ts`, 2 files plus `syntax-highlight.js`) still loads because `extensions/runner.ts` imports the lazy `theme` proxy; it is small and left alone.

Phase 1 cuts, from a static import-graph cut analysis (es-module-lexer over `dist/`, then confirmed by the trace on the built branch):

| Cut | Modules no longer loaded |
| --- | ---: |
| `main.ts` → `commands/run-command.ts` (doctor/stats/provider/sdk/router-feedback/verified-run CLIs) plus `agent-session-services.ts` → `verified-run/coordinator.ts` | 119 (incl. 62 verified-run, 25 adaptorch-wpl) |
| `main.ts` → `codexbar-cli.ts`, `modes/acp/acp-mode.ts`, `session-selector-loaders.ts` | 9 |
| `cli.ts` → `commands/neo-cli.ts`, `agent-session.ts` → `export-html/**` | 5 |

## Design

1. **Subcommand words** (`cli/subcommand-words.ts`, dependency-free, like `cli/package-commands.ts`). `mayBeRunCommand(argv)` is true when `argv[0]` is one of `provider run session doctor stats sdk router-feedback`, or `--doctor-provider` appears anywhere (legacy alias). `isQuotaCommand(argv)` is `argv[0] === "quota"`. `main.ts` imports `commands/run-command.ts` (and `core/verified-run-session.ts`) only when `mayBeRunCommand` is true, and `codexbar-cli.ts` only when `isQuotaCommand` is true.
   - **Why it is safe**: every handler in `run-command.ts` returns `handled: false` unless `argv[0]` is its word (checked handler by handler: `provider adopt|sync|doctor`, `run`, `session doctor`, `doctor resources|adaptorch|<flags>`, `stats`, `sdk session`, `router-feedback`, and `--doctor-provider` anywhere). So the gate only skips imports that would have answered "not mine".
   - **Drift guard**: `runCommand()` applies `mayBeRunCommand` itself first. A future handler with a new word fails its own tests through `runCommand` until the word is added here. `DOCTOR_PROVIDER_FLAG` moves to this module so the gate and the doctor parser read one constant.
2. **Verified-run session helpers** move from `core/agent-session-services.ts` to `core/verified-run-session.ts`: `createVerifiedRunAgentSession` and `createRunCoordinator`, unchanged. The public SDK export `createRunCoordinator` in `src/index.ts` points at the new module; its signature does not change.
3. **Use-site dynamic imports** for code that only one path needs: `runAcpMode` (`--mode acp`), `createSessionMetadataLoaders` (`--resume` picker, imported together with the picker it feeds), `runNeoCli` (`omk neo`, in `cli.ts`), and `exportSessionToHtml` / `createToolHtmlRenderer` (inside the already-async `AgentSession.exportToHtml`, next to the existing lazy tool-renderer import).

Interactive mode, `--mode rpc`, `--mode acp`, `--resume`, `--export`, `/export`, and every subcommand keep their behavior. They now `await import()` the module they used to get statically, the same pattern #83 uses for interactive mode. The Bun compiled binary is not re-verified by this change.

## Targets

| Dimension | Baseline (main `c3ac89e`) | Acceptance target | Regression floor | Verification | Evidence |
| --- | --- | --- | --- | --- | --- |
| Module graph | 1,812 modules (1,775 files) on the worker argv | ≤ 1,690 (≥ 120 fewer); zero `commands/run-command`, `verified-run/`, `omk-adaptorch-wpl`, `modes/acp/`, `codexbar-cli`, `neo-cli`, `export-html/`, `session-selector-loaders` | No new module on the worker path | trace hook on the built branch, same argv and env | PR body + trace lists |
| Start → first request (1 worker) | 654 ms median (busy box) | Median paired difference (branch − main) **≤ −25 ms** on a quiet box, and larger than main's own interquartile range in the same run | Not slower than main beyond noise | quiet-box interleaved run below | raw dir + summary |
| Idle RSS (1 worker, slow mock) | 150.0 MiB median | Median paired difference **≤ −5 MiB** (the RSS noise seen in #80–#82 is ±5–8 MiB) | No increase beyond noise | same run | same |
| 16 concurrent start | median 2.1–2.4 s, p90 2.6–2.7 s | Report p90 before/after (no pass bar; start is CPU bound, so it should move with per-worker CPU) | No regression beyond the 3-rep spread | same harness, N=16 × 3 reps per arm | same |

How the targets were set: phase 1 removes 131 of 1,775 files (7.4 %). Module loading is about 430 ms of a ~650 ms start, so a proportional share is about 30 ms. These are small application modules plus one package, so 25 ms is the bar. RSS from 131 small modules is expected to be a few MiB, likely **inside the ±5–8 MiB noise**. If the quiet-box run confirms that, the RSS part of acceptance needs phase 2, and Tech Lead decides whether phase 1 merges on start time and module count alone.

## Acceptance tests

- `test/print-mode-worker-cold-path.test.ts`: runs `main()` with the exact worker argv (`--mode json -p --no-session --model mock/mock-1 --append-system-prompt <file> "Task: …"`) against a local OpenAI-compatible mock. Each cold-path module is wrapped in a `vi.doMock` load counter. The worker must answer and load none of `commands/run-command.ts`, `core/verified-run/coordinator.ts`, `modes/acp/acp-mode.ts`, `codexbar-cli.ts`, `session-selector-loaders.ts`, `core/export-html/index.ts`. On main `c3ac89e` it reports all six as loaded.
- `test/main-subcommand-routing.test.ts`: importing `main.ts` loads neither handler module. `stats`, `doctor resources`, and `--doctor-provider` anywhere reach `runCommand` with the original argv and exit code. `quota` reaches only `codexbar-cli.ts`. For every handler word, a real `--help`-style argv is handled by the real `runCommand` and passes the gate. The worker argv is not handled.
- `test/cli-neo-lazy-import.test.ts`: the node entry answers `--help` without resolving `neo-cli.ts` (a resolve hook fails the process if it does), and `omk neo` still loads it.
- Unchanged and passing: `main-package-routing`, `onboarding-version-fast-path`, `neo-distribution`, `acp-mode`, `session-selector-*`, `verified-run-*` (three import paths updated), every `*-cli` test, `print-mode*`, `sdk-model-contract`.

## Measurement method

- Harness: the worker cost harness from `RESULTS.md` (`harness.mjs`, `mock-server.mjs`), pointed at two worktrees built from the same lockfile and `node_modules`: main `c3ac89e` and the branch head.
- Single worker: ≥ 10 interleaved pairs (order alternates per pair) after one warm-up per arm, fast mock (0 ms) for start time and slow mock (2,000 ms) for idle RSS. Report medians, p90, and the median of paired differences. Idle RSS is the median `VmRSS` sampled every 50 ms from request arrival + 300 ms to response − 200 ms.
- 16 concurrent: 3 reps per arm, interleaved.
- Quiet box: no other agent's build, test, or benchmark running. `/proc/loadavg` and the top CPU processes are logged before every run, and runs that overlap heavy work are flagged. Coordinated in the room. The perf-workers `PAUSE` file is honored.
- Everything under `nice -n 10`, Node 22.23.3, page cache warm.

## Phase 2 (not in this change)

- **`models.generated` lazy load**: 1.2 MB, about 23 ms to load in isolation. Prior art: closed #80 (`perf/worker-rss-lazy-models` `f309e9b`, commits `645d473`, `9d0dbe2` browser loader, `3c2c070` Bun lazy require). It only helps workers on fully specified custom providers (built-in providers need the catalog), touches `model-registry.ts` heavily, and #80 measured −3.5 MiB RSS (noise) without measuring start time. Separate PR after phase 1 numbers.
- **`typebox/compile` + `typebox/value` deferral** (291 modules, about 46 ms in isolation): needed at startup when `models.json` exists (schema check) and on the first tool call. Deferring only moves the cost unless the startup check changes. Needs its own design.

## Non-goals

- `NODE_COMPILE_CACHE` stays off by default. It is re-measured and re-decided after this diet (it was −108 ms start, +12.7 MiB RSS per worker on main).
- The bytecode binary is a later step.
- No change to the worker argv, worker env, providers, tools, or the session runtime (`metacognition`, `guardrails`, `mcp` stay eager).
- No warm pool and no supervisor rewrite.
- No merge, force-push, or npm publish.

## Expected Files

- `specs/043-worker-startup-diet/spec.md`: this spec (first commit)
- `packages/coding-agent/src/cli/subcommand-words.ts`: new, dependency-free words and gate
- `packages/coding-agent/src/main.ts`: gated `run-command` / `codexbar-cli`; dynamic `acp-mode`, `session-selector-loaders`
- `packages/coding-agent/src/commands/run-command.ts`: applies the gate first
- `packages/coding-agent/src/commands/doctor-provider-cli.ts`: reads `DOCTOR_PROVIDER_FLAG` from the words module
- `packages/coding-agent/src/core/verified-run-session.ts`: new home of `createVerifiedRunAgentSession` / `createRunCoordinator`
- `packages/coding-agent/src/core/agent-session-services.ts`, `src/index.ts`: move and re-point the export
- `packages/coding-agent/src/cli.ts`: `neo-cli` only for `omk neo`
- `packages/coding-agent/src/core/agent-session.ts`: export-html loaded inside `exportToHtml`
- Tests: `print-mode-worker-cold-path`, `main-subcommand-routing`, `cli-neo-lazy-import` (new); three `verified-run-*` tests (import path)
