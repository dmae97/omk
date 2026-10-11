---
description: "CI guard that the cacheable request prefix (system prompt, tools, earlier messages) stays byte-identical during a session with every A/B flag on, plus a shared prompt-hash helper"
---

# Feature Specification: Prompt-cache prefix stability guard

**Specification ID**: `051-prompt-cache-stability`
**Feature Branch**: `test/prompt-cache-stability`
**Created**: 2026-10-11
**Status**: Draft
**Constitution**: [specs/constitution.md](../constitution.md)
**Input**: Tech Lead asked for a byte audit of system and tools across a multi-turn session with flags 031–035 on, before spec 037 (adaptive reasoning effort). Bench Analyst measured on R8 (262 omk runs, 9,593 calls): 16.1% of consecutive call pairs (previous prompt ≥ 4k tokens, gap < 5 min) read less than half of the previous prompt from cache, while only 0.5% of gaps exceed 5 minutes. TTL is not the cause, so either omk changes bytes or the provider misses. This spec decides which, for omk's side.
**OMK Preset**: `omk`

## CLI Harness Target Impact

**Classification**: test only, plus one new exported helper. No runtime behavior change.

| Dimension | Baseline (main `eda87d0`) | Acceptance target | Regression floor | Verification command | Evidence artifact |
| --- | --- | --- | --- | --- | --- |
| Cache prefix | Not tested | Every provider request in a multi-turn session with every A/B flag on has the same system hash and tools hash as the first call, and the previous call's messages are a byte-identical prefix of the next call's (per lane) | Same assertions with every flag off | `npx vitest run test/suite/prompt-cache-stability.test.ts` in `packages/coding-agent` | that file |
| Helper | none | `omk-ai/prompt-hash` exports `systemHash`, `toolsHash`, `messagesPrefixHash` | — | `npx vitest run test/prompt-hash.test.ts` in `packages/ai` | that file |

## What "the cacheable prefix" means here

Providers cache the longest exact prefix of a request: Anthropic in the order tools → system → messages, xAI and OpenAI chat completions as system message → messages (tools are sent too and must not change). A change anywhere in the system prompt invalidates every message after it. So the guard checks, at the `Context` the agent hands to the provider stream (`systemPrompt`, `tools`, `messages`):

- **(a) system**: `sha256(systemPrompt as UTF-8)` is the same on every call.
- **(b) tools**: `sha256(JSON of [{name, description, parameters}] in the order given)` is the same on every call. Keys are **not** re-sorted, so key-order nondeterminism shows up instead of being hidden.
- **(c) messages**: each earlier message of call *k* is byte-identical in call *k+1* (role, content, tool-result ids; local bookkeeping such as `timestamp` and `usage` is not sent and not compared).

Allowed, and marked in the test rather than ignored:

- **Spec 032 verifier lane.** The verifier deliberately starts from a fresh context. Its calls form their own lane with their own prefix rule. The main lane resumes after it and must still extend the main prefix.
- **Compaction.** The summary request is its own lane. Calls after a `compaction_end` start a new message prefix; system and tools must still match.

## Design

### 1. Shared helper: `packages/ai/src/prompt-hash.ts` (`omk-ai/prompt-hash`)

- `systemHash(context)`, `toolsHash(context)`, `serializePromptTools(context)`, `serializePromptMessage(message)`, `messagesPrefixHash(context, count?)`.
- Node-only (`node:crypto`), so it is a separate package entry, not part of the browser-safe index (`check:browser-smoke`).
- No dependency on `OMK_RUN_LOG_DIR` or any run-log code. Runtime Engineer's `llm-call.jsonl` (per-call `systemHash`/`toolsHash`) imports the same functions, so the CI guard and the run log agree byte for byte.

### 2. The session test: `packages/coding-agent/test/suite/prompt-cache-stability.test.ts`

- Real `AgentSession` via `test/suite/harness.ts` and the faux provider. The built-in harness extensions load in production order (identical-loop, tool-pair-repair, prompt-preset, goal-controller, deliverable-guard, finish-check).
- Flags on: `OMK_FINISH_CHECK=always`, `OMK_FINISH_CHECK_EXTRA_TURN=on` (035), `OMK_FINISH_CHECK_REVERIFY=on` (032), `OMK_DELIVERABLE_GUARD=always` (034), `OMK_TIME_BUDGET_SEC=900`. Spec 033 wraps the provider stream with `createResponseReasoningCapStreamFn`, as `createSdkProviderStream` does. Its cap is set low so one long-thinking response is cut and retried at one lower effort. Spec 031's prompt text lives in finish-check's discipline prompt.
- Every request is captured below the 033 wrapper, so the capped attempt and its retry are both checked.
- Two user tasks in one session. Task A finishes early, so finish-check's turn, the 032 verifier and the 035 fix turn all run. Task B runs at 40% (034 steer), 80% (033 cap retry, 75% save-now steer) and gets finish-check's turn. The test asserts that each of these texts actually reached the model, so the guard cannot pass vacuously.
- Variants: flags off (baseline); flags on with a manual compaction between the tasks; flags on with the six bundled skills (`resources/neo/skills`) and `contextBudget` off (the default); native `xai` with grok-harness skills (flags on and off).
- Expected failure (`it.fails`): flags on, bundled skills, `contextBudget.enabled: true`. Owned by spec 050. The case goes red when 050 makes it stable, and then `it.fails` becomes `it`.
- Self-test: an extension that appends a per-turn line to the system prompt and edits the first user message must be reported as exactly those two breaks.

## Results on main `eda87d0`

