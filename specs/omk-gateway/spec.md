# Spec: OMK gateway (OpenAI-compatible server behind the `omk` provider)

Status: draft v1, design and local prototype only. No deployment, no external users.
Branch: `feat/omk-provider-gateway` (based on `origin/feat/omk-provider` = `ea03fcf`, omk 1.5.11).
Owner decision needed from 근빈: see [Open questions](#10-open-questions).

> **Legal gate (PM, 2026-11-11).** Resale is ON HOLD until DeepSeek gives written
> permission (Terms of Use 3.6(4): no selling or sublicensing without permission;
> Open Platform 5.2: the "DeepSeek" name may not be used). Until then: internal test keys
> only, no paying or external users, Polar is design and estimate only (no live Polar
> calls), and the upstream brand must not appear in any selling context (section 7).

Fetch date for every GitHub figure below: **2026-11-10T16:56Z (2026-11-11 01:56 KST)**.
Docs pages were read on 2026-11-11 KST between 01:57 and 02:00.
Numbers are quoted as the GitHub API or the docs page returned them.

## 1. What the client expects (omk 1.5.11, tag `ea03fcf`)

There is **no `omk` provider in the repo yet**. A GitHub search of `dmae97/omk` for
"gateway" and "polar" found no matching provider code or spec. The only related hits are
the unrelated issue/PR titles #8, #288, #297. The closest existing code is the native
`deepseek` provider, which the gateway must be wire-compatible with.

| Topic | What the client does | File |
|---|---|---|
| Wire API | `openai-completions` (Chat Completions, `stream: true`) | `packages/ai/src/providers/openai-completions.ts` (`buildParams`, ~L505-640) |
| Native DeepSeek models | `deepseek-flash`, `deepseek-v4-flash` (legacy alias), `deepseek-v4-pro`; base URL `https://api.deepseek.com`; `maxTokensField: "max_tokens"` | `packages/ai/scripts/catalog-deepseek.ts`; `packages/ai/src/models.generated.ts` (`"deepseek"` block ~L9427) |
| Env key | `DEEPSEEK_API_KEY` | `packages/ai/src/env-api-keys.ts:122` |
| Auth header | SDK default `Authorization: Bearer <apiKey>`; custom providers may also set `headers` or `authHeader: true` | `packages/coding-agent/docs/models.md` (L159-216) |
| Custom provider config | `models.json` with `baseUrl`, `apiKey` (`$ENV`, `!cmd`, literal), `api`, `compat`, per-model `cost`, `thinkingLevelMap` | `packages/coding-agent/docs/models.md`, `docs/custom-provider.md` |
| Streaming usage | Sends `stream_options: { include_usage: true }` when `compat.supportsUsageInStreaming !== false` (default true). Reads `chunk.usage` (also `choice.usage` fallback) | `openai-completions.ts` L282-292, L526-528 |
| Usage fields read | `prompt_tokens`, `completion_tokens`, `total_tokens`, `prompt_cache_hit_tokens` **or** `prompt_tokens_details.cached_tokens`, `prompt_tokens_details.cache_write_tokens`, `completion_tokens_details.reasoning_tokens` | `packages/ai/src/providers/openai-completions-usage.ts` |
| Usage math | `input = prompt - cacheRead - cacheWrite`; `output = completion_tokens` (reasoning is **not** added again, except xAI) | same file |
| Thinking toggle (see 1.1) | `thinking: {type: "enabled"\|"disabled"}` (always sent for `reasoning: true` models) and `reasoning_effort` (only when a level is set and `supportsReasoningEffort`); a `reasoning: false` model sends **neither** | `packages/ai/src/providers/openai-completions.ts:586-591` (Provider Engineer map, PROVIDER_MAP.md §4) |
| Reasoning replay | assistant messages are replayed with `reasoning_content` (empty string if none) when `requiresReasoningContentOnAssistantMessages` | `openai-completions.ts` L946-950; `openai-completions-compat.ts` L87 |
| Stream reasoning field | reads `reasoning_content` (then `reasoning`, `reasoning_text`) from deltas | `openai-completions.ts` L320-340 |
| Compat auto-detect | keyed on `provider === "deepseek"` or `baseUrl.includes("deepseek.com")`. **A gateway on another host gets none of it** and needs explicit `compat` | `openai-completions-compat.ts` L46, L65-91 |
| Harness gating | `deepseek_harness` triggers only on native `deepseek` provider or DeepSeek-pattern model IDs; `OMK/coder` will **not** match | `packages/coding-agent/src/core/deepseek-harness.ts`, `docs/deepseek-harness.md` |
| Provider env | PM: `OMK_PROVIDER_OMK=1` enables, `OMK_GATEWAY_BASE_URL` overrides the base URL, headless token env `OMK_ACCOUNT_TOKEN`, sent as `Authorization: Bearer <omk token>`. None of `OMK_PROVIDER_*`, `OMK_GATEWAY_*`, `OMK_ACCOUNT_*` exist in the repo today | Provider Engineer's read-only map `/workspace/omk-provider-map/PROVIDER_MAP.md` (§ env, §4) |

### 1.1 Thinking parameter the existing provider sends to `deepseek-flash`

From `buildParams` (`thinkingFormat === "deepseek"`) and the catalog map
`thinkingLevelMap: {"minimal":null,"low":"low","medium":null,"high":"high","xhigh":null,"max":"max"}`
(`models.generated.ts`, `catalog-thinking.ts` L80):

```jsonc
// thinking OFF (no reasoningEffort selected)
{ "model": "...", "stream": true, "stream_options": {"include_usage": true},
  "max_tokens": N, "thinking": {"type": "disabled"} }
// thinking ON
{ "...": "...", "thinking": {"type": "enabled"}, "reasoning_effort": "low" | "high" | "max" }
```

`reasoning_effort` is only sent when thinking is on and `supportsReasoningEffort` is true.
Levels with `null` in the map (minimal/medium/xhigh) are not offered in the UI.
**The gateway must accept and forward exactly `thinking` and `reasoning_effort`, plus
`max_tokens`, `stream_options.include_usage`, `tools`, `tool_choice`, `temperature`, and
assistant-message `reasoning_content`** (DeepSeek returns 400 on a tools request that drops
`reasoning_content`: Thinking Mode guide). Upstream default when `thinking` is omitted is
thinking enabled at effort `high`, so the gateway must set an explicit value (section 6).

Required client config (sketch for the Provider Engineer; `compat` must be explicit because
auto-detect only fires for `provider === "deepseek"` or a `deepseek.com` base URL):

```json
{ "providers": { "OMK": {
  "baseUrl": "$OMK_GATEWAY_BASE_URL",           // includes /v1; SDK appends /chat/completions
  "apiKey":  "$OMK_ACCOUNT_TOKEN", "api": "openai-completions",
  "compat": { "requiresReasoningContentOnAssistantMessages": true, "thinkingFormat": "deepseek",
              "maxTokensField": "max_tokens", "supportsReasoningEffort": true,
              "supportsUsageInStreaming": true, "supportsStore": false,
              "supportsDeveloperRole": false },
  "models": [
    { "id": "OMK/coder",    "reasoning": false, "input": ["text"], "contextWindow": 1000000, "maxTokens": 32768 },
    { "id": "OMK/reasoner", "reasoning": true,  "input": ["text"], "contextWindow": 1000000, "maxTokens": 32768,
      "thinkingLevelMap": {"minimal":null,"low":"low","medium":null,"high":"high","xhigh":null,"max":"max"} }
  ] } } }
```

Values here are placeholders. `maxTokens`/`contextWindow` come from the Pricing Analyst's caps.
The slash in model ID `OMK/coder` has not been checked against omk's `--model provider/id`
parser (open question Q7).

## 1A. Client contract: proposed v0, confirm 11/12

Answers the Provider Engineer's open questions 1, 2, 4, 6 (PROVIDER_MAP.md, "Open questions")
using the PM decisions of 2026-11-11. Everything here is **proposed v0 until 11/12**.

**Q1. Base URL shape.** `OMK_GATEWAY_BASE_URL` **includes `/v1`** (for example
`https://<gateway-host>/v1`). The client (OpenAI SDK) appends `/chat/completions`, so the gateway
serves `POST {base}/chat/completions` and `GET {base}/models`. No trailing slash. The client trims one if present.

**Q2. Token.**
- Format `omk_test_<32 random chars>` (alphabet `[A-Za-z0-9]`, from a CSPRNG). The prefix is a fixed
  string so secret scanners and log redaction can match it. Stored **hashed only** (SHA-256) plus last 4 characters.
  Shown once at issuance. Never logged, never returned again.
- **No refresh in v1.** No OAuth, no refresh endpoint. The client stores the token as a plain `apiKey`
  (no `oauth` block), so there is nothing to refresh.
- **Optional expiry** (`expires_at`, set by the admin at issuance; default none for internal test tokens).
  After expiry: `401 token_expired`. Renewal = admin issues a new token; the old one stays dead.
  Revocation (admin action) = `403 token_revoked`.
- How a user gets one: v1 = issued by an admin out of band (`POST /admin/keys`), pasted into `/login`
  or exported as the headless env var **`OMK_ACCOUNT_TOKEN`**. A self-serve URL for `/login` to display is not part of v1.
- Account label for the client UI: optional `GET /v1/account` (Bearer) returning
  `{ "id": "...", "label": "...", "expires_at": null | "ISO-8601", "quota": { "monthly_token_cap": n, "used": n, "resets_at": "ISO-8601 KST" } }`.
  Proposed; the client may skip it and show a local label.
- Header: `Authorization: Bearer <token>` only. No other auth header.

**Q4. Thinking and model exposure.**
- Gateway passes through `thinking`, `reasoning_effort`, `max_tokens`, `stream_options`, `tools`, `tool_choice`,
  `temperature`/`top_p`, `response_format`, `stop`, assistant-message `reasoning_content`, and returns
  `reasoning_content` in messages and stream deltas, **after** applying the per-model rules below.
- `OMK/reasoner`: thinking **forced on**. `thinking: {type:"enabled"}` or absent is accepted;
  `thinking: {type:"disabled"}` (what the client sends for level `off`, because `getSupportedThinkingLevels`
  always offers `off` for `reasoning: true`) -> **400 `thinking_required`** with message
  "OMK/reasoner always uses thinking. Use OMK/coder for non-thinking requests." `reasoning_effort` is limited to
  `low|high|max` and is capped by `reasoner_max_effort` (section 6).
- `OMK/coder`: thinking **forced off**. Any client-sent `thinking`/`reasoning_effort` is dropped and upstream
  always receives `thinking: {type:"disabled"}`. The upstream default when `thinking` is omitted is thinking ON
  (docs: when `thinking` and `reasoning_effort` are both omitted, thinking is enabled), so the gateway must set it explicitly.
  A `reasoning: false` client model sends neither field (PROVIDER_MAP.md §4), which is why this is required.
- Exposed model IDs in v1: **only `OMK/coder` and `OMK/reasoner`.** `deepseek-v4-pro` is reachable only as a
  config change of the `OMK/reasoner` row (T-05); there is no third public ID.
- **Text-only.** Both models advertise `input_modalities: ["text"]`. A request containing `image_url` or `file`
  content parts -> **400 `image_input_unsupported`**. (Upstream `deepseek-flash` supports vision and `deepseek-v4-pro`
  does not, per the pricing page; PM chose text-only for v1 so the mapping can switch to v4-pro without a behavior change.)
- **FIM / prefix completion blocked on `OMK/reasoner`.** DeepSeek documents FIM (Beta) as non-thinking only
  and Chat Prefix Completion (Beta, assistant `prefix: true`) on the `/beta` base URL. The gateway exposes neither
  `/v1/completions` nor `/beta`. A `prefix: true` assistant message on `OMK/reasoner` -> **400 `unsupported_feature`**
  ("Prefix/FIM completion is not available with thinking models"). Behind a config flag `features.fim`
  (default off) the coder row may allow it later; v1 ships it off for both. A plain assistant `reasoning_content`
  replay (tools requests) is **not** blocked.
- `/v1/models` entries (values from the DeepSeek official docs, read 2026-11-11, `deepseek-flash` column; the
  pricing page shows one merged cell for context and max output across both models):

```json
{ "object": "list", "data": [
  { "id": "OMK/coder",    "object": "model", "owned_by": "omk",
    "omk": { "context_length": 1000000, "max_output_tokens": 393216, "input_modalities": ["text"],
             "thinking": "off", "tools": true, "json_mode": true } },
  { "id": "OMK/reasoner", "object": "model", "owned_by": "omk",
    "omk": { "context_length": 1000000, "max_output_tokens": 393216, "input_modalities": ["text"],
             "thinking": "always", "reasoning_effort": ["low","high","max"], "tools": true, "json_mode": true } } ] }
```

  The docs state max output as "384K" (pricing page) and `393216` (Chat Completions reference); the omk
  client catalog uses `384000` (`catalog-deepseek.ts`). The gateway's own per-request ceiling (section 6) is far lower and is
  what `max_tokens` is checked against; the models endpoint also reports it as `omk.max_tokens_ceiling` once the Pricing Analyst sets it.
  **v4-pro context and max output are an assumption** (merged docs cell); verify with a real call later.

**Q6. Error contract.** All errors use the OpenAI envelope `{"error": {"message": "...", "type": "...", "code": "..."}}`
(`param` optional). `message` is human-readable, brand-free, and never contains a token.

| HTTP | `code` | `type` | When | `Retry-After` |
|---|---|---|---|---|
| 401 | `token_missing` | `authentication_error` | no `Authorization` header | no |
| 401 | `token_invalid` | `authentication_error` | unknown or malformed token | no |
| 401 | `token_expired` | `authentication_error` | past `expires_at` | no |
| 403 | `token_revoked` | `permission_error` | revoked by admin | no |
| 403 | `model_not_allowed` | `permission_error` | model not in the user's allow-list (also unknown model ID) | no |
| 400 | `thinking_required` | `invalid_request_error` | `OMK/reasoner` with `thinking: disabled` | no |
| 400 | `image_input_unsupported` | `invalid_request_error` | image or file content part | no |
| 400 | `unsupported_feature` | `invalid_request_error` | FIM / `prefix: true` on `OMK/reasoner` | no |
| 429 | `quota_exceeded` | `rate_limit_error` | monthly token or cost cap reached | **seconds until the monthly reset (KST month start)** |
| 429 | `request_limit_exceeded` | `rate_limit_error` | per-request limits: `max_tokens` ceiling, `reasoning_effort` above allowed, reserved budget > remaining | seconds until the cap could pass (0 if the client must change the request; never omitted) |
| 429 | `rate_limited` | `rate_limit_error` | requests/min or concurrency per key (or neutral mapping of an upstream 429) | seconds, from the limiter |
| 502/503 | `upstream_unavailable` | `api_error` | upstream error/timeout, mapped neutrally | when known |

`Retry-After` is **always present on every 429, as an integer number of seconds**. Over-cap 429 bodies name the cap,
current value, limit and the fix, as in section 6.

Client implications to confirm with the Provider Engineer: (a) the client's provider-retry retries 429 (PROVIDER_MAP.md
§ error mapping), but `quota_exceeded` and `request_limit_exceeded` are not transient; the gateway also sends
`x-omk-retryable: false` on those and the client should not auto-retry them (otherwise `Retry-After` can be days);
(b) the client should classify by `error.code`, not by message text.

