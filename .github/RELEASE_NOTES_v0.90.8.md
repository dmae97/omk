# OMK v0.90.8

OMK v0.90.8 is a lockstep patch release for the OMK package set. It adds a tool-free GPT-5.6 MoA model, ordered path-safe tool-batch waves, global context-budget controls, and bounded computer-use integrations.

## Highlights

| Area | Release note |
| --- | --- |
| Models | Added `openai-codex/gpt-5.6-moa`, a virtual model that runs bounded Sol and Terra analysis concurrently and returns one Sol synthesis. Hardened Codex cancellation, terminal status, tool-history, and retry behavior. |
| Agent loop | Added `partitionToolBatchWaves` so independent tool calls run in ordered safe waves while conflicting or unknown calls remain sequential. |
| Context control | Added global `contextBudget.enabled` and `compaction.model`, with cache selection that respects the remaining context-budget tier. |
| Evidence / verification | Hardened the evidence ledger with a tamper-evident hash chain. Correctness Wall fixtureless live OA now requires explicit MCP transport, run IDs, and a bound handler; otherwise it remains preview-only. |
| Computer use | Added the project-local Stagehand extension and `omk-computeruse` skill for redacted browser observation, bounded extraction, and operator-approved actions. |
| Release safety | Prevented nested extension `node_modules` from being staged into release commits while preserving extension sources and lockfiles. |

## Packages

- `open-multi-agent-kit@0.90.8`
- `omk-ai@0.90.8`
- `omk-agent-core@0.90.8`
- `omk-tui@0.90.8`

## Install

```bash
npm install -g --ignore-scripts open-multi-agent-kit@0.90.8
omk --version
```

Expected output:

```text
0.90.8
```
