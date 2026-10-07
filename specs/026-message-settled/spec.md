---
description: "Event-boundary rule for deciding when a transcript message is finished (documentation only)"
---

# Feature Specification: Event-Boundary Rule for Finished Messages

**Specification ID**: `026-message-settled`
**Feature Branch**: `docs/message-settled-spec`
**Created**: 2026-10-06
**Status**: Accepted (documentation only; no code)
**Constitution**: [specs/constitution.md](../constitution.md)
**Input**: Consumers (TUI chat windowing in PR #79, per-message token caches in spec 023) need to know when a transcript message is "finished". An earlier attempt shipped an `isMessageSettled` predicate backed by stream-generation marks. The team decided **not** to ship a settled predicate in code. This spec records the rule consumers follow instead, with code-verified evidence.
**OMK Preset**: `omk`

## CLI Harness Target Impact

**Classification**: not applicable

This is a documentation-only contract. It changes no runtime behavior, so no harness metric moves.

| Dimension | Baseline | Acceptance target | Regression floor | Verification command | Evidence artifact |
| --- | --- | --- | --- | --- | --- |
| Maintainability | Not specified. Callers could invent divergent "finished" heuristics (e.g. `stopReason`) | One documented event-boundary rule, line refs verified on `main` | No code change | `npm run check` | This spec |

## Goal

Document one rule, decided by **event boundaries rather than object state**, that answers "is this message finished?". Every consumer of agent events (TUI, context admission, token caches) follows it. Ship no predicate module.

## Investigation findings

All line references are verified against `origin/main` at `7d15b34446` (unchanged from `3d1f8ca825` for every referenced file).

### F1. Consumers only ever see deep-frozen immutable snapshots

- `createImmutableSnapshot` (`packages/agent/src/plain-data.ts:51-57`, re-exported by `tool-execution-boundary.ts:13`) runs `structuredClone` and then recursively freezes the result.
- `runAgentLoop` and `runAgentLoopContinue` publish every event through `const publish = (event) => emit(createImmutableSnapshot(event))` (`packages/agent/src/agent-loop.ts:270`, `:299`).
- `Agent.processEvents` snapshots again before it updates state or reaches listeners (`packages/agent/src/agent.ts:499-500`). `tool_execution_update` events get one more snapshot per listener (`agent.ts:551`).
- During streaming, `consumeAssistantStream` keeps the live provider object in the loop-private `context.messages` (`agent-loop.ts:707`, `:685`, `:665`). Events carry `{ ...partial }` (`:668`, `:689`, `:709`), and `publish` clones and freezes those. So **each `message_update` delivers a NEW frozen copy**, and a reference held from an earlier event never changes.
- `Agent` state follows the same snapshots: `streamingMessage` is replaced on `message_start` and `message_update`, then cleared on `message_end`, when the final snapshot is appended to `state.messages` (`agent.ts:502-513`).

**Exception: the failure path.** When the loop promise rejects, `runAgentLoop` / `runAgentLoopContinue` call `endStreamWithFailure` (`agent-loop.ts:147-168`, called at `:202` and `:253`). It pushes closure results, a fresh failure assistant (`message_start` + `message_end` + `turn_end`) and `agent_end` straight onto the stream with `stream.push`, **not** through `publish`. Two consequences:

- Raw `agentLoop` stream consumers receive these failure events unfrozen. `Agent` consumers still get frozen copies, because `processEvents` snapshots every event again (`agent.ts:499-500`); `Agent`'s own failure path at `agent.ts:477-487` also goes through `processEvents`.
- The failure assistant is a **new** message. If the error is thrown while an assistant message is streaming, the `message_start` already published for that partial message gets **no** matching `message_end` (reading of the code, not yet reproduced). Consumers must not wait for it: the `agent_end` safety net (R1) closes it. This spec does not change the code; PR #79 adds the backstop and a test that checks whether the gap actually reproduces.

**Consequence:** apart from the raw-stream failure path above, no consumer ever holds a mutable message. "Will this object change?" is always *no*. The useful question is "will this transcript entry be **replaced** by a newer snapshot?", and only the event lifecycle answers it.

### F2. `stopReason` is NOT a finished signal

- `AssistantMessage.stopReason` is a required field. Providers initialize it to `"stop"` when they construct the output (`packages/ai/src/providers/openai-completions.ts:132`, `packages/ai/src/providers/anthropic.ts:523`). An in-flight snapshot is therefore indistinguishable from a final one by data alone.
- openai-completions writes to the message **after** it sets the real stop reason. `output.stopReason` is set from `finish_reason` at `:295` (`errorMessage` `:297`). The same chunk then appends text (`block.text +=` `:309`) and tool arguments (`:365`). After the loop, `finishBlock` (`:394`) parses tool arguments and deletes the scratch fields `partialArgs` and `streamIndex` (`:200-204`). Only after all of that is `done` pushed (`:410`).
- anthropic's `message_delta` handler sets `stopReason` (`:728`) and then writes usage and cost (`:732-747`). Salvage may rewrite `stopReason` to `"stop"` (`:765`) before `done` (`:775`). On the error path, `errorMessage` (`:784`) is written after `stopReason` (`:783`) and before the `error` event (`:785`).
- Every provider write happens before the terminal `done`/`error` push. In the loop that push becomes `message_end` (`agent-loop.ts:670`).

Reordering provider writes so that `stopReason` is assigned last is a **low-priority follow-up and out of scope** here. Nothing in this rule depends on it.

### F3. Roles that are complete when created

| Role | Evidence |
| --- | --- |
| `toolResult` | Created frozen at finalization (`createToolResultMessage`, `agent-loop.ts:1589-1599`) and emitted `message_start` + `message_end` back-to-back (`:1601-1604`). In-flight tool state exists only in `tool_execution_*` events and component fields. No message object exists for it. |
| `bashExecution` | Built only in `recordBashResult` after the command exits, with `output`/`exitCode`/`cancelled` filled in (`packages/coding-agent/src/core/session-bash-service.ts:198-218`, literal `:199-209`). It is pushed directly or queued unchanged (`:212-217`). No transcript message exists while the command runs. |
| `branchSummary` / `compactionSummary` / `custom` | Built complete by `createBranchSummaryMessage` / `createCompactionSummaryMessage` / `createCustomMessage` (`packages/agent/src/harness/messages.ts:108`, `:117`, `:130`; coding-agent mirrors `core/messages.ts:102`, `:111`, `:125`, same order). |
| `user` | Appended complete. Prompts are emitted `message_start` + `message_end` back-to-back (`agent-loop.ts:276-277`). |

## The rule

### R1. "Finished" is decided by event boundaries

| Item | Live from | Finished at |
| --- | --- | --- |
| Assistant message | `message_start` | its matching `message_end` |
| Tool execution (UI / partial results) | `tool_execution_start` (`agent-loop.ts:1570-1577`) | matching `tool_execution_end` (`:1579-1587`), same `toolCallId` (also mirrored in `Agent.state.pendingToolCalls`, `agent.ts:515-525`) |
| `bashExecution` | never live | created after the command exits. No tracking needed |
| `toolResult`, `user`, `custom`, `branchSummary`, `compactionSummary` | never live | complete when created |

**Safety net:** at `agent_end`, consumers treat every item as finished, including any assistant message or tool still open because of a missing end event (see the failure-path exception in F1). A missed end event then only delays freezing until `agent_end`; it never leaves a stale entry on screen.

### R2. Swap references, never rely on object identity

- On every `message_update`, consumers **replace** their reference with the new snapshot and **bump their render generation** (or equivalent invalidation). Never compare object identity to detect change, and never assume that the object from `message_start` is the object delivered at `message_end`.
- Object-keyed caches (e.g. per-message token counts) use a `WeakMap` keyed on the frozen snapshot. A snapshot never changes, so an entry can never go stale, and superseded streaming copies become unreachable and are garbage-collected with their entries. Only snapshots outside the live window (R1) are worth caching. Caching a live snapshot is correct but wasted work.
- Do not infer "finished" from message data (`stopReason`, `usage`, `errorMessage`, presence of `partialArgs`). See F2.

## Non-goals

- No code. No `isMessageSettled` or other predicate module, and no stream-generation marks. The abandoned attempt stays on branch `feat/message-settled` for reference only.
- No TUI wiring (`interactive-mode.ts`, `tui.ts`, ChatContainer freeze policy). PR #79 handles that.
- No token cache or admission logic. Spec 023 is on hold.
- No provider reordering of `stopReason` assignment (F2). Low-priority follow-up.
- Per-event deep-copy cost (`structuredClone` + freeze per `message_update`) on long messages: noted as a future measurement, out of scope.
- Component-local state (expand/collapse, Markdown highlight caches, loaders) stays the TUI's own concern.

## Acceptance criteria

This spec ships no code. AC1–AC3 are the contract the consumer PRs must meet and prove with tests: AC1 and AC2 in PR #79 (TUI wiring), AC3 in spec 023 if it resumes. AC4 and AC5 are verified on this PR.

### AC1: Start/end pairing on every path, with an `agent_end` backstop (PR #79)

- For the normal, error and abort paths, every `message_start` a consumer sees is closed: either by its matching `message_end` or, failing that, at `agent_end`.
- The error case includes a provider throwing mid-stream (the `endStreamWithFailure` path, F1). The test records whether the open partial assistant actually lacks a `message_end` there.
- After `agent_end`, no item remains live in the consumer.

**Method:** a vitest case per path driving `agentLoop`/`Agent` with a faux stream (normal completion, provider `error`, `AbortSignal` abort, and a stream function that throws after `message_start`), asserting the pairing and that the consumer's live set is empty after `agent_end`.

### AC2: Reference swap and generation bump on every `message_update` (PR #79)

- On every `message_update` the consumer replaces its stored reference with the event's snapshot and bumps its render generation.
- No change detection by object identity.

**Method:** a vitest case streaming N updates for one assistant message, asserting the stored reference equals each event's snapshot and the generation increases by exactly one per update.

### AC3: Object-keyed caches use a `WeakMap` on frozen snapshots (spec 023, if resumed)

- Per-message caches are keyed in a `WeakMap` on the frozen snapshot, never on a mutable object or an id that a streaming update reuses.
- Only snapshots outside the live window (R1) are cached.

**Method:** code review of the cache declaration, plus a vitest case asserting a live (streaming) snapshot is not stored and a finished one is.

### AC4: Line references verified on `main`

Every file:line reference in this spec matches `origin/main` at `7d15b34446`.

**Method:** review in the PR (e.g. `sed -n '<line>p' <file>` for each reference).

### AC5: Gates

- One file changed: `specs/026-message-settled/spec.md`. Staged by explicit path.
- `npm run check` passes.

**Method:** `git show --stat HEAD`; `npm run check` exit code 0.

## Expected Files

- `specs/026-message-settled/spec.md`: this specification (the only file).

## Verification Commands

- `npm run check`

## Assumptions

- Consumers subscribe through `Agent`/`agentLoop` events and do not reach into the loop-private `context.messages`.
- A future role that streams in place must emit `message_start` / `message_update` / `message_end` like assistant messages and get added to R1, with this spec updated.
