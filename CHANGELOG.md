# Changelog

## [Unreleased]

## v0.78.8 — persona-token surface cleanup and CI-gated hotfix (2026-06-11)

### Fixed

- Removed exact legacy persona-token strings from source, proof notes, ignore-file comments, doctor allowlists, tests, and published `dist` output while retaining bracketed deploy-exclusion globs and runtime guard coverage.
- Extended the persona isolation guard to scan publishable artifacts plus tracked source paths for exact legacy identity/override tokens before release.

### Notes

- Supersedes `0.78.7` for package consumers because `0.78.7` still exposed guard-only filename strings in the npm tarball.
- Stable release claims remain gated on exact-tag CI and registry verification.

## v0.78.7 — README assertions, Fable enablement, and release gates (2026-06-11)

### Added

- **README/NPM assertion assets** — Added packaged `readmeasset/omk-control-surfaces.svg` and `readmeasset/omk-release-assertions.svg`, wired them into README, asset provenance, asset index, and `assets:check`.
- **Fable/OpenRouter activation coverage** — Added tests documenting `fable`/`fable-5` alias resolution, OpenRouter advisory routing, and the explicit enable + API-key activation contract.
- **Opt-in append-only memory durability** — `OMK_MEMORY_DURABILITY=legacy|delta` (default `legacy`). Delta mode uses CRC-framed JSONL append + replay with snapshot compaction, avoiding per-write full serialization. Legacy mode remains byte-identical and the default.
- **Opt-in sandbox writableRoots enforcement** — `assertWritable` with deepest-existing-ancestor realpath resolution denies symlink escapes outside declared writable roots. Safe-default unrestricted when roots are empty; wired into `buildGatedDispatch` only when enforce, roots, resolver, and path are all present.

### Changed

- **Release truthfulness assertions** — README now states the exact package/bin/proof/package-audit assertions used before publish and keeps published-version claims conditional on tagged checks plus registry verification.
- **Provider/runtime metadata** — Added Anthropic Messages wire API support, direct Anthropic provider metadata, Fable/Opus aliases, and max-thinking coverage for Fable/DuckCoding-style routes while preserving advisory boundaries.
- **Root-orchestrator chrome** — Reworded OMK entry/HUD/cockpit surfaces around root-orchestrator control, dynamic package/runtime version labels, and Rust Forge independent-control copy.
- **Performance: hot-path optimizations** — `secret-scanner` `getLineColumn` reduced from O(matches × n) to O(n + matches × log lines) via precomputed newline-offset binary search. Memory store search reduced from O(N²) to O(N + E) one-pass content index; `mutateState` reuses a process-local parsed-state cache guarded by mtime/size/ctime/inode. Routing regex cache (~150× fewer recompiles per node). `runtime-router` precomputes capability scores before sort. `control-loop` six filters collapsed to one bucket pass. `cockpit`/`system24`/`terminal-layout` reduced ANSI strip/regex passes.

### Removed

- **BREAKING: Native (Rust) omk-safety lane** — Removed `crates/omk-safety`, root `Cargo.toml`/`Cargo.lock`, `scripts/build-native.mjs`, `scripts/rust-safety-check.mjs`, `scripts/normalize-native-artifacts.mjs`, `src/util/native-safety.ts`, and native-only tests. Removed npm scripts `rust:build`, `rust:check`, `native:build`, `native:normalize`, `native:no-kimi:turn`, and the shipped `omk-safety` binary. Safety checks are now pure TypeScript. See [ADR-0001](docs/adr/0001-no-native-rust-lane.md).

### Fixed

- **Cockpit color determinism test flake** — Timer-normalized the control-output determinism test to remove wall-clock dependency.

## v0.78.6 — exclude AdaptOrch skills and MCP install template from package (2026-06-09)

### Changed

- Added `.npmignore` exclusions so the published package no longer ships:
  - `templates/skills/**/omk-adaptorch-orchestration-review/`
  - `templates/skills/**/mcp-install/`
- Core AdaptOrch topology routing and MCP runtime code remain in the package;
  only the optional skill templates are removed from the npm tarball.

### Notes

- This remains a pre-1.0 release line.
- Stable release claims are still withheld pending exact-tag CI, live benchmark pass,
  and sandbox violation count equal to zero.