## 2. Upstream facts (DeepSeek official docs, read 2026-11-11)

Sources: [Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing),
[Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion),
[Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode),
[Rate Limit & Isolation](https://api-docs.deepseek.com/quick_start/rate_limit).

- Current model names: `deepseek-flash` (DeepSeek-V4.1-Flash-1017) and `deepseek-v4-pro`
  (DeepSeek-V4-Pro-0813). Legacy `deepseek-v4-flash` is accepted and served by the Flash model.
  The chat-completion `model` enum lists only `deepseek-flash`, `deepseek-v4-pro`.
  **`deepseek-chat` and `deepseek-reasoner` are never used in this project** (Pricing Analyst:
  deprecated; retirement announced 2026-07-24). A CI grep guard enforces this (T-14).
- Base URL `https://api.deepseek.com`; context 1M; max output 384K (393216).
- Price table, USD per 1M tokens (page values):

| Model | Hit peak | Hit off-peak | Miss peak | Miss off-peak | Out peak | Out off-peak |
|---|---|---|---|---|---|---|
| deepseek-flash | 0.006 | 0.003 | 0.3 | 0.15 | 1.2 | 0.6 |
| deepseek-v4-pro | 0.044 | 0.022 | 1.32 | 0.66 | 3.96 | 1.98 |

- Peak = 01:00-04:00 and 06:00-10:00 UTC, Mon-Fri, excluding Chinese public holidays; all else
  off-peak. In KST (UTC+9, no date rollover for these windows) that is **10:00-13:00 and
  15:00-19:00 KST Mon-Fri**, matching the Pricing Analyst's numbers. Holiday calendar needs a config list.
- Usage object (non-stream and last stream chunk): `prompt_tokens` (= hit + miss),
  `prompt_cache_hit_tokens`, `prompt_cache_miss_tokens`, `prompt_tokens_details.cached_tokens`
  (same as hit), `completion_tokens`, `total_tokens` (prompt + completion),
  `completion_tokens_details.reasoning_tokens`.
- **Thinking tokens:** reported as `completion_tokens_details.reasoning_tokens`, documented as a
  "breakdown of tokens used in a completion". The doc's example response omits it
  (non-thinking sample). Docs do not state explicitly that `completion_tokens` includes it, but the
  "breakdown" wording, `total_tokens = prompt + completion`, and omk's own math all treat it as included.
  So metering records `completion_tokens` as billed output (single charge at the output rate),
  `reasoning_tokens` as its thinking part, and `answer_tokens = completion - reasoning`.
  **The first real 20-request run must confirm this** (T-01 invariant, R-real in section 9).
- Stream: usage rides on the **last content chunk** (non-null `finish_reason`), then `data: [DONE]`;
  no separate usage-only chunk. `finish_reason` can be `stop|length|content_filter|tool_calls|insufficient_system_resource|aborted`.
  Keep-alive: blank lines (non-stream) or `: keep-alive` SSE comments.
- Account-level concurrency limit regardless of API key: 2500 (flash), 500 (pro); excess gets HTTP 429.
  `user_id` request param isolates KV cache and scheduling per end user (and gets a per-`user_id` limit
  on accounts with raised quotas).
- Thinking can be driven by `thinking.type` and `reasoning_effort` (`low|high|max`; minimal->low,
  medium/xhigh->high). Default max output when unset: 8K non-thinking, 64K thinking (128K at `max`).

## 3. Gateway candidates compared

GitHub API data fetched 2026-11-10T16:56Z. "Last commit" = latest commit on default branch
(`commits?per_page=1`). "pushed_at" is the repo field. Release = `releases/latest`.

| | **one-hub** [MartialBE/one-hub](https://github.com/MartialBE/one-hub) | **new-api** [QuantumNous/new-api](https://github.com/QuantumNous/new-api) | **LiteLLM proxy** [BerriAI/litellm](https://github.com/BerriAI/litellm) | **one-api** [songquanpeng/one-api](https://github.com/songquanpeng/one-api) | **Custom** (Hono + Postgres) |
|---|---|---|---|---|---|
| License (GitHub SPDX) | `Apache-2.0` (LICENSE file is Apache 2.0 text) | `AGPL-3.0` (LICENSE = GNU AGPL v3) + NOTICE with extra Section 7 terms | `NOASSERTION`. LICENSE: MIT except `enterprise/` under a separate commercial license | `MIT` | ours (Hono: `MIT`) |
| Implication | Permissive; keep license/NOTICE | Network use of a modified version must offer source to remote users (AGPL s13). NOTICE requires UI attribution "Frontend design and development by New API contributors." + link. **Do not copy code** (PM). | OSS core is MIT. `enterprise/LICENSE.md`: production use needs a BerriAI subscription. Docs: SSO/audit/RBAC/secret managers are enterprise; virtual keys, budgets, rate limits, spend tracking, admin UI are OSS | Permissive | none |
| Stars | 2901 | 51701 | 63049 | 37397 | n/a |
| Last commit | 2026-02-19T21:11:53Z | 2026-11-10T13:44:17Z | 2026-11-10T16:55:08Z | 2025-02-21T11:30:16Z (pushed_at 2026-01-09T03:26:43Z) | n/a |
| Latest release | v0.14.27, 2025-12-06T07:26:25Z | v1.0.0-rc.49, 2026-11-08T05:06:38Z | v1.108.4, 2026-11-09T23:00:51Z | v0.6.10, 2025-02-02T12:29:38Z | n/a |
| Language / DB | Go; gorm drivers: mysql, postgres, sqlite (go.mod); Redis code present | Go | Python; Postgres required for keys/spend (docs); Redis for multi-instance limits | JS/Go | TS; Postgres (+ optional Redis) |
| DeepSeek | native channel `providers/deepseek` (wraps OpenAI provider, base `https://api.deepseek.com`) | not checked in depth | documented; docs list `deepseek-flash`, `deepseek-v4-pro`; applies off-peak pricing automatically (UTC) per its docs | not checked | by design |
| Per-user key issuance | yes: `model/token.go`, `controller/token.go`, user groups | yes (tokenkit/) | virtual keys (OSS) | yes | build |
| Usage metering | Log row: prompt_tokens, completion_tokens, quota, metadata JSON. `types/common.go` maps `cached_tokens` and `reasoning_tokens` to "extra tokens" with price ratios; extra tokens + ratios written into log metadata (`relay/relay_util/quota.go` ~L226-231). Billing unit is integer **quota**, not tokens. Hit/miss split is derivable (prompt - cached); thinking is priced via ratio, so no separate peak/off-peak cost or exact `prompt_cache_miss_tokens` column | not evaluated | spend tracking incl. cache cost; schema in `schema.prisma` | basic | exact columns we need |
| Rate limits/quotas | token/sliding-window limiters in `common/limit/`, per-user quota | present | budgets, tpm/rpm (OSS) | basic | build (in-memory + PG) |
| Polar mapping | **none found**: repo has payment gateways alipay/epay/stripe/wxpay only (tree search for "polar" = no hits). Needs a sidecar that reads the log table | none checked | none checked (callbacks exist) | none | outbox -> Polar events API |
| Name scrub / response rewrite | channel model mapping exists, but scrubbing error text/headers/`/v1/models` is unverified | not verified | not verified | not verified | first-class |
| Ops weight | single Go binary + DB, built-in admin UI (Chinese-market features: epay/alipay/wxpay) | similar | docs recommend 1 vCPU + 4Gi per worker; Postgres required; Redis from 2+ instances | n/a | 1 small Node service + PG |
| Maintenance risk | **no commits since 2026-02-19** (about 8.7 months before fetch) | very active | very active | **stale** (last commit 2025-02-21, last release 2025-02-02) | ours |

Other candidates seen (only license/date fields fetched; features **not evaluated**):

| Repo | SPDX | Stars | Last commit | Latest release | Note |
|---|---|---|---|---|---|
| [Portkey-AI/gateway](https://github.com/Portkey-AI/gateway) | MIT | 13361 | 2026-05-25T13:54:51Z | v1.15.2, 2026-01-12T08:46:07Z | TypeScript; not evaluated |
| [maximhq/bifrost](https://github.com/maximhq/bifrost) | Apache-2.0 | 9477 | 2026-11-10T16:25:18Z | ent-v2.5.1-base, 2026-11-10T15:07:06Z | Go; not evaluated |
| [Helicone/ai-gateway](https://github.com/Helicone/ai-gateway) | GPL-3.0 | 644 | 2025-11-21T01:25:55Z | none (404) | stale, GPL; reject |

Hono: [honojs/hono](https://github.com/honojs/hono), `MIT`, 32900 stars, pushed_at 2026-11-07T11:54:30Z.

### 3.1 Hard requirements vs candidates

Requirements that decide this (PM + QA): exact per-request reconciliation with separate
hit/miss/thinking columns; peak/off-peak cost per request; response `model` rewrite to
`OMK/*` and an upstream-name scrub of errors/headers/`/v1/models`; HTTP 429 with guidance on
monthly cap and reasoner caps; monthly caps in KST; no keys in logs; Polar event outbox.

- **one-hub** covers keys, quota, limits, and a DeepSeek channel. Its accounting is integer quota with
  ratios, so the fields above would have to be re-derived from log metadata, and the scrub/429-guidance
  behavior is unverified. Hard fact against it: no commit since 2026-02-19.
- **new-api**: strongest activity, but AGPL-3.0 plus attribution terms; excluded as a base by PM
  (no code reuse). Fine as a behavioral reference only.
- **LiteLLM**: OSS tier already has virtual keys, budgets, rate limits, spend tracking and DeepSeek
  support. Heavy (Python, Prisma/Postgres, 4Gi/worker guidance), repo has a commercial `enterprise/` dir
  (avoid it; features we need are claimed OSS in its docs, **verify before relying on it**), and
  response-rewrite/scrub would still be custom callback code.
- **one-api**: stalled; reject.

## 4. Recommendation

Build a **small custom gateway (Hono + Postgres, optional Redis)** for the 11/14 prototype, and keep
**one-hub as the runner-up** (Apache-2.0, can be run locally as a comparison/fallback if 근빈 wants an
admin UI and top-up flows). Reasons (my judgment from the facts above, not a measured result): the
decisive requirements are exact token columns, per-request cost with a KST peak window, upstream-name
scrubbing and Polar events; those are the parts we would have to bolt onto one-hub (whose last
commit is 2026-02-19), while the proxy path itself (auth, SSE tap, usage capture, caps) is small. new-api
is excluded by license/PM rule, one-api by staleness, LiteLLM by weight plus the enterprise-dir risk.
This is a recommendation for 근빈 to confirm (Q1), not a settled decision.

Spike to de-risk before committing: run one-hub locally with a DeepSeek channel and the mock upstream
(section 9) for half a day and check whether the 20 mock requests reconcile 100% and whether the scrub
tests are reachable by config. If yes, switching to one-hub is a defensible alternative.

## 5. Architecture sketch (custom build)

```
omk client --Bearer omk_...--> [ gateway (Hono, Node) ] --Bearer <upstream key>--> official upstream API
                                 | auth + limits + caps      (base URL from config; mock in CI)
                                 | model map (config table)
                                 | SSE tap: rewrite `model`, capture usage
                                 v
                              Postgres: users, api_keys, usage_events, usage_monthly,
                                        price_table, polar_outbox
                              (Redis optional: only for multi-instance rate limits)
                                 |
                                 +--> Polar worker (OFF until permission): outbox -> events API
```

Endpoints: `POST /v1/chat/completions` (stream and non-stream), `GET /v1/models` (only `OMK/*`),
`GET /healthz`, admin-only `POST /admin/users`, `POST /admin/keys`, `DELETE /admin/keys/:id`,
`GET /admin/usage`. No other upstream surface is proxied.

**Auth.** `Authorization: Bearer omk_test_<32 random chars>` (see 1A). Store only SHA-256 of the token
plus last 4 chars. The upstream API key is read from an env var (set through Railway/secret input),
never stored in the DB, never logged. One official upstream account/key (no multi-account pooling, no
rotation across accounts to dodge limits).

**Model map (config table, no code change to switch):**

```yaml
models:
  "OMK/coder":    { upstream: "deepseek-flash",  thinking: "disabled" }
  "OMK/reasoner": { upstream: "deepseek-flash",  thinking: "enabled", max_effort: "high" }
  # switching the reasoner to the larger model is config-only:
  # "OMK/reasoner": { upstream: "deepseek-v4-pro", thinking: "enabled", max_effort: "high" }
```

The gateway always sends an explicit `thinking` value to upstream (never relies on the upstream default).
For `OMK/coder` it forces `thinking: {type: "disabled"}` and drops `reasoning_effort`. For `OMK/reasoner`
it forces `thinking: {type: "enabled"}` (a client `disabled` is a 400 `thinking_required`) and validates `reasoning_effort` (section 6).

**Price table (config, versioned, not code):**

```yaml
price_table_version: 2026-11-11
models:
  deepseek-flash:  { peak: {hit: 0.006, miss: 0.30, out: 1.20}, offpeak: {hit: 0.003, miss: 0.15, out: 0.60} }
  deepseek-v4-pro: { peak: {hit: 0.044, miss: 1.32, out: 3.96}, offpeak: {hit: 0.022, miss: 0.66, out: 1.98} }
peak_windows_kst: { days: [Mon,Tue,Wed,Thu,Fri], hours: ["10:00-13:00", "15:00-19:00"] }
holidays_off_peak: []     # Chinese public holiday dates, maintained by hand
billing_instant: request_end   # open question Q5: request start vs end
```

**Request flow.** 1) auth key -> user; 2) validate body, apply model map; 3) check monthly cap and
per-request caps (429 on breach, no upstream call); 4) reserve `max_tokens` against the monthly budget;
5) call upstream with `stream_options.include_usage = true` forced; pass `user_id = <opaque per-user id>`
(letters/digits/_/- only, no email or PII, per upstream docs); 6) stream bytes through, parsing each
`data:` JSON line only to rewrite `model` and capture usage, forward everything else untouched
(including `reasoning_content`, `tool_calls`, `: keep-alive`); 7) on completion write one immutable
`usage_events` row and settle the reservation; 8) enqueue a Polar outbox row (flag-gated, off by default).

