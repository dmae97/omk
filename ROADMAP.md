# Roadmap

Current source version: `open-multi-agent-kit@0.80.1` (`pre-1.0`; runtime contract family `v1.2`)
Last updated: 2026-06-15

## 2026-06-15 release truth status

Current source and npm target is `open-multi-agent-kit@0.80.1` on the `v1.2` runtime contract family and `pre-1.0` release channel.

- Main CI and main Smoke are green on the `0.80.1` release commit.
- Tag Release and tag Smoke are green for `v0.80.1`.
- npm `latest` is registry-verified as `open-multi-agent-kit@0.80.1`.
- OS-level sandboxing is still planned, not claimed; current safety relies on authority gates, approval policy, evidence, replay, and scoped runtime capabilities.
- The active architecture backlog is tracked in `docs/native-root-runtime-hardening.md`, `docs/native-root-runtime-algorithms.md`, and `.omk/specs/native-orchestrator-phase1/`.

## v1.1.9 reality

Provider routing and graph viewing are no longer purely future work:

- `omk run`, `omk parallel`, and DAG replay expose `--provider auto|kimi`.
- `omk provider` / `omk deepseek` manage DeepSeek enablement, key setup, availability checks, and default fallback to the most mature adapter.
- DeepSeek and similar API providers remain read/review/advisory by default; write/shell/merge authority is selected by runtime-mode capability, health, approval policy, and sandbox constraints.
- `omk graph view` generates an HTML view from `.omk/memory/graph-state.json`.
- `omk goal` has a persisted lifecycle, continue loop, generated plan/evidence criteria, and verification flow.

## v1.2 — Native Orchestrator Decoupling

### Phase 0: Foundation & Spec

- Coupling map: identify every Kimi-only assumption in runtime, harness, agent loop, and subagent spawning.
- Produce Speckit artifacts (`spec.md`, `plan.md`, `tasks.md`) for the decoupling milestone.
- Define provider-adapter contract so Kimi, DeepSeek, and future workers plug into a unified `AgentRuntime`.

### Phase 1: Unified Runtime Bridge

- Implement `AgentRuntime.execute` as the single entrypoint for all worker execution (chat, DAG node, inline tool call).
- Model chat as a DAG: user message → IntentFrame → ActionAtom → worker node → evidence gate.
- Ensure Kimi adapter remains the mature default while the bridge is provider-agnostic.
- Use `docs/native-root-runtime-algorithms.md` Algorithms 3-5 as the
  acceptance reference for context-capsule conversion, task execution, and
  router fallback.

### Phase 2: Worker Capability Assignment

- Allow per-DAG-node MCP, skills, hooks, and provider selection.
- Move capability flag resolution from Kimi prompt scaffolding into OMK harness metadata.
- Add preflight health checks and fallback chains for non-Kimi workers.
- Make native chat turn capability default-safe: read-only for advisory/review prompts, write/patch for edit prompts, and shell only when command execution is intended and approval policy allows it.
- Keep DeepSeek as read/review/advisory unless a future contract explicitly grants write/shell authority.
- Use Algorithm 2 and Algorithm 7 as the acceptance reference for per-turn
  capabilities and scoped worker environment construction.

### Phase 3: Root Coordinator Mode

- Introduce native OMK agent loop with `IntentFrame` parsing and `ActionAtom` dispatch.
- OMK becomes the root orchestrator; Kimi becomes one worker provider adapter among many.
- Preserve D-Mail checkpoints and Okabe-compatible context management across provider handoffs.
- Treat ActionAtom/Novelty Guard language as contract-level until concrete
  runtime implementation and tests land.

### Phase 4: Docs & GA

- Update `AGENTS.md`, `DESIGN.md`, init templates, and skill docs to reflect OMK-as-root narrative.
- Deprecate Kimi-only subagent language where OMK `ParallelOrchestrator` is the actual spawn surface.
- Mark v1.2.x stable once provider fallback, evidence gates, and DAG replay are green across all supported adapters.

## v1.3 — Hardening the current surface

### P0: release and contract gates

