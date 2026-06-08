# Example: Codex MCP evidence run

Use this example when you want to show OMK as a CLI control plane for coding agents, not just a single-agent chat tool.

## What it demonstrates

- Provider-neutral routing with a Codex-capable local runtime.
- Project-scoped MCP setup before an agent run.
- Parallel DAG workers from one coding goal.
- Evidence-gated dry-run output before implementation.

## Run it

```bash
npm i -g open-multi-agent-kit
omk init
omk doctor
omk orchestrate "add tests for src/router.ts" --workers 3 --dry-run
```

## Expected output

OMK should produce a bounded orchestration preview: selected runtime, MCP scope, worker count, planned lanes, and evidence expectations. A dry run should not modify source files.

## Why this belongs in awesome CLI coding-agent lists

OMK gives terminal coding agents a control plane: route runtimes, scope MCP tools, run DAG workers, and require evidence before completion claims.
