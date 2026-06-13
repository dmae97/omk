# OMK vs OpenCode

## Short answer

OpenCode is a terminal coding agent. OMK is a control plane for running coding agents with scoped authority, DAG orchestration, evidence gates, and replayable artifacts.

## Category difference

- **OpenCode**: a direct coding loop in the terminal.
- **OMK**: a layer around execution that routes providers, scopes authority, requires evidence, and saves replayable run artifacts.

## When to use which

- Use OpenCode when you want a direct coding assistant.
- Use OMK when you want to route tasks across providers, restrict write or shell authority, and require evidence before marking work complete.

## How they work together

OpenCode/CommandCode can participate as a compatibility lane when the local CLI and auth are present.

```bash
omk provider list
omk do "refactor the parser" --provider auto --dry-run --json
```

See [provider routing](../use-cases/provider-routing-for-ai-coding.md).

## Related

- [What is OMK?](../what-is-omk.md)
- [OMK vs Codex](omk-vs-codex.md)
- [OMK vs mcp-agent](omk-vs-mcp-agent.md)
