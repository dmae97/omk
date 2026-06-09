# Provider maturity

This page documents provider status for the current source tree.

## Current source target

- Package version: `0.78.4`
- Runtime contract family: `v1.2`
- Release channel: `pre-1.0`

## Provider matrix

This table describes built-in source defaults. `omk provider list --json` also merges user-local provider configuration, so local output may include custom providers or changed enabled/configured flags.

| Provider | Default model / runtime | Routing role | Auth/config source | Current maturity |
| --- | --- | --- | --- | --- |
| Kimi | `kimi-k2.6` / `kimi-api` | Default coding authority and compatibility fallback | Provider/runtime config; no OMK-managed OAuth exchange | Most mature authority path. Still subject to API/key/runtime availability. |
| MiMo | `mimo-v2.5-pro` / `mimo-api` | Runtime provider for read/review/thinking lanes; advisory after authority downgrade in API runtime | `MIMO_API_KEY` | RC path. Do not claim direct workspace-write authority from the API runtime. |
| DeepSeek | `deepseek-v4-flash`, `deepseek-v4-pro` | Read/review/QA/research/advisory lanes; direct only for low-risk read-only routes | `DEEPSEEK_API_KEY` or user-local DeepSeek config | Mature enough for opportunistic advisory/read-only lanes; write, MCP, and merge authority stay with the authority provider. |
| Qwen | `qwen3-max` | Advisory/read/research/review/QA routes | `DASHSCOPE_API_KEY` | Configured provider path exists; broader release-gate coverage is still pending. |
| OpenRouter | `openrouter/auto` | Advisory/read/research/review/QA routes | `OPENROUTER_API_KEY`; provider-side BYOK/OAuth | Configured provider path exists; OMK records env-var metadata, not secret values. |
| Codex | `codex-cli` | External CLI provider for read/plan/review/advisory and explicit policy routes | Official Codex CLI login; OMK does not read token files | Compatibility path. MCP authority is not granted to Codex CLI routes. |
| OpenCode | `opencode-cli` | External CLI runtime for read/write/shell/patch/review when selected and available | External CLI auth/config | Compatibility path; availability depends on the local CLI. |
| CommandCode | `commandcode-cli` | External CLI runtime for read/write/shell/patch/review when selected and available | External CLI auth/config | Compatibility path; availability depends on the local CLI. |
| Local LLM | `qwen3-coder-30b-a3b` at `http://localhost:8080/v1` | Local OpenAI-compatible runtime | Local endpoint; optional `LOCAL_LLM_API_KEY` | Local preview path. API runtime rejects direct shell/tool-calling authority. |

## Routing rules to preserve

- OMK is the root orchestrator; individual providers are adapters or worker lanes.
- Authority/write/merge routes must stay with an authority-capable provider unless a tested contract grants another provider that authority.
- Advisory API runtimes must not be documented as direct workspace-write, shell, MCP, or merge authorities.
- Provider setup commands store environment variable names and metadata, not raw secret values.
- Optional provider lanes may skip or fall back depending on route criticality and failure type.

## Verification commands

```bash
npm run build:clean
node dist/cli.js provider list --json
node dist/cli.js provider doctor kimi --json --soft
node --test test/provider-routing.test.mjs test/runtime-router.test.mjs test/provider-tool-contracts.test.mjs
```

Run these before claiming provider-maturity changes are release-ready.
