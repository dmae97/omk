# Implementation Plan: Per-Task Reasoning-Effort Router

**Branch**: `003-reasoning-effort-router` | **Date**: 2026-07-03 | **Spec**: `spec.md`
**OMK Preset**: `omk`

## Summary

Add a pure local reasoning router (`reasoning-router.ts`) that classifies each turn and recommends a ThinkingLevel clamped to model capability, wire it into `AgentSession.prompt()` behind a new `auto` thinking mode with manual-`/think`-wins precedence, cover it with a faux-provider regression test, verify with `npm run check`, and build only if runtime application is requested.

## Runtime Inventory

- **Harness**: `packages/coding-agent/test/suite/harness.ts` (faux provider; no real APIs)
- **MCP Scope**: project filesystem only (router is local; no AdaptOrch MCP dependency)
- **Skills**: omk-typescript-strict, omk-code-review, omk-docs-release
- **Authority**: Writer lanes update only their listed files and preserve unrelated worktree changes; parallel writer lanes never share a file.

## Agent Routing

| Phase | Primary Role | Secondary Roles | Evidence Gate |
|-------|--------------|-----------------|---------------|
| Bootstrap | explorer | planner | summary-present |
| Core | coder | reviewer | command-pass |
| Providers Audit | reviewer | security | summary-present |
| Tests | tester | coder | command-pass |
| Docs | reviewer | qa | file-exists |
| Verification | qa | reviewer | command-pass |

## Lane Grants (implementation-wave DAG)

Evidence root: `.omk/goals/003-reasoning-effort-router/`. Lane A (explorer recon) is satisfied by planner recon recorded in this spec-kit; remaining lanes below. DAG edges: B freezes `reasoning-router.ts` exports first; C and D then run in parallel with B's wiring work; E runs last and gates merge.

| Lane | Role | Authority | Write Scope | Skills | MCP | Acceptance | Evidence Path |
|------|------|-----------|-------------|--------|-----|------------|---------------|
| B coder-core | omk-coder | write-scoped | `packages/coding-agent/src/core/reasoning-router.ts`, `src/core/agent-session.ts`, `src/core/slash-commands.ts`, `src/modes/interactive/interactive-mode.ts` | programming, omk-typescript-strict | filesystem (project) | Spec Req 1-2 acceptance items pass; no `packages/ai` diff; typecheck clean | `.omk/goals/003-reasoning-effort-router/laneB-coder-core.md` |
| C providers-audit | omk-security | read-only (advisory) | none | omk-code-review | filesystem-readonly | Confirms `reasoning` option flow and `clampThinkingLevel` unchanged in `packages/ai`; flags any breaking-change risk; confirms router inputs stay local prompt text only | `.omk/goals/003-reasoning-effort-router/laneC-providers-audit.md` |
| D tester | omk-tester | write-scoped (tests only) | `packages/coding-agent/test/suite/regressions/003-reasoning-router.test.ts` | programming, debugging | filesystem (project) | Spec Req 3 acceptance items pass; targeted vitest run green on faux harness | `.omk/goals/003-reasoning-effort-router/laneD-tester.md` |
| E reviewer | omk-reviewer | review-only | none (docs fixups delegated back to B) | omk-code-review, omk-docs-release | filesystem-readonly | Verifies precedence semantics vs spec, determinism claims, docs/changelog present, `npm run check` output clean; issues merge verdict | `.omk/goals/003-reasoning-effort-router/laneE-reviewer.md` |

Relevant always-on hooks per lane (evidence-wise): typecheck-after-edit and eslint-after-edit for B and D; the shell guard and sensitive-data guard for all lanes; stop-verify for E.

## Project Structure

```text
packages/coding-agent/src/core/reasoning-router.ts
packages/coding-agent/src/core/agent-session.ts
packages/coding-agent/src/core/slash-commands.ts
packages/coding-agent/src/modes/interactive/interactive-mode.ts
packages/coding-agent/test/suite/regressions/003-reasoning-router.test.ts
packages/coding-agent/docs/usage.md
packages/coding-agent/CHANGELOG.md
specs/003-reasoning-effort-router/
```

## Complexity Check

| Concern | Decision | Rationale |
|---------|----------|-----------|
| New dependencies | none | Pure TS module; rule table is static data; harness already exists. |
| Breaking changes | no | Manual mode stays default; `packages/ai` untouched; existing `reasoning` option reused. |
| Parallel tasks | 3 | Core wiring, providers audit, and tests run as separate lanes after router interface freeze. |
| MCP/sensitive-data exposure | none | Router sees prompt text locally only; no network, no AdaptOrch service, nothing sensitive recorded in evidence. |

## Quality Gates

- Targeted regression: `cd packages/coding-agent && node ../../node_modules/vitest/dist/cli.js --run test/suite/regressions/003-reasoning-router.test.ts`
- Repository check: `npm run check` (full output; fix all errors/warnings/infos)
- Runtime dist update: `npm run build` (only on explicit user request for runtime application, then TUI restart)
