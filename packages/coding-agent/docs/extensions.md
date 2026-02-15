> omp can create extensions. Ask it to build one for your use case.

# Extensions

Extensions are TypeScript modules that extend omp's behavior. They can subscribe to lifecycle events, register custom tools callable by the LLM, add commands, and more.

**Key capabilities:**

- **Custom tools** - Register tools the LLM can call via `pi.registerTool()`
- **Event interception** - Block or modify tool calls, inject context, customize compaction
- **User interaction** - Prompt users via `ctx.ui` (select, confirm, input, notify)
- **Custom UI components** - Full TUI components with keyboard input via `ctx.ui.custom()` for complex interactions
- **Custom commands** - Register commands like `/mycommand` via `pi.registerCommand()`
- **Session persistence** - Store state that survives restarts via `pi.appendEntry()`
- **Custom rendering** - Control how tool calls/results and messages appear in TUI

**Example use cases:**

- Permission gates (confirm before `rm -rf`, `sudo`, etc.)
- Git checkpointing (stash at each turn, restore on branch)
- Path protection (block writes to `.env`, `node_modules/`)
- Custom compaction (summarize conversation your way)
- Interactive tools (questions, wizards, custom dialogs)
- Stateful tools (todo lists, connection pools)
- External integrations (file watchers, webhooks, CI triggers)

See [examples/extensions/](../examples/extensions/) for working implementations.

## Table of Contents

