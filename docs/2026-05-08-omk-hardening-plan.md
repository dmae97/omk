# OMK v1.1.6 Hardening Execution Report

Date: 2026-05-08
Scope: hardening areas found from the current repo/package surface and executed in this branch with parallel agents.

## Current baseline

- Public version is v1.1.6.
- Provider routing exists behind `--provider auto|kimi` on run/parallel/DAG replay paths.
- DeepSeek commands exist for API setup, enable/disable, and availability checks; Kimi remains final authority.
- `omk graph view` can render local graph-state HTML.
- `omk goal` persists goals and now writes actionable planner DAG plans instead of a placeholder `goal plan`.

## Completed in this pass

- Fixed malformed GitHub feedback issue-template YAML.
- Added `.github/**/*.yml|yaml` validation and wired it into local `verify` plus CI/smoke workflows.
- Added local release/package gates: `yaml:check`, `release:check`, dry pack, package audit, tarball smoke evidence.
- Added MCP JSON diagnostics to `doctor` so invalid project/global MCP config fails visibly without leaking secret values.
- Expanded CLI JSON contract coverage for provider/deepseek and screenshot commands.
- Added provider route/fallback metrics to run summary/report generation and terminal summary display.
- Fixed `open-design-agent --smoke` to exit through the OMK CLI fast path instead of timing out before Kimi ACP launch.

## P0 — Release gates and machine contracts

1. Done: validate GitHub workflow/issue-template YAML before release.
2. Done: dry-pack/package-audit/tarball-smoke evidence collected after build.
3. Done: additional JSON contract tests for provider/deepseek and screenshot command surfaces.
4. Remaining: broaden provider fallback tests for rate-limit/timeout variants and promote canonical JSON envelopes across graph/DAG/summary/workflow entrypoints.

Exit evidence:

- Release gate fails on invalid YAML.
- Package audit and tarball smoke pass on the generated package artifact.
- JSON contract tests exist for newly covered command surfaces.

## P1 — Visibility and diagnostics

1. Done: provider route/fallback metrics are present in run summaries and reports.
2. Done: invalid MCP JSON is surfaced through doctor/MCP diagnostics without exposing config contents.
3. Done: `omk mcp doctor --json` emits parseable source/server status with active scope, transport, resolved command, timeout, and failure-kind checks.
4. Remaining: expand JSON output for graph, DAG, summary, and workflow entrypoints.
5. Done: graph audit links now include run IDs, audit/report links, provider attempts, and evidence gates in local graph/viewer relations.

Exit evidence:

- Run summaries show provider totals without exposing secrets.
- MCP JSON diagnostics classify missing command, timeout, permission, invalid config, and unhealthy server.
- Graph output can support an audit trail from goal to run to evidence.

## P2 — Runtime depth and planning quality

1. Done: `omk team` run state records tmux runtime windows, coordinator pane count, session health, and HUD reporting metadata.
2. Done: `omk goal plan` writes generated steps, acceptance criteria, risks/constraints, and evidence gates.
3. Add provider quality gates before expanding beyond conservative read-only/advisory worker usage.
4. Keep Kimi-only fallback as the default safety invariant.

Exit evidence:

- Team runs expose enough state to debug partial worker/window failures.
- Goal plans are actionable without hand-editing a placeholder file.
- Provider expansion is blocked unless quality/evidence gates pass.
