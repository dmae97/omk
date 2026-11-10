# OMK gateway (local prototype)

OpenAI-compatible gateway in front of the official upstream API, for the `OMK` provider in omk.
**Local prototype only**: no deploy, no external users, no real upstream key in tests, billing off.
Spec: `specs/omk-gateway/spec.md`. Room decisions override the spec where they differ (see Deviations).

- Endpoints: `POST /v1/chat/completions` (stream and non-stream), `GET /v1/models`, `GET /v1/account`, `GET /healthz`.
  The client base URL includes `/v1` (for example `http://127.0.0.1:8787/v1`); the client appends `/chat/completions`.
- Public model IDs: `OMK/coder` (thinking off) and `OMK/reasoner` (thinking on). No third ID.
  The mapping to upstream models is a config table: `config/models.json`.
- Stack: Hono on Node + Postgres. The prototype defaults to PGlite (embedded Postgres, WASM): no external service, in-memory in tests. A real Postgres is optional via `OMK_GATEWAY_DATABASE_URL` (required before hosting, for race-safe monthly cap reservation).

## Run

```bash
cd gateway && npm ci
npm test                 # typecheck separately: npm run typecheck
npm run dev:mock         # gateway + mock upstream, in-memory DB, prints a one-time dev token
```

## Real Postgres (optional, required before hosting)

PGlite stays the default. To use a local Postgres (bind it to `127.0.0.1` only; do not commit the password):

```bash
# example: a throwaway local container, not a hosted database
docker run -d --name omk-gateway-pg --publish 127.0.0.1:5432:5432 \
  -e POSTGRES_USER=omk_gw -e POSTGRES_PASSWORD='<local-only>' -e POSTGRES_DB=omk_gateway \
  postgres:17

export OMK_GATEWAY_DATABASE_URL='postgres://omk_gw:<local-only>@127.0.0.1:5432/omk_gateway'
npm start                # uses the URL; PGlite pid lock is skipped
npm test                 # default suite still runs on PGlite; the cap-race test runs only when the URL is set
```

The cap-race test (`test/pg-race.test.ts`) is skipped unless `OMK_GATEWAY_DATABASE_URL` is set. It fires 50 concurrent requests against a tight monthly cap and asserts that reserved tokens never exceed the cap. Do not point this variable at a shared or hosted database.

`issue-key`, `revoke-key` and `reconcile` honor the same URL and can run while the server is up (Postgres is multi-connection). With PGlite they still require the server to be stopped.

Real local run (needs an official upstream key from the owner, never committed):

```bash
export <upstream key env var named in src/server.ts>=...   # read from the environment only, never logged
npm run issue-key -- --label alice --plan A [--expires-in-days 30]   # server stopped
npm start                # http://127.0.0.1:8787/v1
npm run revoke-key -- --key <key_id>
npm run reconcile -- --month 2026-11
```

Clients send the token as a Bearer credential. Headless clients read it from `OMK_ACCOUNT_TOKEN`.
A PGlite data dir is single-process: the CLI scripts refuse to run while the server holds it.

## Dev mock modes

`npm run dev:mock` serves the gateway at `http://127.0.0.1:8787/v1` in front of a local mock upstream.
The mock picks a response only from the request body (deterministic, no randomness). The default
non-stream JSON reply is unchanged. `$TOKEN` is the one-time dev token printed at startup.

| Trigger | Response |
|---|---|
| default (no `stream`, no `tools`) | non-stream JSON, content `mock reply` |
| `stream: true` on `OMK/coder` | SSE `chat.completion.chunk` content deltas, a final usage chunk, then `data: [DONE]` |
| `stream: true` on `OMK/reasoner` | same, plus `reasoning_content` deltas (`Let me think step by step.`) before the answer |
| `tools` present, no message with `role: "tool"` | a tool call: name = first tool's name (or `get_weather`), arguments `{"city":"Seoul"}`, id `call_1`, `finish_reason` `tool_calls`. SSE deltas if `stream: true` |
| a message with `role: "tool"` | a normal answer (`It's 18C and clear in Seoul.`). On the reasoner this is preceded by the same reasoning text. JSON or SSE |