- [Quick Start](#quick-start)
- [Extension Locations](#extension-locations)
- [Available Imports](#available-imports)
- [Writing an Extension](#writing-an-extension)
  - [Extension Styles](#extension-styles)
- [Events](#events)
  - [Lifecycle Overview](#lifecycle-overview)
  - [Session Events](#session-events)
  - [Agent Events](#agent-events)
  - [Input Events](#input-events)
  - [User Bash/Python Events](#user-bashpython-events)
  - [Tool Events](#tool-events)
- [ExtensionContext](#extensioncontext)
- [ExtensionCommandContext](#extensioncommandcontext)
- [ExtensionAPI Methods](#extensionapi-methods)
- [State Management](#state-management)
- [Custom Tools](#custom-tools)
- [Custom UI](#custom-ui)
- [Error Handling](#error-handling)
- [Mode Behavior](#mode-behavior)

## Quick Start

Create `~/.omp/agent/extensions/my-extension.ts` (legacy alias: `~/.pi/agent/extensions/`):

```typescript
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export default function (pi: ExtensionAPI) {
	// React to events
	pi.on("session_start", async (_event, ctx) => {
		ctx.ui.notify("Extension loaded!", "info");
	});

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName === "bash" && event.input.command?.includes("rm -rf")) {
			const ok = await ctx.ui.confirm("Dangerous!", "Allow rm -rf?");
			if (!ok) return { block: true, reason: "Blocked by user" };
		}
	});

	// Register a custom tool
	pi.registerTool({
		name: "greet",
		label: "Greet",
		description: "Greet someone by name",
		parameters: Type.Object({
			name: Type.String({ description: "Name to greet" }),
		}),
		async execute(toolCallId, params, onUpdate, ctx, signal) {
			return {
				content: [{ type: "text", text: `Hello, ${params.name}!` }],
				details: {},
			};
		},
	});

	// Register a command
	pi.registerCommand("hello", {
		description: "Say hello",
		handler: async (args, ctx) => {
			ctx.ui.notify(`Hello ${args || "world"}!`, "info");
		},
	});
}
```

Test with `--extension` (or `-e`) flag:

```bash
omp -e ./my-extension.ts
```

## Extension Locations

Extensions are auto-discovered from:

| Location                                 | Scope                        |
| ---------------------------------------- | ---------------------------- |
| `~/.omp/agent/extensions/*.{ts,js}`      | Global (all projects)        |
| `~/.omp/agent/extensions/*/index.{ts,js}` | Global (subdirectory)        |
| `.omp/extensions/*.{ts,js}`              | Project-local                |
| `.omp/extensions/*/index.{ts,js}`        | Project-local (subdirectory) |

Legacy `.pi` directories are supported as aliases for the `.omp` paths above.

`settings.json` lives in `~/.omp/agent/settings.json` (user) or `.omp/settings.json` (project).

Additional paths via `settings.json`:

```json
{
	"extensions": ["/path/to/extension.ts", "/path/to/extension/dir"]
}
```

**Discovery rules:**

1. **Direct files:** `extensions/*.ts` or `*.js` → loaded directly
2. **Subdirectory with index:** `extensions/myext/index.ts` or `index.js` → loaded as single extension
3. **Subdirectory with package.json:** `extensions/myext/package.json` with `"omp"` field (legacy `"pi"` supported) → loads declared paths

Discovery only recurses one level under `extensions/`. Deeper entry points must be listed in the manifest.

```
~/.omp/agent/extensions/
├── simple.ts                      # Direct file (auto-discovered)
├── my-tool/
│   └── index.ts                   # Subdirectory with index (auto-discovered)
└── my-extension-pack/
    ├── package.json               # Declares multiple extensions
    ├── node_modules/              # Dependencies installed here
    └── src/
        ├── safety-gates.ts        # First extension
        └── custom-tools.ts        # Second extension
```

```json
// my-extension-pack/package.json
{
	"name": "my-extension-pack",
	"dependencies": {
		"zod": "^3.0.0"
	},
	"omp": {
		"extensions": ["./src/safety-gates.ts", "./src/custom-tools.ts"]
	}
}
```

The `package.json` approach enables:

- Multiple extensions from one package
- Third-party dependencies resolved via Bun's module loader
- Nested source structure (no depth limit within the package)
- Deployment to and installation from npm

## Available Imports

| Package                     | Purpose                                                      |
| --------------------------- | ------------------------------------------------------------ |
| `@oh-my-pi/pi-coding-agent` | Extension types (`ExtensionAPI`, `ExtensionContext`, events) |
| `@sinclair/typebox`         | Schema definitions for tool parameters                       |
| `@oh-my-pi/pi-ai`           | AI utilities (`StringEnum` for Google-compatible enums)      |
| `@oh-my-pi/pi-tui`          | TUI components for custom rendering                          |

`ExtensionAPI` also exposes:

- `pi.logger` - file logger (preferred over `console.*`)
- `pi.typebox` - injected TypeBox module
- `pi.pi` - access to `@oh-my-pi/pi-coding-agent` exports

Dependencies work like any Bun project. Add a `package.json` next to your extension (or in a parent directory), run `bun install`, and imports from `node_modules/` resolve automatically.

Node.js built-ins (`node:fs`, `node:path`, etc.) are also available.

## Writing an Extension

An extension exports a default function that receives `ExtensionAPI`:

```typescript
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  // Subscribe to events
  pi.on("event_name", async (event, ctx) => {
    // ctx.ui for user interaction
    const ok = await ctx.ui.confirm("Title", "Are you sure?");
    ctx.ui.notify("Done!", "success");
    ctx.ui.setStatus("my-ext", "Processing...");  // Footer status
    ctx.ui.setWidget("my-ext", ["Line 1", "Line 2"]);  // Widget above editor
  });

  // Register tools, commands, shortcuts, flags
  pi.registerTool({ ... });
  pi.registerCommand("name", { ... });
  pi.registerShortcut("ctrl+x", { ... });
  pi.registerFlag("--my-flag", { ... });
}
```

Extensions are loaded via Bun's native module loader, so TypeScript works without a build step. Both `.ts` and `.js` entry points are supported.

### Extension Styles

**Single file** - simplest, for small extensions (also supports `.js`):

```
~/.omp/agent/extensions/
└── my-extension.ts
```

**Directory with index.ts** - for multi-file extensions (also supports `index.js`):

```
~/.omp/agent/extensions/
└── my-extension/
    ├── index.ts        # Entry point (exports default function)
    ├── tools.ts        # Helper module
    └── utils.ts        # Helper module
```

**Package with dependencies** - for extensions that need npm packages:

```
~/.omp/agent/extensions/
└── my-extension/
    ├── package.json    # Declares dependencies and entry points
    ├── bun.lockb
    ├── node_modules/   # After bun install
    └── src/
        └── index.ts
```

```json
// package.json
{
	"name": "my-extension",
	"dependencies": {
		"zod": "^3.0.0",
		"chalk": "^5.0.0"
	},
	"omp": {
		"extensions": ["./src/index.ts"]
	}
}
```

The manifest key can be `omp` (preferred) or `pi` (legacy).

Run `bun install` in the extension directory, then imports from `node_modules/` work automatically.

## Events

### Lifecycle Overview

```
omp starts
  │
  └─► session_start
      │
      ▼
user submits input ────────────────────────────────────────┐
  │                                                        │
  ├─► input (can modify or handle)                          │
  ├─► before_agent_start (can inject message, modify system prompt)
  ├─► agent_start                                          │
  │                                                        │
  │   ┌─── turn (repeats while LLM calls tools) ───┐       │
  │   │                                            │       │
  │   ├─► turn_start                               │       │
  │   ├─► context (can modify messages)            │       │
  │   │                                            │       │
  │   │   LLM responds, may call tools:            │       │
  │   │     ├─► tool_call (can block)              │       │
  │   │     │   tool executes                      │       │
  │   │     └─► tool_result (can modify)           │       │
  │   │                                            │       │
  │   └─► turn_end                                 │       │
  │                                                        │
  └─► agent_end                                            │
                                                           │
user sends another prompt ◄────────────────────────────────┘

/new (new session) or /resume (switch session)
  ├─► session_before_switch (can cancel)
  └─► session_switch

/branch
  ├─► session_before_branch (can cancel)
  └─► session_branch

/compact or auto-compaction
  ├─► session_before_compact (can cancel or customize)
  ├─► session.compacting (add context or override prompt)
  └─► session_compact

/tree navigation
  ├─► session_before_tree (can cancel or customize)
  └─► session_tree

exit (Ctrl+C, Ctrl+D)
  └─► session_shutdown
```

### Session Events

#### session_start

Fired on initial session load.

```typescript
pi.on("session_start", async (_event, ctx) => {
	ctx.ui.notify(`Session: ${ctx.sessionManager.getSessionFile() ?? "ephemeral"}`, "info");
});
```

**Examples:** [todo.ts](../examples/extensions/todo.ts), [tools.ts](../examples/extensions/tools.ts)

#### session_before_switch / session_switch

Fired when starting a new session (`/new`), resuming (`/resume`), or forking a session.

```typescript
pi.on("session_before_switch", async (event, ctx) => {
	// event.reason - "new", "resume", or "fork"
	// event.targetSessionFile - session we're switching to ("resume" only)

	if (event.reason === "new") {
		const ok = await ctx.ui.confirm("Clear?", "Delete all messages?");
		if (!ok) return { cancel: true };
	}
});

pi.on("session_switch", async (event, ctx) => {
	// event.reason - "new", "resume", or "fork"
	// event.previousSessionFile - session we came from
});
```

**Examples:** [todo.ts](../examples/extensions/todo.ts)

#### session_before_branch / session_branch

Fired when branching via `/branch`.

```typescript
pi.on("session_before_branch", async (event, ctx) => {
	// event.entryId - ID of the entry being branched from
	return { cancel: true }; // Cancel branch
	// OR
	return { skipConversationRestore: true }; // Branch but don't rewind messages
});

pi.on("session_branch", async (event, ctx) => {
	// event.previousSessionFile - previous session file
});
```

**Examples:** [todo.ts](../examples/extensions/todo.ts), [tools.ts](../examples/extensions/tools.ts)

#### session_before_compact / session_compact

Fired on compaction. See [compaction.md](compaction.md) for details.

```typescript
pi.on("session_before_compact", async (event, ctx) => {
	const { preparation, branchEntries, customInstructions, signal } = event;

	// Cancel:
	return { cancel: true };

	// Custom summary:
	return {
		compaction: {
			summary: "...",
			firstKeptEntryId: preparation.firstKeptEntryId,
			tokensBefore: preparation.tokensBefore,
		},
	};
});

pi.on("session_compact", async (event, ctx) => {
	// event.compactionEntry - the saved compaction
	// event.fromExtension - whether extension provided it
});
```


#### session.compacting

Fired before compaction summarization to adjust the prompt or inject extra context.

```typescript
pi.on("session.compacting", async (event, ctx) => {
	// event.messages - messages being summarized
	return {
		context: ["Important context line"],
		prompt: "Summarize with an emphasis on decisions and follow-ups",
		preserveData: { ticketId: "ABC-123" },
	};
});
```

#### session_before_tree / session_tree

Fired on `/tree` navigation.

```typescript
pi.on("session_before_tree", async (event, ctx) => {
	const { preparation, signal } = event;
	return { cancel: true };
	// OR provide custom summary:
	return { summary: { summary: "...", details: {} } };
});

pi.on("session_tree", async (event, ctx) => {
	// event.newLeafId, oldLeafId, summaryEntry, fromExtension
});
```

**Examples:** [tools.ts](../examples/extensions/tools.ts)

#### session_shutdown

Fired on exit (Ctrl+C, Ctrl+D, SIGTERM).

```typescript
pi.on("session_shutdown", async (_event, ctx) => {
	// Cleanup, save state, etc.
});
```

### Agent Events

#### before_agent_start

Fired after user submits prompt, before agent loop. Can inject a message and/or modify the system prompt.

```typescript
pi.on("before_agent_start", async (event, ctx) => {
	// event.prompt - user's prompt text
	// event.images - attached images (if any)
	// event.systemPrompt - current system prompt

	return {
		// Inject a persistent message (stored in session, sent to LLM)
		message: {
			customType: "my-extension",
			content: "Additional context for the LLM",
			display: true,
		},
		// Replace the system prompt for this turn (chained across extensions)
		systemPrompt: event.systemPrompt + "\n\nExtra instructions for this turn...",
	};
});
```

**Examples:** [pirate.ts](../examples/extensions/pirate.ts), [plan-mode.ts](../examples/extensions/plan-mode.ts)

#### agent_start / agent_end

Fired once per user prompt.

```typescript
pi.on("agent_start", async (_event, ctx) => {});

pi.on("agent_end", async (event, ctx) => {
	// event.messages - messages from this prompt
});
```

**Examples:** [chalk-logger.ts](../examples/extensions/chalk-logger.ts), [plan-mode.ts](../examples/extensions/plan-mode.ts)

#### turn_start / turn_end

Fired for each turn (one LLM response + tool calls).

```typescript
pi.on("turn_start", async (event, ctx) => {
	// event.turnIndex, event.timestamp
});

pi.on("turn_end", async (event, ctx) => {
	// event.turnIndex, event.message, event.toolResults
});
```

**Examples:** [plan-mode.ts](../examples/extensions/plan-mode.ts)

#### Runtime reliability events

Fired for internal recovery/continuation mechanics:

- `auto_compaction_start` / `auto_compaction_end`
- `auto_retry_start` / `auto_retry_end`
- `ttsr_triggered`
- `todo_reminder`

```typescript
pi.on("todo_reminder", async (event, _ctx) => {
	// event.todos, event.attempt, event.maxAttempts
});

pi.on("auto_retry_start", async (event, _ctx) => {
	// event.attempt, event.maxAttempts, event.delayMs, event.errorMessage
});
```


#### context

Fired before each LLM call. Modify messages non-destructively.

```typescript
pi.on("context", async (event, ctx) => {
	// event.messages - deep copy, safe to modify
	const filtered = event.messages.filter((m) => !shouldPrune(m));
	return { messages: filtered };
});
```

### Input Events

#### input

Fired when the user submits input (interactive, RPC, or extension-triggered). Can rewrite or handle input.

```typescript
pi.on("input", async (event, ctx) => {
	// event.text, event.images, event.source
	if (event.text.startsWith("/noop")) {
		return { handled: true };
	}
	return { text: event.text.trim() };
});
```

### User Bash/Python Events

#### user_bash

Fired when the user runs a `!`/`!!` command. Return a `result` to override execution.

```typescript
pi.on("user_bash", async (event, ctx) => {
	// event.command, event.excludeFromContext, event.cwd
	if (event.command === "pwd") {
		return {
			result: {
				stdout: event.cwd,
				stderr: "",
				code: 0,
				killed: false,
			},
		};
	}
});
```

#### user_python

Fired when the user runs a `$`/`$$` block. Return a `result` to override execution.

```typescript
pi.on("user_python", async (event, ctx) => {
	// event.code, event.excludeFromContext, event.cwd
});
```

### Tool Events

#### tool_call

Fired before tool executes. **Can block.**

```typescript
pi.on("tool_call", async (event, ctx) => {
	// event.toolName - "bash", "read", "write", "edit", etc.
	// event.toolCallId
	// event.input - tool parameters

	if (shouldBlock(event)) {
		return { block: true, reason: "Not allowed" };
	}
});
```

**Examples:** [chalk-logger.ts](../examples/extensions/chalk-logger.ts), [plan-mode.ts](../examples/extensions/plan-mode.ts)

#### tool_result

Fired after tool executes. **Can modify result.**

`tool_result` handlers chain like middleware:
- Handlers run in extension load order
- Each handler sees the latest result after previous handler changes
- Handlers can return partial patches (`content`, `details`, or `isError`); omitted fields keep their current values

```typescript
pi.on("tool_result", async (event, ctx) => {
  // event.toolName, event.toolCallId, event.input
  // event.content, event.details, event.isError

  if (event.toolName === "bash") {
    // event.details is typed as BashToolDetails
  }

  // Modify result:
  return { content: [...], details: {...}, isError: false };
});
```

**Examples:** [plan-mode.ts](../examples/extensions/plan-mode.ts)

## ExtensionContext

Every handler receives `ctx: ExtensionContext`:

### ctx.ui

UI methods for user interaction. See [Custom UI](#custom-ui) for full details.

### ctx.hasUI

`false` in print mode (`-p`) and JSON mode. `true` in interactive and RPC mode. In RPC mode, dialog methods (`select`, `confirm`, `input`, `editor`) work via the extension UI sub-protocol, and fire-and-forget methods (`notify`, `setStatus`, `setWidget`, `setTitle`, `setEditorText`) emit requests to the client. Some TUI-specific methods are no-ops or return defaults (see [rpc.md](rpc.md#extension-ui-protocol)).

### ctx.cwd

Current working directory.

### ctx.sessionManager

Read-only access to session state:

```typescript
ctx.sessionManager.getEntries(); // All entries
ctx.sessionManager.getBranch(); // Current branch
ctx.sessionManager.getLeafId(); // Current leaf entry ID
```

### ctx.modelRegistry / ctx.model

Access to models and API keys.

### ctx.getContextUsage()

Returns current context usage for the active model, if available.

### ctx.compact(instructionsOrOptions?)

Trigger compaction programmatically (interactive mode shows UI).

### ctx.shutdown()

Gracefully shut down and exit.

### ctx.isIdle() / ctx.abort() / ctx.hasPendingMessages()

Control flow helpers.

## ExtensionCommandContext

Command handlers receive `ExtensionCommandContext`, which extends `ExtensionContext` with session control methods. These are only available in commands because they can deadlock if called from event handlers.

### ctx.waitForIdle()

Wait for the agent to finish streaming:

```typescript
pi.registerCommand("my-cmd", {
	handler: async (args, ctx) => {
		await ctx.waitForIdle();
		// Agent is now idle, safe to modify session
	},
});
```

### ctx.newSession(options?)

Create a new session:

```typescript
const result = await ctx.newSession({
	parentSession: ctx.sessionManager.getSessionFile(),
	setup: async (sm) => {
		sm.appendMessage({
			role: "user",
			content: [{ type: "text", text: "Context from previous session..." }],
			timestamp: Date.now(),
		});
	},
});

if (result.cancelled) {
	// An extension cancelled the new session
}
```

### ctx.branch(entryId)

Branch from a specific entry:

```typescript
const result = await ctx.branch("entry-id-123");
if (!result.cancelled) {
	// Now in the branched session
}
```

### ctx.navigateTree(targetId, options?)

Navigate to a different point in the session tree:

```typescript
const result = await ctx.navigateTree("entry-id-456", {
	summarize: true,
});
```

### ctx.reload()

Run the same reload flow as `/reload`.

```typescript
pi.registerCommand("reload-runtime", {
  description: "Reload extensions, skills, prompts, and themes",
  handler: async (_args, ctx) => {
    await ctx.reload();
    return;
  },
});
```

Important behavior:
- `await ctx.reload()` emits `session_shutdown` for the current extension runtime
- It then reloads resources and emits `session_start` (and `resources_discover` with reason `"reload"`) for the new runtime
- The currently running command handler still continues in the old call frame
- Code after `await ctx.reload()` still runs from the pre-reload version
- Code after `await ctx.reload()` must not assume old in-memory extension state is still valid
- After the handler returns, future commands/events/tool calls use the new extension version

For predictable behavior, treat reload as terminal for that handler (`await ctx.reload(); return;`).

Tools run with `ExtensionContext`, so they cannot call `ctx.reload()` directly. Use a command as the reload entrypoint, then expose a tool that queues that command as a follow-up user message.

Example tool the LLM can call to trigger reload:

```typescript
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("reload-runtime", {
    description: "Reload extensions, skills, prompts, and themes",
    handler: async (_args, ctx) => {
      await ctx.reload();
      return;
    },
  });

  pi.registerTool({
    name: "reload_runtime",
    label: "Reload Runtime",
    description: "Reload extensions, skills, prompts, and themes",
    parameters: Type.Object({}),
    async execute() {
      pi.sendUserMessage("/reload-runtime", { deliverAs: "followUp" });
      return {
        content: [{ type: "text", text: "Queued /reload-runtime as a follow-up command." }],
      };
    },
  });
}
```

## ExtensionAPI Methods

### pi.on(event, handler)

Subscribe to events. See [Events](#events).

### pi.registerTool(definition)

Register a custom tool callable by the LLM. See [Custom Tools](#custom-tools) for full details.

```typescript
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@oh-my-pi/pi-ai";

pi.registerTool({
  name: "my_tool",
  label: "My Tool",
  description: "What this tool does",
  parameters: Type.Object({
    action: StringEnum(["list", "add"] as const),
    text: Type.Optional(Type.String()),
  }),

  async execute(toolCallId, params, onUpdate, ctx, signal) {
    // Stream progress
    onUpdate?.({ content: [{ type: "text", text: "Working..." }] });

    return {
      content: [{ type: "text", text: "Done" }],
      details: { result: "..." },
    };
  },

  // Optional: Custom rendering
  renderCall(args, theme) { ... },
  renderResult(result, options, theme, args) { ... },
});
```

### pi.sendMessage(message, options?)

Inject a message into the session:

```typescript
pi.sendMessage({
  customType: "my-extension",
  content: "Message text",
  display: true,
  details: { ... },
}, {
  triggerTurn: true,
  deliverAs: "steer",
});
```

**Options:**

- `deliverAs` - Delivery mode:
  - `"steer"` (default) - Interrupts streaming. Delivered after current tool finishes, remaining tools skipped.
  - `"followUp"` - Waits for agent to finish. Delivered only when agent has no more tool calls.
  - `"nextTurn"` - Queued for next user prompt. Does not interrupt or trigger anything.
- `triggerTurn: true` - If agent is idle, trigger an LLM response immediately. Only applies to `"steer"` and `"followUp"` modes (ignored for `"nextTurn"`).

### pi.sendUserMessage(content, options?)

Send a user message into the session and trigger a turn immediately:

```typescript
pi.sendUserMessage("Follow up with the latest status", { deliverAs: "followUp" });
```

### pi.appendEntry(customType, data?)

Persist extension state (does NOT participate in LLM context):

```typescript
pi.appendEntry("my-state", { count: 42 });

// Restore on reload
pi.on("session_start", async (_event, ctx) => {
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type === "custom" && entry.customType === "my-state") {
			// Reconstruct from entry.data
		}
	}
});
```

### pi.registerCommand(name, options)

Register a command:

```typescript
pi.registerCommand("stats", {
	description: "Show session statistics",
	handler: async (args, ctx) => {
		const count = ctx.sessionManager.getEntries().length;
		ctx.ui.notify(`${count} entries`, "info");
	},
});
```

### pi.registerMessageRenderer(customType, renderer)

Register a custom TUI renderer for messages with your `customType`. See [Custom UI](#custom-ui).

### pi.registerShortcut(shortcut, options)

Register a keyboard shortcut:

```typescript
pi.registerShortcut("ctrl+shift+p", {
	description: "Toggle plan mode",
	handler: async (ctx) => {
		ctx.ui.notify("Toggled!");
	},
});
```

### pi.registerFlag(name, options)

Register a CLI flag:

```typescript
pi.registerFlag("--plan", {
	description: "Start in plan mode",
	type: "boolean",
	default: false,
});

// Check value
if (pi.getFlag("--plan")) {
	// Plan mode enabled
}
```

### pi.setLabel(label)

Set a display label for the extension:

```typescript
pi.setLabel("My Extension");
```

### pi.exec(command, args, options?)

Execute a shell command:

```typescript
const result = await pi.exec("git", ["status"], { signal, timeout: 5000 });
// result.stdout, result.stderr, result.code, result.killed
```

### pi.getActiveTools() / pi.getAllTools() / pi.setActiveTools(names)

Manage active tools:

```typescript
const active = pi.getActiveTools(); // ["read", "bash", "edit", "write"]
pi.setActiveTools(["read", "bash"]); // Switch to read-only
```

### pi.setModel(model) / pi.getThinkingLevel() / pi.setThinkingLevel(level)

Control the active model and thinking level:

```typescript
const model = ctx.modelRegistry.find("anthropic", "claude-sonnet-4-5");
if (model) {
	const ok = await pi.setModel(model);
}
const level = pi.getThinkingLevel();
pi.setThinkingLevel(level);
```

### pi.events

Shared event bus for communication between extensions:

```typescript
pi.events.on("my:event", (data) => { ... });
pi.events.emit("my:event", { ... });
```

## State Management

Extensions with state should store it in tool result `details` for proper branching support. Tools can also implement `onSession` to rebuild or clean up state on start/switch/branch/tree/shutdown:

```typescript
export default function (pi: ExtensionAPI) {
	let items: string[] = [];

	// Reconstruct state from session
	pi.on("session_start", async (_event, ctx) => {
		items = [];
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type === "message" && entry.message.role === "toolResult") {
				if (entry.message.toolName === "my_tool") {
					items = entry.message.details?.items ?? [];
				}
			}
		}
	});

	pi.registerTool({
		name: "my_tool",
		// ...
		async execute(toolCallId, params, onUpdate, ctx, signal) {
			items.push("new item");
			return {
				content: [{ type: "text", text: "Added" }],
				details: { items: [...items] }, // Store for reconstruction
			};
		},
	});
}
```

## Custom Tools

Register tools the LLM can call via `pi.registerTool()`. Tools appear in the system prompt and can have custom rendering.

### Tool Definition

```typescript
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@oh-my-pi/pi-ai";
import { Text } from "@oh-my-pi/pi-tui";

pi.registerTool({
  name: "my_tool",
  label: "My Tool",
  description: "What this tool does (shown to LLM)",
  parameters: Type.Object({
    action: StringEnum(["list", "add"] as const),  // Use StringEnum for Google compatibility
    text: Type.Optional(Type.String()),
  }),
  hidden: false, // Optional: set true to hide unless explicitly enabled
  onSession(event, ctx) {
    // event.reason: "start" | "switch" | "branch" | "tree" | "shutdown"
  },

  async execute(toolCallId, params, onUpdate, ctx, signal) {
    // Check for cancellation
    if (signal?.aborted) {
      return { content: [{ type: "text", text: "Cancelled" }] };
    }

    // Stream progress updates
    onUpdate?.({
      content: [{ type: "text", text: "Working..." }],
      details: { progress: 50 },
    });

    // Run commands via pi.exec (captured from extension closure)
    const result = await pi.exec("some-command", [], { signal });

    // Return result
    return {
      content: [{ type: "text", text: "Done" }],  // Sent to LLM
      details: { data: result },                   // For rendering & state
    };
  },

  // Optional: Custom rendering
  renderCall(args, theme) { ... },
  renderResult(result, options, theme, args) { ... },
});
```

**Important:** Use `StringEnum` from `@oh-my-pi/pi-ai` for string enums. `Type.Union`/`Type.Literal` doesn't work with Google's API.

### Multiple Tools

One extension can register multiple tools with shared state:

```typescript
export default function (pi: ExtensionAPI) {
  let connection = null;

  pi.registerTool({ name: "db_connect", ... });
  pi.registerTool({ name: "db_query", ... });
  pi.registerTool({ name: "db_close", ... });

  pi.on("session_shutdown", async () => {
    connection?.close();
  });
}
```

### Custom Rendering

Tools can provide `renderCall` and `renderResult` for custom TUI display. See [tui.md](tui.md) for the full component API.

Tool output is wrapped in a `Box` that handles padding and background. Your render methods return `Component` instances (typically `Text`).

#### renderCall

Renders the tool call (before/during execution):

```typescript
import { Text } from "@oh-my-pi/pi-tui";

renderCall(args, theme) {
  let text = theme.fg("toolTitle", theme.bold("my_tool "));
  text += theme.fg("muted", args.action);
  if (args.text) {
    text += " " + theme.fg("dim", `"${args.text}"`);
  }
  return new Text(text, 0, 0);  // 0,0 padding - Box handles it
}
```

#### renderResult

Renders the tool result:

```typescript
renderResult(result, { expanded, isPartial }, theme) {
  // Handle streaming
  if (isPartial) {
    return new Text(theme.fg("warning", "Processing..."), 0, 0);
  }

  // Handle errors
  if (result.details?.error) {
    return new Text(theme.fg("error", `Error: ${result.details.error}`), 0, 0);
  }

  // Normal result - support expanded view (Ctrl+O)
  let text = theme.fg("success", "✓ Done");
  if (expanded && result.details?.items) {
    for (const item of result.details.items) {
      text += "\n  " + theme.fg("dim", item);
    }
  }
  return new Text(text, 0, 0);
}
```

#### Best Practices

- Use `Text` with padding `(0, 0)` - the Box handles padding
- Use `\n` for multi-line content
- Handle `isPartial` for streaming progress
- Support `expanded` for detail on demand
- Keep default view compact

#### Fallback

If `renderCall`/`renderResult` is not defined or throws:

- `renderCall`: Shows tool name
- `renderResult`: Shows raw text from `content`

## Custom UI

Extensions can interact with users via `ctx.ui` methods and customize how messages/tools render.

### Dialogs

```typescript
// Select from options
const choice = await ctx.ui.select("Pick one:", ["A", "B", "C"]);

// Confirm dialog
const ok = await ctx.ui.confirm("Delete?", "This cannot be undone");

// Text input
const name = await ctx.ui.input("Name:", "placeholder");

// Multi-line editor
const text = await ctx.ui.editor("Edit:", "prefilled text");

// Notification (non-blocking)
ctx.ui.notify("Done!", "info"); // "info" | "warning" | "error"
```

### Widgets and Status

```typescript
// Status in footer (persistent until cleared)
ctx.ui.setStatus("my-ext", "Processing...");
ctx.ui.setStatus("my-ext", undefined); // Clear

// Working message shown during streaming
ctx.ui.setWorkingMessage("Connecting...");
ctx.ui.setWorkingMessage(); // Restore default

// Widget above editor (string array or factory function)
ctx.ui.setWidget("my-widget", ["Line 1", "Line 2"]);
ctx.ui.setWidget("my-widget", (tui, theme) => new Text(theme.fg("accent", "Custom"), 0, 0));
ctx.ui.setWidget("my-widget", undefined); // Clear

// Custom header/footer
ctx.ui.setHeader((tui, theme) => new Text(theme.fg("accent", "Header"), 0, 0));
ctx.ui.setFooter((tui, theme) => new Text(theme.fg("accent", "Footer"), 0, 0));
ctx.ui.setHeader(undefined); // Restore default
ctx.ui.setFooter(undefined); // Restore default

// Terminal title
ctx.ui.setTitle("omp - my-project");

// Editor text
ctx.ui.setEditorText("Prefill text");
const current = ctx.ui.getEditorText();

// Paste into editor (triggers paste handling, including collapse for large content)
ctx.ui.pasteToEditor("pasted content");

// Custom editor component
ctx.ui.setEditorComponent((tui, theme, keybindings) => new MyEditor(tui, theme, keybindings)); // EditorComponent
ctx.ui.setEditorComponent(undefined); // Restore default
```

### Custom Components

For complex UI, use `ctx.ui.custom()`. This temporarily replaces the editor with your component until `done()` is called:

```typescript
import { Text, Component } from "@oh-my-pi/pi-tui";

const result = await ctx.ui.custom<boolean>((tui, theme, keybindings, done) => {
	const text = new Text("Press Enter to confirm, Escape to cancel", 1, 1);

	text.onKey = (key) => {
		if (key === "return") done(true);
		if (key === "escape") done(false);
		return true;
	};

	return text;
}, { overlay: true });

if (result) {
	// User pressed Enter
}
```

The callback receives:

- `tui` - TUI instance (for screen dimensions, focus management)
- `theme` - Current theme for styling
- `keybindings` - Keybindings manager for resolving bindings
- `done(value)` - Call to close component and return value

See [tui.md](tui.md) for the full component API and [examples/extensions/](../examples/extensions/) for working examples (todo.ts, tools.ts, reload-runtime.ts).

### Message Rendering

Register a custom renderer for messages with your `customType`:

```typescript
import { Text } from "@oh-my-pi/pi-tui";

pi.registerMessageRenderer("my-extension", (message, options, theme) => {
	const { expanded } = options;
	let text = theme.fg("accent", `[${message.customType}] `);
	text += message.content;

	if (expanded && message.details) {
		text += "\n" + theme.fg("dim", JSON.stringify(message.details, null, 2));
	}

	return new Text(text, 0, 0);
});
```

Messages are sent via `pi.sendMessage()`:

```typescript
pi.sendMessage({
  customType: "my-extension",  // Matches registerMessageRenderer
  content: "Status update",
  display: true,               // Show in TUI
  details: { ... },            // Available in renderer
});
```

### Themes

```typescript
const themes = await ctx.ui.getAllThemes();
const current = ctx.ui.theme;
const loaded = await ctx.ui.getTheme("celestial");
const result = await ctx.ui.setTheme("celestial");
```

### Theme Colors

All render functions receive a `theme` object:

```typescript
// Foreground colors
theme.fg("toolTitle", text); // Tool names
theme.fg("accent", text); // Highlights
theme.fg("success", text); // Success (green)
theme.fg("error", text); // Errors (red)
theme.fg("warning", text); // Warnings (yellow)
theme.fg("muted", text); // Secondary text
theme.fg("dim", text); // Tertiary text

// Text styles
theme.bold(text);
theme.italic(text);
theme.strikethrough(text);
```

## Error Handling

- Extension errors are logged, agent continues
- `tool_call` errors block the tool (fail-safe)
- Tool `execute` errors are reported to the LLM with `isError: true`

## Mode Behavior

| Mode         | UI Methods    | Notes                           |
| ------------ | ------------- | ------------------------------- |
| Interactive  | Full TUI      | Normal operation                |
| JSON         | No-op         | `--mode json` output            |
| RPC          | JSON protocol | Host handles UI                 |
| Print (`-p`) | No-op         | Extensions run but can't prompt |

In print/JSON/RPC modes, check `ctx.hasUI` before using UI methods.
