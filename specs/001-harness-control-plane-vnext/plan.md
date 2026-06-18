# Implementation Plan: Harness Control Plane VNext P0

**Branch**: `main` | **Date**: 2026-06-18 | **Spec**: `specs/001-harness-control-plane-vnext/spec.md`  
**OMK Preset**: `omk`

## Summary

Implement the P0 control-plane slices with minimal API surface: compaction gets budget accounting plus summary contract validation, interactive controls stop persisting invalid/non-committed state, and migration warnings get a structured tri-state classifier behind the existing string-warning public API. Follow-up slices add semantic-unit packing, scoped keybinding guardrails, bounded extension migration dry-run/apply APIs, and an append-only JSONL event ledger for selected control-plane transitions.

## Runtime Inventory

- **Harness**: `.omk/runs/harness-control-plane-vnext/result.json`
- **MCP Scope**: project; AdaptOrch dry-run recorded through `omk_orchestrate_goal`
- **Skills**: writing-plans, test-driven-development, ddd-software-architecture, verification-before-completion
- **Authority**: root session is final writer; no subagent tool is available in this harness instance.

## Agent Routing

| Phase | Primary Role | Secondary Roles | Evidence Gate |
|-------|--------------|-----------------|---------------|
| Bootstrap | planner | explorer | file-exists |
| RED tests | coder | reviewer | command-pass failure evidence |
| Core | coder | reviewer | focused tests pass |
| QA | qa | reviewer | npm run check |
| Synthesis | reviewer | planner | result artifact updated |

## Project Structure

```text
packages/coding-agent/src/core/compaction/compaction.ts
packages/coding-agent/src/modes/interactive/components/model-selector.ts
packages/coding-agent/src/modes/interactive/interactive-mode.ts
packages/coding-agent/src/migrations.ts
packages/coding-agent/test/*.test.ts
specs/001-harness-control-plane-vnext/
.omk/runs/harness-control-plane-vnext/
```

## Complexity Check

| Concern | Decision | Rationale |
|---------|----------|-----------|
| New dependencies | none | Existing token heuristics and vitest are sufficient for P0. |
| Breaking changes | no | Public migration warning API remains `string[]`. |
| Parallel tasks | 4 conceptual lanes | Compaction, interaction, migration, and keybinding guardrails touch separate files/tests. |
| MCP/secret exposure | none | No secret files read; auth material not touched. |

## Quality Gates

- Focused Vitest: compaction, interactive status/theme, model selector, migration deprecation.
- `npm run check` after code changes.
- `git diff --check` before final.
