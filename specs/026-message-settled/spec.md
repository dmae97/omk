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

All line references are verified against `origin/main` at `3d1f8ca825`.

### F1. Consumers only ever see deep-frozen immutable snapshots

- `createImmutableSnapshot` (`packages/agent/src/plain-data.ts:51-57`, re-exported by `tool-execution-boundary.ts:13`) runs `structuredClone` and then recursively freezes the result.
- `runAgentLoop` and `runAgentLoopContinue` publish every event through `const publish = (event) => emit(createImmutableSnapshot(event))` (`packages/agent/src/agent-loop.ts:270`, `:299`).
- `Agent.processEvents` snapshots again before it updates state or reaches listeners (`packages/agent/src/agent.ts:499-500`). `tool_execution_update` events get one more snapshot per listener (`agent.ts:551`).
- During streaming, `consumeAssistantStream` keeps the live provider object in the loop-private `context.messages` (`agent-loop.ts:707`, `:685`, `:665`). Events carry `{ ...partial }` (`:668`, `:689`, `:709`), and `publish` clones and freezes those. So **each `message_update` delivers a NEW frozen copy**, and a reference held from an earlier event never changes.
- `Agent` state follows the same snapshots: `streamingMessage` is replaced on `message_start` and `message_update`, then cleared on `message_end`, when the final snapshot is appended to `state.messages` (`agent.ts:502-513`).

**Consequence:** no consumer ever holds a mutable message. "Will this object change?" is always *no*. The useful question is "will this transcript entry be **replaced** by a newer snapshot?", and only the event lifecycle answers it.

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
| `custom` / `branchSummary` / `compactionSummary` | Built complete by `createCustomMessage` / `createBranchSummaryMessage` / `createCompactionSummaryMessage` (`packages/agent/src/harness/messages.ts:108`, `:117`, `:130`; coding-agent mirrors `core/messages.ts:102`, `:111`, `:125`). |
| `user` | Appended complete. Prompts are emitted `message_start` + `message_end` back-to-back (`agent-loop.ts:276-277`). |

## The rule

### R1. "Finished" is decided by event boundaries

| Item | Live from | Finished at |
| --- | --- | --- |
| Assistant message | `message_start` | its matching `message_end` |
| Tool execution (UI / partial results) | `tool_execution_start` (`agent-loop.ts:1570-1577`) | matching `tool_execution_end` (`:1579-1587`), same `toolCallId` (also mirrored in `Agent.state.pendingToolCalls`, `agent.ts:515-525`) |
| `bashExecution` | never live | created after the command exits. No tracking needed |
| `toolResult`, `user`, `custom`, `branchSummary`, `compactionSummary` | never live | complete when created |

**Safety net:** at `agent_end`, consumers treat every item as finished, including any assistant message or tool still open because of a missing end event.

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

### AC1: Line references verified on `main`

Every file:line reference in this spec matches `origin/main` at `3d1f8ca825`.

**Method:** review in the PR (e.g. `sed -n '<line>p' <file>` for each reference).

### AC2: Gates

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