```bash
# stream (coder)
curl -N http://127.0.0.1:8787/v1/chat/completions \
  -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"model":"OMK/coder","messages":[{"role":"user","content":"hi"}],"stream":true}'

# stream (reasoner): includes reasoning_content deltas
curl -N http://127.0.0.1:8787/v1/chat/completions \
  -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"model":"OMK/reasoner","messages":[{"role":"user","content":"hi"}],"stream":true}'

# tool call (non-stream)
curl http://127.0.0.1:8787/v1/chat/completions \
  -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"model":"OMK/coder","messages":[{"role":"user","content":"weather?"}],"tools":[{"type":"function","function":{"name":"get_weather","parameters":{"type":"object","properties":{"city":{"type":"string"}}}}}]}'

# follow-up after the tool result
curl http://127.0.0.1:8787/v1/chat/completions \
  -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"model":"OMK/coder","messages":[{"role":"user","content":"weather?"},{"role":"assistant","content":null,"tool_calls":[{"id":"call_1","type":"function","function":{"name":"get_weather","arguments":"{\"city\":\"Seoul\"}"}}]},{"role":"tool","tool_call_id":"call_1","content":"18C clear"}]}'
```

## Tokens

`omk` + `_test_` prefix (see `src/tokens.ts`) followed by 32 random alphanumerics (CSPRNG). Shown once at issuance,
stored as SHA-256 only, optional `expires_at`, no refresh. Logs keep only the first 8 characters of the token **hash**.
Revocation is a CLI action. There is no admin HTTP surface and no admin UI.

## Errors

OpenAI envelope `{error:{message,type,code,param}}`. 401 `token_missing|token_invalid|token_expired`;
403 `token_revoked|model_not_allowed`; 400 `thinking_required|image_input_unsupported|unsupported_feature|invalid_request|invalid_json`;
429 `quota_exceeded|request_limit_exceeded|rate_limited` (always an integer `Retry-After`; quota also sends
`x-omk-retryable: false` and `Retry-After` = seconds until the KST month start); 502/503 `upstream_unavailable`.

## Config (values are assumptions, not measurements)

| File | What |
|---|---|
| `config/models.json` | public ID -> upstream model, thinking mode, effort levels |
| `config/prices.json` | USD per 1M tokens, peak/off-peak, KST peak windows, holiday list (placeholder, empty) |
| `config/limits.json` | plan caps (A 5M, B 20M tokens/month, shared by both models), per-request ceilings, rpm, concurrency |
| `config/gateway.json` | upstream base URL, timeout, estimate ratio, feature flags |

`OMK_GATEWAY_CONFIG_DIR` points the server at another config dir. Switching the reasoner to the larger upstream model is a one-line edit in `models.json`.

## Metering

One immutable `usage_events` row per request that reached upstream: hit, miss, completion and reasoning tokens
(read verbatim from upstream `usage`), timestamp, `peak` by request START in KST (Mon-Fri 10-13 and 15-19, end exclusive).
User-billed cost is always at the peak price; the upstream cost uses the peak flag. Costs are integer nano-USD
(USD per 1M tokens equals nano-USD per token, so the math is exact).
A stream that ends or is aborted without `usage` gets `estimated=true`: input is estimated from the request body (4 chars per token, all priced as cache miss) and output from the text received. It is never the reserved maximum, and reconciliation reports estimated rows separately.
`npm run reconcile` reports exact and estimated rows separately.
Polar: `polar_outbox` rows only, deduplicated by `external_id`. No network call anywhere.

## Deviations from the spec text

See the report that accompanies the commit; the short list is in `DEVIATIONS.md`.
