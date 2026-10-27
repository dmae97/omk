# Spec 116: compaction comparison (omk vs Codex CLI, OpenHands, Aider, SWE-agent) and default-off candidates

Status: draft (spec only, no code). Base: omk `d6737aa35e` (main after #250).
Candidate 3 of the 107 A/B queue (Agent Researcher order: truncate-middle, edit fuzzy-indent, **compaction**).
Implementation is gated (see Gate); until then this spec is the only deliverable. 0 new dependencies.

Sources are pinned to commits. Claude Code and any GPL code: ideas only, no code (none is used below).

## 1. omk today (`d6737aa35e`)

| aspect | behaviour | ref |
|---|---|---|
| defaults | `reserveTokens: 16384`, `keepRecentTokens: 20000`, `maxUsageRatio: 0.9` | [compaction-headroom.ts:18-24](https://github.com/dmae97/omk/blob/d6737aa35e/packages/coding-agent/src/core/compaction/compaction-headroom.ts#L18-L24) |
| trigger | `triggerTokens = min(window*maxUsageRatio, window - reserved budget, input-ceiling bound)` | [compaction-headroom.ts:41-83](https://github.com/dmae97/omk/blob/d6737aa35e/packages/coding-agent/src/core/compaction/compaction-headroom.ts#L41-L83), [:133-135](https://github.com/dmae97/omk/blob/d6737aa35e/packages/coding-agent/src/core/compaction/compaction-headroom.ts#L133-L135) |
| hysteresis | rearm `0.75 x trigger`, emergency ratio `0.98` (capped by input ceiling) | [compaction-headroom.ts:112-128](https://github.com/dmae97/omk/blob/d6737aa35e/packages/coding-agent/src/core/compaction/compaction-headroom.ts#L112-L128), call site [agent-session.ts:3515](https://github.com/dmae97/omk/blob/d6737aa35e/packages/coding-agent/src/core/agent-session.ts#L3515) |
| reasons | `manual` / `threshold` / `overflow` | [agent-session.ts:362](https://github.com/dmae97/omk/blob/d6737aa35e/packages/coding-agent/src/core/agent-session.ts#L362), [:3538](https://github.com/dmae97/omk/blob/d6737aa35e/packages/coding-agent/src/core/agent-session.ts#L3538), [:3937](https://github.com/dmae97/omk/blob/d6737aa35e/packages/coding-agent/src/core/agent-session.ts#L3937) |
| kept verbatim | newest messages until >= `keepRecentTokens`; cut only at user/assistant entries, never at a tool result; split turn gets its own prefix summary | [compaction.ts:333-400](https://github.com/dmae97/omk/blob/d6737aa35e/packages/coding-agent/src/core/compaction/compaction.ts#L333-L400), [:262](https://github.com/dmae97/omk/blob/d6737aa35e/packages/coding-agent/src/core/compaction/compaction.ts#L262), [:695](https://github.com/dmae97/omk/blob/d6737aa35e/packages/coding-agent/src/core/compaction/compaction.ts#L695) |
| summary prompt | fixed sections Goal / Constraints / Progress / Key Decisions / Next Steps / Critical Context; incremental `UPDATE_` prompt with `<previous-summary>` | [compaction.ts:432-463](https://github.com/dmae97/omk/blob/d6737aa35e/packages/coding-agent/src/core/compaction/compaction.ts#L432-L463), [:465](https://github.com/dmae97/omk/blob/d6737aa35e/packages/coding-agent/src/core/compaction/compaction.ts#L465), system prompt [utils.ts:220](https://github.com/dmae97/omk/blob/d6737aa35e/packages/coding-agent/src/core/compaction/utils.ts#L220) |
| summary budget | `0.8 x reserveTokens` (turn-prefix: `0.5 x`) | [compaction.ts:538](https://github.com/dmae97/omk/blob/d6737aa35e/packages/coding-agent/src/core/compaction/compaction.ts#L538), [:883](https://github.com/dmae97/omk/blob/d6737aa35e/packages/coding-agent/src/core/compaction/compaction.ts#L883) |
| tool output in summarizer input | each tool result head-truncated to 2000 chars, tool-call arg 500, all calls 4000 | [utils.ts:126-141](https://github.com/dmae97/omk/blob/d6737aa35e/packages/coding-agent/src/core/compaction/utils.ts#L126-L141), [:208](https://github.com/dmae97/omk/blob/d6737aa35e/packages/coding-agent/src/core/compaction/utils.ts#L208) |
| tool output in live context | not touched until compaction; no observation masking found (grep for mask/elide/prune in `src/core`) | weak evidence: absence by grep only |
| file refs | `<read-files>` / `<modified-files>` appended deterministically, carried across compactions via `details` | [compaction.ts:852-863](https://github.com/dmae97/omk/blob/d6737aa35e/packages/coding-agent/src/core/compaction/compaction.ts#L852-L863), [utils.ts:46-56](https://github.com/dmae97/omk/blob/d6737aa35e/packages/coding-agent/src/core/compaction/utils.ts#L46-L56), [:99-116](https://github.com/dmae97/omk/blob/d6737aa35e/packages/coding-agent/src/core/compaction/utils.ts#L99-L116) |
| rules | spec 018 injects preserved user rules after generation | [specs/018](../018-type-aware-compaction/spec.md) |
| run log | no compaction record in `appendRunLog` today (grep of callers) | [run-log.ts:50](https://github.com/dmae97/omk/blob/d6737aa35e/packages/coding-agent/src/core/run-log.ts#L50) |

## 2. Other harnesses

| harness (license) | trigger | kept verbatim | summary method | tool output | refs |
|---|---|---|---|---|---|
| Codex CLI (Apache-2.0) | `auto_compact_token_limit`, default and clamp = 90% of context window | recent **user messages only**, newest first, up to `COMPACT_USER_MESSAGE_MAX_TOKENS = 20_000`; last one truncated; plus summary with prefix | model is asked with a short handoff prompt; on window overflow during compaction it drops the oldest item and retries | old tool outputs dropped; only explicitly marked client-authored outputs retained whole or dropped | [openai_models.rs:465-469](https://github.com/openai/codex/blob/7d592f6dd9988e349e3164feaa21d0fc14bbac8a/codex-rs/protocol/src/openai_models.rs#L465-L469), [:534-545](https://github.com/openai/codex/blob/7d592f6dd9988e349e3164feaa21d0fc14bbac8a/codex-rs/protocol/src/openai_models.rs#L534-L545), [compact.rs:63](https://github.com/openai/codex/blob/7d592f6dd9988e349e3164feaa21d0fc14bbac8a/codex-rs/core/src/compact.rs#L63), [:358-367](https://github.com/openai/codex/blob/7d592f6dd9988e349e3164feaa21d0fc14bbac8a/codex-rs/core/src/compact.rs#L358-L367), [:403-406](https://github.com/openai/codex/blob/7d592f6dd9988e349e3164feaa21d0fc14bbac8a/codex-rs/core/src/compact.rs#L403-L406), [:710-800](https://github.com/openai/codex/blob/7d592f6dd9988e349e3164feaa21d0fc14bbac8a/codex-rs/core/src/compact.rs#L710-L800), [prompt.md](https://github.com/openai/codex/blob/7d592f6dd9988e349e3164feaa21d0fc14bbac8a/codex-rs/prompts/templates/compact/prompt.md), [compact_retained_tool_outputs.rs](https://github.com/openai/codex/blob/7d592f6dd9988e349e3164feaa21d0fc14bbac8a/codex-rs/core/src/compact_retained_tool_outputs.rs) |
| OpenHands SDK (MIT) | event count `> max_size=240`, or tokens `> max_tokens`, or explicit request | first `keep_first=2` events + tail (~half of `max_size`, or tokens down to `max_tokens/2`) | LLM summary of forgotten events with state sections (USER_CONTEXT, TASK_TRACKING, CODE_STATE, TESTS, CHANGES, VERSION_CONTROL_STATUS) | each forgotten event optionally truncated (`max_event_str_length`); legacy `ObservationMaskingCondenser` replaced observations outside last `attention_window=5` events with `<MASKED>` | [llm_summarizing_condenser.py:64-74](https://github.com/OpenHands/software-agent-sdk/blob/dd0892c80fffb1e59bac77242adafbd8b1168649/openhands-sdk/openhands/sdk/context/condenser/llm_summarizing_condenser.py#L64-L74), [:140-176](https://github.com/OpenHands/software-agent-sdk/blob/dd0892c80fffb1e59bac77242adafbd8b1168649/openhands-sdk/openhands/sdk/context/condenser/llm_summarizing_condenser.py#L140-L176), [:248-256](https://github.com/OpenHands/software-agent-sdk/blob/dd0892c80fffb1e59bac77242adafbd8b1168649/openhands-sdk/openhands/sdk/context/condenser/llm_summarizing_condenser.py#L248-L256), [:300-330](https://github.com/OpenHands/software-agent-sdk/blob/dd0892c80fffb1e59bac77242adafbd8b1168649/openhands-sdk/openhands/sdk/context/condenser/llm_summarizing_condenser.py#L300-L330), [summarizing_system.j2](https://github.com/OpenHands/software-agent-sdk/blob/dd0892c80fffb1e59bac77242adafbd8b1168649/openhands-sdk/openhands/sdk/context/condenser/prompts/summarizing_system.j2), [observation_masking_condenser.py:11-28](https://github.com/All-Hands-AI/OpenHands/blob/0.59.0/openhands/memory/condenser/impl/observation_masking_condenser.py#L11-L28) |
| Aider (Apache-2.0) | `done_messages` tokens `> max_chat_history_tokens` = `min(max(max_input/16, 1024), 8192)`; runs in a background thread | tail up to half the budget, split at an assistant message | recursive (depth <= 3) "briefly summarize", written as the user; must keep file/function names, no code blocks | no tool outputs in this sense; file contents are re-sent each turn, not part of history (weak: from code structure, not a doc) | [history.py:27-96](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/history.py#L27-L96), [models.py:356-358](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/models.py#L356-L358), [prompts.py:46-61](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/prompts.py#L46-L61), [base_coder.py:1002-1014](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/coders/base_coder.py#L1002-L1014) |
| SWE-agent (MIT) | no LLM summary; processors run on every query | everything except old observations | none | `last_n_observations`: observations older than last `n` become `Old environment output: (N lines omitted)`; `polling` keeps prefix cache stable; tags force keep/remove; `closed_window` collapses stale file windows | [history_processors.py:85-175](https://github.com/SWE-agent/SWE-agent/blob/3ea751c087f32b16e039a2233dd6eefecef325d5/sweagent/agent/history_processors.py#L85-L175), [:215-258](https://github.com/SWE-agent/SWE-agent/blob/3ea751c087f32b16e039a2233dd6eefecef325d5/sweagent/agent/history_processors.py#L215-L258), [config/default.yaml:67-69](https://github.com/SWE-agent/SWE-agent/blob/3ea751c087f32b16e039a2233dd6eefecef325d5/config/default.yaml#L67-L69) |

Takeaways (observations, not measured effects):

- omk's trigger (90% + reserve + hysteresis) is already as strict as Codex; no candidate on trigger.
- omk is the only one of the five that keeps stale tool outputs in live context at full size until compaction. SWE-agent and legacy OpenHands mask them **without an LLM call**.
- omk's summary prompt has no explicit test/error/VCS state section (OpenHands has `TESTS`, `VERSION_CONTROL_STATUS`).
- Codex keeps recent user messages verbatim across compaction; omk keeps a token tail of all roles.

## 3. Candidates (all default off, read per call from `process.env`, value `1` = on)

### C1 `OMK_COMPACT_MASK_STALE_TOOL_OUTPUT`: mask old tool results before the threshold

Idea from SWE-agent `last_n_observations` and OpenHands `ObservationMaskingCondenser` (MIT, written fresh, no port).
On request assembly (not in the session file), tool results older than the last `N=5` tool results are
replaced by `[old tool output: <lines> lines, <bytes> bytes omitted; re-run to see]`. Masking advances in
steps of `polling=5` so the prompt prefix stays cache-stable. Never mask: the newest N, results of
`edit`/`write` errors, any result inside the kept tail of the latest compaction.

- Hypothesis: fewer threshold compactions per task and lower input tokens, at no pass-rate loss. Unproven.
- Risk: the model re-runs commands; tokens may go up. That is what the A/B checks.

### C2 `OMK_COMPACT_STATE_SECTIONS`: add test/error and VCS state to the summary prompt

Idea from OpenHands `summarizing_system.j2` (`TESTS`, `VERSION_CONTROL_STATUS`). Adds two sections to
`SUMMARIZATION_PROMPT` and `UPDATE_SUMMARIZATION_PROMPT`: `## Tests & Errors` (last failing command, exact
error text) and `## Repository State` (branch, uncommitted files). Prompt-only change.

- Hypothesis: fewer repeated test runs right after a compaction. Unproven.

### C3 `OMK_COMPACT_KEEP_USER_MESSAGES`: keep recent user messages verbatim

Idea from Codex `build_compacted_history_with_limit` (Apache-2.0; written fresh, no port, so no NOTICE).
User messages before the cut point, newest first, up to 4000 estimated tokens, are re-inserted verbatim
before the summary. (4000 is a starting value for omk's single-task TB runs, not taken from Codex's 20 000.)

- Hypothesis: fewer instruction-drift failures after compaction. Weakest candidate for TB 4.0, where most tasks have one user message; expected to be a no-op there.

### Observe-only run log (no flag, lands first, separate small PR)

When `OMK_RUN_LOG_DIR` is set, append one line to `compaction.jsonl` per compaction. Counts and hashes only, no content:

`{sessionId, parentSessionId, seq, reason, tokensBefore, tokensAfter, summaryTokens, keptEntries, droppedEntries,
droppedToolResults, droppedToolResultBytes, staleToolResultBytesAtTrigger, userMessagesBeforeCut, isSplitTurn,
summarySha256, flags:{c1,c2,c3}}`

`staleToolResultBytesAtTrigger` = bytes of tool results that C1 would have masked at that moment (computed, never applied, when C1 is off).
For C1 also log per request `{maskedCount, maskedBytes}` to `compaction-mask.jsonl` only when the flag is on.

### Tests (per candidate, flag on and off)

- Off: request payload and session file byte-identical to today (snapshot test).
- C1: masks exactly results older than the last N; polling keeps the masked set constant within a step; error results and kept-tail results are never masked; session file is unchanged.
- C2: both prompts contain the new headings only when on; spec 018 rule injection still appended.
- C3: kept user messages are verbatim, newest-first within budget, de-duplicated against the kept tail.
- Run log: written only with `OMK_RUN_LOG_DIR`; no message text in any field (assert no field longer than 64 chars except hash).

## 4. Gate (before implementing a candidate)

Run the observe-only log on the A/B baseline (main, all flags off), TB 4.0 66 tasks. Implement only when:

- C1: >= 3 tasks with >= 1 threshold/overflow compaction where `staleToolResultBytesAtTrigger / tokensBefore-bytes` is the majority (> 50%).
- C2: >= 3 tasks where a test command identical by hash (bash log, spec 113 field set) is re-run within 3 turns after a compaction.
- C3: >= 3 tasks with `userMessagesBeforeCut >= 1`.

Count by task (lead + workers grouped via `parentSessionId`). Under 3 → candidate is parked, not implemented.
If no task compacts at all on TB 4.0, the whole spec is parked (weak-evidence outcome, report it as such).

## 5. A/B plan (team rule)

- Benchmark TB 4.0, 66 tasks x n >= 5 per arm, one flag per arm vs all-off control.
- Base SHA = main at time of A/B (record it).
- Pass: task-clustered 95% CI lower bound of pass-rate delta > -3 points, total tokens <= 1.10x control, wall time <= 1.25x control.
- Cache guardrail (C1 changes earlier request content, so it can break prompt-cache hits): report cache-read tokens and cost per arm from the provider usage fields. Pass also requires cost <= 1.10x control; a cache-read token drop is reported with its task-clustered 95% CI and is not waived by a pass-rate gain.
- Secondary (report only): compactions per task, tokens after compaction.
- Paid runs need 인호's dollar cap; nothing runs before that.

## Out of scope

Trigger changes, remote/server-side compaction (Codex `compact_remote*`), changing the session file format.
