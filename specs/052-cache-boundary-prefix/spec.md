---
description: "Keep the system-prompt cache boundary when an extension only appends to the planned system prompt (finish-check, prompt-preset)"
---

# Feature Specification: Cache boundary survives appended system-prompt text

**Specification ID**: `052-cache-boundary-prefix`
**Feature Branch**: `fix/cache-boundary-prefix`
**Created**: 2026-10-11
**Status**: Draft
**Constitution**: [specs/constitution.md](../constitution.md)
**Input**: Spec 051's provider-layer findings (PR #117). Tech Lead filed this as a bug, so there is no flag.
**OMK Preset**: `omk`

## CLI Harness Target Impact

**Classification**: fix (prompt caching). The model-visible text does not change; only cache metadata does.

| Dimension | Baseline (main `0391505`) | Acceptance target | Regression floor | Verification command | Evidence artifact |
| --- | --- | --- | --- | --- | --- |
| Cache hints | A `before_agent_start` handler that appends to the system prompt (finish-check, on by default in headless runs; prompt-preset) makes the session drop the cache boundary. Anthropic then sends the system prompt with no `cache_control`, and OpenAI gets no `prompt_cache_key`. | An appended system prompt keeps the planned boundary. Anthropic marks exactly the planned stable prefix, and OpenAI gets the content-derived key. | A system prompt that does not start with the planned prompt is still treated as replaced (boundary dropped, bypass on), exactly as today. | `npx vitest run test/system-prompt-cache-boundary.test.ts test/suite/system-prompt-cache-boundary.test.ts` in `packages/coding-agent` | those files |

## Problem

`AgentSession._prompt` builds the turn's system prompt plan `{ prompt, cacheBoundary }`. `cacheBoundary` is the length of the stable prefix, before context files, skills, the date and the cwd. Extensions can then return a new `systemPrompt` from `before_agent_start`. The session keeps the boundary only when that text is byte-equal to the plan (`agent-session.ts:2658`):

```ts
const preservesCacheBoundary = result.systemPrompt === turnSystemPrompt.prompt;
```

finish-check (`${event.systemPrompt}\n\n${finishDisciplinePrompt}`) and prompt-preset (`${event.systemPrompt}\n\n<model_preset …>`) only append, so the planned prefix is still at the start, byte for byte. The equality check treats them as a full replacement anyway:

- **Anthropic** (`anthropic.ts:1276-1285`): bypass → a single system block with **no** `cache_control`. The OAuth identity block also loses it.
- **OpenAI Responses / chat completions** (`openai-prompt-cache.ts:41-46`): bypass → `deriveContextPromptCacheKey` returns undefined and the session-id fallback is suppressed → **no `prompt_cache_key`**.
- The session's own cache-plan telemetry records a bypass on every such turn.

## Design

New module `packages/coding-agent/src/core/system-prompt-cache-boundary.ts`:

```ts
resolveExtendedSystemPromptCache(plan: { prompt: string; cacheBoundary: number | undefined }, systemPrompt: string)
  → { cacheBoundary: number | undefined; bypass: boolean }
```

1. `systemPrompt === plan.prompt` → `{ cacheBoundary: plan.cacheBoundary, bypass: false }` (unchanged).
2. The boundary is **kept** only when all of these hold:
   - `plan.prompt` is non-empty, so an empty plan cannot match everything;
   - `systemPrompt.startsWith(plan.prompt)`: the whole planned prompt, not just its stable prefix, is at the start. So the extension appended and did not edit anything, including the dynamic suffix;
   - `plan.cacheBoundary` is a safe integer with `0 < boundary ≤ plan.prompt.length`.

   Result: `{ cacheBoundary: plan.cacheBoundary, bypass: false }`. The appended text starts at `plan.prompt.length ≥ boundary`, so it always falls outside the cached block. Providers cache `systemPrompt.slice(0, boundary)`, which equals the planned stable prefix byte for byte. The appended text goes into the uncached dynamic suffix, together with the plan's own dynamic tail.
3. Anything else (a replacement, an edit, a prepend, or a prefix match without a valid boundary) → `{ cacheBoundary: undefined, bypass: true }`, as today.

`agent-session.ts` calls the helper in place of the three-line equality block, so the file gets smaller (module-size ratchet).

## Acceptance

1. Unit (`test/system-prompt-cache-boundary.test.ts`): equal → kept; appended → kept, with the same boundary; replaced, edited, prepended, or a different dynamic suffix → bypass; empty plan → bypass for any non-empty text; missing or out-of-range boundary → bypass.
2. Session (`test/suite/system-prompt-cache-boundary.test.ts`): a real `AgentSession` with the built-in finish-check discipline (`OMK_FINISH_CHECK=always`) and an extension that appends text. The context captured at the provider stream is passed to `streamAnthropic` and `streamOpenAIResponses` (payload captured, no network):
   - Anthropic: `system[0]` is exactly the planned stable prefix with `cache_control`; `system[1]` (no `cache_control`) contains the appended text.
   - OpenAI: `prompt_cache_key` is defined and equals the key of the plan alone (appended text does not change it).
   - Negative: an extension that replaces the system prompt still yields one Anthropic block without `cache_control` and no `prompt_cache_key`.
3. Without an extension override, nothing changes (the `else` branch is untouched).

## Not in scope

- `x-grok-conv-id` for xAI (separate follow-up).
- Per-prompt skill selection in the system prompt (spec 050).