## v0.78.5 — release truthfulness, CLI bin restoration, and gate hardening (2026-06-09)

### Fixed

- Restored the public `omk` CLI bin in `package.json` and `package-lock.json`.
- Aligned package, lockfile, docs, provider maturity notes, and release-truthfulness proof metadata to `0.78.5`.
- Reworked `version:check` to derive the expected package version from `package.json`.
- Extended `version:check` to validate required bins, docs, lockfile, schemas, and release-truthfulness proof metadata.
- Wired `release:check` to pass an explicit demo signal to the release promotion gate only after local package, smoke, proof, and audit gates pass.

### Changed

- Stable release claims are withheld until exact-tag CI, live benchmark pass, and sandbox violation count equal to zero are available.
- `release:full` and `release:rc` now finish with the same explicit final release promotion gate as `release:check`.
- README release wording treats npm `latest` as release-truthful only after tagged workflow and registry verification both pass.

### Notes

- This remains a pre-1.0 release line.
- The `v1.2` label is a runtime contract family, not an npm stable `1.x` release.
- `v0.78.4` was superseded by `v0.78.5` after benchmark shadow fixture gate repair.

## v0.78.2 — Regression Proof Matrix, deep interview, clipboard image paste, and README hardening (2026-06-09)

### Overview

This release adds the Regression Proof Matrix (Algorithm 9) as a release-defense gate, ships the deep interview and clipboard image paste features, and hardens README links to be package-safe.

### Added

- **Regression Proof Matrix (Algorithm 9)** — release-defense gate that verifies Algorithms 1–8 are alive via tests, proof bundles, decision traces, and CLI surfaces. `scripts/regression-proof-matrix.mjs --json` evaluates coverage topology, test linkage, proof-bundle trust, and CLI reachability, returning a JSON verdict with per-algorithm coverage and reasons.
- `src/evidence/regression-proof-matrix.ts` engine with configurable coverage and proof-trust thresholds (default `TAU_EVIDENCE` = 0.75), plus `test/regression-proof-matrix.test.mjs` unit coverage.
- Proof bundle `011-regression-proof-matrix` under `proof/verified-runs/` with evidence, decisions, verify JSON, and `sha256sums.txt`.
- `omk goal interview [input]` and `omk goal refine <goal-id>` commands under the existing `goal` group, adding an evidence-driven clarification step before planning.
- Deterministic deep interview that scores goal ambiguity (`0..1`), ranks targeted questions (`informationGain*0.35 + riskReduction*0.25 + dagImpact*0.20 + evidenceImpact*0.15 - userCost*0.05`), and computes a completeness score from assimilated answers.
- Spec-delta assimilation that folds interview answers into a structured `GoalSpec` with conflict resolution, selectable depth (`light|standard|deep`, auto-selected by ambiguity when omitted), and `--write-spec` persistence.
- `omk.interview.v1` JSON contract (`schemas/omk.interview.v1.schema.json`) plus the `omk.interview-delta.v1` spec-delta envelope.
- Per-session interview artifacts (`interview.json`, `spec-delta.json`, `questions.md`, `answers.jsonl`, `interview-report.md`) under `.omk/goals/<goalId>/interviews/<sessionId>/` (or `.omk/interviews/<sessionId>/` before `--write-spec`).
- Clipboard image paste support: `/paste` slash command in chat REPL, `--image` flag on `omk goal interview`, cross-platform clipboard reader (macOS/Linux/Windows), `InputAttachment` type for multimodal image handling.
- GitHub organic growth kit: README first-screen positioning, runnable awesome-list examples, a 1280x640 social preview upload candidate, and reusable Topics/About/awesome-list PR copy in `docs/github-organic-promotion.md`.

### Changed

- README install and badge links now use package-safe `open-multi-agent-kit` example URLs instead of the unavailable `@omk/cli` scope.
- `MATURITY.md` and `docs/native-root-runtime-algorithms.md` clarify that the Regression Proof Matrix is a release-defense coverage gate, not a stable-release claim.

### Commits

```
1504eae chore(release): bump v0.78.2
3874558 docs(readme): use package-safe example links
cb673e3 docs(readme): clarify regression proof matrix boundary
278cdf4 docs(proof): clarify regression matrix release boundary
285c68c Feat/regression proof matrix (#15)
4701243 feat(runtime): send clipboard images as multimodal content parts
78a31eb feat(clipboard): add image paste support for chat and goal interview
69d65c6 feat(goal): add deep interview refinement
```