- **Flags on, flags off, and across compaction: no byte change.** System and tools hashes are constant, and every main-lane call extends the previous one. The 032 verifier, the 035 fix turn, the 034 and 75% steers, finish-check's turn, and the 033 retry (same context, effort `high` → `medium`) all append. None of them rewrites earlier messages. Extension follow-ups are queued into the running agent loop and do not rebuild the system prompt. Finish-check's discipline text and the prompt-preset block are appended once per user prompt and are static within a run.
- **Found, not fixed here: per-user-prompt active-skill selection.** In the native-`xai` variant (and the same way for Devin), `AgentSession._prompt` re-selects grok-harness skills from each new user prompt (`agent-session.ts:2611-2623`), and `buildSystemPromptPlan` renders them into the system prompt (`system-prompt.ts:218-219`, `formatActiveSkillsForPrompt` at `:270`). A second user prompt that selects a different set changes the system prompt bytes, and with them the whole cached prefix after them. On xAI chat completions the system prompt is the first message, so nothing after it is reused. One prompt is stable: every call of task A, including finish-check, the verifier and the fix turn, keeps one system hash. Single-prompt Terminal-Bench runs are therefore not affected. Interactive and multi-prompt sessions are affected. The test pins this as a known break, allowed only at a user-prompt boundary, so any other byte change still fails CI.
  - Why not fixed here: the fix changes where the model sees active skills, for every provider, flags on or off (the same question spec 050 owns). Proposed fix: keep the system prompt's active-skill section at the session's operator defaults, and put per-prompt harness or `!skill` selections in a custom message appended after the user message (`messages.push(...)` next to `_pendingNextTurnMessages` at `agent-session.ts:2606`). `agent-session.ts` has 3 lines of module-size headroom (4212/4215), so the logic belongs in a small helper module.
- **`contextBudget` skills section (pinned as expected failure, spec 050).** With `contextBudget.enabled` (off by default) or `OMK_CONTEXT_GOVERNOR=1`, `_prompt` passes the prompt text to the budget planner (`_getContextBudgetOptions(expandedText)`, `agent-session.ts:2627`). `renderSystemPromptBudgetedResources` (`system-prompt.ts:200-207`) then ranks and selects the skills section of the system prompt against that text. With the six bundled skills, task B's system prompt lists them in a different order (first byte difference inside `<available_skills>`, call 7 of 12). In this harness the rebuild happens once per user prompt. Every call of task A, including finish-check's turn, the verifier and the fix turn, keeps one hash. Spec 050 (OMK) replaces this with an appended message, so it is not fixed here. With `contextBudget` off, the same six skills keep the prefix stable.
- **Same class, lower impact.** `Current date:` (`system-prompt.ts:223`) changes the system prompt on the first user prompt after midnight.

## Provider layer (packages/ai) findings, for follow-up

- **Tool order and schema keys are deterministic on the wire.** Anthropic, OpenAI Responses and chat completions send `stableTools(...)`: tools sorted by name, then description, then canonical schema (`tool-schema.ts:88-109`), with schema keys canonically sorted. No `Date`/random value goes into request bodies. The only `Date.now()` in message conversion is the `timestamp` of a synthetic tool result (`transform-messages.ts:175`), which is not serialized.
- **xAI chat completions send no cache routing.** No `x-grok-conv-id` header. `prompt_cache_key` only for `api.openai.com` or long retention (`openai-completions.ts:514-518`). Session-affinity headers are off for xAI (`openai-completions-compat.ts:106`, used at `openai-completions.ts:472`). xAI documents that `x-grok-conv-id` routes a conversation to the same cache server and is the recommended way to get hits. Without it, misses on unchanged prefixes are expected. This fits Bench Analyst's 16% with no omk byte change. Proposed fix (a provider change, needs its own A/B): send `x-grok-conv-id: <sessionId>` for `provider === "xai"` / `api.x.ai`.
- **Extension-modified system prompts drop cache hints.** Finish-check (default on in headless runs) and prompt-preset append to the system prompt. `agent-session.ts:2658` then treats the result as not cache-boundary-preserving because it is not byte-equal, although it starts with the planned prompt. Effects: Anthropic sends the system prompt as one block without `cache_control` (`anthropic.ts:1284`). The prefix is still cached through the tools and last-user-message breakpoints, but the system breakpoint is lost. OpenAI gets no `prompt_cache_key` (`openai-prompt-cache.ts:45`). Proposed fix: `preservesCacheBoundary = result.systemPrompt.startsWith(turnSystemPrompt.prompt)`. This changes cache metadata only, no model-visible text.
- **Anthropic breakpoints today:** the system prompt's stable prefix block (when a boundary is known), the last tool (`anthropic.ts:1326`), and the last block of the last user message (`anthropic.ts:1240-1260`). That is three of the four allowed breakpoints. Breakpoint placement does not depend on timestamps or ids.
- **Reasoning effort.** The 033 retry runs at one lower effort. On Anthropic a thinking-budget change invalidates message-level cache (system and tools stay). On xAI it does not matter. Spec 037 must count these switches. The session-level auto thinking mode (`_applyAutoThinkingLevelForTurn`, `agent-session.ts:2600`) is per user prompt and off by default (`manual`).

## Not verified

- Live provider bytes: the guard checks the `Context` handed to the provider stream, not the HTTP body. The wire-level points above come from reading `packages/ai`.
- Whether R8's bench skills inventory contained grok-harness allowlisted skills (`packages`, `programming`, `debugging`, `headroom`, …). The bundled Neo skills do not.
- Whether grok-4.7 returns `reasoning_content` that omk should send back. xAI names omitting it as a top cause of misses.

## Acceptance

1. `prompt-cache-stability.test.ts` passes on main with the known-break pin. Any new byte change inside a user prompt fails it.
2. `prompt-hash.test.ts` passes. The helper is importable as `omk-ai/prompt-hash` and is not part of the browser index.
3. No `src` behavior change.
