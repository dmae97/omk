<!-- Synced from jot qe0ikdqs. Edit this file in-repo going forward. -->

# OMK Observability Design Notes

## Goal

Make `packages/ai` and `packages/agent`/harness observable without depending on OpenTelemetry, Sentry, or any APM vendor.

OMK should emit stable, structured lifecycle events. External listeners can convert those events into OTel spans, Sentry spans, logs, metrics, or custom telemetry.

## Mental model

A trace is one causal tree of work, e.g. one user turn.

A span is one timed operation in that tree. It is normally represented by IDs, not object pointers:

```ts
interface SpanRecord {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTime: number;
  endTime?: number;
  attributes: Record<string, unknown>;
  status: "ok" | "error";
}
```

Example tree:

```text
traceId=t1 spanId=s1 parent=-  name=omk.agent.prompt
traceId=t1 spanId=s2 parent=s1 name=omk.agent.turn
traceId=t1 spanId=s3 parent=s2 name=omk.ai.provider.request
traceId=t1 spanId=s4 parent=s2 name=omk.agent.tool_call
traceId=t1 spanId=s5 parent=s4 name=omk.session.append_entry
```

## Async context

JavaScript has one event loop but multiple async chains can interleave. A single global `currentContext` breaks under concurrency.

`AsyncLocalStorage` is the Node equivalent of `ThreadLocal` for async continuations. It lets concurrent operations keep distinct current contexts:

```ts
await Promise.all([
  runWithPiContext({ userId: "alice" }, () => harness.prompt("A")),
  runWithPiContext({ userId: "bob" }, () => harness.prompt("B")),
]);
```

Deep code can then read the correct current context for the active async chain.

OMK must run in Node, Bun, browser, workers, and other JS runtimes, so ALS cannot be the core abstraction. It should be a runtime adapter.

## Core design

OMK owns a small runtime-agnostic observability abstraction:

```ts
export interface PiObservabilityContext {
  traceId?: string;
  currentSpanId?: string;
  userContext?: Record<string, unknown>;
}

export interface PiObservabilityEvent {
  type: "start" | "end" | "error" | "event";
  name: string;
  traceId: string;
  spanId?: string;
  parentSpanId?: string;
  timestamp: number;
  durationMs?: number;
  context?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  error?: { name: string; message: string };
}

export interface PiObservability {
  getContext(): PiObservabilityContext | undefined;
  runWithContext<T>(context: PiObservabilityContext, fn: () => T): T;
  emit(event: PiObservabilityEvent): void;
  hasSubscribers(): boolean;
}
```

Public API:

```ts
export function configurePiObservability(observability: PiObservability): void;
export function subscribePiObservability(listener: (event: PiObservabilityEvent) => void): () => void;
export function runWithPiContext<T>(userContext: Record<string, unknown>, fn: () => T): T;
export function traceOperation<T>(name: string, payload: Record<string, unknown>, fn: () => T): T;
```

`traceOperation()`:

1. reads the current context
2. creates `traceId` if missing
3. creates a new `spanId`
4. uses current span as `parentSpanId`
5. emits `start`
6. runs callback under child context
7. emits `end` or `error`
8. rethrows on error

Pseudo-code:

```ts
function traceOperation<T>(name: string, payload: Record<string, unknown>, fn: () => T): T {
  const parent = getContext();
  const traceId = parent?.traceId ?? createId();
  const spanId = createId();
  const parentSpanId = parent?.currentSpanId;

  const child = { ...parent, traceId, currentSpanId: spanId };

  emit({ type: "start", name, traceId, spanId, parentSpanId, timestamp: Date.now(), context: parent?.userContext, payload });

  return runWithContext(child, () => {
    try {
      const result = fn();
      // Promise-aware implementation emits end/error after settlement.
      emit({ type: "end", name, traceId, spanId, parentSpanId, timestamp: Date.now(), context: child.userContext, payload });
      return result;
    } catch (error) {
      emit({ type: "error", name, traceId, spanId, parentSpanId, timestamp: Date.now(), context: child.userContext, payload, error: serializeError(error) });
      throw error;
    }
  });
}
```

## Runtime adapters

Core packages should not import Node-only APIs.

Possible implementations:

