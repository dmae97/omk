# Changelog

## v1.1.8 — Release smoke hardening (2026-05-09)

### Fixed
- Normalized downloaded Rust native safety artifact modes before release packing so Linux/macOS install smoke runs execute bundled `omk-safety` correctly.
- Added package audit coverage for non-Windows native executable bits to prevent artifact-permission regressions.

### Release
- Supersedes the failed v1.1.7 tag run; npm publication should use v1.1.8 to avoid rewriting the remote tag.

## Unreleased

_No unreleased changes._

## v1.1.7 — Harness manifest, native safety, and release matrix (2026-05-09)

### New

- **Chat agent harness manifest** — `omk chat` writes a run-scoped prompt, contract, generated agent file, and `chat-agent-harness.json` with MCP, skills, hooks, workers, gates, provider policy, and stop conditions.
- **Capability-aware orchestration lanes** — parallel DAG setup can expose optional MCP/skills/hooks/DeepSeek advisory workers while Kimi keeps final write/merge authority. Worker counts are clamped to a safe 1–6 range.
- **Rust native safety loader** — `omk-safety` is built from the Rust crate and selected from `dist/native/<platform-arch>/omk-safety`, with a TypeScript fallback when no bundled binary exists.
- **Windows clipboard screenshot bridge** — WSL/bash/zsh users can store Ctrl+C Snipping Tool captures through `omk screenshot` without manually saving files.
- **Awesome Design.md skill** — OMK Core now includes the packaged `awesome-design-md` skill template alongside Open Design.

### Improved

- **Release matrix** — GitHub Release now builds native safety artifacts on Ubuntu, Windows, and macOS before tarball audit, install smoke, GitHub Release, and npm publish.
- **Harness evidence** — the test runner records MCP/skill/hook harness resource counts without leaking names or secrets.
- **Cockpit and DeepSeek visibility** — cockpit keeps its current layout while exposing more run/deepseek usage context in a long responsive view.
- **Init and MCP defaults** — init flows keep project-only MCP as the safe default while offering trusted local/global runtime reuse without copying personal servers into the repo.

### Fixed

- **Invalid worker budgets** — chat/parallel harness generation now rejects empty or runaway worker DAGs by normalizing invalid and excessive worker counts.
- **Stale dist release checks** — package audit and tests run after clean builds so generated dist drift is caught before tagging.

## v1.1.6 — Open Design OMK bridge, MCP diagnostics, and README asset refresh (2026-05-07)

### New

- **Open Design OMK CLI bridge** — `omk design open-design` now registers an `OMK CLI` local agent in the upstream Open Design checkout, persists `OMK_BIN`, adds an OMK visual label/icon, and defaults the local checkout to `agentId: omk`.
- **`omk open-design-agent`** — new local connection point for Open Design. Smoke tests return `ok` immediately without launching Kimi ACP, while real prompts are handed to Kimi print mode through OMK's isolated runtime.
- **Generated hook set** — `omk init` now includes session-context, awesome-agent-skills advisory routing, precompact checkpointing, subagent-stop audit, release guard, secret guard, post-format, and stop-verification hooks.
- **Open Design slash skill** — `open-design` is included at the top of the OMK Core skill pack so `/skills` exposes localhost design first.
- **README assets** — refreshed Open Design localhost, generated hooks, generated skills, skill packs, HUD, cockpit, and status-line screenshots under `readmeasset/`.

### Fixed

- **Kimi-native MCP lookup for initialized projects** — OMK no longer synthesizes a temporary `/tmp` `.kimi/mcp.json` inside isolated Kimi homes. Runtime MCP flags now point at the real project `.kimi/mcp.json` and, for all-scope runs, the original user `~/.kimi/mcp.json`; `omk mcp add/install` also writes to project `.kimi/mcp.json`.
- **MCP JSON-RPC internal errors** — `omk mcp test` and the project MCP server return tool-level failures instead of opaque `json-rpc id 3: Internal error` crashes.
- **Open Design localhost routes** — OMK patches the local Open Design app route shape so `/` and deep links like `/projects/test` return the SPA instead of 404/500 in dev mode.
- **DeepSeek advisory participation** — goal progress and file-affecting nodes can invoke DeepSeek advisory metadata while Kimi remains the writer/merge authority.

## v1.1.5 — Node 24 Actions release pipeline hardening (2026-05-06)

### Fixed

