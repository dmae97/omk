# TTSR Injection Lifecycle

This document covers the current Time Traveling Stream Rules (TTSR) runtime path from rule discovery to stream interruption, retry injection, extension notifications, and session-state handling.

## Implementation files

- [`../src/sdk.ts`](../src/sdk.ts)
- [`../src/export/ttsr.ts`](../src/export/ttsr.ts)
- [`../src/session/agent-session.ts`](../src/session/agent-session.ts)
- [`../src/session/session-manager.ts`](../src/session/session-manager.ts)
- [`../src/prompts/system/ttsr-interrupt.md`](../src/prompts/system/ttsr-interrupt.md)
- [`../src/capability/index.ts`](../src/capability/index.ts)
- [`../src/extensibility/extensions/types.ts`](../src/extensibility/extensions/types.ts)
- [`../src/extensibility/hooks/types.ts`](../src/extensibility/hooks/types.ts)
- [`../src/extensibility/custom-tools/types.ts`](../src/extensibility/custom-tools/types.ts)
- [`../src/modes/controllers/event-controller.ts`](../src/modes/controllers/event-controller.ts)

## 1. Discovery feed and rule registration

At session creation, `createAgentSession()` loads all discovered rules and constructs a `TtsrManager`:

```ts
const ttsrSettings = settings.getGroup("ttsr");
const ttsrManager = new TtsrManager(ttsrSettings);
const rulesResult = await loadCapability<Rule>(ruleCapability.id, { cwd });
for (const rule of rulesResult.items) {
  if (rule.ttsrTrigger) ttsrManager.addRule(rule);
}
```

### Pre-registration dedupe behavior

`loadCapability("rules")` deduplicates by `rule.name` with first-wins semantics (higher provider priority first). Shadowed duplicates are removed before TTSR registration.

### `TtsrManager.addRule()` behavior

Registration is skipped when:

- `rule.ttsrTrigger` is absent
- a rule with the same `rule.name` was already registered in this manager
- the regex fails to compile (`new RegExp(rule.ttsrTrigger)` throws)

Invalid regex triggers are logged as warnings and ignored; session startup continues.

### Setting caveat

`TtsrSettings.enabled` is loaded into the manager but is not currently checked in runtime gating. If rules exist, matching still runs.

## 2. Streaming monitor lifecycle

TTSR detection runs inside `AgentSession.#handleAgentEvent`.

### Turn start

On `turn_start`, the stream buffer is reset:

- `ttsrManager.resetBuffer()`

### During stream (`message_update`)

When assistant updates arrive and rules exist:

- monitor `text_delta` and `toolcall_delta`
- append delta into manager buffer
- call `check(buffer)`

`check()` iterates registered rules and returns all matching rules that pass repeat policy (`#canTrigger`).

## 3. Trigger decision and immediate abort path

When one or more rules match:

1. `markInjected(matches)` records rule names in manager injection state.
2. matched rules are queued in `#pendingTtsrInjections`.
3. `#ttsrAbortPending = true`.
4. `agent.abort()` is called immediately.
5. `ttsr_triggered` event is emitted asynchronously (fire-and-forget).
6. retry work is scheduled via `setTimeout(..., 50)`.

Abort is not blocked on extension callbacks.

## 4. Retry scheduling, context mode, and reminder injection

After the 50ms timeout:

1. `#ttsrAbortPending = false`
2. read `ttsrManager.getSettings().contextMode`
3. if `contextMode === "discard"`, drop partial assistant output with `agent.popMessage()`
4. build injection content from pending rules using `ttsr-interrupt.md` template
5. append a synthetic user message containing one `<system_interrupt ...>` block per rule
6. call `agent.continue()` to retry generation

Template payload is:

```xml
<system_interrupt reason="rule_violation" rule="{{name}}" path="{{path}}">
...
{{content}}
</system_interrupt>
```

Pending injections are cleared after content generation.

### `contextMode` behavior on partial output

- `discard`: partial/aborted assistant message is removed before retry.
- `keep`: partial assistant output remains in conversation state; reminder is appended after it.

## 5. Repeat policy and gap logic

`TtsrManager` tracks `#messageCount` and per-rule `lastInjectedAt`.

### `repeatMode: "once"`

A rule can trigger only once after it has an injection record.

### `repeatMode: "after-gap"`

A rule can re-trigger only when:

- `messageCount - lastInjectedAt >= repeatGap`

`messageCount` increments on `turn_end`, so gap is measured in completed turns, not stream chunks.

## 6. Event emission and extension/hook surfaces

### Session event

`AgentSessionEvent` includes:

```ts
{ type: "ttsr_triggered"; rules: Rule[] }
```

### Extension runner

`#emitSessionEvent()` routes the event to:

- extension listeners (`ExtensionRunner.emit({ type: "ttsr_triggered", rules })`)
- local session subscribers

### Hook and custom-tool typing

- extension API exposes `on("ttsr_triggered", ...)`
- hook API exposes `on("ttsr_triggered", ...)`
- custom tools receive `onSession({ reason: "ttsr_triggered", rules })`

### Interactive-mode rendering difference

Interactive mode uses `session.isTtsrAbortPending` to suppress showing the aborted assistant stop reason as a visible failure during TTSR interruption, and renders a `TtsrNotificationComponent` when the event arrives.

## 7. Persistence and resume state (current implementation)

`SessionManager` has full schema support for injected-rule persistence:

- entry type: `ttsr_injection`
- append API: `appendTtsrInjection(ruleNames)`
- query API: `getInjectedTtsrRules()`
- context reconstruction includes `SessionContext.injectedTtsrRules`

`TtsrManager` also supports restoration via `restoreInjected(ruleNames)`.

### Current wiring status

In the current runtime path:

- `AgentSession` does not append `ttsr_injection` entries when TTSR triggers.
- `createAgentSession()` does not restore `existingSession.injectedTtsrRules` back into `ttsrManager`.

Net effect: injected-rule suppression is enforced in-memory for the live process, but is not currently persisted/restored across session reload/resume by this path.

## 8. Race boundaries and ordering guarantees

### Abort vs retry callback

- abort is synchronous from TTSR handler perspective (`agent.abort()` called immediately)
- retry is deferred by timer (`50ms`)
- extension notification is asynchronous and intentionally not awaited before abort/retry scheduling

### Multiple matches in same stream window

`check()` returns all currently matching eligible rules. They are injected as a batch on the next retry message.

### Between abort and continue

During the timer window, state can change (user interruption, mode actions, additional events). The retry call is best-effort: `agent.continue().catch(() => {})` swallows follow-up errors.

## 9. Edge cases summary

- Invalid `ttsr_trigger` regex: skipped with warning; other rules continue.
- Duplicate rule names at capability layer: lower-priority duplicates are shadowed before registration.
- Duplicate names at manager layer: second registration is ignored.
- `contextMode: "keep"`: partial violating output can remain in context before reminder retry.
- Repeat-after-gap depends on turn count increments at `turn_end`; mid-turn chunks do not advance gap counters.
