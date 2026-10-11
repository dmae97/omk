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
| `typebox` (index + compile + value + schema + locale) | 660 | Yes: tool schemas use `Type`. `typebox/compile` + `typebox/value` alone are 291 of these (models.json validation at startup, tool-argument validation). Not deferred: the first tool call needs them (see phase 2). |
| `open-multi-agent-kit` `dist/core/**` | 403 | Mostly. **Not needed: `core/verified-run/**` (62)**, reached only through `agent-session-services.ts` → `createVerifiedRunAgentSession` / `createRunCoordinator`. Also `core/export-html/**` (3), `core/neo/**` (2), codexbar/codex-web/onboarding/session-doctor helpers (≈10). |
| `openai` SDK | 154 | Yes for `openai-completions` providers (the mock and many real ones). Already loaded per provider. |
| `undici` | 109 | Yes: loaded on the first `fetch` (#78/#88). |
| `yaml` | 72 | Yes: skill/prompt frontmatter. |
| `omk-ai` / `omk-agent-core` / `omk-protocol` | 151 | Yes. One file, `omk-ai` `models.generated.js` (1.2 MB), costs about 23 ms to load on its own. Out of scope: built-in provider workers need it (see phase 2). |
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
| Start → first request (1 worker) | 654 ms median (busy box) | `startup_ms` **PASS**: 95 % CI of the paired difference (branch − main) excludes 0 and its median is **≤ −25 ms** | Not slower than main (CI not above 0) | quiet-box interleaved run, 20 pairs, `paired_verdict.py` | `pairs.tsv` + verdict table |
| Idle RSS (1 worker, slow mock) | 150.0 MiB median | `idle_mib` **PASS**: 95 % CI of the paired difference excludes 0 and its median is **≤ −5 MiB** | No increase (CI not above 0) | same run | same |
| One-tool-call worker (wall to exit, peak RSS) | measured in the same run (turn 1: one `read` of a small file; turn 2: final text) | **No regression**: `tool_peak_mib` CI upper bound **< +5 MiB**, and `tool_wall_ms` CI upper bound **< main's interquartile range** of wall time in the same run (printed by `analyze-ab.mjs`) | Same as target | `bench/run-ab.sh` scenario `tool` | same raw dir |
| 16 concurrent start | median 2.1–2.4 s, p90 2.6–2.7 s | Report p90 before/after (no pass bar; start is CPU bound, so it should move with per-worker CPU) | No regression beyond the 3-rep spread | same harness, N=16 × 3 reps per arm | `conc16.tsv` |

How the targets were set: phase 1 removes 131 of 1,775 files (7.4 %). Module loading is about 430 ms of a ~650 ms start, so a proportional share is about 30 ms. These are small application modules plus one package, so 25 ms is the bar. RSS from 131 small modules is expected to be a few MiB, likely **inside the ±5–8 MiB noise**. The decision order is in [Acceptance order](#acceptance-order-tech-lead-103).

### Paired verdict rule (team rule for performance PRs)

Tech Lead approved this on #103. It replaces the earlier rule that the median difference had to be larger than main's own interquartile range. It is now the team rule for every performance PR, not only this one.

- **20 interleaved pairs** per scenario on a quiet box. d = branch − main for each pair.
- The judge is Bench Analyst's `paired_verdict.py`: bootstrap 95 % CI of the median of d (10,000 resamples, fixed seed) plus a two-sided sign test. It reads `pairs.tsv`.
- **Improvement target** (`--target metric=value`). **PASS**: CI upper bound < 0 and median ≤ value. **NOISE**: the CI contains 0. **SMALL**: the CI excludes 0 but the median misses the value. Targets here are `startup_ms=-25` and `idle_mib=-5`.
- **No-regression check** (`--noreg metric=value`). Passes when the CI upper bound < value: `tool_peak_mib=5`, and `tool_wall_ms=<main's IQR of tool wall time in the same run>`.
- Command: `python3 paired_verdict.py pairs.tsv --target startup_ms=-25 --target idle_mib=-5 --noreg tool_wall_ms=<IQR> --noreg tool_peak_mib=5`. Targets apply by metric name, so the `slow` scenario's startup is emitted as `slow_startup_ms` (report-only) and `startup_ms` is judged only in `fast`.

Why the tool-call scenario: time to first request only shows startup. Anything the diet defers (or any later phase that defers work) could come back on the first tool call and make the whole worker slower. A worker that makes one cheap tool call and exits shows that cost, so the branch must not regress there.

## Acceptance tests

- `test/print-mode-worker-cold-path.test.ts`: runs `main()` with the exact worker argv (`--mode json -p --no-session --model mock/mock-1 --append-system-prompt <file> "Task: …"`) against a local OpenAI-compatible mock. Each cold-path module is wrapped in a `vi.doMock` load counter. The worker must answer and load none of `commands/run-command.ts`, `core/verified-run/coordinator.ts`, `modes/acp/acp-mode.ts`, `codexbar-cli.ts`, `session-selector-loaders.ts`, `core/export-html/index.ts`. On main `c3ac89e` it reports all six as loaded.
- `test/main-subcommand-routing.test.ts`: importing `main.ts` loads neither handler module. `stats`, `doctor resources`, and `--doctor-provider` anywhere reach `runCommand` with the original argv and exit code. `quota` reaches only `codexbar-cli.ts`. For every handler word, a real `--help`-style argv is handled by the real `runCommand` and passes the gate. The worker argv is not handled.
- `test/cli-neo-lazy-import.test.ts`: the node entry answers `--help` without resolving `neo-cli.ts` (a resolve hook fails the process if it does), and `omk neo` still loads it.
- `test/agent-session-export-html.test.ts`: `AgentSession.exportToHtml` still writes an HTML file after export-html moved inside it.
- Unchanged and passing: `main-package-routing`, `onboarding-version-fast-path`, `neo-distribution`, `acp-mode`, `session-selector-*`, `verified-run-*` (three import paths updated), every `*-cli` test, `print-mode*`, `sdk-model-contract`.

## Measurement method

- Harness: [`bench/`](bench/) next to this spec. It is the worker cost harness from `RESULTS.md` (`harness.mjs`, `mock-server.mjs`) plus `mock-server-tool.mjs`, `run-ab.sh` (interleaved A/B with the `PAUSE` gate), `analyze-ab.mjs`, and the module inventory (`inventory.sh`, `trace-hook.mjs`, `analyze-inv.mjs`). It points at two worktrees built from the same lockfile and `node_modules`: main `c3ac89e` and the branch head. Raw output goes to `$OUT` (default `bench/out/`, git-ignored).
- Single worker, three scenarios, **20 interleaved pairs** each (order alternates per pair; `run-ab.sh` default), one warm-up per arm and scenario. Report medians, p90, interquartile range, and the median of paired differences, and judge with the paired verdict rule above:
  - `fast`: mock answers at once. **Time to first request.**
  - `slow`: mock holds the answer 2,000 ms. **Idle RSS** = median `VmRSS` sampled every 50 ms from request arrival + 300 ms to response − 200 ms.
  - `tool`: turn 1 answers with one `read` tool call on `small.txt` in the worker's cwd, turn 2 (the request that carries the tool result) answers with final text. **Wall time from spawn to exit** and **peak RSS** (`/usr/bin/time -v`). A run counts only if the worker exits 0, made exactly two requests (turn 1 offered the `read` tool), and turn 2 saw the file contents.
- 16 concurrent: 3 reps per arm, interleaved.
- Output for the verdict: at the end of `run-ab.sh`, `analyze-ab.mjs` writes `pairs.tsv` (one header line; columns `scenario metric pair base branch`) into the run dir and `$OUT`, the input format of Bench Analyst's `paired_verdict.py`. Metric names match its flags: `fast` → `startup_ms`, `peak_mib`; `slow` → `slow_startup_ms` (report-only, so `--target startup_ms` judges only `fast`), `idle_mib`; `tool` → `tool_wall_ms`, `tool_peak_mib`. It also prints main's interquartile range of `tool_wall_ms` for `--noreg`. The 16-concurrent p90 goes to a separate `conc16.tsv` (same format, scenario `c16`, metric `startup_p90_ms`, one row per rep).
- Quiet box: no other agent's build, test, or benchmark running. `/proc/loadavg` and the top CPU processes are logged before every run, and runs that overlap heavy work are flagged. Coordinated in the room. The perf-workers `PAUSE` file is honored.
- Everything under `nice -n 10`, Node 22.23.3, page cache warm.

## Acceptance order (Tech Lead, #103)

1. **Measure phase 1** (this change) on a quiet box with all three scenarios and the 16-concurrent run.
2. **If it does not clear noise** (`startup_ms` or `idle_mib` is not PASS under the paired verdict rule), add phase 2 below and measure again the same way.
3. **If it still does not clear noise**, #103 merges as cleanup that counts only the module drop (1,775 → 1,644 files), **provided nothing regresses**: no `startup_ms` or `idle_mib` CI lies entirely above 0, both `tool` no-regression checks pass, and 16-concurrent p90 does not regress beyond the 3-rep spread.

## Phase 2 (not in this change)

The only phase 2 candidate is **validating `models.json` without `typebox/compile`**.

Out of phase 2, and why:

- **`typebox/compile` deferral in general.** A worker loads it on its first tool call anyway (`omk-ai` `utils/validation.ts` compiles tool schemas to check tool arguments). Making it lazy only moves the time later, and the one-tool-call scenario would show the same total.
- **`models.generated` lazy load.** Tech Lead ruled it out: workers on built-in providers load the catalog anyway to resolve the model and its defaults, so only fully specified custom-provider workers could gain. #80's commits are not reused.

### Profile: `models.json` validation with and without Compile (no code change)

`core/model-registry-schema.ts` builds the schema and calls `Compile(ModelsConfigSchema)` at module top level, so the compile runs at every startup, also when there is no `models.json`. `model-registry.ts` then calls `validateModelsConfig.Check(parsed)` once per load.

Method: `bench/`-style microbenchmark on the branch build, a fresh process per run, 9 runs per mode, medians, `nice -n 10`, box load1 about 2–5 (2026-10-11 09:13 KST). The input is the worker harness's mock `models.json`. Each mode first imports `typebox` (index, 369 modules, about 68–73 ms).

| Step | With `Compile` (main today) | Without `Compile` (`Value.Check` on the same schema) |
| --- | --- | --- |
| Import the validator package after `typebox` | `typebox/compile`: 40.4 ms, +291 modules | `typebox/value`: 40.6 ms, +287 modules (`compile` already includes `value`) |
| Load the schema module | 17.0 ms (builds the schema and compiles it) | 8.0 ms (builds the schema only) |
| First `Check` of the mock `models.json` | 1.36 ms | 1.89 ms |
| 100 more `Check` calls | 0.66 ms | 9.78 ms |

Reading:

- Dropping `Compile` here saves about **9 ms** of schema compilation per process. Package import costs the same, because `Value.Check` needs `typebox/value`, which is 287 of the same 291 modules.
- On the worker path today, `omk-ai`'s index already imports `typebox/compile` and `typebox/value` at startup through `utils/validation.ts`, so neither package import goes away. Only the ~9 ms compile is saved, and that holds whether or not `models.json` exists. A hand-written validator would not change this while `omk-ai` keeps those imports.
- Validation runs once per load, so the slower interpreter (~0.1 ms per check) does not matter.
- Expected phase 2 gain is about 9 ms of start time and no material RSS change. That is below the 25 ms bar, so phase 2 is unlikely to clear noise by itself. It is recorded as an option for step 2 of the acceptance order, not as a plan.

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
- `specs/043-worker-startup-diet/bench/**`: measurement harness (scenarios `fast`, `slow`, `tool`) and module inventory
- Tests: `print-mode-worker-cold-path`, `main-subcommand-routing`, `cli-neo-lazy-import`, `agent-session-export-html` (new); three `verified-run-*` tests (import path)
- `packages/coding-agent/CHANGELOG.md`: one Changed entry
