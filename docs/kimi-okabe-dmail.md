# Kimi Okabe + D-Mail context recovery

open-multi-agent-kit exposes a Kimi adapter lane. Generated root and role agents inherit an Okabe-compatible base agent that keeps the default tools and adds Kimi's `SendDMail` tool.

## Why it matters

Okabe/D-Mail is the fast context-safety layer:

- use Okabe for smart context management instead of stuffing the main prompt with every detail;
- send D-Mail before risky refactors, dependency migrations, long-running multi-agent handoffs, or `/compact`;
- keep D-Mail notes short and future-facing so rollback/recovery knows the goal, changed files, tests, blockers, and next action.

Project-local ontology graph memory is the durable project/session memory layer. D-Mail is for checkpoint recovery; graph memory is for long-term recall. Embedded Kuzu remains available when Cypher-style graph queries are needed.

## Generated agent default

Official Kimi docs expose built-in `okabe` via `kimi --agent okabe`, and note `--agent` / `--agent-file` are mutually exclusive. Because OMK uses custom `--agent-file` configs, it ships an `okabe.yaml` base that extends `default` and adds `kimi_cli.tools.dmail:SendDMail`.


Generated `.omk/agents/*.yaml` files use:

```yaml
agent:
  extend: ./okabe.yaml  # Okabe-compatible base adds SendDMail/D-Mail checkpoints
```

## Recommended D-Mail shape

```txt
Goal:
Checkpoint reason:
Changed files:
Verification:
Blockers:
Next action:
Rollback note:
```

Do not put secrets in D-Mail. Store durable, non-secret project facts through `omk_write_memory`; inspect ontology recall through `omk_memory_mindmap` or `omk_graph_query`.

## References

- Kimi Code CLI Agents and Subagents: https://moonshotai.github.io/kimi-cli/en/customization/agents.html
- Kimi command agent flags: https://moonshotai.github.io/kimi-cli/en/reference/kimi-command.html