**Metering row (`usage_events`, one per upstream attempt that returns usage):**
`id, user_id, key_id, request_id, ts_start, ts_end, model_public, model_upstream, stream,
prompt_tokens, cache_hit_tokens, cache_miss_tokens, completion_tokens, reasoning_tokens,
answer_tokens (= completion - reasoning), total_tokens, finish_reason, peak (bool), price_table_version,
cost_usd_micros (computed), upstream_usage_json (verbatim copy of upstream usage for audit)`.
Thinking tokens are stored separately from answer output; cost uses `completion_tokens` at the output rate once.
Requests aborted by the client before usage arrives are stored with `usage_missing = true`
and an estimate flagged as such; they are excluded from the reconciliation test and handled by Q6.

**Per-user limits:** requests/min and concurrent requests per key (in-memory token bucket;
Postgres counters for monthly totals; Redis only if running more than one instance). The gateway
keeps its own total concurrency below the upstream account limit (flash 2500, pro 500) and maps
upstream 429/5xx to a neutral error (no upstream name) with `Retry-After`.

## 6. Usage caps and the thinking limit (margin protection)

Thinking tokens are billed as output (the output rate is the most expensive line and
`reasoning_tokens` sit inside `completion_tokens`), so an uncapped reasoner request can erase margin.
Illustrative worst case from the price table above (arithmetic, not a measurement), peak rate:
- `deepseek-flash`: 65,536 output tokens x $1.2/1M = **$0.0786** per request; 393,216 (max) = **$0.4719**.
- `deepseek-v4-pro`: 65,536 x $3.96/1M = **$0.2595**; 393,216 = **$1.5571**.
Upstream defaults are 64K output in thinking mode (128K at effort `max`), so the gateway must inject its own default.

