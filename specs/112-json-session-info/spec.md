# Spec 112: `OMK_JSON_SESSION_INFO`: system prompt + tool definitions in `--mode json`

Status: draft (spec only, no code). Depends on spec 110 (ATIF export, PR #231) masking rules.

## Problem

Spec 110 Q3 found that `--mode json` carries neither the system prompt nor the tool
definitions (pinned at omk `9e03b40b77`):

- `packages/coding-agent/src/modes/print-mode.ts:198-202`: json mode writes
  `sessionManager.getHeader()` first.
- `packages/coding-agent/src/core/session-listing.ts:7-14`: `SessionHeader` is only
  `type, version, id, timestamp, cwd, parentSession`.
- `packages/coding-agent/src/modes/print-mode.ts:186-188`: then each `AgentEvent` verbatim
  (`print-mode.ts:58` adds `session_termination`).
- `packages/agent/src/types.ts:705-725` (`AgentEvent`) and
  `packages/agent/src/provider-request-types.ts:42-63` (`ProviderRequestEvent`): no tool
  schemas, no system prompt.
- Tools exist only in memory: `packages/coding-agent/src/core/agent-session.ts:2041`
  (`tools: this.agent.state.tools`). The run log holds only `systemHash` / `toolsHash`
  (`packages/coding-agent/src/core/llm-call-run-log.ts`).

So the spec 110 exporter always falls back to a hash placeholder for the system step and
omits ATIF `agent.tool_definitions` (optional, harbor `209a48a`
`src/harbor/models/trajectories/agent.py:23`).

## Change

New env flag `OMK_JSON_SESSION_INFO`, **default off**.

- **Off (unset, empty, or anything but `1`)**: no code path changes; `--mode json` stdout is
  byte-identical to main.
- **On (`1`) and `--mode json`**: emit the first `omk_session_info` line right after the
  header line (`print-mode.ts:198-202`), before any event, and a new line whenever
  `systemHash` or `toolsHash` changes (e.g. after compaction or a model switch). No re-emit
  while both hashes are unchanged.

  ```json
  {"type":"omk_session_info","seq":1,"systemHash":"<hex>","toolsHash":"<hex>","systemPrompt":"<string>","tools":[{"name":"...","description":"...","parameters":{...}}]}
  ```

  Only these fields. `seq` starts at 1 and increments by 1 per emitted line. `systemHash` /
  `toolsHash` use the same functions as the `llm-call` run log (`llm-call-run-log.ts`).
  `systemPrompt` is the final string actually sent to the provider (after all extension /
  skill / cache-boundary processing), not an intermediate value. `tools[]` entries carry only `name`, `description`, `parameters` (JSON
  schema as given to the model). Nothing else (no cwd, env, model, settings).
- Other modes (text, interactive, rpc): flag ignored.
- Workers: subagent worker processes inherit the flag through env and emit their own
  `omk_session_info` lines in their own json stream; spec 110 maps them into
  `subagent_trajectories`.
- Model input unchanged: the line is built from the same in-memory values the session
  already sends; it does not alter the system prompt, tool list, order or cache prefix.
- **Run log rule unchanged**: `appendRunLog` records keep hashes only; this spec writes
  nothing to `OMK_RUN_LOG_DIR`.
- 0 new dependencies.

## Masking

The flag writes raw text to stdout (same trust level as the existing json event stream,
which already contains prompts and tool output). Masking is done by the spec 110 exporter,
not in omk runtime: every emitted string (`systemPrompt`, all `tools[]` strings incl. `description` and strings
inside `parameters`) goes through spec 110's
masking pass (secret-named env vars, `sk-`/`xai-`/`ghp_`/`Bearer` shapes) before
`trajectory.json` is written. Mapping: `systemPrompt` → first step `source:"system"`
`message`; `tools` → `agent.tool_definitions`.
Spec 110 maps the first (seq 1) line only: seq 2 and later `omk_session_info` lines are kept only in
`extra.omk.eventLog` (masked); mapping them is a follow-up.

## Success criteria

1. Flag off: `--mode json` stdout byte-identical to main for a fixed fake-provider run
   (golden comparison test).
2. Flag on, no change during the run: exactly one `omk_session_info` line, at line index 1
   (right after header), with exactly the keys `type, seq, systemHash, toolsHash,
   systemPrompt, tools` and per tool exactly `name, description, parameters`.
2a. Flag on, each change of system prompt or tools (simulated compaction / model switch):
   exactly one new line, `seq` +1, new hashes; unchanged hashes => no new line.
2b. `systemHash` of the emitted line == the run log `llm-call.systemHash` of the following
   request, and `systemPrompt` == the string captured at the fake provider.
2c. Worker process with inherited env emits its own line(s).
3. Flag on: the provider request (system prompt, tools, messages) is identical to flag off
   (captured via fake stream function).
4. Run log files byte-identical (modulo `t`/`pid`) between on and off.
5. Researcher criterion: after spec 110 masking of a flag-on stream seeded with fake
   `TYPESAFE_API_KEY` and key-shaped strings in the system prompt, a rescan of the exported
   trajectory finds 0 hits.

## Test plan

Unit tests only, no A/B, no live model:
- print-mode json test with fake stream: off golden, on line position/shape, one-line-per-change and no-change cases, hash == run log `systemHash`, on/off request equality, worker inheritance.
- run-log unchanged test.
- spec 110 exporter test (in that PR's suite): consumes `omk_session_info`, masks, rescan = 0.

## Out of scope

No change to run-log content, session files, rpc/interactive modes, or the model request;
no ATIF exporter code (spec 110); no paid runs.

## Decisions (Tech Lead, 10/23)

1. All emitted strings, including tool descriptions, go through spec 110 masking.
2. Workers inherit the flag via env and emit their own lines (spec 110 `subagent_trajectories`).
3. Not once-only: re-emit on `systemHash`/`toolsHash` change, with `seq` and hashes; no
   re-emit when unchanged.
4. `systemPrompt` is the final string sent to the provider; tested against run log `systemHash`.

## Open questions

None open. Former Q1 (workers), Q2 (mid-run changes), Q3 (which prompt string) are closed
by decisions 2, 3, 4.