## v0.78.1 — package alignment, JSON contract envelopes, and adaptive runtime algorithms (2026-06-07)

### Overview

Pre-1.0 source release target for `open-multi-agent-kit`. This entry aligns the public docs with the actual npm package name, makes the `v1.2` runtime label explicit as a contract family, and avoids implying that every provider lane has the same write/merge authority. It also records the runtime, CI, and orchestration work that ships between the prior release commit and this release: machine-readable `omk.contract.v1` JSON envelopes, real-run graph/proof linkage, an opt-in tool-authority gate, opt-in self-update and first-run star, and adaptorch/headroom/ouroboros adaptive runtime algorithms.

### Added

- Fast-gate CI job and a unified release-truthfulness check that ties publish/tag claims to the exact target commit and gate state.
- Standard `ProviderHealth` shape embedded additively in `omk provider doctor --json`.
- `omk.contract.v1` JSON envelope for `omk summary --json`.
- `omk.contract.v1` JSON envelopes for the `omk dag`, `omk team`, and `omk merge` machine-readable surfaces.
- Real-run linkage into graph memory plus `omk graph audit`, which validates links across run manifest, evidence JSONL, decision JSONL, and provider-route nodes.
- Pure tool-authority decision-gate primitive that classifies tool calls against per-lane write authority.
- `OMK_AUTO_UPDATE` opt-in for non-interactive startup self-update.
- First-run GitHub star with a browser-open fallback when the `gh` CLI is unavailable.
- Adaptive runtime algorithms in the package: adaptorch-style topology routing on first DAG composition (`OMK_ADAPTORCH_ROUTING`), headroom context-guard compaction before the 90% context window (`OMK_HEADROOM` / `OMK_HEADROOM_THRESHOLD`), and embedded-ouroboros preference for goal/spec intents with native fallback (`OMK_OUROBOROS`).
- Ouroboros integration documentation covering the MCP server, bridge, and skills surface.

### Changed

- README install, badge, package contract, and npm links now use `open-multi-agent-kit` instead of the unavailable `@omk/cli` scope.
- ROADMAP now separates public `0.78.x` package releases from historical v1.1.x/v1.2 source milestones.
- Provider-lane wording now points readers to the provider-maturity contract before treating non-Kimi lanes as authority paths.
- Release wording now treats npm publish/tag claims as gated by the exact target commit, CI/smoke status, package audit, and dist-tag state.
- The tool-authority gate is wired into dispatch in shadow/opt-in mode; enforcement stays off by default and is enabled only by `OMK_TOOL_AUTHORITY_ENFORCE`.
- Chat startup now resumes paused stdin before the native loop so first-run chat stays interactive.

### Notes

- Default MCP configuration excludes the adaptorch MCP server; adaptorch is not auto-injected and is opt-in only.
- The new runtime behaviors are opt-in through environment flags and default to off, so existing default runs are unchanged.

### Verification

Release readiness requires `npm run release:check` or the documented CI equivalent, native safety build, package audit, and tarball install smoke before npm publish or git tag.

## v0.78.0 — initial public npm release (2026-06-07)

### Overview

Initial `0.78.0` npm publication for `open-multi-agent-kit` as a pre-1.0 provider-neutral multi-agent control plane for coding workflows. OMK routes, verifies, measures, and controls agent execution with DAG orchestration, evidence gates, and scoped MCP/skills/hooks injection.

### Core

- **OMK//CONTROL** brand system with operator TUI, runtime-flow diagrams, and telemetry.
- **Provider-neutral architecture** with provider-specific maturity limits; Kimi remains the most mature authority path.
- **DAG orchestration**: Goal → DAG plan → parallel lanes → evidence bundle → verify gate → merge / replay / inspect.
- **Evidence gates**: command output, diff, artifact, metric, and review proof before completion claims.
- **Scoped capability injection**: project MCP, skills, hooks, and graph memory scoped per-run; global secrets not imported silently.
- **Worktree isolation**: parallel lanes stay bounded, reviewable, and recoverable.

### Package contract

- Package: `open-multi-agent-kit`
- Bins: `omk`, `omk-project-mcp`, `omk-acp`, `omk-mcp-host`
- Engine: Node.js >=20, npm >=10
- License: MIT