Config (values are for the Pricing Analyst; `null` = to be decided):

```yaml
limits:
  per_user:
    monthly_token_cap: null          # prompt+completion tokens, KST calendar month
    monthly_cost_cap_usd_micros: null # optional second cap on computed upstream cost
    monthly_reasoning_token_cap: null # optional
  per_request:
    default_max_tokens:  { "OMK/coder": null, "OMK/reasoner": null }  # injected when client omits
    max_tokens_ceiling:  { "OMK/coder": null, "OMK/reasoner": null }  # above this -> 429
    reasoner_max_effort: "high"       # "max" requires an allow-list flag on the user
  rpm_per_key: null
  concurrent_per_key: null
```

**Over-cap behavior (HTTP 429, never a silent clamp):** codes follow section 1A. Monthly cap reached ->
`quota_exceeded`; request `max_tokens` above ceiling, `reasoning_effort` above `reasoner_max_effort`, or remaining
monthly budget smaller than the reserved `max_tokens` -> `request_limit_exceeded`; per-key rpm/concurrency -> `rate_limited`.
Body (OpenAI-style error envelope, no upstream name):

```json
{ "error": { "type": "rate_limit_error", "code": "quota_exceeded",
  "message": "Monthly token budget used (X of Y). Resets 2026-12-01 00:00 KST. Use OMK/coder or wait for the reset.",
  "param": null } }
```

