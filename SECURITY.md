# Security Policy

## Reporting Vulnerabilities

Please report security issues via GitHub Issues with the `security` label.

## Built-in Protections

open_multi-agent_kit includes scoped default hooks to block destructive commands and secret leakage when the active runtime/harness enables them.

## MCP and Harness Secret Handling

- Fresh init uses project scope by default: `omk-core-verified` treats project-local `omk-project` MCP as the baseline hint, while generated `.omk/mcp.json` / `.kimi/mcp.json` may stay minimal or empty until runtime materializes managed entries. User/global MCP and skills are runtime-only unless explicitly imported by a trusted local user.
- `--local-user`, `mcp_scope = "all"`, `skills_scope = "all"`, and `hooks_scope = "all"` are trusted local-user modes, not public fresh-init defaults.
- `.kimi` is the agent-facing runtime surface for provider-specific skills, MCP, and hooks; `.omk` is OMK runtime/evidence state. Do not treat the two generated trees as interchangeable.
- Never print, commit, or summarize MCP `env`, headers, tokens, or provider keys.
- Agent child execution inherits a minimal allowlist from the parent process and drops inherited secret-like keys. Explicit `env` / DAG `nodeEnv` remains trusted local input so runtime variables such as `KIMI_BIN`, `PATH`, `HOME`, and non-secret `OMK_*` values keep working; secret-like explicit keys emit warnings. Set `OMK_STRICT_KIMI_EXPLICIT_ENV=1` to drop secret-like explicit keys unless the local trusted session also sets `OMK_TRUST_KIMI_EXPLICIT_SECRET_ENV=1`.
- `omk image generate/edit` requires an OpenAI Platform project API key supplied as an ephemeral runtime env var such as `OPENAI_API_KEY`; Codex/ChatGPT OAuth tokens are never accepted as Images API credentials.
- Isolated agent HOME shell-profile bridging is off by default because sourcing user profiles can re-export secrets; enable it only in trusted local sessions with `OMK_ISOLATED_HOME_BRIDGE_SHELL_PROFILES=1`.
- Treat `chat-agent-harness.json` as private run metadata: use it for inventory/gates, but do not paste large inventories or secret-like values into prompts, memory, or reports.
- Prefer sanitized `omk mcp doctor --json`, `omk verify --json`, test summaries, and secret scans as shareable evidence.
- Run `npm run secret:scan:runtime` before release/demo when local `.omk` or `.kimi` trust-boundary files may contain user-added MCP wrappers or hook edits.

## Public Asset Provenance

- Treat `public/assets/**` as source-only reference material until license, source URL/origin, usage rights, reviewer, and review date are recorded.
- Do not move unlicensed or unprovenanced public assets into `readmeasset/`, `docs/assets/`, templates, `dist/`, or npm package contents.
- Package audit forbids `public/assets/**`; keep documentation assets in `readmeasset/` or `docs/assets/` only after provenance review.

## Best Practices

- Review hooks before running in production repositories.
- Use `--print` mode only in disposable worktrees.
- Never commit secrets into agent memory files.
