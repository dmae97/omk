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

A `StreamFn` wrapper, `createResponseReasoningCapStreamFn(inner, config)`, in `packages/coding-agent/src/core/response-reasoning-cap.ts`, applied inside `createSdkProviderStream` (`core/sdk-provider-stream.ts`), which builds the main agent's `streamFn`. No change to `packages/ai` or `packages/agent`.

1. **Activation.** Off unless `OMK_RESPONSE_REASONING_CAP=1`. When off, the wrapper is not installed at all.
2. **Caps (per response attempt).**
   - Reasoning tokens: `OMK_RESPONSE_REASONING_CAP_TOKENS`, default **20000** (the Desk's split point). Counted live as `max(ceil(thinking chars / 4), partial.usage.output)` while the response has produced no text and no tool call. `usage.output` is only used when the provider streams it.
   - Wall time: `OMK_RESPONSE_WALL_CAP_SEC`, default **240 s**. When the run clock is active (`OMK_TIME_BUDGET_SEC`, started once at run start by #63/spec 036 and only read here, so both A/B arms share one origin) the cap is `min(240 s, 15% of the budget, remaining − save reserve)`, floored at 30 s. For the 900 s ARS budget that is 135 s; for a 3600 s task 240 s.
3. **Only runaway thinking is cut.** Caps are checked only until the first `text_start` or `toolcall_start`. Once the model is answering or calling a tool, the response is allowed to finish; cutting it would waste the work it just did.
4. **On overrun.** Abort the attempt through a private `AbortController` linked to the caller's signal, drain it without forwarding its terminal event, then call the inner stream again with `reasoning` lowered one step (`ultra`/`max` → `xhigh` → `high` → `medium` → `low` → `minimal`). Retry happens **at most once per response**. If there is no lower level (`minimal`, off, or no `reasoning`), the cap is not enforced.
5. **Second attempt.** Caps are still measured but not enforced: a second abort would leave the turn with no assistant message and end the run. An overrun on the retry is recorded only.
6. **Transcript.** Events from the first attempt are forwarded as usual (the UI shows the thinking). The retry's `start` event is suppressed so the consumer keeps one assistant message; the retry's updates and final message replace it.
7. **Recording.** The final message gets `diagnostics` entries, which are saved in the session JSONL with the assistant message, so the bench can count them:
   - `response_reasoning_cap_retry` with `{ reason: "reasoning_tokens" | "wall_time", fromEffort, toEffort, reasoningTokens, elapsedMs, capTokens, capMs }`
   - `response_reasoning_cap_overrun_after_retry` with the same fields when the retry also passes a cap.
   Usage (review #96 M1): the final message's **token** fields (`input`, `output`, `cacheRead`, `cacheWrite`, `totalTokens`) come from the **last attempt only**, because `calculateContextTokens` (`core/compaction/compaction.ts`) reads `totalTokens`, or falls back to the sum of those fields, as the context size. Summing them would make the context look up to 2× and fire compaction early. Only **`cost.*`** is summed, since both requests are billed. The aborted attempt's full usage (tokens and cost) is kept in the retry diagnostic as `details.abortedAttemptUsage`, so the bench can count billed tokens.
8. **Listener cleanup** (review #96 M2): the abort link on the caller's signal is removed in a `finally` that also covers a throw from the first `inner()` call (setup errors such as auth). The error still propagates exactly as before.
9. **No prompt change.** The Desk suggested also adding a "run one command now" nudge. It is left out so the A/B measures one change (effort reduction). It is a follow-up variant if this one shows no gain.

### Run log: `reasoning-cap.jsonl` (spec 042)

Bench runs use `--no-session --mode json`, so the diagnostics above never reach a session JSONL. With the cap on **and** `OMK_RUN_LOG_DIR` set, the wrapper also appends to `<OMK_RUN_LOG_DIR>/reasoning-cap.jsonl` through `appendRunLog` (which adds `t`, `elapsedFraction`, `pid`, `role`). With the flag off the wrapper is not installed, so nothing is written; with no `OMK_RUN_LOG_DIR` no file or directory is created.

- `{ event: "retry", attempt, reason, fromEffort, toEffort, reasoningTokens, elapsedMs, capTokens, capMs, input, cacheRead, cacheWrite, output, totalTokens }`: written when a first attempt is cut, before the retry is sent. The cap fields equal the `response_reasoning_cap_retry` diagnostic; the token fields are the aborted attempt's usage (`abortedAttemptUsage`).
- `{ event: "retry_end", attempt, input, cacheRead, cacheWrite, output, totalTokens, stopReason }`: the retry's own usage when it finishes within the caps.
- `{ event: "overrun_after_retry", attempt, reason, fromEffort, toEffort, reasoningTokens, elapsedMs, capTokens, capMs, input, cacheRead, cacheWrite, output, totalTokens, stopReason }`: written **instead of** `retry_end` when the retry also passes a cap (same fields as the `..._overrun_after_retry` diagnostic, plus the retry's usage).

**Invariant: every `retry` line has exactly one terminal line** (`retry_end` or `overrun_after_retry`) with the same `attempt`. If the retry call throws, its stream fails, or the caller aborts, `retry_end` is still written, with `stopReason` `"error"` or `"aborted"` and zero tokens when there is no usage. `attempt` is a per-process counter, so lines pair on (`pid`, `attempt`); subagent workers append to the same file with their own `pid`.

Privacy (spec 042): numbers, the cap reason, effort level names and the `stopReason` enum only. No prompt, thinking or answer text, and no error message.

Logging is best effort: `appendRunLog` never throws, and the wrapper's events, final message and usage are the same with or without `OMK_RUN_LOG_DIR`.

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
2. **Reasoning-token cap → one retry at lower effort.** Thinking passes the token cap before any text: the first call's signal is aborted, the inner stream is called a second time with `reasoning: "high"` (from `xhigh`), the consumer sees one `start`, and the final message carries one `response_reasoning_cap_retry` diagnostic with `reason: "reasoning_tokens"`. Its token fields equal the retry's, its `cost.total` is the sum, and `details.abortedAttemptUsage` holds the first attempt's usage.
3. **Wall-time cap → one retry.** A response that thinks past the wall cap (no deltas needed) is aborted and retried once at lower effort with `reason: "wall_time"`.
4. **Second overrun is not retried.** If the retry also passes a cap, the inner stream is still called exactly twice, the retry runs to completion, and a `response_reasoning_cap_overrun_after_retry` diagnostic is recorded.
5. **Feature off → no change.** With the flag unset, `resolveResponseReasoningCapConfig` returns `undefined` and the installer returns the inner `StreamFn` itself.
6. **Caller abort is not a cap.** If the caller's signal aborts, no retry happens and the aborted result is passed through.
7. **Answer already started → not cut.** Passing the cap after `text_start` or `toolcall_start` does not abort.
8. Wall cap honors the RemainingBudget clock: `min(cap, 15% budget, remaining − reserve)`, floor 30 s (unit test of the resolver).
9. **Context size is not inflated**: after a capped retry, `calculateContextTokens(final.usage)` equals the retry's own value (failed before this fix, when it was the sum).
10. **No listener leak**: if the first `inner()` throws, the error propagates and no abort listener stays on the caller's signal.
11. **Run log** (`test/response-reasoning-cap-run-log.test.ts`, temp `OMK_RUN_LOG_DIR`): flag off writes no `reasoning-cap.jsonl`; no `OMK_RUN_LOG_DIR` writes no file and throws nothing; one cut gives one `retry` and one `retry_end` with the same `attempt` and the retry's token numbers; an overrun retry gives `overrun_after_retry` and no `retry_end`; a retry that throws or is aborted still gets one `retry_end`; two cuts give two pairs with distinct `attempt`; the file never contains the fake stream's thinking, answer or error text.

### Requirement 2 - Gates (Priority: P0)

- biome, module-size, import-cycles, `tsgo --noEmit`, and the touched vitest files pass. First commit is this spec.
- New module under the 250 pure-LOC ceiling. No `any`.

## Measurement (A/B, pending benchmark credits)

- **Pin**: main `d69af96` (Tech Lead's joint A/B pin; it has 032–035 and the run logs `finish-check`, `deliverable-guard`, `reasoning-cap`). 033 is measured in the joint A/B with arms A–E on that one build (Bench Analyst's plan, `/workspace/omk-bench-analyst/AB_PLAN_d69af96.md`). 033's verdict is **A vs B**.
- **One build, one flag.** A runs with all new opt-in flags off; B sets only `OMK_RESPONSE_REASONING_CAP=1`. `OMK_FINISH_CHECK_EXTRA_TURN` (035), `OMK_FINISH_CHECK_REVERIFY` (032), `OMK_DELIVERABLE_GUARD` (034) and `OMK_ADAPTORCH_ENSEMBLE` (038) are off in both. Finish-check itself runs in its default headless mode in both arms, as in R8. Both arms read one run clock started at process start (spec 036); the cap only reads it. Older pins (the main commit that merges #96, main `47e78c4` + #44/#45/#62/#64/#63 SHAs) are retired.
- **Shared arms**: A is the shared control for 033, 034 and 035, so if A is low by chance all three look better together. Report the A/B result with this caveat.
- **Tasks** (Desk's target set), **3 runs each per arm**: adaptive-rejection-sampler, write-compressor, path-tracing-reverse, schemelike-metacircular-eval. Model grok-4.7 at `xhigh`, same TB timeouts as R8. Benches run `omk --no-session --mode json` with `OMK_RUN_LOG_DIR` set in every arm.
- **Stage 0 smoke (B only, about $2)**: adaptive-rejection-sampler, write-compressor, schemelike-metacircular-eval, once each, before any other arm. Stop and report if (1) the `retry` line count in `reasoning-cap.jsonl` does not match the "no usage chunk" line count (pair on `pid`, `attempt`), or (2) every cut is `wall_time` with `reasoningTokens` near 0; then B tests only the wall-time cap, and that is reported instead of running on. Bench Analyst's plan also expects (3) some retries to end normally (`retry_end`). If the smoke passes, its runs count as B's first repetition.
- **Report**: pass count per task per arm; count of `retry` and `overrun_after_retry` lines in `<OMK_RUN_LOG_DIR>/reasoning-cap.jsonl` (no session JSONL in bench runs; the `message_end` diagnostics in `omk.jsonl` are a cross-check only); per-response max wall time and reasoning tokens.
- **Cost** in xAI `cost_in_usd_ticks` from the adapter's `omk_usage_raw.jsonl`, not omk's `usage.cost`, which leaves out reasoning tokens. An aborted first attempt may have no xAI usage line, so B's cost is a **[lower, upper] interval**. Per cut attempt, lower = `reasoningTokens` as output plus the `retry_end` `input`/`cacheRead`; upper = `capTokens` (or `elapsedMs` × the run's mean output rate, for a `wall_time` cut) as output plus the same `retry_end` `input`/`cacheRead`. A cost conclusion is stated only if both ends agree; otherwise "cost verdict deferred".
- **Verdict** (paired by task × repetition): **effect** when B meets the Benchmark row's acceptance target and a sign test on the discordant pairs points the same way → PR to turn the default on; **no effect** when the 95% CI upper bound of the pass difference is below that target → PR removing the flag and its code; otherwise **inconclusive** → flag stays off and gets more runs next round, reported with the discordant-pair count and the runs needed. With 3 runs per task, inconclusive is the likely outcome; the report says so in its first line.

## Non-goals

- No change to the HTTP idle timeout, provider retry, or `packages/ai` stream code.
- No default-on behavior and no `settings.json` key in this PR.
- No prompt or nudge changes.
- Not a total-turn or total-run budget. Bash timeouts stay under #63's clamp.
- Compaction and summary calls that go through `agent.streamFn` are wrapped too; they rarely think 20k tokens, and when they do the same rule applies. Not separately tuned.

## Expected Files

- `specs/033-response-reasoning-cap/spec.md`: this spec (first commit)
- `packages/coding-agent/src/core/response-reasoning-cap.ts`: config resolver and `StreamFn` wrapper
- `packages/coding-agent/src/core/sdk-provider-stream.ts`: `createSdkProviderStream` returns the wrapped stream function (keeps `sdk.ts` under its module-size baseline)
- `packages/coding-agent/test/response-reasoning-cap.test.ts`: acceptance cases above
- `packages/coding-agent/src/core/response-reasoning-cap-run-log.ts`: `reasoning-cap.jsonl` line builders (keeps the wrapper module under the 250 pure-LOC ceiling)
- `packages/coding-agent/test/response-reasoning-cap-run-log.test.ts`: run-log lines and the one-terminal-line-per-retry invariant