`param` is `max_tokens` or `reasoning_effort` for per-request limits. Headers: `Retry-After` (integer seconds, always
present on 429), `x-omk-retryable: false` for quota/request limits, `x-omk-limit`, `x-omk-remaining`.
Each message must name the cap, the current value, the limit, and the fix. Over-cap requests make no
upstream call and write no `usage_events` row (an `denied_events` row is kept for support).

## 7. Upstream-name scrub (no "DeepSeek" in a selling context)

Until written permission: the gateway never exposes the upstream brand in `/v1/models` output, model
IDs, error messages, response `model` field, headers, docs or UI copy.
- Rewrite `model` to the public ID (`OMK/coder`, `OMK/reasoner`) in every non-stream body and every
  stream chunk. Rewrite or drop `system_fingerprint` if it embeds a brand (test decides).
- `/v1/models` lists only `OMK/*`, with `owned_by: "omk"`.
- Upstream errors are re-mapped to the gateway envelope with fixed neutral messages (400/401/402/429/5xx
  -> `invalid_request`/`upstream_unavailable`/`rate_limited`), never forwarding upstream error text.
- Drop upstream response headers except a whitelist (`content-type`, `cache-control`, `x-request-id`
  re-minted by us). Add no brand in `server`/`via`.
- The scrub test (T-07) scans every fixture response body, every SSE chunk (and reassembled stream),
  all headers, `/v1/models`, the admin responses and the repo docs for the case-insensitive pattern
  `deepseek|deep-seek|\bds[-_ ]?v?\d|V4\.1-Flash|V4-Pro-0813`; zero hits allowed. Model-generated
  text (`content`, `reasoning_content`) is passed through unchanged, and a model answering "who are you"
  could name its maker; flagged as Q8.