- Node adapter: `AsyncLocalStorage` for context, optional `diagnostics_channel` publishing.
- Browser/workers fallback: local subscriber set and limited/manual context propagation.
- Bun/Deno adapters: use runtime-specific async context if available.

For Node, diagnostics channels can be used as a passive event bus:

```ts
import { channel } from "diagnostics_channel";
channel("omk.observability").publish(event);
```

Subscribers can create OTel/Sentry spans without monkey-patching OMK.

## What OMK emits

OMK emits what happened. It does not create OTel/Sentry spans directly.

Initial minimal event names:

```text
omk.agent.prompt
omk.agent.skill
omk.agent.prompt_template
omk.agent.compaction
omk.agent.branch_navigation
omk.agent.session.append_entry
omk.ai.provider.request
```

Each operation emits:

```text
start
end
error
```

Later additions:

```text
omk.agent.turn
omk.agent.tool_call
omk.agent.queue_update
omk.ai.provider.retry
omk.ai.provider.first_token
omk.ai.provider.usage
omk.session.read
omk.session.write
```

## Minimal instrumentation points

### packages/agent

Wrap:

- `AgentHarness.prompt()`
- `AgentHarness.skill()`
- `AgentHarness.promptFromTemplate()`
- `AgentHarness.compact()`
- `AgentHarness.navigateTree()`
- `Session.appendTypedEntry()` or storage append facade

Example:

```ts
return traceOperation(
  "omk.agent.prompt",
  {
    sessionId: turnState.sessionId,
    provider: turnState.model.provider,
    model: turnState.model.id,
    promptLength: text.length,
    imageCount: options?.images?.length ?? 0,
  },
  () => this.executeTurn(turnState, text, options),
);
```

Session write:

```ts
return traceOperation(
  "omk.agent.session.append_entry",
  { entryType: entry.type },
  async () => {
    await this.unwrap(this.storage.appendEntry(entry));
    return entry.id;
  },
);
```

### packages/ai

Wrap common provider boundaries:

- `streamSimple()`
- `completeSimple()`

Example:

```ts
return traceOperation(
  "omk.ai.provider.request",
  {
    api: model.api,
    provider: model.provider,
    model: model.id,
    sessionId: options.sessionId,
    reasoning: options.reasoning,
  },
  () => actualStreamSimple(model, context, options),
);
```

End/error payloads can include safe metadata:

- stop reason
- status code
- retry count
- input/output/total tokens
- cost total
- aborted/timeout flag

## Safety and redaction

Default payloads must be safe.

Safe by default:

- provider
- model
- API identifier
- session id
- entry type
- tool name
- status code
- stop reason
- token counts
- costs
- durations

Unsafe by default:

- prompts
- completions
- tool args
- tool results
- shell output
- file contents
- provider request payloads
- provider response bodies
- API keys
- headers

Content capture can be opt-in later with explicit redaction hooks.

## Listener behavior

Observability must never affect OMK execution.

Subscriber errors should be swallowed or isolated. Harness hooks are control-plane and may affect execution; observability subscribers are passive and must not.

## User context

Users can associate arbitrary context with a turn:

```ts
await runWithPiContext(
  {
    userId: "u123",
    orgId: "acme",
    region: "eu",
  },
  () => harness.prompt("fix this"),
);
```

Every emitted event inside that async chain includes the context:

```ts
{
  type: "start",
  name: "omk.ai.provider.request",
  traceId: "t1",
  spanId: "s3",
  parentSpanId: "s1",
  context: {
    userId: "u123",
    orgId: "acme",
    region: "eu",
  },
  payload: {
    provider: "anthropic",
    model: "claude-sonnet-4",
  },
}
```

An OTel adapter can map this to span attributes. A Sentry adapter can map it to Sentry context/spans. A custom user can log JSON.

## Package story

Minimal initial package:

```text
packages/observability
  runtime-agnostic context + traceOperation + subscribe
```

Then:

```text
packages/ai
  emits omk.ai.* events

packages/agent
  emits omk.agent.* / omk.session.* events
```

Optional later:

```text
packages/observability-node
  AsyncLocalStorage + diagnostics_channel bridge

packages/otel
  subscribes to OMK events and creates OpenTelemetry spans
```

## Thesis

OMK defines a stable, safe event contract. Adapters define where events go.

This makes ai/harness observable without binding core packages to OTel, Sentry, Node-only APIs, or monkey-patching.
