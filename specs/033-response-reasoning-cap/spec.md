---
description: "Cap reasoning volume and wall time per model response; on overrun, retry that response once at one lower reasoning effort"
---

# Feature Specification: Per-response reasoning cap with one lower-effort retry

**Specification ID**: `033-response-reasoning-cap`
**Feature Branch**: `feat/response-reasoning-cap` (stacked on #63 `feat/remaining-budget`)
**Created**: 2026-10-11
**Status**: Draft
**Constitution**: [specs/constitution.md](../constitution.md)
**Input**: PR Review Desk R8/B′ failure analysis (`IMPROVEMENT_CANDIDATES_20261011.md`, candidate 3). Tech Lead assigned it to Software Conductor.
**OMK Preset**: `omk`

## CLI Harness Target Impact

**Classification**: improve (benchmark score), opt-in. Default behavior is unchanged.

| Dimension | Baseline | Acceptance target | Regression floor | Verification command | Evidence artifact |
| --- | --- | --- | --- | --- | --- |
| Reliability | One response can think for 280–876 s with no bound except the 300 s HTTP *idle* timeout, which never fires while thinking deltas keep streaming | With `OMK_RESPONSE_REASONING_CAP=1`, a response that passes the reasoning-token or wall-time cap before it emits text or a tool call is aborted and retried once at one lower effort | With the flag unset, the stream function returns the inner stream untouched (same object, same events) | `npx vitest run test/response-reasoning-cap.test.ts` in `packages/coding-agent` | `packages/coding-agent/test/response-reasoning-cap.test.ts` |
| Benchmark | Targeted tasks below, control build | +2~3 of 264 R8 trials expected by Desk; at least no loss on the targeted set | No targeted task loses a pass it had in control | A/B below | `/workspace/omk-ab` run ledger |

## Problem (Desk numbers)

- In R8, responses over 20k reasoning tokens make up **17% of failed trials vs 5% of passed trials**.
- B′ adaptive-rejection-sampler r1: **both arms** spent the whole 900 s budget on two responses (23.7k / 27.5k tokens, ~280–345 s each) of repeated-sentence thinking. R8 omk was 3/3 on this task, so this is a pure runaway-reasoning loss.
- R8 write-compressor r2: the last stream ran 876 s. path-tracing-reverse r2·r3 and schemelike-metacircular-eval r2·r3 had 20–44k token responses.
- Today the only bound is `core/http-idle-timeout.ts` (idle 300 s). A thinking stream that keeps emitting deltas is never cut, and steering cannot land until the response ends.
- All runs used grok-4.7 at `xhigh`.

## Design

A `StreamFn` wrapper, `createResponseReasoningCapStreamFn(inner, config)`, in `packages/coding-agent/src/core/response-reasoning-cap.ts`, installed around `createSdkProviderStream` in `core/sdk.ts`. No change to `packages/ai` or `packages/agent`.

1. **Activation.** Off unless `OMK_RESPONSE_REASONING_CAP=1`. When off, the wrapper is not installed at all.
2. **Caps (per response attempt).**
   - Reasoning tokens: `OMK_RESPONSE_REASONING_CAP_TOKENS`, default **20000** (the Desk's split point). Counted live as `max(ceil(thinking chars / 4), partial.usage.output)` while the response has produced no text and no tool call. `usage.output` is only used when the provider streams it.
   - Wall time: `OMK_RESPONSE_WALL_CAP_SEC`, default **240 s**. When a RemainingBudget clock is active (`OMK_TIME_BUDGET_SEC`, #63) the cap is `min(240 s, 15% of the budget, remaining − save reserve)`, floored at 30 s. For the 900 s ARS budget that is 135 s; for a 3600 s task 240 s.
3. **Only runaway thinking is cut.** Caps are checked only until the first `text_start` or `toolcall_start`. Once the model is answering or calling a tool, the response is allowed to finish; cutting it would waste the work it just did.
4. **On overrun.** Abort the attempt through a private `AbortController` linked to the caller's signal, drain it without forwarding its terminal event, then call the inner stream again with `reasoning` lowered one step (`ultra`/`max` → `xhigh` → `high` → `medium` → `low` → `minimal`). Retry happens **at most once per response**. If there is no lower level (`minimal`, off, or no `reasoning`), the cap is not enforced.
5. **Second attempt.** Caps are still measured but not enforced: a second abort would leave the turn with no assistant message and end the run. An overrun on the retry is recorded only.
6. **Transcript.** Events from the first attempt are forwarded as usual (the UI shows the thinking). The retry's `start` event is suppressed so the consumer keeps one assistant message; the retry's updates and final message replace it.
7. **Recording.** The final message gets `diagnostics` entries, which are saved in the session JSONL with the assistant message, so the bench can count them:
   - `response_reasoning_cap_retry` with `{ reason: "reasoning_tokens" | "wall_time", fromEffort, toEffort, reasoningTokens, elapsedMs, capTokens, capMs }`
   - `response_reasoning_cap_overrun_after_retry` with the same fields when the retry also passes a cap.
   The first attempt's `usage` (tokens and cost) is added to the final message's `usage` so cost accounting does not drop the aborted attempt.
8. **No prompt change.** The Desk suggested also adding a "run one command now" nudge. It is left out so the A/B measures one change (effort reduction). It is a follow-up variant if this one shows no gain.

### Why opt-in by env var

- The cut is lossy: an aborted response's reasoning is discarded. For interactive users a long think is often wanted and they can steer or press Esc themselves. The data that justifies the cap comes only from timed headless bench runs.
- The bench adapter already sets run-scoped env vars (`OMK_TIME_BUDGET_SEC`, `OMK_RTK_OUTPUT`). An env flag lets the A/B toggle exactly this feature on one build with no settings-file changes.
- Making it default-on, or a `settings.json` key, is a follow-up decision after the A/B shows a gain.

## Agent-Oriented Requirements

### Requirement 1 - Cap and single retry (Priority: P0)

**Agent**: coder
**Evidence Gate**: command-pass
**Risk**: medium (aborts a live provider stream)

**Acceptance** (named vitest cases in `packages/coding-agent/test/response-reasoning-cap.test.ts`, with a fake inner `StreamFn`):
1. **Under cap → no retry.** A response with thinking below both caps calls the inner stream once, forwards every event, and returns its message with no cap diagnostics.
2. **Reasoning-token cap → one retry at lower effort.** Thinking passes the token cap before any text: the first call's signal is aborted, the inner stream is called a second time with `reasoning: "high"` (from `xhigh`), the consumer sees one `start`, and the final message carries one `response_reasoning_cap_retry` diagnostic with `reason: "reasoning_tokens"` and the first attempt's usage added.
3. **Wall-time cap → one retry.** A response that thinks past the wall cap (no deltas needed) is aborted and retried once at lower effort with `reason: "wall_time"`.
4. **Second overrun is not retried.** If the retry also passes a cap, the inner stream is still called exactly twice, the retry runs to completion, and a `response_reasoning_cap_overrun_after_retry` diagnostic is recorded.
5. **Feature off → no change.** With the flag unset, `resolveResponseReasoningCapConfig` returns `undefined` and the installer returns the inner `StreamFn` itself.
6. **Caller abort is not a cap.** If the caller's signal aborts, no retry happens and the aborted result is passed through.
7. **Answer already started → not cut.** Passing the cap after `text_start` or `toolcall_start` does not abort.
8. Wall cap honors the RemainingBudget clock: `min(cap, 15% budget, remaining − reserve)`, floor 30 s (unit test of the resolver).

### Requirement 2 - Gates (Priority: P0)

- biome, module-size, import-cycles, `tsgo --noEmit`, and the touched vitest files pass. First commit is this spec.
- New module under the 250 pure-LOC ceiling. No `any`.

## Measurement (A/B, pending benchmark credits)

- **Control build**: the same finish-check-enabled bench build used for R8/B′ (main + the unmerged finish-check stack #44 → #45 → #62 → #64), plus #63, with `OMK_RESPONSE_REASONING_CAP` unset.
- **Treatment build**: the identical build with only 033 added and `OMK_RESPONSE_REASONING_CAP=1`. Nothing else toggled.
- **Tasks** (Desk's target set), **3 runs each per arm**: adaptive-rejection-sampler, write-compressor, path-tracing-reverse, schemelike-metacircular-eval. Model grok-4.7 at `xhigh`, same TB timeouts as R8.
- **Report**: pass count per task per arm; count of `response_reasoning_cap_retry` and `..._overrun_after_retry` diagnostics from session JSONL; per-response max wall time and reasoning tokens; total cost per arm.
- **Merge rule** (Tech Lead): if the treatment does not beat control on the targeted set, it is not merged regardless of code quality.

## Non-goals

- No change to the HTTP idle timeout, provider retry, or `packages/ai` stream code.
- No default-on behavior and no `settings.json` key in this PR.
- No prompt or nudge changes.
- Not a total-turn or total-run budget. Bash timeouts stay under #63's clamp.
- Compaction and summary calls that go through `agent.streamFn` are wrapped too; they rarely think 20k tokens, and when they do the same rule applies. Not separately tuned.

## Expected Files

- `specs/033-response-reasoning-cap/spec.md`: this spec (first commit)
- `packages/coding-agent/src/core/response-reasoning-cap.ts`: config resolver and `StreamFn` wrapper
- `packages/coding-agent/src/core/sdk.ts`: install the wrapper around `createSdkProviderStream`
- `packages/coding-agent/test/response-reasoning-cap.test.ts`: acceptance cases above
