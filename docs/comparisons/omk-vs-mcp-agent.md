# OMK vs MCP agent frameworks

## Short answer

MCP agent frameworks give agents tool access through the Model Context Protocol. OMK adds task-level control on top: scoped MCP per lane, provider routing, evidence gates, and replayable artifacts.

## Category difference

- **MCP agent frameworks**: expose tools to an agent through MCP servers.
- **OMK**: keeps MCP servers, skills, and hooks scoped per lane, routes providers, separates read/write/shell/merge authority, and requires evidence before completion.

## When to use which

- Use an MCP agent framework when you mainly need tool access for one agent.
- Use OMK when you need bounded tool authority, multi-provider routing, and verifiable, replayable runs.

## How they work together

OMK consumes MCP servers as scoped capabilities per lane instead of importing every global server into every agent.

```bash
omk mcp list
omk mcp doctor
omk do "summarize open issues" --mcp-scope project --dry-run --json
```

See [scoped MCP for coding agents](../use-cases/scoped-mcp-for-coding-agents.md).

## Related

- [What is OMK?](../what-is-omk.md)
- [OMK vs OpenCode](omk-vs-opencode.md)
- [Provider routing for AI coding](../use-cases/provider-routing-for-ai-coding.md)
