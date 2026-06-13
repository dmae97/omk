# Scoped MCP for coding agents

## Short answer

Scoped MCP means each agent lane only sees the Model Context Protocol servers, skills, and hooks it needs, instead of inheriting every global tool and secret.

## Why does tool scope matter for coding agents?

An agent with unrestricted tool access can read secrets, write outside its task, or run shell commands it was never meant to. OMK keeps MCP servers, skills, hooks, and memory bounded per lane so authority matches the task.

## How OMK implements it

- Default project scope reads project `.kimi/mcp.json` and `.omk/mcp.json`; the generated safe default is `omk-project` only.
- All-scope can read user `~/.kimi/mcp.json` at runtime without copying or printing global MCP secrets.
- Each lane receives only the capabilities its role requires.
- Tool authority is separated into read, write, shell, and merge.

## Example

```bash
omk do "summarize open issues" --mcp-scope project --dry-run --json
omk mcp doctor
omk mcp list
```

## What this does not claim

Scoped MCP is an authority and configuration boundary, not an OS-level sandbox. OS-level sandboxing is planned, not claimed. See [SECURITY.md](../../SECURITY.md).

## Related

- [What is OMK?](../what-is-omk.md)
- [Provider routing for AI coding](provider-routing-for-ai-coding.md)
- [Evidence-gated coding agents](evidence-gated-coding-agents.md)
