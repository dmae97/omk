# AgentHarness lifecycle

`AgentHarness` is the orchestration layer above the low-level `Agent`. It owns session persistence, runtime configuration, resource resolution, operation locking, and extension-facing mutation semantics.

## State model

The harness separates state into four categories.

### Harness config

Harness config is the latest runtime configuration set by the application or extensions:

- model
- thinking level
- tools
- active tool names
- resources or resource provider
- system prompt or system prompt provider

Getters return harness config. They do not return the snapshot used by an in-flight provider request.

Setters update harness config immediately, including while a turn is in flight. Changes affect the next turn snapshot, not the currently running provider request.

### Turn snapshot

A turn snapshot is the concrete state used for one LLM turn. It is created by `createTurnState()` and contains:

- persisted session messages
- resolved resources
- resolved system prompt
- model
- thinking level
- active tools

Static option values are used directly. Provider callbacks are invoked once per `createTurnState()` call. All logic for that turn uses the same snapshot.

### Session

The session contains persisted entries only. Session reads return persisted state and do not include queued writes.

### Pending session writes

Session writes requested while an operation is active are queued as pending session writes. Pending writes are visible through an explicit pending-writes API, not through normal session reads.

Pending session writes are always persisted. They are flushed at save points, at operation settlement, and in failure cleanup.

## Operation phases

The harness has an explicit phase:

```ts
type AgentHarnessPhase = "idle" | "turn" | "compaction" | "branch_summary" | "retry";
```

Structural operations require `phase === "idle"` and synchronously set the phase before the first `await`:

- `prompt`
- `skill`
- `promptFromTemplate`
- `compact`
- `navigateTree`

Starting another structural operation while the harness is not idle throws.

The following operations are allowed during a turn where appropriate:

- `steer`
- `followUp`
- `nextTurn`
- `abort`
- runtime config setters
- session facade writes

## Turn execution

`prompt`, `skill`, and `promptFromTemplate` follow the same flow:

1. Assert idle and set phase to `"turn"`.
2. Create a turn snapshot with `createTurnState()`.
3. Derive invocation text from that snapshot.
4. Execute the turn with `executeTurn()`.

`skill` and `promptFromTemplate` resolve their resource from the same snapshot that is passed to the turn. They do not resolve resources separately.

`nextTurn` queues arbitrary `AgentMessage`s for the next user-initiated turn. Queued messages are inserted before the new user message.

## Save points

A save point occurs after an assistant turn and its tool-result messages have completed.

At a save point the harness:

1. flushes pending session writes after the agent-emitted messages for that turn
2. creates a fresh turn snapshot if the low-level loop may continue
3. applies the fresh context/model/reasoning state before the next provider request

This lets model, thinking level, tool, resource, and system prompt changes made during a turn affect the next turn in the same run, while never mutating an in-flight provider request. The loop callbacks are not recreated at save points.

No state refresh is needed on `agent_end` except flushing leftover pending session writes and clearing the operation phase.

## Session facade

Extensions and callbacks interact with a harness-scoped session facade rather than the raw session.

Reads delegate to persisted session state. Writes behave as follows:

- idle: persist immediately
- busy: enqueue as pending session writes

The facade exposes pending writes explicitly for diagnostics and UI:

```ts
getPendingWrites(): readonly PendingSessionWrite[]
```

Agent-emitted messages are persisted on `message_end` to preserve transcript ordering. Pending extension/session writes flush after those messages at save points.

## Extension context

Event payloads describe what is happening. Harness getters describe latest config for future snapshots.

Event contexts expose the harness and session facade. Events that belong to a turn also expose the immutable turn snapshot used for that turn. Extensions may update harness config at any time; updates affect the next snapshot.

## Abort

Abort is allowed during a turn. It aborts the low-level run and clears low-level steering/follow-up queues.

Abort does not discard pending session writes. Pending writes flush at the next save point if reached, at `agent_end`, or in operation failure cleanup.

## Compaction and tree navigation

Compaction and tree navigation are structural session mutations.

They are allowed only while idle and are not queued. They operate on persisted session state. The next prompt creates a fresh turn snapshot.

Branch summary generation is part of the tree navigation operation.
