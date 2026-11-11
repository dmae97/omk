# Provider Resilience

OMK can recover an agent turn from provider failures that are unlikely to succeed unchanged:

- content or safety stops reported as errors
- billing-cycle or quota exhaustion
- orphaned `tool_call_id` protocol errors
- transient transport and server failures
- gateway/upstream availability failures (5xx passthroughs, streams that end without a finish reason)

This is availability behavior, not a safety bypass. Provider safety policy and the user's configured model access remain authoritative.

## Settings

Configure resilience in `~/.omk/agent/settings.json` or `.omk/settings.json`:

```json
{
  "providerResilience": {
    "blockStickySafetyModels": true,
    "autoFailoverOnSafetyStop": true,
    "autoFailoverOnQuotaExhaustion": true,
    "failoverCandidates": [
      { "provider": "kimi-coding", "id": "k3" },
      { "provider": "modelstudio-maas", "id": "qwen3.8-max" }
    ]
  }
}
```

| Setting | Default | Behavior |
|---|---:|---|
| `blockStickySafetyModels` | `true` | Blocks interactive and automatic activation of models known to produce sticky false-positive safety stops. The catalog still lists them; set this to `false` to use an interactive or saved selection. |
| `autoFailoverOnSafetyStop` | `true` | Enables failover for content/safety stops. |
| `autoFailoverOnQuotaExhaustion` | `true` | Enables failover for quota/billing exhaustion, including when `--model` or `--provider` pins the current model. |
| `failoverCandidates` | built-in chain | Ordered models considered before an automatic retry. |

Automatic recovery also requires `retry.enabled: true` and available retry budget.

An explicit `--model` or `--provider`/`--model` pin keeps safety-stop failover and sticky-model eject from replacing that model. A later manual model selection can still change it. Quota exhaustion is the exception: a pinned route cannot serve the next request until its billing window resets, so `autoFailoverOnQuotaExhaustion` (default `true`) may switch to an authenticated candidate. Set it to `false` to keep the pin absolute and end the turn with the quota cause instead.
Claude Fable, Opus, and Sonnet also stay on-model after a content/safety stop,
even without `--model` and even when skills are loaded. Those refusals are not
retried on DeepSeek or Kimi.

## Failover behavior

For a safety stop or recognized quota/billing error, OMK:

1. classifies the failed provider attempt;
2. excludes the current model and models already failed during this retry sequence;
3. selects the first non-sticky candidate that exists and has configured authentication;
4. switches models before retrying with a short delay.

A failover or route-rotation switch applies to the current session only. It is recorded in the session transcript but never written as `defaultProvider`/`defaultModel`, so the next session starts on the model you chose, not on the last failover target.

If the candidate OMK switched to rejects the request outright (for example `403 Access to model denied`, an authentication error, or an unsupported model), that candidate is marked failed for the turn and the chain advances to the next authenticated candidate. When no candidate remains, the turn ends with that error instead of retrying the denied model. The same error from the model you selected yourself is still not retried.

A content/safety stop gets at most one automatic retry, including a retry that switches model, regardless of the larger transport retry budget. Other transient failures keep the configured retry policy and backoff. Plain authentication errors remain non-retryable and do not trigger failover.

Recognized quota shapes include billing-cycle usage limits (`429 Go usage limit exceeded`), `insufficient_quota`, `free_limit_reached`, exhausted balances/credits, `GoUsageLimitError`, `FreeUsageLimitError`, and out-of-budget responses. These are classified as `provider.rate_limit`, even when a provider wraps them in HTTP 403. Provider-capacity bodies that omit a status or limit token are classified the same way: xAI `currently at capacity` / `high demand` (HTTP 429) and Anthropic `overloaded_error` / `Overloaded` (HTTP 529). Left unmatched they fall through to `provider.protocol` and advertise orphan-`tool_call_id` sanitize.

Two HTTP 400s are permanent `configuration.invalid`, not retryable protocol faults: Anthropic `claude_code_version_too_old`, and Codex ChatGPT-account `The '<slug>' model is not supported when using Codex with a ChatGPT account.` Same-model retry, transcript sanitize, and `/new session` re-send the same client version or slug. Switch with `/model`, or for Codex use an API-key route that has the model.

Gateway/upstream availability failures — "503 Upstream request failed", "Endpoint is unavailable", or a stream that ended without a finish reason — are classified as `provider.network`: transport problems that heal by retry or model switch, never by transcript sanitization.

The default candidate order is:

1. `kimi-coding/k3`
2. `modelstudio-maas/qwen3.8-max`
3. `xai/grok-4.5`
4. `deepseek/deepseek-v4-pro`
5. `deepseek/deepseek-v4-flash`
6. `modelstudio-maas/deepseek-v4-pro`
7. `kimi-coding/kimi-for-coding`

## Same-model route rotation

The same underlying model is often served by several provider routes (for example `openrouter/stealth/ox-alpha` and `opencode-go/ox-alpha-free`). When the active route fails with an upstream availability error, OMK rotates to another authenticated route of the same model family before touching the cross-model failover chain, so the retry lands on a live endpoint instead of hammering the dead one.

Routes already visited this turn and routes without configured authentication are excluded from rotation. Route rotation runs inside the normal retry budget; when no sibling route remains, the standard failover behavior applies.

Compaction summarization reuses the same chain: when the summarization model hits quota/billing exhaustion, the configured failover candidates are tried once each before the run fails with a non-retryable `compaction.quota_exhausted` termination cause. See [Compaction](compaction.md).

## Retry and termination events

Each provider attempt is journaled separately and emits `session_termination`. A retryable failure is attempt-level when an `auto_retry_start` event follows it. A recovered retry later emits a `completed` termination; an exhausted retry budget leaves the last provider failure as the final termination.

See [Sessions](sessions.md#retries-and-termination-events) for consumer guidance.

## Protocol recovery

For orphaned `tool_call_id` errors, OMK removes the failed assistant message from the live retry context. The standard message transform then drops tool results whose originating call is absent. Persisted session history remains unchanged for auditability.