## v1.2.0-rc.0 — Version and provider documentation alignment (2026-05-31)

### Added
- `docs/versioning.md` documents the `1.2.0-rc.0` package RC, `v1.2` runtime contract family, `rc` channel, schema versions, and verification commands.
- `docs/provider-maturity.md` documents provider routing roles, authority limits, auth/config sources, and known RC limitations.
- `omk.proof-bundle.v1`, `npm run proof:check`, `npm run proof:index`, and ten scoped RC hardening proof bundles introduce the public proof gate surface, including evidence-block, replay/inspect, graph-audit, no-Kimi smoke, and fallback-routing axes.
- `omk graph audit --json` validates graph links between a run manifest, evidence JSONL, decision JSONL, and provider-route nodes for proof artifacts.

### Improved
- README, CONTRIBUTING, MATURITY, ROADMAP, and verified-run issue template wording now use provider-neutral OMK identity while keeping Kimi described as the most mature authority path for this RC line.
- License wording now matches the checked repository `LICENSE` file (`MIT`).
- `release:check` and `release:rc` now include the no-Kimi gate and proof gate alongside contract, schema, and version checks.
- `npm run proof:check` now validates proof artifact runId/commit/version linkage, evidence/decision JSONL record shape, verify references, per-bundle `sha256sums.txt`, non-empty limitations, sanitized paths, secret-like strings, and placeholder/fabrication markers.

### Verification
- This is a source RC documentation entry. Do not treat it as a stable `v1.2` release or a publish claim.

## v1.1.18 — Release-prep hardening for parallel orchestration, doctor repair plans, and startup updates (2026-05-22)

### New
- **Parallel orchestration as the agent-first path** — Agent mode and chat-agent harnesses now make the root process an orchestrator that assigns worker, capability, review, QA, and security lanes with role-specific skills, hooks, MCP/tool hints, and memory recall context instead of treating all non-simple work as plain chat.
- **Typed `omk doctor --fix` repair plans** — Doctor fixes now report structured operations with category, severity, safety tier, status, before/after metadata, backups, verify checks, and manual-action reasons while preserving the legacy `fixes.actions/skipped/backups` JSON fields for compatibility.
- **Startup update prompt flow** — OMK startup update prompts use the shared Update now / Skip this version / Remind me later UX, with non-TTY, CI, JSON, smoke, and cockpit-child paths kept quiet and non-blocking.

### Improved
- **Safe local repair coverage** — `doctor --fix` safe tier can repair generated runtime preset drift, `.omk/config.toml` defaults, `.omk/lsp.json`, local graph-memory bootstrap, prompt/root scaffold gaps, hook executable modes, and web-bridge package/template presence without touching global/user secret-adjacent config by default.
- **Post-fix verification evidence** — Non-dry-run doctor repairs can rerun doctor checks and include `before -> after` warning/error summaries, fixed counts, and remaining manual actions in JSON output.
- **Native safety packaging gate** — Release prep now explicitly requires `npm run native:build` before package audit/smoke-pack so `dist/native/linux-x64/omk-safety` is present in the tarball and executable for install smoke.
- **Release docs alignment** — README, maturity, roadmap, getting-started, and changelog wording now describe v1.1.18 as the source release target while keeping the latest-published v1.1.17 caveat and publish/tag readiness gated on `npm run release:check`.

### Verification
- Release readiness requires a clean pass of `npm run release:check`, which includes verify, native build, dry pack, package audit, and tarball smoke before npm publish or git tag.
- This entry is a source release-prep note; do not treat v1.1.18 as published until the final release gate and publish step are completed.

## v1.1.17 — Full agent MCP/skills/hooks enablement and parallel orchestration (2026-05-18)

### New
- **Every OMK agent now has MCP, skills, and hooks** — All 15 generated role files (explorer, planner, router, architect, coder, reviewer, security, qa, tester, researcher, integrator, aggregator, interviewer, ontology, vision-debugger) plus the explore/plan aliases now inherit `OMK_MCP_ENABLED`, `OMK_SKILLS_ENABLED`, and `OMK_HOOKS_ENABLED` through the Okabe base agent. Runtime scope controls actual availability; agents receive sanitized harness digests instead of raw inventory dumps.
- **Parallel subagent orchestration** — Root coordinator explicitly manages parallel worker lanes with independent context, each subagent receiving scoped MCP/skills/hooks when runtime scope permits. Worker lanes are isolated until review/merge.

