# Roadmap

Current public version: v1.1.12
Last updated: 2026-05-11

## v1.1.9 reality

Provider routing and graph viewing are no longer purely future work:

- `omk run`, `omk parallel`, and DAG replay expose `--provider auto|kimi`.
- `omk provider` / `omk deepseek` manage DeepSeek enablement, key setup, availability checks, and Kimi-only fallback.
- DeepSeek is an opportunistic read-only/advisory worker; Kimi remains the orchestrator, writer, merger, and final authority.
- `omk graph view` generates an HTML view from `.omk/memory/graph-state.json`.
- `omk goal` has a persisted lifecycle, continue loop, generated plan/evidence criteria, and verification flow.

## v1.2 — Hardening the current surface

### P0: release and contract gates

- Done: YAML validation now runs in local `verify` plus CI/smoke workflows.
- Done: package dry-pack, package audit, tarball smoke, native safety build, and release matrix gates were re-verified against v1.1.9 artifacts.
- Done: provider/deepseek and screenshot JSON command contracts gained hermetic regression tests.
- Remaining: lock broader provider fallback metadata with tests for rate limit, timeout, and Kimi fallback variants.
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
- Keep Kimi-only execution as the safe fallback path for every run.

## Later tracks

### Provider routing maturity

- Keep Kimi as the main orchestrator, planner, merger, and final synthesis runtime.
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