- Allowed exception: server-side config files and logs may contain upstream IDs (they are not customer-visible);
  the logs are not a selling surface but still never contain secrets.

## 8. Polar integration plan (design + estimate; gated on DeepSeek permission)

Facts from Polar docs (read 2026-11-11):
[event ingestion](https://polar.sh/docs/features/usage-based-billing/event-ingestion),
[meters](https://polar.sh/docs/features/usage-based-billing/meters),
[credits](https://polar.sh/docs/features/usage-based-billing/credits),
[ingest API](https://polar.sh/docs/api-reference/events/ingest),
[webhook events](https://polar.sh/docs/integrate/webhooks/events).
- Events: `name`, `external_customer_id` (our user id), `timestamp`, `external_id` (dedup key),
  `metadata` (string <=500 chars, ints, floats, bools; <=50 keys; key <=40 chars). Immutable once ingested.
  Ingest returns `inserted` and `duplicates`. `metadata._llm` is a structured block with
  `vendor, model, input_tokens, cached_input_tokens, output_tokens, total_tokens` (no reasoning field).
- Meters filter by event name/metadata and aggregate Count/Sum/Avg/Min/Max/Unique over a metadata
  property; changing a meter is only allowed before it has processed events or purchases.
- Credits benefit pre-pays meter units; **Polar does not block usage over balance**, the gateway must
  enforce (sections 5-6). Manual credit API exists from API version `2027-01`.
- Webhooks: `customer.state_changed`, `subscription.created|active|canceled|revoked|past_due|cycled`,
  `order.paid`, `benefit_grant.*`.

Plan:
1. **Event** per `usage_events` row, `name = "omk_usage"`, `external_id = usage_events.id`,
   `external_customer_id = user_id`, `metadata = {model: "OMK/coder", input_miss_tokens, input_hit_tokens,
   output_tokens, reasoning_tokens, answer_tokens, total_tokens, peak (bool), cost_usd_micros,
   price_table_version}`. Only public model IDs go to Polar (scrub test T-07 covers the outbox too).
2. **Meters** (Sum over `metadata`): `omk_miss_tokens`, `omk_hit_tokens`, `omk_output_tokens`,
   `omk_reasoning_tokens`; optionally one cost meter if billing is cost-plus. Define meters before the first
   event (they are not editable after).
3. **Outbox worker** batches to `POST /v1/events/ingest`, retries on failure; dedup by `external_id` makes
   retries safe. Worker is feature-flagged OFF; sandbox (`sandbox-api.polar.sh`) first once allowed.
4. **Entitlements:** webhook handler (`subscription.*`, `customer.state_changed`, `benefit_grant.*`) updates
   `users.plan` and monthly caps. Gateway remains the enforcement point (429 on cap), Polar the billing record.
5. **Reconciliation job** (daily): sum of outbox rows vs Polar meter totals per customer via the Customer Meters API.
6. Credentials: Polar access token via secret input/Railway variable; never in repo or logs.

## 9. Test plan

### 9.1 Mock upstream (CI)

A local Node HTTP server `test/mock-upstream/` replays fixtures from `test/fixtures/upstream/*.json`
(JSON for non-stream, `.sse` for streams, byte-exact incl. keep-alive comments and the DeepSeek-style
"usage on last content chunk"). The gateway reads `UPSTREAM_BASE_URL`; CI sets it to the mock. No real key is
needed in CI; the mock asserts the incoming upstream key equals a dummy sentinel and the request carries
explicit `thinking` and `stream_options.include_usage = true`.

### 9.2 Reconciliation fixtures (20 fixed requests; metered == mock `usage`, 100%)

Per fixture compare (exact equality): `prompt_tokens`, `cache_hit_tokens`, `cache_miss_tokens`,
`completion_tokens`, `reasoning_tokens`, `answer_tokens`, `total_tokens`, `finish_reason`, and recomputed
`cost_usd_micros` from the price table at the fixture clock. Also check the response sent to the client carries
the same `usage` numbers as the upstream.

| # | Fixture | Covers |
|---|---|---|
| R01 | coder, non-stream, all miss | basic |
| R02 | coder, non-stream, full cache hit | hit/miss split |
| R03 | coder, non-stream, partial hit | hit+miss = prompt |
| R04 | coder, stream, usage in last chunk | stream tap |
| R05 | coder, stream, tool call | `tool_calls` deltas |
| R06 | coder, Fri 10:00:00 KST exactly | window edge (first peak second) |
| R07 | reasoner(flash), non-stream, reasoning_tokens > 0 | thinking recorded separately |
| R08 | reasoner(flash), stream, reasoning deltas | `reasoning_content` stream |
| R09 | reasoner, stream, effort `low` | effort forwarded |
| R10 | reasoner, stream, effort `max` allowed user | allow-list |
| R11 | reasoner, tool loop turn with `reasoning_content` replay | replay passthrough |
| R12 | reasoner, `finish_reason: length` | truncation billed |
| R13 | reasoner, `reasoning_tokens` = 0 in thinking mode | zero edge |
| R14 | coder, peak timestamp (Wed 11:00 KST) | peak price |
| R15 | coder, off-peak timestamp (Sat 11:00 KST) | off-peak price |
| R16 | coder, Fri 09:59:59 KST | window edge (last off-peak second) |
| R17 | reasoner mapped to `deepseek-v4-pro` via config | config-only switch + pro prices |
| R18 | coder, stream with `: keep-alive` comments | keep-alive |
| R19 | coder, `finish_reason: content_filter` | non-stop finish |
| R20 | coder, `insufficient_system_resource` with usage | non-stop finish |

JSON mode (`response_format`) is covered in T-06.

### 9.3 Other tests

| ID | Test |
|---|---|
| T-01 | Invariants on every row: `prompt = hit + miss`, `total = prompt + completion`, `answer = completion - reasoning >= 0`; real-key run (below) confirms `reasoning_tokens <= completion_tokens` |
| T-02 | Monthly token cap: user at cap -> 429 `monthly_token_cap`, guidance text names usage/limit/reset (KST), no upstream call, no `usage_events` row |
| T-03 | Reasoner caps: `max_tokens` above ceiling and `reasoning_effort: max` for a non-allow-listed user -> 429 with the right `code`/`param`; default `max_tokens` injected when omitted |
| T-04 | Reservation: concurrent requests cannot overshoot the monthly cap by more than 0 tokens (reserve, then settle) |
| T-05 | Config-only mapping switch: change the `OMK/reasoner` row in the model-map file to `deepseek-v4-pro`; no code/build change; mock sees `model: deepseek-v4-pro`, price table switches |
| T-06 | Thinking parameter and `response_format: json_object` passthrough: client payload from omk (section 1.1, off/low/high/max) arrives upstream as the expected `thinking` + `reasoning_effort`; coder always `disabled` |
| T-07 | Upstream-name scrub (section 7) on bodies, SSE chunks, errors (including mock upstream error bodies that contain the brand), headers, `/v1/models`, Polar outbox payloads |
| T-08 | Secrets: run all fixtures with sentinel upstream key and sentinel user tokens; grep stdout/stderr/log files/DB dump/outbox for the sentinels and for `Bearer ` values; zero hits. Log redaction paths cover `authorization`, `x-api-key`, request bodies are not logged |
| T-09 | Auth: missing, invalid or revoked account token returns 401; tokens are stored only as SHA-256 hashes |
| T-10 | Upstream 429/500/timeout -> neutral error, `Retry-After`, no usage row, no double billing on retry |
| T-11 | Client abort mid-stream -> upstream request aborted, `usage_missing` row, not counted as reconciled |
| T-12 | Polar outbox (flag off by default): rows created, dedup `external_id` stable across retries; contract test against a stubbed `POST /v1/events/ingest` |
| T-13 | omk client compatibility: omk with the section-1.1 `models.json` talks to the local gateway against the mock and parses usage (reads `prompt_cache_hit_tokens` / `reasoning_tokens`) |
| T-15 | Image/file content part on either model -> 400 `image_input_unsupported`; no upstream call |
| T-16 | `OMK/reasoner` with `thinking: disabled` -> 400 `thinking_required`; `OMK/coder` with `thinking: enabled` still reaches upstream as `disabled`; omk payload table (level off/low/high/max) matches PROVIDER_MAP.md §4 |
| T-17 | FIM / `prefix: true` on `OMK/reasoner` -> 400 `unsupported_feature`; `/v1/completions` and `/beta/*` not routed; `reasoning_content` replay still accepted |
| T-18 | Error contract table (section 1A): every row produces exactly that status/`code`/`type`, OpenAI envelope, and every 429 has integer `Retry-After`; expired and revoked tokens; monthly `Retry-After` equals seconds to KST month start |
| T-19 | `/v1/models` returns exactly two entries with the 1A fields, no upstream names; base URL `/v1` routing (no double `/v1`) |
| T-14 | Repo guard: `rg 'deepseek-chat|deepseek-reasoner'` over gateway code, config and fixtures returns nothing (this spec is excluded; it only names them to forbid them) |

### 9.4 Real 20-request check (later, not part of 11/14)

Once 근빈 supplies an official key via secret input: send 20 requests (mix of R01-R12 shapes), capture each
upstream `usage` through a debug tap that records only the usage JSON (no prompts, no keys), compare to
`usage_events` exactly. Also confirm the `completion_tokens` vs `reasoning_tokens` relationship (section 2) and
which instant DeepSeek uses for peak classification (Q5).

## 10. Open questions

| # | Question for 근빈 | Default if no answer |
|---|---|---|
| Q1 | Confirm custom Hono+Postgres build as the base (one-hub as runner-up/fallback)? Is a built-in admin UI needed for the prototype? | custom, no UI |
| Q2 | Permission status from DeepSeek (ToU 3.6(4), Open Platform 5.2): who asks, and when? Billing stays design-only until then | internal test keys only |
| Q3 | Reasoner policy values: default `max_tokens`, ceiling, `reasoner_max_effort`, monthly token cap and reasoning cap (Pricing Analyst) | placeholders in config, tests use fake values |
| Q4 | `deepseek-v4-pro` is config-only for `OMK/reasoner` (PM). Real-call check of its context/max-output (docs show a merged cell) | reasoner = flash thinking on |
| Q5 | Peak/off-peak instant: request start or end? DeepSeek docs do not say; LiteLLM prices by request completion. Need to verify against an invoice; holiday list source | request end, holidays empty |
| Q6 | Aborted streams with missing usage: bill estimate, bill zero, or bill reserved max? | bill zero, flagged |
| Q11 | Confirm token lifetime policy (no expiry by default vs fixed 30/90 days) and the client retry behavior for non-transient 429 (`x-omk-retryable`). Provider Engineer: client UX for level `off` on `OMK/reasoner` (it will get 400 `thinking_required`; hide `off` or accept the message) | no expiry; message shown |
| Q7 | Does `OMK/coder` (slash in model ID) survive omk's `--model provider/id` parsing? Provider Engineer to check; fallback ID e.g. `omk-coder` | assume works |
| Q8 | Model-generated text may name its maker; accept, or add a system-prompt guard (changes cache behavior and the prompt)? | accept, no rewrite |
| Q9 | `deepseek_harness` (`isDeepSeekHarnessModel`) will not trigger for `OMK/*`; add a gateway-model allow-list to the harness, or leave harness off for the gateway? (client-side change, Provider Engineer) | harness off |
| Q10 | Deployment later: Railway Hobby vs Pro, and who holds the production upstream key | not deployed |

## 11. Railway hosting estimate (cost only; nothing deployed or created)

Source: [Railway plans and pricing](https://docs.railway.com/pricing/plans), read 2026-11-11:
Hobby $5/month incl. $5 usage; Pro $20/month incl. $20 usage; RAM $10/GB/month; CPU $20/vCPU/month;
egress $0.05/GB; volume $0.15/GB/month; builds free; each account needs a subscription.
Railway bills on measured usage, so these are usage estimates. The average CPU/RAM/egress numbers
below are **my assumptions**, not measurements. The `user-Railway` MCP was not called; no Railway resource was created.

| Item (monthly) | A. Custom gateway (small beta, <=50 users) | B. one-hub + Postgres | C. LiteLLM + Postgres (upper bound) |
|---|---|---|---|
| App service | avg 0.1 vCPU, 0.25 GB: 2.00 + 2.50 = **$4.50** | avg 0.15 vCPU, 0.3 GB: 3.00 + 3.00 = **$6.00** | docs sizing 1 vCPU + 4 GB per worker, fully used: 20 + 40 = **$60.00** |
| Postgres | avg 0.1 vCPU, 0.5 GB, 2 GB volume: 2.00 + 5.00 + 0.30 = **$7.30** | same **$7.30** | same **$7.30** |
| Redis (optional) | avg 0.05 vCPU, 0.1 GB: 1.00 + 1.00 = **$2.00** | optional **$2.00** | LiteLLM docs: needed from 2+ instances **$2.00** |
| Egress | 20 GB x $0.05 = **$1.00** | **$1.00** | **$1.00** |
| Usage subtotal | **$14.80** | **$16.30** | **$70.30** |
| Hobby bill (max(5, usage); usage > $5 pays the excess on top of included $5) | **$14.80** | **$16.30** | **$70.30** |
| Pro bill (max(20, usage)) | **$20.00** | **$20.00** | **$70.30** |

Excluded: upstream API token spend (pass-through, see price table), Polar fees, domain, log retention
service, any top-ups. No paid infra is purchased by this spec. Prototype runs locally on the box and costs $0.

## 12. Rules and non-goals

- Official upstream API keys only; one account, no multi-account pooling or rotation to evade limits.
- Never log or print secrets; keys hashed at rest; upstream key from env only; T-08 enforces.
- No deployment, no push; this file is the only change on the branch.
- Internal prototype only: test keys, no external users, Polar and billing off until permission.
