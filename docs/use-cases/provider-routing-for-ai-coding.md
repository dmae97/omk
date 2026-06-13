# Provider routing for AI coding

## Short answer

Provider routing means OMK selects a compatible coding runtime for each task and falls back in a ranked order when one fails, instead of hardcoding a single model.

## How does OMK route coding agents?

OMK classifies task intent, filters compatible runtimes, scores them by quality, evidence pass rate, and recent failures, runs the best runtime, and records the selected runtime plus a fallback chain. Routing is evidence-aware, not just provider-name matching.

## Which providers can participate?

- **Codex (app/CLI OAuth)**: compatibility path through the official Codex login.
- **OpenCode / CommandCode (CLI)**: compatibility paths when the local CLI and auth are present.
- **Claude Code**: a coding agent surface routed through OMK lanes.
- **DeepSeek, Qwen, OpenRouter, MiMo, local LLM**: advisory/read/review lanes unless a tested contract grants more authority.
- **Kimi-compatible API/print lanes**: optional adapters, not the package identity.

Provider authority is not equal. See [provider maturity](../provider-maturity.md) before treating any lane as a write or merge authority.

## Example

```bash
omk provider list
omk do "add tests for the router" --provider auto --dry-run --json
```

## What this does not claim

Routing does not grant every adapter equal write/merge authority, and adapter health depends on local CLI and auth setup.

## Related

- [What is OMK?](../what-is-omk.md)
- [No-Kimi mode](no-kimi-mode.md)
- [Scoped MCP for coding agents](scoped-mcp-for-coding-agents.md)
