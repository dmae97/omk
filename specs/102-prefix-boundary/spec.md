# Spec 102: Keep the cache boundary when only the dynamic tail differs

Status: draft (spec only, no code). Base: `origin/main` `e898c19e44`.
Owner: Harness Engineer. Reviewer: Tech Lead.
Flag: `OMK_PREFIX_BOUNDARY` (default off; off = exactly current `main` behavior).
New dependencies: 0.

## 1. Problem (verified in source at `e898c19e44`)

- `resolveExtendedSystemPromptCache()` lives in
  `packages/coding-agent/src/core/system-prompt-cache-boundary.ts:19-31`.
  It keeps the planned boundary only when the extension-returned prompt is
  identical to the plan (`:23`) or `startsWith(plan.prompt)` — the *whole*
  planned prompt, including the dynamic tail after the boundary (`:27`).
  Otherwise it returns `{ cacheBoundary: undefined, bypass: true }` (`:30`).
- Single caller: `packages/coding-agent/src/core/agent-session.ts:2675`
  (applied at `:2676-2678`; no-extension path `:2680-2683`). The boundary
  comes from `system-prompt.ts:96/127` and `:200/232` (`cacheBoundary = prompt.length`
  at the end of the stable part), carried via `session-system-prompt.ts:88`.
- Propagation: `packages/agent/src/agent.ts:395-396` →
  `agent-loop.ts:642-643` → `packages/ai/src/types.ts:373-375`.
- Consumers of `cacheBoundary` (provider serializers):
  - Shared validator `packages/ai/src/providers/prompt-cache.ts:6-20`
    (`resolveSystemPromptCacheBoundary`, bypass → undefined at `:7`) and
    `deriveContextPromptCacheKey` `:27-` (key hashes `systemPrompt.slice(0, boundary)` + tools).
  - Anthropic: `anthropic.ts:1000` → `convertSystemPrompt` `:1271-1300`
    splits into a `cache_control` prefix block and an uncached suffix block;
    with bypass, no `cache_control` at all (`:1276-1286`).
  - OpenAI family via `openai-prompt-cache.ts:38-47`
    (`resolveOpenAIPromptCacheKey`; with bypass or boundary metadata but no
    content key → `undefined`, `:45`): `openai-responses.ts:247`,
    `azure-openai-responses.ts:266`, `openai-codex-responses.ts:502`,
    `openai-completions.ts:518`.

Consequence: when the dynamic tail (after the boundary) differs between the
turn plan and what an extension returns (e.g. extension built on a tail A while
the plan now has tail B, or rewrote only the tail), the stable prefix is still
byte-identical but we drop the boundary → Anthropic loses `cache_control`,
OpenAI loses `prompt_cache_key`.

## 2. Change (flag on)

`keep boundary  ⇔  validBoundary && systemPrompt.length >= boundary &&
systemPrompt.slice(0, boundary) === plan.prompt.slice(0, boundary)`

- "Verified" boundary = the existing validity rule (`:25-26`: safe integer,
  `> 0`, `<= plan.prompt.length`, non-empty plan). Comparison is UTF-16 code
  units, same unit as the serializers' `slice`.
- Additionally bypass only on a real split: when the code unit before the
  boundary is a high surrogate and the one at the boundary is a low surrogate
  (in either string), so `sanitizeSurrogates` can never alter the prefix bytes.
  A complete pair ending exactly at the boundary is not a split and keeps the
  boundary (test §4.4).
- Any difference before the boundary → `{ undefined, bypass: true }` (as today).
- Flag off → current function body, unchanged.

## 3. Invariants (non-negotiable)

1. The full current prompt (`result.systemPrompt`) is always sent unchanged;
   the boundary only decides where the cache marker/key goes.
2. Never substitute the planned/cached text for changed instructions or
   permissions to preserve a cache hit. Changed text before the boundary
   means bypass; changed text after it is sent verbatim in the suffix.
3. Flag off: byte-identical request payloads to `main` for every adapter.

## 4. Required tests (through real serializer payloads)

Build the actual request body for each adapter that consumes the boundary:
Anthropic (`convertSystemPrompt` via the anthropic payload builder),
OpenAI Responses, Azure OpenAI Responses, OpenAI Codex Responses,
OpenAI Completions (where `prompt_cache_key` is emitted).

1. Dynamic tail A→B (prefix identical): boundary kept. Anthropic: prefix block
   has `cache_control`, suffix block = tail B exactly. OpenAI: `prompt_cache_key`
   present and equal to the key of the tail-A request.
2. Prefix change (one byte before the boundary, incl. a surrogate-split case):
   bypass. Anthropic: single block, no `cache_control`. OpenAI: no `prompt_cache_key`.
3. Permission/instruction change: the concatenated system text in the payload
   equals `result.systemPrompt` byte-for-byte in both the prefix-change and
   tail-change cases (no stale text ever sent).
4. Surrogate pair at the boundary: an emoji (e.g. U+1F600, a UTF-16
   surrogate pair) placed immediately before the boundary, in two variants:
   (a) boundary splits the pair (between high and low surrogate) and
   (b) boundary abuts it (directly after the low surrogate, prefix otherwise
   identical, only the tail changes). (a) must bypass: Anthropic single block
   with no `cache_control`, OpenAI no `prompt_cache_key`. (b) keeps the
   boundary: prefix identical with the emoji intact in the prefix block,
   `cache_control` / `prompt_cache_key` present as normal. In both, the request
   body's system text equals the full `result.systemPrompt` unchanged (emoji
   intact, no `sanitizeSurrogates` replacement). Checked through the real serializer
   payloads of all 5 adapters.
5. Flag-off equivalence: for a fixed corpus (equal, appended, tail-changed,
   prefix-changed, replaced, empty, invalid boundary), payloads with the flag
   off deep-equal payloads produced by the `main` implementation.

## 5. Measurement and default-on decision

- A cache key or `cache_control` marker is not a cache hit. Hits are only
  measured from provider-reported usage (cache read tokens) via the spec 101
  trace.
- Primary metric: difference (flag on − off) in cache-read ratio, computed
  only over `suffix_changed` requests: on arm by the actual
  `boundaryChangeReason`, off arm by `shadowBoundaryChangeReason` (the cause
  the flag-on rule would have recorded; metadata only, off arm only, next to
  `boundaryChangeReason: flag_off`). First requests are excluded.
- Minimum sample, fixed before any measurement: at least 30 `suffix_changed`
  requests per arm on that basis. Below that in either arm the result is `inconclusive`
  and the flag stays off; the bar is never relaxed.
- The boundary change cause is recorded as new values on #183's existing
  `boundaryChangeReason`, not a new field.
- No default-on decision until 101 lands. Default-on bar (A/B, flag on vs off,
  same tasks/models), all three required: 95% CI upper bound of
  Δ(cost per verified completion) `< 0`, AND success-rate drop `<= 5pp`,
  AND 0 false completions.

## 6. Success criterion (measurable)

- All tests in §4 pass for all 5 adapters; flag-off corpus 100% deep-equal.
- In the 101 trace, on runs where the tail changed and the prefix did not,
  the share of turns that keep the boundary goes from 0% (off) to 100% (on),
  with 0 turns where the sent system text differs from `result.systemPrompt`.

## 7. Open questions

- Is the tail-only-change case frequent in practice? Unknown until 101 trace;
  if ~0, the flag stays off.
- Should Anthropic placing `cache_control` on a prefix that the provider then
  misses (min cacheable length) count as a write cost? Answer via 101 usage.
- Google/xAI adapters do not read the boundary today; out of scope.
