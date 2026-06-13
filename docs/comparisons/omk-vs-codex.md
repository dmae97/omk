# OMK vs Codex

## Short answer

Codex is a coding agent. OMK is a control plane that can run Codex as one provider lane with scoped authority, DAG orchestration, evidence gates, and replayable artifacts.

## Category difference

- **Codex**: executes coding tasks through the official Codex app/CLI.
- **OMK**: routes tasks across providers, scopes read/write/shell/merge authority, requires evidence before completion, and records replayable run artifacts.

## When to use which

- Use Codex when you want a direct coding assistant.
- Use OMK when you want to route across providers, restrict authority per task, and require evidence before marking work complete.

## How they work together

OMK delegates Codex auth to the official Codex app/CLI and never reads or prints `~/.codex/auth.json` tokens.

```bash
codex login
omk codex auth --choice plus-pro --run
omk provider doctor codex --soft
```

See [Codex OAuth setup](../codex-oauth-setup.md) and [provider routing](../use-cases/provider-routing-for-ai-coding.md).

## Related

- [What is OMK?](../what-is-omk.md)
- [OMK vs OpenCode](omk-vs-opencode.md)
- [OMK vs Claude Code](omk-vs-claude-code.md)