- Done: YAML validation now runs in local `verify` plus CI/smoke workflows.
- Done: package dry-pack, package audit, tarball smoke, release matrix gates, GitHub Release, and npm registry verification were re-verified for `0.80.1`.
- Done: `version:check` now validates current-version Markdown claims in README, docs, ROADMAP, and init templates.
- Done: native turn risk defaults are safer: explicit read-only constraints override write keywords, ambiguous turns fall back to `ask`, and write/shell/merge turns require evidence gates.
- Done: tool authority has staged `shadow|warn|enforce` modes, with native turn dispatch blocking in enforce mode.
- Done: runtime routing is health-aware for async execution paths and records `executeTask` decision traces.
- Done: headroom compaction can feed the effective runtime context capsule.
- Required before any future publish/tag: pass `npm run release:check`, tag CI/smoke, tarball install smoke, package audit, and registry verification on the exact intended release diff.
- Remaining: expand provider health from available/unavailable to binary/auth/model/quota/rate-limit/latency vectors across all adapters.
- Remaining: define minimum machine-readable CLI envelopes for the rest of the automation-critical commands.

### P1: observability and diagnostics

- Done: provider route/fallback counts are now emitted in run summaries/reports and summary terminal output.
- Done: invalid MCP JSON is reported as a visible diagnostic without leaking secret-like config values.
- Done: `omk mcp doctor --json` exposes structured server status, command resolution, timeout, permission, and config-source fields.
- Expand JSON output for graph, DAG, summary, and workflow commands where CI or agents consume results.
- Link graph nodes back to runs, goals, providers, and evidence so `omk graph view` becomes audit evidence, not only visualization.

### P2: execution depth and planner quality

- Deepen `omk team` runtime reporting: worker state, pane/session health, artifacts, and verification handoff.
- Done: replace the `omk goal plan` stub with a planner that emits steps, acceptance criteria, risks, and evidence gates.
- Add provider-quality gates before broader non-Kimi worker pools.
- Keep Kimi execution as the safe fallback path for every run.

## Later tracks

### Provider routing maturity

- Keep authority at the runtime-mode level: API runtimes are advisory/read/review unless a runtime-mode contract grants write/shell/merge authority.
- Use provider hints for explorer, reviewer, QA, planner, and documentation roles only when runtime health is acceptable and task risk is low.
- Record provider attempts, route confidence, fallback reason, and final authority in run evidence.

### Graph and memory maturity

- Materialize provider routes, fallback events, goals, evidence gates, and run artifacts in the local graph/Kuzu ontology.
- Keep `omk graph view` local-first and safe for private repositories.

### Historical milestones

| Version | Focus |
|---------|-------|
| v0.1 | init / doctor / chat, P0 skills, AGENTS.md / DESIGN.md generation, quality gate hooks |
| v0.2 | wire controller, HUD, run state, worker logs |
| v0.3 | worktree team, merge queue, reviewer / QA / integrator agents |
| v0.4 | Google DESIGN.md integration, Stitch skills installer, screenshot UI review, Spec Kit planning + DAG execution, agent registry, project index, run summary |
| v0.5 | MCP project server, plugin pack, CI agent mode |
| v1.1.6 | provider/deepseek commands, provider policy flags, graph view, goal lifecycle, expanded run history and update JSON |
| v1.1.9 | chat harness manifest, capability DAG lanes, Rust native safety loader, Windows clipboard screenshot bridge, release native matrix |
| v1.1.12 | Replay system, skill assigner, decision trace coverage, evidence gates, and repair policy |
| v1.1.13 | Bundled MCP server entrypoints, ACP/host transport groundwork, deployment-ready package metadata |
| v1.1.14 | Current harness docs, external-inspired workflow skills, and release-safe public wording |
| v1.1.15 | Isolated HOME MCP shell-profile hotfix and persistent fetch MCP entrypoint |
| v1.1.16 | Deterministic IntentFrame/ActionAtom orchestration, chat schema preflight, MCP duplicate policy, agent capability propagation, and doctor/init/pack smoke fixes |
| v1.1.17 | Full generated-agent MCP/skills/hooks enablement, parallel subagent orchestration emphasis, and v1.1.17 release docs |
| v1.1.18 | **Last Kimi-wrapper dominant release.** Package source version alignment, latest-published v1.1.17 caveat, native safety package gate, typed doctor repair plans, startup update prompt UX, and parallel subagent orchestration release-doc alignment |
