# Codex app / OAuth setup

OMK uses the official Codex app/CLI for Codex authentication. OMK does not store Codex login data, read `~/.codex/auth.json`, or print OAuth/session tokens.

## Recommended flow

1. Install or expose the official Codex CLI/app on `PATH`.
   ```bash
   codex --version
   ```
2. Complete the official Codex OAuth login.
   ```bash
   codex login
   ```
3. Ask OMK to guide or run the official login flow.
   ```bash
   omk codex auth --choice plus-pro --run
   omk provider doctor codex --soft
   ```
4. Import only safe Codex MCP server configuration when needed.
   ```bash
   omk mcp import-codex
   ```

## Policy

- OMK project configuration lives under `.omk/`.
- Codex-specific login state remains owned by the official Codex app/CLI.
- OMK may inspect Codex MCP server configuration, but secret-bearing `headers`, `env`, bearer values, and token files are not copied into project MCP config.
- Do not `cat` token/session files or paste OAuth values into logs.

## OpenAI Images API is separate

Codex/ChatGPT OAuth proves the Codex CLI login state only. It is not an OpenAI Platform API key.

`omk image generate` and `omk image edit`, including `--model gpt-image-2`, require a separate OpenAI Platform project API key supplied only at runtime.

```bash
OPENAI_API_KEY=<platform-project-key> omk image generate "OMK control-plane hero" --model gpt-image-2
```

You can also run the guided key setup instead of exporting the variable manually:

```bash
omk openai setup
```

Do not store the API key in project files; prefer environment variables or a user-local secret store.

See [`openai-platform-image-keys.md`](openai-platform-image-keys.md) for the one-shot key flow.

## Troubleshooting

- If `codex` is not found, install the official Codex CLI/app or add it to `PATH`.
- If login status is unclear, run `codex login`, then `omk provider doctor codex --soft`.
- If MCP import finds nothing, check whether your Codex config has importable MCP servers.

## Security principles

- Never print token/session files.
- OMK never reuses Codex OAuth values as OpenAI API bearer keys.
- In shared environments, keep per-provider authentication and project configuration separate.