### Improved
- **Global init UX clarity** — `omk init --global` documentation now explicitly notes: press Enter to accept defaults on input prompts, and wait for the MCP timeout (default 15s) instead of interrupting npx-based server resolution.
- **README maturity labeling** — Added explicit Global MCP instability warning; all agent capabilities documented; parallel orchestration emphasized.

### Known Limitations & Remaining Issues
- **P0 — Global MCP instability**: `omk init --global` can fail or hang when global MCP servers require dependency resolution. Workaround: use `omk init` (project-local) which is stable, or manually configure `~/.kimi/mcp.json` after init.
- **P0 — Provider fallback metadata**: rate-limit, timeout, and Kimi-fallback variant tests are scaffolded but not yet locked in CI.
- **P0 — Machine-readable CLI envelopes**: JSON output contracts for `omk graph`, `omk summary`, and `omk workflow` are partial; consumers should pin to the current surface.
- **P1 — Graph audit evidence**: `omk graph view` links nodes to runs/goals/providers only when the graph backend has explicitly ingested them; automatic back-linking is pending.
- **P2 — `omk team` runtime reporting**: tmux pane health, artifact sync, and verification handoff are manual; automated worker-start inside panes is not yet implemented.
- **P2 — Provider-quality gates**: DeepSeek preflight health checks exist but do not yet block non-Kimi worker pools.

### Init Global User Notes
When running `omk init --global`:
- Prompts for MCP server installation may appear; press **Enter** to accept defaults.
- Some npx-based MCP servers require a one-time dependency resolution; wait for the **MCP timeout** (default 15s) rather than interrupting.
- The global `~/.kimi/mcp.json` is no longer modified for `omk-project`; it is injected at runtime automatically.
- **Known issue**: Global MCP initialization can be unstable. If it hangs, cancel with Ctrl+C and run `omk init` (project-local) instead, then configure MCP manually.

### Verification
- Release readiness requires `npm run release:check` plus tarball install smoke before publish or tag.
- Local release gate: `npm run release:check` (`verify` + native build + dry pack + package audit + pack smoke).

## v1.1.16 — Runtime orchestration and release smoke hardening (2026-05-17)

### Fixed

- **Doctor pack-smoke readiness** — uninitialized package install directories now report project agent YAML as not initialized instead of failing `omk doctor --json --soft`; partial agent scaffolds and explicit agent-file validation still fail.
- **IntentFrame/ActionAtom non-repetition** — execution DAGs, worker prompts, and continuation prompts now use sanitized digest/action contracts instead of replaying raw user input.
- **Chat startup schema preflight** — generated agent YAML prompt args and root aliases are validated before launching Kimi, with startup-failure artifacts for invalid schemas.
- **MCP/init duplicate policy** — legacy MCP migration, duplicate handling, and package-arg preservation were hardened for project/global scopes.
- **Agent capability propagation** — generated/root/run-scoped agents receive MCP, skills, hooks, and tool hints through sanitized harness inventory digests.

### Known Limitations & Remaining Issues

- **P0 — Provider fallback metadata**: rate-limit, timeout, and Kimi-fallback variant tests are scaffolded but not yet locked in CI.
- **P0 — Machine-readable CLI envelopes**: JSON output contracts for `omk graph`, `omk summary`, and `omk workflow` are partial; consumers should pin to the current surface.
- **P1 — Graph audit evidence**: `omk graph view` links nodes to runs/goals/providers only when the graph backend has explicitly ingested them; automatic back-linking is pending.
- **P2 — `omk team` runtime reporting**: tmux pane health, artifact sync, and verification handoff are manual; automated worker-start inside panes is not yet implemented.
- **P2 — Provider-quality gates**: DeepSeek preflight health checks exist but do not yet block non-Kimi worker pools.

### Init Global User Notes

When running `omk init --global`:
- Prompts for MCP server installation may appear; press **Enter** to accept defaults.
- Some npx-based MCP servers require a one-time dependency resolution; wait for the **MCP timeout** (default 15s) rather than interrupting.
- The global `~/.kimi/mcp.json` is no longer modified for `omk-project`; it is injected at runtime automatically.

