# Adaptorch Integration

Adaptorch is OMK's optional topology-routing and adaptive-synthesis companion. OMK ships a pure TypeScript Adaptorch-style topology router by default, so DAG composition works without any external service. If an Adaptorch MCP server is configured locally, OMK can also route MCP-aware lanes through that server in trusted local-user scope.

## Runtime Modes

- **Built-in router**: enabled unless `OMK_ADAPTORCH_ROUTING=off|0|false`.
- **MCP bridge**: trusted local config from `~/.omk/agent/mcp.json`, `~/.omk/mcp.json`, or `~/.kimi/mcp.json` is active only when `OMK_MCP_SCOPE=all` or after importing a reviewed server into project `.kimi/mcp.json`.
- **Typo alias**: `adptorch` is accepted by `omk mcp add/remove/test` and maps to `adaptorch`.

## Enable From Existing Global Agent Config

If your Adaptorch MCP entry already exists in `~/.omk/agent/mcp.json`:

```bash
omk mcp list
OMK_MCP_SCOPE=all omk mcp list
omk mcp add adaptorch      # or: omk mcp add adptorch
omk mcp test adaptorch
```

`omk mcp add adaptorch` copies a sanitized server definition into project `.kimi/mcp.json`. Secret-like env values are stored as runtime placeholders such as `${ADAPTORCH_CONTROL_PLANE_TOKEN}` rather than literal secrets.

## Direct Project Install

Use this only after reviewing the launcher path and secret handling:

```bash
omk mcp install adaptorch bash /absolute/path/to/run_adaptorch_mcp.sh \
  --env ADAPTORCH_CONTROL_PLANE_BASE_URL=http://127.0.0.1:8080 \
  --env ADAPTORCH_CONTROL_PLANE_TOKEN='${ADAPTORCH_CONTROL_PLANE_TOKEN}'
```

Then verify:

```bash
omk mcp doctor
omk mcp test adaptorch
OMK_MCP_SCOPE=all omk chat "plan this DAG with adaptorch routing"
```

## Safety Notes

- Do not commit real Adaptorch tokens, headers, or `.env.local` files.
- Keep production `adaptorch-prod` in global/user config unless the project explicitly requires it.
- Prefer project import for reproducible local runs; prefer `OMK_MCP_SCOPE=all` only for trusted local operator sessions.
