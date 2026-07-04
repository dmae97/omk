# Implementation Plan: Headroom GitHub Main 0.29.0 Upgrade

**Branch**: `009-headroom-github-main-0290-upgrade` | **Date**: 2026-07-03 | **Spec**: `specs/009-headroom-github-main-0290-upgrade/spec.md`  
**OMK Preset**: `omk`

## Summary

Upgrade the PATH-visible Headroom CLI to GitHub main package version `0.29.0`, then keep the control-panel runtime status path truthful to the installed CLI version. Retain forward-compatible parsing for future `3.0` output and legacy `headroom-ai` 0.x compatibility.

## Runtime Inventory

- **Harness**: OMK Parallel Orchestrator
- **MCP Scope**: `filesystem` only
- **Skills**: `programming`, `headroom`, `docs-write-concisely`
- **Authority**: root coordinator / current session is the sole writer for listed files

## Agent Routing

| Phase | Primary Role | Secondary Roles | Evidence Gate |
|---|---|---|---|
| Runtime parser | `omk-coder` | `omk-tester` | targeted Vitest pass |
| Fixture refresh | `omk-coder` | `omk-reviewer` | targeted Vitest pass |
| Spec-kit trace | `omk-coder` | `omk-reviewer` | file-exists + no-secret review |
| Final QA | `omk-tester` | `omk-reviewer` | `npm run check` |

## Project Structure

```text
packages/coding-agent/src/modes/interactive/components/
└── control-panel-runtime-status.ts

packages/coding-agent/test/
├── control-panel-runtime-status.test.ts
├── control-panel-header.test.ts
└── control-panel-reference-fidelity.test.ts

specs/009-headroom-github-main-0290-upgrade/
├── spec.md
├── plan.md
└── tasks.md
```

## Complexity Check

| Concern | Decision | Rationale |
|---|---|---|
| New dependencies | external Python package upgrade only | Repo `package.json` and lockfiles remain unchanged. |
| Breaking changes | no | Existing legacy output remains supported. |
| Parallel tasks | low | Code/tests/spec files are small and sequential enough for direct execution. |
| MCP/secret exposure | none | No secret files or remote MCP calls are required. |

## Design Decisions

- Prefer installed CLI truth over hardcoded upstream target.
- Parse both `0.29.0` and future `3.0` forms because upstream release strings may vary.
- Probe `headroom --version`, then `headroom version`, then Python distribution metadata.
- Prefer Python distribution `headroom` over legacy `headroom-ai`.
- Keep legacy `headroom-ai` fallback so existing OMK installs do not lose status display.
- Preserve the previous uv tool symlink as `/home/yu/.local/bin/headroom.uv-0.22.4-backup`.

## Quality Gates

- Targeted tests pass for parser, control-panel header, and reference fidelity.
- `npm run check` passes after formatting/type checks.
- No changes to `packages/ai/**` or `packages/agent/**`.