### Verification

- Release readiness requires `npm run release:check` plus tarball install smoke before publish or tag.
- Local gate run: `npm run verify && npm run native:build && npm run audit:package`.

## v1.1.15 — Isolated HOME MCP startup hotfix (2026-05-13)

- Fixes isolated Kimi HOME shell-profile bridging so bash-based MCP servers source the real user profile with the real HOME before restoring the temporary HOME.
- Moves the local fetch MCP setup to a persistent executable path to avoid repeated `uvx` dependency resolution inside disposable `/tmp/omk-home-*` sessions.
- Adds regression coverage for profile lines that source `$HOME/.local/bin/env` and `$HOME/.cargo/env`.

## v1.1.14 — Current harness docs and workflow skills (2026-05-13)

### New

- **External-inspired workflow skills** — packaged OMK skills for `agentmemory`, `andrej-karpathy-skills`, `matt-pocock-skills`, `multica`, and `react-doctor` across Kimi and portable agent templates.
- **Skill pack routing** — `omk-core`, `omk-typescript`, and `omk-review` now surface the new skills through `omk skill catalog/install/sync`.

### Improved

- **Current AGENTS/init guidance** — refreshed AGENTS, `.kimi/AGENTS`, root prompt, init routing hook, and spec-kit preset templates for the current skills/MCP/agents/harness surface.
- **Release-safe public language** — kept public positioning on the verified daily-use core with alpha orchestration surfaces; no unsupported readiness overclaiming.
- **Verified-run demo path** — kept the demo bundle as an explicit evidence skeleton with raw prompt, diff, verify JSON, cockpit/replay proof, video plan, and known limitation slots.

### Verification

- Passed `npm run yaml:check`, `npm run lint`, `npm run secret:scan`, `npm run check`, `npm run build:clean`, `npm test`, `npm run native:build`, `npm run audit:package`, and `git diff --check` before release preparation.

## v1.1.13 — Bundled MCP server release readiness (2026-05-12)

### New

- **Bundled MCP entrypoints** — package metadata now exposes `omk-project-mcp`, `omk-acp`, and `omk-mcp-host` bins for npm-installed MCP usage.
- **ACP and host groundwork** — added ACP session server, host gateway runtime, client transport adapters, and consent-aware permission flow foundations.
- **Secret scanning guards** — added shared secret pattern registry integration and release scan handling for synthetic fixture files.

### Improved

- **Deployment-ready package metadata** — README, package homepage, Open Graph metadata, and social preview now point to the public landing site.
- **Provider execution isolation** — provider execution paths use isolated runtime homes to avoid leaking local Kimi/global state into release workflows.
- **TypeScript release hygiene** — removed unused imports, unsafe internal stdout suppression comments, and redundant variables from MCP server code.

### Verification

- Local release gate run for this tag: `npm run release:check`.

## v1.1.12 — Replay system, skill assigner, and decision trace coverage (2026-05-11)

### New

- **`omk replay` — timeline-based run replay** — reconstructs a run's execution chronology from artifacts with flags for `--context`, `--evidence`, `--decisions`, `--repair`, `--node`, and `--attempt` deep-dives.
- **`omk inspect` — forensic run inspection** — validates run directories and renders colored terminal output with optional deep-dive into context capsules, evidence gates, decision traces, and repair chains.
- **`omk diff-runs` — run reproducibility diff** — structural and content diff between two `ReplayManifest`s with per-node context-changed, evidence-changed, and repair-changed kinds.
- **Skill Assigner** — automatic skill/MCP/tool/hook assignment engine with 14 intent-based rules (`web-design`, `diagram-design`, `kb-retriever`, `code-review`, `spec-driven`, `security-audit`, `debugging`, `feature-dev`, `refactor`, `release`, `team-run`, `mcp-required`, `tool-calling`). Preserves manually assigned values and records decision traces.
- **External skill packs** — installed `diagram-design`, `web-design-engineer`, `kb-retriever`, `gpt-image-2`, and `web-video-presentation` into `.kimi/skills/`.
- **Decision trace full coverage** — unified decision trace recording added to `runtime-router`, `context-broker`, `provider-router`, `repair-policy`, `evidence-gate`, `scheduler`, and `ensemble-decision`.

### Improved

