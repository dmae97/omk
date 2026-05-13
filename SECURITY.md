# Security Policy

## Reporting Vulnerabilities

Please report security issues via GitHub Issues with the `security` label.

## Built-in Protections

oh-my-kimi includes default hooks to block destructive commands and secret leakage.

## MCP and Harness Secret Handling

- Fresh init writes project-local `omk-project` MCP only; user/global MCP and skills are runtime-only unless explicitly imported by a trusted local user.
- Never print, commit, or summarize MCP `env`, headers, tokens, or provider keys.
- Treat `chat-agent-harness.json` as private run metadata: use it for inventory/gates, but do not paste large inventories or secret-like values into prompts, memory, or reports.
- Prefer sanitized `omk mcp doctor --json`, `omk verify --json`, test summaries, and secret scans as shareable evidence.

## Best Practices

- Review hooks before running in production repositories.
- Use `--print` mode only in disposable worktrees.
- Never commit secrets into agent memory files.
