# Roadmap

Current source version: v0.78.1 (`v1.2` runtime contract family)
Last updated: 2026-06-07

## 2026-06-07 release reality

The public npm package line is `open-multi-agent-kit@0.78.x`. The `v1.2` label below is the source-tree runtime contract family, not a claim that a stable npm `1.2.x` package has shipped.

The v1.1.x/v1.2 rows in this file are historical source checkpoints and architecture milestones unless a row explicitly says it was npm-published. Current public-release work should be judged against the exact target commit, CI/smoke status, package audit, and npm dist-tag state.

## Historical 2026-05-31 v1.2 contract checkpoint

At the 2026-05-31 checkpoint, the source tree was being aligned toward a `v1.2` runtime contract and an internal RC packaging target. That checkpoint is useful architectural history, but it is not the current public npm package line. The architecture direction is OMK-as-root with providers as adapters. Kimi remains the most mature authority path; other providers have narrower or advisory maturity unless tests and contracts say otherwise.

- Version contract details: `docs/versioning.md`.
- Provider status and limitations: `docs/provider-maturity.md`.
- Public proof index: `proof/PROOF_INDEX.md`.
- Active native-runtime backlog: `docs/native-root-runtime-hardening.md`, `docs/native-root-runtime-algorithms.md`, and `.omk/specs/native-orchestrator-phase1/`.
- Do not claim stable npm `1.x` status until release gates pass on the exact target commit and the stable package/tag is published.

## Historical v1.1.9 source reality

Provider routing and graph viewing are no longer purely future work in the source tree, but these notes are historical and provider-dependent:

- `omk run`, `omk parallel`, and DAG replay expose `--provider auto|kimi`.
- `omk provider` / `omk deepseek` manage DeepSeek enablement, key setup, availability checks, and default fallback to the most mature adapter.
- DeepSeek is an opportunistic read-only/advisory worker; Kimi remains the most mature authority adapter in this historical line, while v1.2 RC moves orchestration ownership into OMK.
- `omk graph view` generates an HTML view from `.omk/memory/graph-state.json`.
- `omk goal` has a persisted lifecycle, continue loop, generated plan/evidence criteria, and verification flow.

## v1.2 contract hardening — Native Orchestrator Decoupling

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

## Post-0.78 hardening — current surface

### P0: release and contract gates

- Source implemented: YAML validation runs in local `verify` plus CI/smoke workflows.
- Source verified in recent gates: package dry-pack, package audit, tarball smoke, native safety build, and release matrix coverage. Public publish/tag claims still depend on the exact target commit.
- Required before a public npm publish/tag: regenerate the native safety binary if the target platform artifacts changed, pass package audit, pass smoke-pack/tarball install smoke, and pass `npm run release:check` or the documented CI equivalent on the exact intended release diff.
- Required before a public npm publish/tag: CI and smoke checks must pass on the exact intended commit.
- Source implemented: provider/deepseek and screenshot JSON command contracts have hermetic regression tests.
- Source implemented: proof bundle schema/check/index scaffolding exists, with scoped hardening bundles covering no-Kimi smoke, doctor-provider, fallback-route, native-safety, contract-version, evidence-block, replay/inspect, graph-audit, deeper no-Kimi verification, and provider fallback-routing gates.
- Source implemented: proof integrity enforces artifact linkage plus per-bundle `sha256sums.txt` hash validation.
- Source implemented: current AGENTS/init templates and packaged workflow skills align with the active skills/MCP/agents/harness surface.
- Still required: lock runtime safety gates for native turn risk, approval/sandbox propagation, authority-provider resolution, provider health probes, and DeepSeek read-only routing.
- Still required: lock broader provider fallback metadata with tests for rate limit, timeout, and default fallback variants.
- Still required: define minimum machine-readable CLI envelopes for the rest of the automation-critical commands.
- Still required: promote additional proof bundles beyond the current baseline, especially provider fallback variants for rate limit, timeout, and default route behavior.

### P1: observability and diagnostics

- Source implemented: provider route/fallback counts are emitted in run summaries/reports and summary terminal output.
- Source implemented: invalid MCP JSON is reported as a visible diagnostic without leaking secret-like config values.
- Source implemented: `omk mcp doctor --json` exposes structured server status, command resolution, timeout, permission, and config-source fields.
- Expand JSON output for DAG, summary, and workflow commands where CI or agents consume results.
- Link live graph nodes back to runs, goals, providers, and evidence so `omk graph audit` can validate real project graph memory, not only compact proof fixtures.

### P2: execution depth and planner quality

- Deepen `omk team` runtime reporting: worker state, pane/session health, artifacts, and verification handoff.
- Source implemented: replace the `omk goal plan` stub with a planner that emits steps, acceptance criteria, risks, and evidence gates.
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

### Historical source milestones

These are source/development checkpoints unless a release note explicitly says the version was npm-published.

| Source checkpoint | Focus |
| --- | --- |
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
| v1.2.0-rc.0 | Internal RC target for the `v1.2` runtime contract family, provider-neutral docs alignment, version contract docs, and provider maturity limits |
