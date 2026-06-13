# OMK showcase

Short, honest demos for people deciding whether OMK is worth trying.

Each showcase should be either:

- a dry-run command that does not modify source files, or
- a verified proof bundle already checked by `npm run proof:check`.

## Start here

| Showcase | What it demonstrates | Verification boundary |
| --- | --- | --- |
| [Codex release-risk review](codex-release-risk/) | A 30-second dry-run shape for release-risk review: goal → DAG → evidence artifacts | Dry run only until the operator executes the compiled DAG |
| [Codex MCP evidence run](../codex-mcp-evidence-run/) | Project-scoped MCP setup plus evidence-gated DAG dry run | Example command, no source mutation expected |
| [Provider fallback](../provider-fallback/) | `--provider auto` routing with fallback planning | Example command, adapter health depends on local setup |
| [Evidence block proof](../../proof/verified-runs/006-evidence-block/proof-bundle.json) | OMK blocks completion when required evidence is missing | Local fixture proof checked by `npm run proof:check` |

## Rules for adding showcase entries

- Do not link demos with placeholder run reports.
- Do not claim provider authority unless a test or proof bundle covers it.
- Keep screenshots and logs out of git unless they are sanitized and reproducible.
- Prefer `.omk/runs/<run-id>/` artifact paths over narrative success claims.
