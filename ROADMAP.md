# Roadmap

Current source version: v1.2.0-rc.0 package RC (`v1.2` runtime contract family)
Last updated: 2026-05-31

## 2026-05-31 v1.2 RC status

The local source tree is aligned to package version `1.2.0-rc.0`, runtime version `v1.2`, and release channel `rc`. The architecture direction is OMK-as-root with providers as adapters. Kimi remains the most mature authority path in this RC line; other providers have narrower or advisory maturity unless tests and contracts say otherwise.

- Version contract details: `docs/versioning.md`.
- Provider status and limitations: `docs/provider-maturity.md`.
- Public proof index: `proof/PROOF_INDEX.md`.
- Active native-runtime backlog: `docs/native-root-runtime-hardening.md`, `docs/native-root-runtime-algorithms.md`, and `.omk/specs/native-orchestrator-phase1/`.
- Do not claim stable `v1.2` until release gates pass on the exact target commit and the stable package/tag is published.

## v1.1.9 reality

Provider routing and graph viewing are no longer purely future work:

- `omk run`, `omk parallel`, and DAG replay expose `--provider auto|kimi`.
- `omk provider` / `omk deepseek` manage DeepSeek enablement, key setup, availability checks, and default fallback to the most mature adapter.
- DeepSeek is an opportunistic read-only/advisory worker; Kimi remains the most mature authority adapter in this historical line, while v1.2 RC moves orchestration ownership into OMK.
- `omk graph view` generates an HTML view from `.omk/memory/graph-state.json`.
- `omk goal` has a persisted lifecycle, continue loop, generated plan/evidence criteria, and verification flow.

## v1.2 RC — Native Orchestrator Decoupling

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
- Mark v1.2.x stable only after provider fallback, evidence gates, DAG replay, version contracts, and provider-maturity docs are green across supported adapters.

## v1.3 — Hardening the current surface

### P0: release and contract gates

- Done: YAML validation now runs in local `verify` plus CI/smoke workflows.
- Done: package dry-pack, package audit, tarball smoke, native safety build, and release matrix gates were re-verified against v1.1.17 artifacts.
- Required before stable v1.2 publish/tag: regenerate the native safety binary, pass package audit, pass smoke-pack/tarball install smoke, and pass `npm run release:check` on the exact intended release diff.
- Required before stable v1.2 publish/tag: CI and smoke checks must pass on the exact intended commit.
- Done: provider/deepseek and screenshot JSON command contracts gained hermetic regression tests.
- Done: proof bundle schema/check/index scaffolding exists, with eight scoped RC hardening bundles covering no-Kimi smoke, doctor-provider, fallback-route, native-safety, contract-version, evidence-block, replay/inspect, and graph-audit gates.
- Done: current AGENTS/init templates and packaged workflow skills were aligned with the active skills/MCP/agents/harness surface, including all generated agent MCP/skills/hooks flags and parallel subagent orchestration guidance.
- Remaining: lock runtime safety gates for native turn risk, approval/sandbox propagation, authority-provider resolution, provider health probes, and DeepSeek read-only routing.
- Remaining: lock broader provider fallback metadata with tests for rate limit, timeout, and default fallback variants.
- Remaining: define minimum machine-readable CLI envelopes for the rest of the automation-critical commands.
- Remaining: promote additional real proof bundles until the public proof index reaches the RC ten-bundle target and deepens no-Kimi plus fallback-routing coverage.

### P1: observability and diagnostics

- Done: provider route/fallback counts are now emitted in run summaries/reports and summary terminal output.
- Done: invalid MCP JSON is reported as a visible diagnostic without leaking secret-like config values.
- Done: `omk mcp doctor --json` exposes structured server status, command resolution, timeout, permission, and config-source fields.
- Expand JSON output for DAG, summary, and workflow commands where CI or agents consume results.
- Link live graph nodes back to runs, goals, providers, and evidence so `omk graph audit` can validate real project graph memory, not only compact proof fixtures.

### P2: execution depth and planner quality

- Deepen `omk team` runtime reporting: worker state, pane/session health, artifacts, and verification handoff.
- Done: replace the `omk goal plan` stub with a planner that emits steps, acceptance criteria, risks, and evidence gates.
- Add provider-quality gates before broader non-Kimi worker pools.
- Keep Kimi execution as the safe fallback path for every run.

## Later tracks

### Provider routing maturity

- Keep Kimi as the most mature authority adapter and default fallback until another provider has tested write/merge/MCP authority contracts.
- Use provider hints for explorer, reviewer, QA, planner, and documentation roles only when preflight is healthy and task risk is low.
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
| v1.1.18 | Historical Kimi-wrapper dominant release-prep line: package source version alignment, native safety package gate, typed doctor repair plans, startup update prompt UX, and parallel subagent orchestration release-doc alignment |
| v1.2.0-rc.0 | Package RC for the `v1.2` runtime contract family, provider-neutral docs alignment, version contract docs, and provider maturity limits |