- **Package audit** — entry count budget within limits (491 entries), native safety binary validated, `.map` files excluded from tarball via `tsconfig.json` sourcemap settings.

### Fixed

- **Context snapshot `list()` parsing** — fixed filename split vs JSON extraction bug in `context-snapshot.ts`.
- **TypeScript lint** — resolved 21 unused-variable warnings across `src/orchestration/`, `src/replay/`, `src/commands/`, `src/contracts/`, `src/runtime/`, and `src/providers/`.
- **Context budget optimizer** — `estimateTokens` now null-safe (`text ?? ""`) preventing test failures on undefined memory fact fields.

### Verification

- Passed `npm run yaml:check`, `npm run lint`, `npm run secret:scan`, `npm run check`, `npm run build:clean`, `npm run native:build`, `npm run audit:package`, `npm run pack:dry`, and core tests (`replay-kernel`, `decision-trace`, `evidence-system`, `package-audit`).

## v1.1.11 — Windows CI and path diagnostics fixes (2026-05-10)

### Fixed

- **Windows CI doctor false positive** — `.json:Zone.Identifier` Kimi home files no longer leave their base `eggup-*.json` file flagged as global pollution on Windows runners.
- **Windows MCP diagnostic paths** — invalid project MCP diagnostics now report project-relative `.omk/mcp.json` paths on Windows instead of absolute temp paths.
- **Post-release CI closure** — fixes the Windows `npm run verify` failures observed after the v1.1.10 tag while preserving the already-passed release publish flow.
- **MCP CLI smoke stability** — `omk mcp test` gives OMK project stdio probes more time under loaded CI runners and reports timeout hints when `tools/call` has no response.
- **Release harness timeout stability** — cross-platform release checks now give slow full-init smoke files enough headroom on loaded runners instead of timing out after valid progress.

### Verification

- Passed `npm run build:clean`, `node test/cli-json-contract.test.mjs`, `node test/orchestration.test.mjs`, `node test/mcp-command.test.mjs`, `node test/init-mcp-secrets.test.mjs`, `npm run check`, and full `npm run release:check`.

## v1.1.10 — Init scaffold and release-safety fixes (2026-05-10)

### Fixed

- **Asset-free init** — `omk init` no longer copies or generates `kimicat.png` into new projects.
- **Logo config safety** — fresh `.omk/config.toml` no longer enables `logo_image = "kimicat.png"` by default; custom logos are opt-in through a commented example.
- **Init scaffold visibility** — init output now lists the generated role, prompt, config, hook, MCP, snippet, memory, and spec-kit scaffold groups instead of the removed PNG asset.
- **Packaged role templates** — packaged `.omk` agent templates now include the missing root subagent role files (`architect`, `interviewer`, `explorer`, `coder`, `qa`, `integrator`, `researcher`, `ontology`, `vision-debugger`) plus the `explore`/`plan` compatibility aliases.
- **Template package audit** — package audit now fails when packaged `.omk/agents/root.yaml` references role paths that are not included in the tarball.
- **Runtime release readiness** — doctor/runtime checks now avoid stale global-home and web-tool false positives, while goal/harness verification uses current dist and latest evidence instead of stale generated output.

### Verification

- Passed `npm run build:clean`, `npm run check`, `npm run lint`, `npm test`, `npm run yaml:check`, `npm run secret:scan`, `npm run native:build && npm run audit:package`, `npm run smoke:pack`, `git diff --check`, and `node dist/cli.js doctor --json --soft`.

## v1.1.9 — CI smoke parity hardening (2026-05-09)

- Fixed smoke workflow parity by rebuilding native npm dependencies after `npm ci --ignore-scripts` before test execution.
- Hardened Windows MCP doctor command discovery for absolute executable paths and source-tree `omk` shim tests.
- Stabilized Windows Rust safety harness tests by allowing first-run Cargo compilation to complete.

## v1.1.8 — Release smoke hardening (2026-05-09)

### Fixed
- Normalized downloaded Rust native safety artifact modes before release packing so Linux/macOS install smoke runs execute bundled `omk-safety` correctly.
- Added package audit coverage for non-Windows native executable bits to prevent artifact-permission regressions.

### Release
- Supersedes the failed v1.1.7 tag run; npm publication should use v1.1.8 to avoid rewriting the remote tag.

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