- **GitHub Actions Node 20 deprecation risk** — CI, smoke, release, and OMK review workflows now pin Node 24-compatible action majors and force the JavaScript action runtime to Node 24, removing the upcoming runner cutoff from future release paths.

## v1.1.4 — Windows CI init-home patch (2026-05-06)

### Fixed

- **Windows init user-skill import** — `omk init --import-user-skills` now resolves the initialization home through `OMK_ORIGINAL_HOME`/`HOME` before OS defaults, matching isolated and test runner homes on Windows as well as Unix.

## v1.1.3 — CI portability patch for DeepSeek hybrid release (2026-05-06)

### Fixed

- **DeepSeek Kimi-only hint prompt stability** — DeepSeek prompts now keep MCP/tool hint section headers visible even when one hint list is empty, avoiding platform-dependent CI failures and making Kimi authority boundaries explicit.
- **Isolated-home DeepSeek secrets on Windows** — POSIX-style `OMK_ORIGINAL_HOME` values are preserved when resolving OMK/OpenCode secret paths, so local terminal auth inheritance remains stable across mixed WSL/Windows runners.

## v1.1.2 — DeepSeek hybrid launch and ontology visibility (2026-05-06)

### New

- **Kimi-first provider routing foundation** — `--provider auto|kimi`, provider route metadata on DAG attempts, DeepSeek balance/preflight doctor, and read-only DeepSeek worker plumbing with Kimi fallback.
- **DeepSeek routing hardening** — DeepSeek now defaults to current `deepseek-v4-flash` with thinking enabled and `reasoning_effort=max`; explicit `deepseek-v4-pro` also uses max effort, transient provider failures retry once, complex explicit DeepSeek hints stay on Kimi, and fallback attempt counts/failure kinds are recorded.
- **Provider ontology** — local graph/Kuzu ontology now models providers, provider routes, and provider fallback evidence (`OmkProvider`, `OmkProviderRoute`, `OmkProviderFallback`).
- **Ontology graph viewer** — `omk graph view` renders `.omk/memory/graph-state.json` to interactive HTML, with `/graph-view` slash-command skill support.

## v1.1.1 — Release hardening, cron execution, and ontology memory defaults (2026-05-05)

### New

- **Timeout Presets** — configurable, named timeout profiles for DAG nodes
  - Built-in presets: `default` (2m), `quick` (30s), `standard` (2m), `long-running` (30m), `unlimited` (0)
  - Custom presets via `.omk/config.toml` `[timeouts.<name>]` sections
  - Per-node `timeoutPreset` and `timeoutMs` override support
  - CLI flag `--timeout-preset` for `omk run` and `omk parallel`
  - Environment variable `OMK_NODE_TIMEOUT_MS` global override
  - Resolution priority: per-node `timeoutMs` > per-node `timeoutPreset` > CLI flag > env > built-in default

- **Cron Jobs** — scheduled recurring DAG execution
  - New `omk cron` command group: `list`, `run`, `logs`, `enable`, `disable`
  - Configuration via `.omk/cron.yml` with `schedule`, `dagFile`, `concurrencyPolicy`, `enabled`, `catchup`
  - Supports `@yearly`, `@monthly`, `@weekly`, `@daily`, `@hourly`, and `@every <duration>` schedules
  - Concurrency policies: `allow`, `forbid`, `replace`
  - Run persistence to `.omk/cron-runs/<job-name>/<timestamp>.json`
  - In-process scheduler (no external cron daemon required)
  - Manual `cron run` now executes the configured DAG instead of only checking file existence
  - Cron job names are validated before filesystem IO to block traversal

- **Release hardening** — init, docs, and CI safety fixes
  - `omk init` no longer copies global `~/.kimi/mcp.json` servers into project `.kimi/mcp.json` by default, preventing accidental env/header token leaks
  - Existing custom project `.kimi/mcp.json` files are preserved
  - Generated daily docs ignore patterns are narrowed so authored `docs/` files remain visible to git
  - Release workflow now fails when the test step fails while still uploading test output

- **Ontology memory defaults** — local graph/Kuzu-focused memory configuration
  - Neo4j runtime/config support removed from the default code path
  - Stale Neo4j credentials in config are ignored without startup warnings
  - Local graph memory remains the default, with embedded Kuzu available for ontology graph workflows

