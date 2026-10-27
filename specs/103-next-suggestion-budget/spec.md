# Spec 103 — next-task suggestion: independent caps, usage settlement, explicit cache capability

Status: draft (spec only, no implementation)
Base: `origin/main` @ `e898c19e44` (PR #177 merged). All `file:line` refs are `e898c19e44`; paths under `packages/`.
Source: 인호's review "OMK 캐시 효율과 기본기 통합 개선 검토", priority E / section 5. Capability table input: Library Scout `/workspace/ls-103-cache-capability/TABLE.md`, re-verified against the official docs on 2026-10-21 (KST).

## 1. Problem (verified in code)

1. **Reuses main context and options.** `MainRequestRecorder.wrap` stores the last `(model, context, options)` (`coding-agent/src/core/next-suggestion.ts:80-85`); `buildSuggestionContext` appends the final assistant message and the instruction only at the end (`next-suggestion.ts:149-156`); `requestNextSuggestion` spreads `...record.options` (`next-suggestion.ts:180-184`).
2. **Same reasoning setting, output cap = thinking budget + 128.** Reasoning is never disabled (`next-suggestion.ts:31-37`). `suggestionMaxTokens` returns `budget + 128` when reasoning is on, and **only 128** when reasoning is off *or* the provider already adds the budget itself (`addsThinkingBudgetToMaxTokens`) (`next-suggestion.ts:38-44`). So "cap = budget + 128" holds only for providers that do not add the budget themselves; in both cases a one-sentence suggestion may spend the full thinking budget.
3. **Returns text only; usage is not settled by this path.** `requestNextSuggestion` returns `extractSuggestion(result)` (`next-suggestion.ts:173-190`); `result.usage` is dropped. The controller calls it with `this.inner` (`modes/interactive/next-suggestion-controller.ts:80,164`). Per-turn metrics come only from the main turn's final assistant message (`core/agent-session.ts:1601-1638`, `usage` at 1628-1636), so suggestion tokens never reach `turns.jsonl`. Whether `this.inner` is the budget/trace wrapper (`core/budget-stream.ts:8-44`, `trace.begin` at :28) depends on install order; if it is, the RequestTrace records the request with **no purpose label** (`core/request-trace.ts:71-75` records only provider/model). Not claimed that every layer misses it — only that this return path does not settle usage and nothing labels it as a suggestion.
4. **No independent caps.** The only bounds are: quota ≥90% skip (`next-suggestion.ts:22-23,142-144`), a 2 s quota-check timeout (`next-suggestion.ts:46`, controller `:131-144`), and abort on next input/turn (`controller:84,103-106,127`). There is no wall-time deadline on the request itself, no cost cap, and no reasoning cap distinct from main.
5. **Cache support guessed from price.** `supportsPromptCache` = `cacheRetention !== "none" && model.cost.cacheRead > 0` (`next-suggestion.ts:122-124`). Price 0 is not evidence of no cache (e.g. a free/unpriced model entry).
6. **One TTL for all providers.** `cacheTtlMs`: `short` → 5 min, `long` → 60 min (`next-suggestion.ts:24-27,117-120`). But the providers send different retentions for `long`: OpenAI Responses sends `prompt_cache_retention: "24h"` (`ai/src/providers/openai-responses.ts:250`), Anthropic sends `ttl: "1h"` (`ai/src/providers/anthropic.ts:66`). For OpenAI, the default (`short`) is not 5 min either (see §3).

## 2. Proposed change

Flag: existing `OMK_NEXT_SUGGESTIONS` (default off, `next-suggestion.ts:21,60-62`) stays the master switch. New behavior that changes the suggestion request is under `OMK_NEXT_SUGGESTIONS_CAPS=1` (default off) so the "reuse current settings" arm remains byte-identical to today.

### 2.1 Independent caps (flag on only)
- `SuggestionBudget { maxReasoning: ThinkingLevel | "inherit"; deadlineMs: number; maxCostUsd: number }`. Defaults (Tech Lead ruling, 2026-10-21 KST); env only overrides (`OMK_NEXT_SUGGESTIONS_DEADLINE_MS`, `OMK_NEXT_SUGGESTIONS_MAX_COST_USD`, `OMK_NEXT_SUGGESTIONS_MAX_REASONING`):
  - `deadlineMs = 30000` — same as `DEFAULT_TIMEOUT_MS` of the other background side-call, `coding-agent/src/core/advisory-judge-model.ts`.
  - `maxCostUsd = 0.02` — automation default run budget `maxCostUsd: 10` ÷ `maxToolCalls: 500` (`coding-agent/src/core/automation/index.ts`), i.e. the per-action share of the default run budget.
  - `maxReasoning = "inherit"` — keeps today's bytes (arm B, §5); a lower level is only an arm.
  - Skip reason `budget_unset` only when the user explicitly sets the deadline or cost cap to `0`. Invalid values keep the default. The pilot (§6) may revise these before default-on.
- Wall time: one `AbortSignal.timeout(deadlineMs)` linked with the existing controller signal; timeout ⇒ outcome `timeout`.
- Cost: pre-flight estimate (input tokens × model rates, using the capability table's read/write multipliers) > `maxCostUsd` ⇒ skip reason `over_cost_cap` (new `SuggestionSkipReason`). Post-hoc actual cost is recorded, never used to retroactively hide a shown suggestion.
- Reasoning: `"inherit"` keeps today's bytes. A lower level is only an **arm** (§5), never forced: on Anthropic, thinking/effort changes invalidate message cache blocks, and on OpenAI `reasoning.effort` is listed as prefix-affecting (docs in §3).

### 2.2 Usage settlement (purpose=suggestion)
- `requestNextSuggestion` returns `{ text?: string; usage?: Usage; outcome: "shown"|"empty"|"aborted"|"timeout"|"error"; latencyMs }`.
- Usage goes to the existing accounting path with `purpose: "suggestion"`: (a) `RequestTrace.begin` gains an optional `purpose` field (`request-trace.ts:71`; same field 101/3C adds for main/compaction/retry — reuse, don't fork); (b) one `TurnMetricsSink` record per suggestion with `purpose:"suggestion"` and `parentTurnIndex`, so totals never double-count into the parent turn (`turn-metrics.ts:178-183` sums all records; summary gets a per-purpose breakdown).
- Aborted/cancelled requests: settle whatever usage the provider reported (partial or none); `usage: undefined` is counted as **missing coverage**, never as 0.

### 2.3 Usage normalization (precondition for cost/ratio math)
Providers define input differently:
- OpenAI: `input_tokens` **includes** cached tokens (and, on GPT-5.6+, cache-write tokens); ordinary input = `input_tokens − cached_tokens − cache_write_tokens` (OpenAI doc, "Monitor cache performance").
- Anthropic: `input_tokens` counts **only** tokens after the last breakpoint; total = `cache_read_input_tokens + cache_creation_input_tokens + input_tokens` (Anthropic doc, "Tracking cache performance").
- Code today: OpenAI Responses already subtracts `cached_tokens` but hard-codes `cacheWrite: 0` and does not subtract `cache_write_tokens` (`ai/src/providers/openai-responses-shared.ts:503-510`); Anthropic maps fields directly (`ai/src/providers/anthropic.ts:596-600`).
- Rule: suggestion cost/ratio math consumes only the normalized `Usage` (`input` = uncached, `cacheRead`, `cacheWrite`). The OpenAI `cache_write_tokens` gap is a 101 (metrics) item; 103 adds a fixture asserting the normalized shape and depends on 101 for the fix.

### 2.4 Explicit cache capability + TTL table
Replace `supportsPromptCache` and `cacheTtlMs` with a constants table in `omk-ai` (no new deps, no pricing feed). Lookup by `(provider/api, model family, retention actually sent)`; unknown ⇒ `"unknown"`, which skips with reason `cache_capability_unknown` (fail closed, same as today's skip behavior).

| Provider / family | Cache | Retention omk sends | Lifetime used for "cold" check | Source |
|---|---|---|---|---|
| OpenAI GPT-5.6+ (Responses) | yes (implicit+explicit) | default; `prompt_cache_options.ttl` "30m" default / "12h" | 30 min (min lifetime) | OpenAI doc "Cache lifetime → GPT-5.6 and later" |
| OpenAI GPT-5.5 / 5.5 Pro | yes (implicit) | `prompt_cache_retention` "24h" only | ~30 min typical (doc: "typically around 30 minutes, up to 24 hours"); use 30 min | OpenAI doc "Summary of model differences" |
| OpenAI earlier models, `in_memory` | yes (implicit) | `in_memory` | 5 min (doc: "5 to 10 minutes of inactivity, up to one hour"; take lower bound) | OpenAI doc "Earlier models" |
| OpenAI earlier models, `24h` (listed models) | yes | `"24h"` (omk sends this for `long`, `openai-responses.ts:250`) | 30 min (doc: "typically keeps entries available for around 30 minutes") | same |
| Anthropic, all active models | yes | `cache_control` ephemeral; `ttl:"1h"` for `long` (`anthropic.ts:66`) | 5 min default / 60 min with `1h` | Anthropic doc "How prompt caching works", "1-hour cache duration" |
| xAI | **unknown** (not verified) | — | — ⇒ skip `cache_capability_unknown` | not fetched; do not mark supported |
| Others (Google, compat endpoints) | **unknown** until verified | — | — | — |

Notes: OpenAI `in_memory`/`24h` default depends on the org's ZDR setting (doc "Retention defaults"), so when omk sends no explicit retention the table uses the **shortest** documented lifetime for that family. Anthropic lifetime is measured from request start (doc), so the cold check uses `record.atMs` (request start, `next-suggestion.ts:82`) — already correct. Table values are lower bounds for a skip heuristic, not billing guarantees.

Sources (fetched 2026-10-21 KST):
- OpenAI: https://platform.openai.com/docs/guides/prompt-caching
- Anthropic: https://docs.claude.com/en/docs/build-with-claude/prompt-caching
- Draft table: `/workspace/ls-103-cache-capability/TABLE.md` (Library Scout)

### 2.5 Safety
- Suggestion request carries no new tool permissions (unchanged: instruction says "no tool calls", `next-suggestion.ts:55-58`; result is text only and never enters agent state, `next-suggestion.ts:14-15`).
- Model change ⇒ discard (exists, `next-suggestion.ts:136-138`); late result ⇒ discard (exists, controller `:165-166`).

## 3. Metrics (per suggestion, all from §2.2 records)
| Metric | Definition |
|---|---|
| cost per suggestion | normalized-usage cost, incl. aborted/timeout ones; missing usage reported as coverage, not 0 |
| adoption rate | Tab-inserted ÷ shown (controller `:117-125`); also "sent unchanged" ÷ inserted |
| added latency to main work | time from `prompt_settled` to the next main `agent_start` blocked or contended by a suggestion (in-flight overlap ms) |
| cost on cancelled suggestions | sum of cost for outcome ∈ {aborted, timeout} |
| skip-reason distribution | count per `SuggestionSkipReason` |

## 4. Deterministic tests (faux provider, no network)
1. Flag off: no wrapper installed, main request bytes identical to `e898c19e44` (existing guarantee, keep test).
2. `OMK_NEXT_SUGGESTIONS=1`, caps flag off: suggestion request bytes identical to today (reuse arm), and usage now appears as one `purpose:"suggestion"` record; parent turn totals unchanged.
3. Caps flag on: deadline fires via fake clock ⇒ outcome `timeout`, request aborted, partial usage settled, nothing shown.
4. Pre-flight estimate > `maxCostUsd` ⇒ skip `over_cost_cap`, zero provider calls.
5. Cancel by keypress mid-stream ⇒ cost counted under cancelled; no placeholder shown.
6. Capability: model with `cost.cacheRead = 0` but table says supported ⇒ **not** skipped; xAI model ⇒ skip `cache_capability_unknown`.
7. TTL: OpenAI `long` (sends `24h`) at 31 min ⇒ `cache_cold`; at 29 min ⇒ request; Anthropic `long` at 59 min ⇒ request, 61 ⇒ cold; Anthropic default at 4/6 min.
8. Normalization fixtures: OpenAI usage `{input_tokens:12000, cached_tokens:4000, cache_write_tokens:7000}` and Anthropic `{input_tokens:50, cache_read:100000, cache_creation:0}` (both doc examples) produce the documented ordinary-input values (1000 and 50).
9. Totals reconcile: Σ(main + suggestion) per session == trace Σ for the same requests (no double count).
10. Model switched before result ⇒ late result discarded, cost still settled.

## 5. Arms (compare later, same model/task/permissions/total budget)
- A `reuse`: today's settings (`inherit`, no caps).
- B `capped`: same model, deadline + cost cap, reasoning `inherit`; variant B′ lower reasoning only if B shows reasoning dominates cost.
- C `skip`: no suggestion.

## 6. Decision rule
- Free stage first: tests above + faux-provider pilot fix initial cap values.
- Paid runs only after 인호 posts a dollar cap in the room.
- Promote an arm to default (still behind `OMK_NEXT_SUGGESTIONS`) only if, on paired tasks: **95% CI upper bound of per-verified-task cost change < 0** vs A, and **success-rate drop ≤ 5 pp**. Otherwise inconclusive; keep A. Task, not request, is the sample unit.

## 7. Flags / deps / rollback
- Flags: `OMK_NEXT_SUGGESTIONS` (existing, default off); `OMK_NEXT_SUGGESTIONS_CAPS` (new, default off). Usage settlement applies whenever suggestions are on (accounting, not model behavior). The capability table (§2.4) sits behind `OMK_NEXT_SUGGESTIONS_CAPS` (Tech Lead ruling 2026-10-21): with the caps flag off, skip decisions and suggestion request bytes are identical to `main`. Metrics summary: suggestion records are excluded from `turns`, duration percentiles and main-turn `usageCoverage`; they count toward cost/token totals and appear under `byPurpose`.
- New dependencies: 0.
- Rollback: unset flags ⇒ today's behavior; code revert is self-contained (next-suggestion.ts, controller, one optional trace field, one table module). `turns.jsonl` readers ignore the new `purpose` field.

## 8. Open questions
1. Should usage settlement (§2.2) ship without the caps flag (pure accounting)? Proposal: yes.
