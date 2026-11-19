# Pi 1.2 compatibility ports

OMK remains an independent harness. This compatibility update ports selected API and correctness changes from Pi `v1.2.0` (`06a466935536f8c9bcacb2d5efc0fc021be1bdff`) while retaining OMK's session ownership, budgets, security gates, model catalog and extension loader. It is not a full upstream rebase or a claim that every Pi package is supported.

## Extension run lifecycle

`before_agent_start` now distinguishes user and idle custom-message starts:

```typescript
omk.on("before_agent_start", (event) => {
  if (event.messageType !== "user") return;
  // event.prompt and event.images exist only on user starts.
});
```

Custom starts carry `event.message`. They receive pending `nextTurn` context and injected handler messages, and retain handler system-prompt changes through tool continuations. A starting run is busy; turn-triggering custom messages join that run instead of starting a competitor. Aborting preparation prevents the provider call.

`agent_settled` runs after pending retries, compaction and queued continuations, before `prompt_settled` and `task_result`. This keeps acceptance receipts and finish-check follow-ups inside the owning prompt run. Ordinary `sendUserMessage` follow-ups may continue that run; another `agent_settled` follows the continuation. `event.aborted` reports cancellation, and cancellation also reaches an acceptance check running in this handler. OMK preserves `event.messages` for older consumers.

`sendUserMessage` accepts `expandPromptTemplates: true` for extension-command handoff, including worktree entry. Such command handoffs are deferred until the old scope and all settlement handlers close, rather than starting a competing session operation. This option does not grant permission to change repositories or sessions. Extension prompt overrides retain the `1.5.5` prefix-boundary cause handoff for request tracing.

Registered extension commands without an explicit run budget do not open an inference-preparation scope of their own; `ctx.isIdle()` still reports another prompt's preparation as busy. Once session shutdown begins, existing prompt/resource finalization still completes, but no new `agent_settled` handler producer starts on the closing context.
## Other behavior changes

- Print and JSON modes exit `1` when the final response reaches the output-token limit. Text mode retains the partial response and writes a warning to stderr.
- `PI_CLIPBOARD_OSC52=1` also sends copied text to the terminal after a successful local clipboard write, even without SSH markers.
- Resource include/exclude and forced exact patterns expand home-relative `~` paths.
- MCP structured content preserves arrays, primitives and `null`, while rejecting non-JSON values. Existing result-content validation remains in place.
- Summarization input omits thinking blocks without mutating retained session messages.
- The shared retry classifier recognizes “The upstream provider returned an error” without changing retry budgets or quota-exhaustion handling.
- Recognized terminal replies stay buffered across delayed fragments rather than becoming text or a BEL shortcut. Herdr advertises Kitty images without losing the existing tmux/screen policy.

## Boundaries

OMK does not replace its runtime with Pi's codemode, Chord or MCP packages in this update. Namespace aliases, `reachesTools`, published Pi configuration schemas, per-key OpenRouter discovery and transport-specific changes require separate compatibility work rather than copying metadata unsupported by the OMK runtime. Existing personal extension handlers that read `event.prompt` without checking `messageType` must be updated before custom-triggered runs use them.

Source integration and a built candidate do not update an already-running process. Restart the core after an accepted local engine activation; extension-only `/reload` cannot replace core modules.
