# OMK vs Claude Code

## Short answer

Claude Code is a coding agent. OMK is a control plane that can run Claude Code as one provider lane with scoped authority, DAG orchestration, evidence gates, and replayable artifacts.

## Category difference

- **Claude Code**: executes coding tasks as a single-agent assistant.
- **OMK**: routes tasks across providers, scopes read/write/shell/merge authority, requires evidence before completion, and records replayable run artifacts.

## When to use which

- Use Claude Code when you want a direct coding assistant.
- Use OMK when you want multi-provider routing, per-task authority, and verifiable completion across agents in the same repository.

## How they work together

Claude Code can act as a coding agent surface inside an OMK lane while OMK keeps routing, authority, and evidence explicit.

```bash
omk do "review this repo for release risk" --dry-run --json
```

See [evidence-gated coding agents](../use-cases/evidence-gated-coding-agents.md).

## Related

- [What is OMK?](../what-is-omk.md)
- [OMK vs Codex](omk-vs-codex.md)
- [OMK vs OpenCode](omk-vs-opencode.md)