- **Long-Running Task Monitor** — heartbeat-based health tracking
  - Heartbeat emitted every 30 seconds while a DAG node is running
  - Stall detection after 3× heartbeat interval (90s default)
  - Automatic retry integration with node `failurePolicy.retryable`
  - New types: `TimeoutPreset`, `CronJob`, `CronRun`, `NodeMonitor`

### Changed

- `src/kimi/runner.ts` — dynamic timeout resolution via `resolveTimeoutMs()` instead of hardcoded 120s
- `src/orchestration/executor.ts` — integrated timeout presets, heartbeat emission, and node monitor engine
- `src/orchestration/dag.ts` — added `timeoutPreset?: string` to `DagNode`
- `src/contracts/orchestration.ts` — extended with preset, cron, and monitor types

---

## v1.1.0 — Scoped package rename & cross-platform hardening (2026-05-04)

### Changed

- **Package rename** — npm package renamed from `oh-my-kimi` to `@oh-my-kimi/cli`. All install commands, update prompts, doctor checks, and init guidance updated to reference the new scoped name
- **GitHub repository URLs** — all docs, badges, and source constants aligned to the canonical repository `https://github.com/dmae97/oh-my-kimi`

### Fixed

- **CI test step cross-platform failure** — replaced bash `for` loop with `npm test -- --test-timeout=120000`, fixing Windows (`windows-latest`) PowerShell glob-expansion failures across the entire Node 20/22/24 matrix
- **Scoped package tarball mismatch** — release and smoke-test workflows now reference correct tarball glob `oh-my-kimi-cli-*.tgz` for `@oh-my-kimi/cli` instead of the old `oh-my-kimi-*.tgz`
- **Package audit link resolver** — `resolveLink` now uses pure POSIX path resolution, eliminating Windows absolute drive-path bugs (`M:/...`) that broke markdown link validation on Windows
- **Secret scan reliability** — `git ls-files` invocations now include `-c safe.directory=<cwd>` to survive container/CI ownership mismatches; filesystem fallback activates when git is unavailable, with zero-scan pass strictly prevented
- **Version truth alignment** — `package.json`, `package-lock.json`, `README.md`, `CHANGELOG.md`, preset, and test fixtures all aligned to `1.1.0`
- **README claim accuracy** — test count corrected to **234** across all language sections; command maturity tables aligned with actual CLI (`omk sync` → Alpha, `omk agent`/`omk skill` → Experimental, `omk update`/`omk menu`/`omk runs` added); Mermaid architecture diagrams updated to reflect actual router topology
- **`cockpit-render` test timeout** — `renderCockpit` test calls now pass `quick: true` to skip slow network/git I/O, eliminating the 60-second timeout that caused test cancellation on slower environments

## v1.0.1 — CLI contract hardening & UI/UX stabilization (2025-05-04)

### Fixed

- **CLI JSON contract** — `goal --json`, `runs --json`, `verify --json` now guarantee single parseable JSON document on stdout with no ANSI/human text leakage
- **Command result contract** — `process.exit` removed from `goal`, `verify`, `parallel`, `review` commands; typed `CommandResult` with `CliError` hierarchy introduced
- **Chat/Cockpit first paint** — `state.json` created before tmux launch; cockpit child suppresses star prompt, HUD preview, and history noise
- **Parallel UI** — lifecycle nodes (bootstrap, coordinator, reviewer) exposed separately; done-without-evidence renders as warning instead of success
- **Onboarding consistency** — Kimi install guidance unified to canonical `curl -LsSf https://code.kimi.com/install.sh | bash`; `--help` grouped by maturity (Start Here, Stable, Alpha, Experimental)
- **Build hygiene** — fixed pre-existing type errors in `mcp.ts` and `sync.ts`; all release gates green (lint, typecheck, build, test, secret-scan, package-audit)

## v1.0.0 — Kimi-native orchestration & chat harness (2025-05-03)

OMK reaches 1.0 as a stable Kimi CLI orchestration and chat harness.

### New

- **`omk chat`** — Interactive Kimi session with full orchestration support
  - Session exit banner showing Run ID, Session ID, resume command, active Workers, MCP servers, and Skills
  - Chat-dedicated first-run GitHub star prompt (`maybeAskForGitHubStarAtChatStart`)
  - Cockpit child detection (`OMK_CHAT_COCKPIT_CHILD`) to prevent duplicate prompts
