# Implementation Plan: Think Command Routing

**Branch**: `001-think-command-routing` | **Date**: 2026-06-18 | **Spec**: `spec.md`
**OMK Preset**: `omk`

## Summary

Apply the `/think` and `/model` routing feature to the canonical `/home/yu/omk` checkout, verify it with a targeted regression test and `npm run check`, then run `npm run build` so the installed launcher sees updated `dist/` output.

## Runtime Inventory

- **Harness**: not present
- **MCP Scope**: project filesystem only
- **Skills**: omk-typescript-strict, omk-docs-release
- **Authority**: Local writer updates only the listed files and preserves unrelated worktree changes.

## Agent Routing

| Phase | Primary Role | Secondary Roles | Evidence Gate |
|-------|--------------|-----------------|---------------|
| Bootstrap | explorer | qa | file-exists |
| Core | coder | reviewer | command-pass |
| Docs | reviewer | qa | file-exists |
| Build | qa | reviewer | command-pass |

## Project Structure

```text
packages/coding-agent/src/core/slash-commands.ts
packages/coding-agent/src/modes/interactive/interactive-mode.ts
packages/coding-agent/src/modes/interactive/components/settings-selector.ts
packages/coding-agent/test/thinking-selector.test.ts
packages/coding-agent/docs/usage.md
packages/coding-agent/docs/quickstart.md
specs/001-think-command-routing/
```

## Complexity Check

| Concern | Decision | Rationale |
|---------|----------|-----------|
| New dependencies | none | Existing selector and TUI primitives are sufficient. |
| Breaking changes | no | Adds `/think`; preserves existing `/model` behavior plus post-select routing. |
| Parallel tasks | 2 | Docs/spec-kit can be updated independently from code once behavior is defined. |
| MCP/secret exposure | none | No credentials or private session data are recorded. |

## Quality Gates

- Targeted regression: `cd packages/coding-agent && node node_modules/vitest/dist/cli.js --run test/thinking-selector.test.ts`
- Repository check: `npm run check`
- Runtime dist update: `npm run build`
