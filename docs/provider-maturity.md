# Provider maturity

This page documents provider status for the current source tree.

## Current source target

- Package version: `0.80.1`
- Runtime contract family: `v1.2`
- Release channel: `pre-1.0`

## Runtime-mode authority matrix

Authority belongs to `(provider, runtimeMode)`, not provider identity alone. The source of truth is `src/runtime/authority-matrix.ts`.

| Runtime mode | Authority class | Allowed authority | Current maturity |
| --- | --- | --- | --- |
| `kimi:api` | advisory API | read, review, vision, advisory tool-calling | Mature read/review path. No direct workspace write/shell/merge authority. |
| `kimi:wire` / `kimi:cli` | OMK-controlled compatibility path | read, review, write, patch, vision, tool-calling | Compatibility authority for edits only when routed through OMK controls. Shell/merge stay separately gated. |
| `mimo:api` | advisory API | read, review, thinking | Default model provider for advisory/thinking lanes. No direct workspace write authority. |
| `deepseek:api` | advisory API | read, review | Opportunistic read/review/QA/research. Write, MCP, shell, merge blocked. |
| `glm:api` | advisory API | read, review | Advisory/thinking path; broader release-gate coverage pending. |
| `codex:cli` | bounded CLI | read, review, write, patch, shell | Workspace authority only under OMK approval/sandbox policy. Merge withheld. |
| `opencode:cli` | bounded CLI | read, review, write, patch, shell | Compatibility path; availability depends on local CLI and auth. |
| `commandcode:cli` | bounded CLI | read, review, write, patch, shell | Compatibility path; availability depends on local CLI and auth. |
| `local-llm:api` | advisory API | read, review | Local preview path. API runtime rejects direct shell/tool-calling authority. |

`omk provider list --json` also merges user-local provider configuration, so local output may include custom providers or changed enabled/configured flags.

## Routing rules to preserve

- OMK is the root orchestrator; individual providers are adapters or worker lanes.
- Authority/write/merge routes must stay with an authority-capable provider unless a tested contract grants another provider that authority.
- Advisory API runtimes must not be documented as direct workspace-write, shell, MCP, or merge authorities.
- Provider setup commands store environment variable names and metadata, not raw secret values.
- Optional provider lanes may skip or fall back depending on route criticality and failure type.

## Verification commands

```bash
npm run build:clean
node dist/cli.js provider list --json
node dist/cli.js provider doctor kimi --json --soft
node --test test/provider-routing.test.mjs test/runtime-router.test.mjs test/provider-tool-contracts.test.mjs
```

Run these before claiming provider-maturity changes are release-ready.