- **Parallel I/O optimization** across the entire codebase
  - `cockpit.ts`: parallel `state.json` + `sessionMeta` reads; per-run-dir `pathExists` + `fsStat`
  - `doctor.ts`: parallel checks in `projectChecks`, `omkChecks` agent loop, `mcpSkillsChecks`, `memoryChecks`
  - `hud.ts` / `run-view-model.ts`: parallel `goal.md` + `plan.md` existence checks
  - `ensemble.ts`: parallel `cleanupWorktree` loop; parallel winner/base file reads in `mergeWinnerWorktree`
  - `dag.ts`: parallel `goal.md` + `plan.md` text loading
  - `run.ts`: parallel `existingGoal` + `existingPlan` reads
  - `mcp/omk-project-server.ts`: parallel `goal` + `plan` reads
  - `fs.ts`: parallel `collectMcpConfigs` and `injectKimiGlobals` `pathExists` checks

### Improved

- `omk cockpit` rendering performance via `Promise.all`-based I/O batching
- `omk hud` candidate listing and snapshot loading parallelism
- `omk dag` replay goal/plan loading speed
- First-run star prompt eligibility now supports `allowChat` option for chat-specific entrypoints
- Runner exit handler includes resume hint (`omk resume <runId>`) on non-zero exit

### Fixed

- `allowChat` option propagation chain (`maybeAskForGitHubStarAtChatStart` → `maybeAskForGitHubStar` → `isStarPromptEligible`) fixed to prevent test regressions
- `doctor.ts` agent loop parallelization avoids shared-state race conditions via result-array aggregation

## v0.4.0 — Spec-driven Kimi orchestration (2025-05-02)

OMK now connects Spec Kit-style planning with Kimi-native DAG execution.

### New

- **`omk specify`** — GitHub Spec Kit integration (init, workflow, extension, preset, version)
- **`omk dag from-spec [spec-dir]`** — Convert spec-kit `tasks.md` into OMK DAG JSON with dependency inference and role-based routing
- **`omk parallel --from-spec <dir>`** — Load spec-based DAG and execute via existing parallel executor
- **`omk feature` / `omk bugfix` / `omk refactor` / `omk review`** — Workflow presets with `--spec-kit` support
- **`omk summary`** — Generate `summary.md` + `report.md` for the latest run
- **`omk summary-show [run-id]`** — Display run summary in terminal
- **`omk index`** — Build project index (package manager, git status, file tree) for context reduction
- **`omk index-show`** — Display last project index
- **`omk skill pack` / `install` / `sync`** — Manage curated Kimi skill packs
- **`omk agent list` / `show` / `create` / `doctor`** — Agent registry and YAML diagnostics
- `command-pass` evidence gate support in DAG

### Improved

- `omk mcp doctor` — MCP diagnostics with executable checks and JSON-RPC handshake tests
- Stable agent classification (planner, coder, reviewer, qa, security)
- Agent role YAML structure with `extend`, `OMK_ROLE`, `exclude_tools`
- Real run state layout under `.omk/runs/`
- Pre-existing type errors fixed in `mcp.ts`, `workflow.ts`, `dag.ts`
- `feat(star)`: First-run star prompt hardening — post-command timing, `omk star` command, manual retry
- `feat(hud)`: Top summary bar, responsive modes (>=120 / 90-119 / <90), goal-aware display, state error UX
- `feat(parallel)`: Worker grid, blocker panel, completion panel, alternate-screen opt-in, `--no-pause`
- `feat(run-view-model)`: Shared RunViewModel for unified HUD and parallel state interpretation

### Fixed

- `doctor` npm global bin detection now supports npm 10+ (`npm prefix -g` fallback)
- Smoke test validates `doctor.errors` and rejects unexpected failures
- README default policy corrected to `approval_policy = "auto"`
- Local runtime files (`.omk/`, `.kimi/`, `.agents/`) removed from Git tracking
- `docs/` excluded from npm package to avoid shipping stale handoff documents

### Known rough edges

- Spec Kit Kimi integration is still unofficial
- Task parsing depends on generated task format
- Merge flow is still conservative

### Known limitations

- `doctor` reports errors when Kimi CLI or `jq` are missing; use `--soft` for CI environments without them
- `parallel`, `run`, `verify`, `goal`, and `sync` are alpha — expect breaking changes
- `chat` cockpit telemetry is heartbeat/thinking sampling based, not a full native Kimi event stream
- GitHub Actions matrix (Node 20/22/24 × ubuntu/windows/macos) must pass before tagging
- Automatic star requires GitHub CLI auth
- No token storage
- Browser fallback not automatic in v1
