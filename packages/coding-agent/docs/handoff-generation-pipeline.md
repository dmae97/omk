# `/handoff` generation pipeline

This document describes how the coding-agent implements `/handoff` today: trigger path, generation prompt, completion capture, session switch, and context reinjection.

## Scope

Covers:

- Interactive `/handoff` command dispatch
- `AgentSession.handoff()` lifecycle and state transitions
- How handoff output is captured from assistant output
- How old/new sessions persist handoff data differently
- UI behavior for success, cancel, and failure

Does not cover:

- Generic tree navigation/branch internals
- Non-handoff session commands (`/new`, `/fork`, `/resume`)

## Implementation files

- [`../src/modes/controllers/input-controller.ts`](../src/modes/controllers/input-controller.ts)
- [`../src/modes/controllers/command-controller.ts`](../src/modes/controllers/command-controller.ts)
- [`../src/session/agent-session.ts`](../src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../src/session/session-manager.ts)
- [`../src/extensibility/slash-commands.ts`](../src/extensibility/slash-commands.ts)

## Trigger path

1. `/handoff` is declared in builtin slash command metadata (`slash-commands.ts`) with optional inline hint: `[focus instructions]`.
2. In interactive input handling (`InputController`), submit text matching `/handoff` or `/handoff ...` is intercepted before normal prompt submission.
3. The editor is cleared and `handleHandoffCommand(customInstructions?)` is called.
4. `CommandController.handleHandoffCommand` performs a preflight guard using current entries:
   - Counts `type === "message"` entries.
   - If `< 2`, it warns: `Nothing to hand off (no messages yet)` and returns.

The same minimum-content guard exists again inside `AgentSession.handoff()` and throws if violated. This duplicates safety at both UI and session layers.

## End-to-end lifecycle

### 1) Start handoff generation

`AgentSession.handoff(customInstructions?)`:

- Reads current branch entries (`sessionManager.getBranch()`)
- Validates minimum message count (`>= 2`)
- Creates `#handoffAbortController`
- Builds a fixed, inline prompt requesting a structured handoff document (`Goal`, `Constraints & Preferences`, `Progress`, `Key Decisions`, `Critical Context`, `Next Steps`)
- Appends `Additional focus: ...` if custom instructions are provided

Prompt is sent via:

```ts
await this.prompt(handoffPrompt, { expandPromptTemplates: false });
```

`expandPromptTemplates: false` prevents slash/prompt-template expansion of this internal instruction payload.

### 2) Capture completion

Before sending prompt, `handoff()` subscribes to session events and waits for `agent_end`.

On `agent_end`, it extracts handoff text from agent state by scanning backward for the most recent `assistant` message, then concatenating all `content` blocks where `type === "text"` with `\n`.

Important extraction assumptions:

- Only text blocks are used; non-text content is ignored.
- It assumes the latest assistant message corresponds to handoff generation.
- It does not parse markdown sections or validate format compliance.
- If assistant output has no text blocks, handoff is treated as missing.

### 3) Cancellation checks

`handoff()` returns `undefined` when either condition holds:

- no captured handoff text, or
- `#handoffAbortController.signal.aborted` is true

It always clears `#handoffAbortController` in `finally`.

### 4) New session creation

If text was captured and not aborted:

1. Flush current session writer (`sessionManager.flush()`)
2. Start a brand-new session (`sessionManager.newSession()`)
3. Reset in-memory agent state (`agent.reset()`)
4. Rebind `agent.sessionId` to new session id
5. Clear queued context arrays (`#steeringMessages`, `#followUpMessages`, `#pendingNextTurnMessages`)
6. Reset todo reminder counter

`newSession()` creates a fresh header and empty entry list (leaf reset to `null`). In the handoff path, no `parentSession` is passed.

### 5) Handoff-context injection

The generated handoff document is wrapped and appended to the new session as a `custom_message` entry:

```text
<handoff-context>
...handoff text...
</handoff-context>

The above is a handoff document from a previous session. Use this context to continue the work seamlessly.
```

Insertion call:

```ts
this.sessionManager.appendCustomMessageEntry("handoff", handoffContent, true);
```

Semantics:

- `customType`: `"handoff"`
- `display`: `true` (visible in TUI rebuild)
- Entry type: `custom_message` (participates in LLM context)

### 6) Rebuild active agent context

After injection:

1. `sessionManager.buildSessionContext()` resolves message list for current leaf
2. `agent.replaceMessages(sessionContext.messages)` makes the injected handoff message active context
3. Method returns `{ document: handoffText }`

At this point, the active LLM context in the new session contains the injected handoff message, not the old transcript.

## Persistence model: old session vs new session

### Old session

During generation, normal message persistence remains active. The assistant handoff response is persisted as a regular `message` entry on `message_end`.

Result: the original session contains the visible generated handoff as part of historical transcript.

### New session

After session reset, handoff is persisted as `custom_message` with `customType: "handoff"`.

`buildSessionContext()` converts this entry into a runtime custom/user-context message via `createCustomMessage(...)`, so it is included in future prompts from the new session.

## Controller/UI behavior

`CommandController.handleHandoffCommand` behavior:

- Calls `await session.handoff(customInstructions)`
- If result is `undefined`: `showError("Handoff cancelled")`
- On success:
  - `rebuildChatFromMessages()` (loads new session context, including injected handoff)
  - invalidates status line and editor top border
  - reloads todos
  - appends success chat line: `New session started with handoff context`
- On exception:
  - if message is `"Handoff cancelled"` or error name is `AbortError`: `showError("Handoff cancelled")`
  - otherwise: `showError("Handoff failed: <message>")`
- Requests render at end

## Cancellation semantics (current behavior)

### Session-level cancellation primitive

`AgentSession` exposes:

- `abortHandoff()` → aborts `#handoffAbortController`
- `isGeneratingHandoff` → true while controller exists

When this abort path is used, the handoff subscriber rejects with `Error("Handoff cancelled")`, and command controller maps it to cancellation UI.

### Interactive `/handoff` path limitation

In current interactive controller wiring, `/handoff` does not install a dedicated Escape handler that calls `abortHandoff()` (unlike compaction/branch-summary paths that temporarily override `editor.onEscape`).

Practical impact:

- There is session-level cancellation support, but no handoff-specific keybinding hook in the `/handoff` command path.
- User interruption may still occur through broader agent abort paths, but that is not the same explicit cancellation channel used by `abortHandoff()`.

## Aborted vs failed handoff

Current UI classification:

- **Aborted/cancelled**
  - `abortHandoff()` path triggers `"Handoff cancelled"`, or
  - thrown `AbortError`
  - UI shows `Handoff cancelled`

- **Failed**
  - any other thrown error from `handoff()` / prompt pipeline (model/API validation errors, runtime exceptions, etc.)
  - UI shows `Handoff failed: ...`

Additional nuance: if generation completes but no text is extracted, `handoff()` returns `undefined` and controller currently reports **cancelled**, not **failed**.

## Short-session and minimum-content guardrails

Two guards prevent low-signal handoffs:

- UI layer (`handleHandoffCommand`): warns and returns early for `< 2` message entries
- Session layer (`handoff()`): throws the same condition as an error

This avoids creating a new session with empty/near-empty handoff context.

## State transition summary

High-level state flow:

1. Interactive slash command intercepted
2. Preflight message-count guard
3. `#handoffAbortController` created (`isGeneratingHandoff = true`)
4. Internal handoff prompt submitted (visible in chat as normal assistant generation)
5. On `agent_end`, last assistant text extracted
6. If missing/aborted → return `undefined` or cancellation error path
7. If present:
   - flush old session
   - create new empty session
   - reset runtime queues/counters
   - append `custom_message(handoff)`
   - rebuild and replace active agent messages
8. Controller rebuilds chat UI and announces success
9. `#handoffAbortController` cleared (`isGeneratingHandoff = false`)

## Known assumptions and limitations

- Handoff extraction is heuristic: "last assistant text blocks"; no structural validation.
- No hard check that generated markdown follows requested section format.
- Missing extracted text is reported as cancellation in controller UX.
- `/handoff` interactive flow currently lacks a dedicated Escape→`abortHandoff()` binding.
- New session lineage metadata (`parentSession`) is not set by this path.