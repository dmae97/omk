> omp can help you use the SDK. Ask it to build an integration for your use case.

# SDK

The SDK provides programmatic access to omp's agent capabilities. Use it to embed omp in other applications, build custom interfaces, or integrate with automated workflows.

**Example use cases:**

- Build a custom UI (web, desktop, mobile)
- Integrate agent capabilities into existing applications
- Create automated pipelines with agent reasoning
- Build custom tools that spawn sub-agents
- Test agent behavior programmatically

See [examples/sdk/](../examples/sdk/) for working examples from minimal to full control.

## Quick Start

```typescript
import { createAgentSession, discoverAuthStorage, discoverModels, SessionManager } from "@oh-my-pi/pi-coding-agent";

// Set up credential storage and model registry
const authStorage = await discoverAuthStorage();
const modelRegistry = discoverModels(authStorage);

const { session, modelFallbackMessage } = await createAgentSession({
	sessionManager: SessionManager.inMemory(),
	authStorage,
	modelRegistry,
});

if (modelFallbackMessage) {
	process.stderr.write(`${modelFallbackMessage}\n`);
}

session.subscribe((event) => {
	if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
		process.stdout.write(event.assistantMessageEvent.delta);
	}
});

await session.prompt("What files are in the current directory?");
```

## Installation

```bash
bun add @oh-my-pi/pi-coding-agent
```

The SDK is included in the main package. No separate installation needed.

## Core Concepts

### createAgentSession()

The main factory function. Creates an `AgentSession` with configurable options.

**Philosophy:** "Omit to discover, provide to override."

- Omit an option → omp discovers/loads from standard locations
- Provide an option → your value is used, discovery skipped for that option

```typescript
import { createAgentSession } from "@oh-my-pi/pi-coding-agent";
import systemPrompt from "./SYSTEM.md" with { type: "text" };

// Minimal: all defaults (discovers from cwd + config dirs and ~/.omp/agent)
const { session } = await createAgentSession();

// Custom: override specific options
const { session } = await createAgentSession({
	model: myModel,
	systemPrompt,
	toolNames: ["read", "bash", "edit"], // Filter to specific tools
	sessionManager: SessionManager.inMemory(),
});
```

### AgentSession

The session manages the agent lifecycle, message history, and event streaming.

```typescript
interface AgentSession {
	// Prompting
	prompt(text: string, options?: PromptOptions): Promise<void>;
	sendUserMessage(
		content: string | (TextContent | ImageContent)[],
		options?: { deliverAs?: "steer" | "followUp" },
	): Promise<void>;
	steer(text: string): void;
	followUp(text: string): void;

	// Subscribe to events (returns unsubscribe function)
	subscribe(listener: (event: AgentSessionEvent) => void): () => void;

	// Session info
	sessionFile: string | undefined; // undefined for in-memory
	sessionId: string;
	sessionName: string | undefined;

	// Model control
	setModel(model: Model, role?: ModelRole): Promise<void>;
	setModelTemporary(model: Model): Promise<void>;
	setThinkingLevel(level: ThinkingLevel): void;
	cycleModel(direction?: "forward" | "backward"): Promise<ModelCycleResult | undefined>;
	cycleRoleModels(
		direction?: "forward" | "backward",
	): Promise<{ model: Model; thinkingLevel: ThinkingLevel; role: ModelRole } | undefined>;
	cycleThinkingLevel(): ThinkingLevel | undefined;

	// State access
	agent: Agent;
	sessionManager: SessionManager;
	settings: Settings;
	model: Model | undefined;
	thinkingLevel: ThinkingLevel;
	messages: AgentMessage[];
	isStreaming: boolean;
	isCompacting: boolean;
	isRetrying: boolean;

	// Session management
	newSession(options?: NewSessionOptions): Promise<boolean>; // Returns false if cancelled by extension
	fork(): Promise<boolean>; // Creates a new session file

	// Branching
	branch(entryId: string): Promise<{ selectedText: string; cancelled: boolean }>;
	navigateTree(
		targetId: string,
		options?: { summarize?: boolean; customInstructions?: string }
	): Promise<{ editorText?: string; cancelled: boolean; aborted?: boolean; summaryEntry?: BranchSummaryEntry }>;

	// Custom message injection
	sendCustomMessage<T>(
		message: { customType: string; content: T; display?: boolean; details?: unknown },
		options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" }
	): Promise<void>;

	// Compaction
	compact(
		customInstructions?: string,
		options?: { onComplete?: (result: CompactionResult) => void; onError?: (error: Error) => void },
	): Promise<CompactionResult>;
	abortCompaction(): void;

	// Utilities
	getSessionStats(): SessionStats;
	formatSessionAsText(): string;
	formatCompactContext(): string;
	exportToHtml(outputPath?: string): Promise<string>;
	handoff(customInstructions?: string): Promise<{ document: string } | undefined>;

	// Abort current operation
	abort(): Promise<void>;

	// Cleanup
	dispose(): Promise<void>;
}
```

### Agent and AgentState

The `Agent` class (from `@oh-my-pi/pi-agent-core`) handles the core LLM interaction. Access it via `session.agent`.

```typescript
// Access current state
const state = session.agent.state;

// state.messages: AgentMessage[] - conversation history
// state.model: Model - current model
// state.thinkingLevel: ThinkingLevel - current thinking level
// state.systemPrompt: string - system prompt
// state.tools: Tool[] - available tools

// Replace messages (useful for branching, restoration)
session.agent.replaceMessages(messages);

// Wait for agent to finish processing
await session.agent.waitForIdle();
```

### Events

Subscribe to events to receive streaming output and lifecycle notifications.

```typescript
session.subscribe((event) => {
	switch (event.type) {
		// Streaming text from assistant
		case "message_update":
			if (event.assistantMessageEvent.type === "text_delta") {
				process.stdout.write(event.assistantMessageEvent.delta);
			}
			if (event.assistantMessageEvent.type === "thinking_delta") {
				// Thinking output (if thinking enabled)
			}
			break;

		// Tool execution
		case "tool_execution_start":
			console.log(`Tool: ${event.toolName}`);
			break;
		case "tool_execution_update":
			// Streaming tool output
			break;
		case "tool_execution_end":
			console.log(`Result: ${event.isError ? "error" : "success"}`);
			break;

		// Message lifecycle
		case "message_start":
			// New message starting
			break;
		case "message_end":
			// Message complete
			break;

		// Agent lifecycle
		case "agent_start":
			// Agent started processing prompt
			break;
		case "agent_end":
			// Agent finished (event.messages contains new messages)
			break;

		// Turn lifecycle (one LLM response + tool calls)
		case "turn_start":
			break;
		case "turn_end":
			// event.message: assistant response
			// event.toolResults: tool results from this turn
			break;

		// Session events (auto-compaction, retry, TTSR, todo reminders)
		case "auto_compaction_start":
		case "auto_compaction_end":
		case "auto_retry_start":
		case "auto_retry_end":
		case "ttsr_triggered":
			// event.rules
			break;
		case "todo_reminder":
			// event.todos
			break;
	}
});
```

## Options Reference

### Directories

```typescript
const { session } = await createAgentSession({
	// Working directory for project-local discovery
	cwd: process.cwd(), // default

	// Global config directory
	agentDir: "~/.omp/agent", // default (expands ~)
});
```

`cwd` is used for:

- Project config discovery (`.omp/`, `.pi/`, `.claude/`, `.codex/`, `.gemini/`)
- Project extensions/tools/skills/commands (via config dirs)
- Context files (`AGENTS.md` walking up from cwd)
- Session directory naming (via `SessionManager.create(cwd)`)

`agentDir` is used for:

- Global settings (`config.yml` + `agent.db`)
- Primary auth/models locations (`auth.json`, `models.yml`, `models.json`)
- Prompt templates (`prompts/`)
- Custom TS commands (`commands/`)

### Model

```typescript
import { getModel } from "@oh-my-pi/pi-ai";
import { discoverAuthStorage, discoverModels } from "@oh-my-pi/pi-coding-agent";

const authStorage = await discoverAuthStorage();
const modelRegistry = discoverModels(authStorage);

// Find specific built-in model (doesn't check if API key exists)
const opus = getModel("anthropic", "claude-opus-4-5");
if (!opus) throw new Error("Model not found");

// Find any model by provider/id, including custom models from models.yml
// (doesn't check if API key exists)
const customModel = modelRegistry.find("my-provider", "my-model");

// Get all models that have valid API keys configured
const available = modelRegistry.getAvailable();

const { session } = await createAgentSession({
	model: opus,
	thinkingLevel: "medium", // off, minimal, low, medium, high, xhigh

	// Models for cycling (Ctrl+P in interactive mode)
	scopedModels: [
		{ model: opus, thinkingLevel: "high" },
		{ model: haiku, thinkingLevel: "off" },
	],

	authStorage,
	modelRegistry,
});
```

If no model is provided:

1. Tries to restore from session (if continuing)
2. Uses default from settings
3. Falls back to first available model

> See [examples/sdk/02-custom-model.ts](../examples/sdk/02-custom-model.ts)

### API Keys and OAuth

API key resolution priority (handled by AuthStorage):

1. Runtime overrides (via `setRuntimeApiKey`, not persisted)
2. Stored credentials in `agent.db` (API keys or OAuth tokens)
3. Environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.)
4. Fallback resolver (for custom provider keys from `models.yml`)

`discoverAuthStorage` also migrates legacy `auth.json` from user config directories (`.pi`, `.claude`, `.codex`, `.gemini`) into `agent.db`.

```typescript
import { AuthStorage, ModelRegistry, discoverAuthStorage, discoverModels } from "@oh-my-pi/pi-coding-agent";

// Default: uses agentDir/auth.json → agent.db and agentDir/models.yml (with legacy fallbacks)
const authStorage = await discoverAuthStorage();
const modelRegistry = discoverModels(authStorage);

const { session } = await createAgentSession({
	sessionManager: SessionManager.inMemory(),
	authStorage,
	modelRegistry,
});

// Runtime API key override (not persisted to disk)
authStorage.setRuntimeApiKey("anthropic", "sk-my-temp-key");

// Custom auth storage location (use create(), constructor is private)
const customAuth = await AuthStorage.create("/my/app/auth.json");
const customRegistry = new ModelRegistry(customAuth, "/my/app/models.yml");

const { session } = await createAgentSession({
	sessionManager: SessionManager.inMemory(),
	authStorage: customAuth,
	modelRegistry: customRegistry,
});

// No custom models.yml (built-in models only)
const simpleRegistry = new ModelRegistry(authStorage);
```

> See [examples/sdk/09-api-keys-and-oauth.ts](../examples/sdk/09-api-keys-and-oauth.ts)

### System Prompt

```typescript
import systemPrompt from "./SYSTEM.md" with { type: "text" };

const { session } = await createAgentSession({
	// Replace entirely with a static prompt
	systemPrompt,
});

const { session: modified } = await createAgentSession({
	// Or modify default (receives default, returns modified)
	systemPrompt: (defaultPrompt) => {
		return `${defaultPrompt}\n\n## Additional Rules\n- Be concise`;
	},
});
```

> See [examples/sdk/03-custom-prompt.ts](../examples/sdk/03-custom-prompt.ts)

### Tools

By default, `createAgentSession` creates all built-in tools automatically. You can filter which tools are available using `toolNames`:

```typescript
// Use all built-in tools (default)
const { session } = await createAgentSession();

// Filter to specific tools
const { session } = await createAgentSession({
	toolNames: ["read", "grep", "find"], // Read-only tools
});

`toolNames` is an allowlist for built-ins; custom tools are always included even if not listed.
```

#### Available Built-in Tools

All tools are defined in `BUILTIN_TOOLS`:

- `ask` - Interactive user prompts (requires UI)
- `bash` - Shell command execution
- `python` - Python REPL execution
- `calc` - Calculator
- `ssh` - Remote SSH execution
- `edit` - Surgical file editing
- `find` - File search by glob patterns
- `grep` - Content search with regex
- `lsp` - Language server protocol integration
- `notebook` - Jupyter notebook editing
- `read` - File reading (text and images)
- `browser` - Puppeteer-based web browser
- `task` - Subagent spawning
- `todo_write` - Todo file management
- `fetch` - URL fetching
- `web_search` - Web search
- `write` - File writing

Hidden tools (not in `BUILTIN_TOOLS`) are available but excluded unless requested:

- `submit_result` - Required for subagent structured output (use `requireSubmitResultTool` or include in `toolNames`)
- `report_finding` - Security review reporting
- `exit_plan_mode` - Plan mode control

#### Creating Tools Manually

For advanced use cases, you can create tools directly using `createTools`:

```typescript
import { createTools, Settings, type ToolSession } from "@oh-my-pi/pi-coding-agent";

const settingsInstance = await Settings.init({ cwd: "/path/to/project" });

const session: ToolSession = {
	cwd: "/path/to/project",
	hasUI: false,
	getSessionFile: () => null,
	getSessionSpawns: () => "*",
	settings: settingsInstance,
};

const tools = await createTools(session);
```

**When you don't need factories:**

- If you omit `toolNames`, omp automatically creates them with the correct `cwd`
- If you use `process.cwd()` as your `cwd`, the pre-built instances work fine

**When you must use factories:**

- When you specify both `cwd` (different from `process.cwd()`) AND custom tools

### Custom Tools

```typescript
import { Type } from "@sinclair/typebox";
import { createAgentSession, type CustomTool } from "@oh-my-pi/pi-coding-agent";

// Inline custom tool
const myTool: CustomTool = {
	name: "my_tool",
	label: "My Tool",
	description: "Does something useful",
	parameters: Type.Object({
		input: Type.String({ description: "Input value" }),
	}),
	execute: async (toolCallId, params, onUpdate, ctx, signal) => ({
		content: [{ type: "text", text: `Result: ${params.input}` }],
	}),
	// Optional session lifecycle handler
	onSession: async (event, ctx) => {
		if (event.reason === "shutdown") {
			// cleanup
		}
	},
};

// Add custom tools (merged with built-in tools)
const { session } = await createAgentSession({
	customTools: [myTool],
});
```

### Extensions

Extensions intercept agent events and can register custom tools/commands. Hooks remain for legacy compatibility.

```typescript
import {
	createAgentSession,
	discoverExtensions,
	type ExtensionFactory,
} from "@oh-my-pi/pi-coding-agent";

// Inline extension
const loggingExtension: ExtensionFactory = (api) => {
	// Log tool calls
	api.on("tool_call", async (event) => {
		console.log(`Tool: ${event.toolName}`);
		return undefined; // Don't block
	});

	// Block dangerous commands
	api.on("tool_call", async (event) => {
		if (event.toolName === "bash" && event.input.command?.includes("rm -rf")) {
			return { block: true, reason: "Dangerous command" };
		}
		return undefined;
	});

	// Register custom slash command
	api.registerCommand("stats", {
		description: "Show session stats",
		handler: async (args, ctx) => {
			const entries = ctx.sessionManager.getEntries();
			ctx.ui.notify(`${entries.length} entries`, "info");
		},
	});
};

// Merge with discovery (default behavior)
const { session } = await createAgentSession({
	extensions: [loggingExtension],
});

// Replace discovery
const { session } = await createAgentSession({
	extensions: [loggingExtension],
	disableExtensionDiscovery: true,
});

// Disable all extensions
const { session } = await createAgentSession({
	extensions: [],
	disableExtensionDiscovery: true,
});

// Use preloaded extensions (skip discovery I/O)
const discovered = await discoverExtensions();
const { session } = await createAgentSession({
	preloadedExtensions: discovered,
	extensions: [loggingExtension],
});

// Add paths without replacing discovery
const { session } = await createAgentSession({
	additionalExtensionPaths: ["/extra/extensions"],
});
```

Extension API methods:

- `api.on(event, handler)` - Subscribe to events
- `api.registerTool(definition)` - Register a custom tool
- `api.registerCommand(name, options)` - Register custom slash command
- `api.registerMessageRenderer(customType, renderer)` - Custom TUI rendering
- `api.exec(command, args, options?)` - Execute shell commands

> See [examples/sdk/06-extensions.ts](../examples/sdk/06-extensions.ts) and [docs/extensions.md](extensions.md)

### Skills

```typescript
import { createAgentSession, discoverSkills, type Skill } from "@oh-my-pi/pi-coding-agent";

// Discover and filter
const { skills: allSkills, warnings } = await discoverSkills();
const filtered = allSkills.filter((s) => s.name.includes("search"));

// Custom skill
const mySkill: Skill = {
	name: "my-skill",
	description: "Custom instructions",
	filePath: "/path/to/SKILL.md",
	baseDir: "/path/to",
	source: "custom",
};

const { session } = await createAgentSession({
	skills: [...filtered, mySkill],
});

// Disable skills
const { session } = await createAgentSession({
	skills: [],
});
```

> See [examples/sdk/04-skills.ts](../examples/sdk/04-skills.ts)

### Context Files

```typescript
import { createAgentSession, discoverContextFiles } from "@oh-my-pi/pi-coding-agent";

// Discover AGENTS.md files
const discovered = await discoverContextFiles();

// Add custom context
const { session } = await createAgentSession({
	contextFiles: [
		...discovered,
		{
			path: "/virtual/AGENTS.md",
			content: "# Guidelines\n\n- Be concise\n- Use TypeScript",
		},
	],
});

// Disable context files
const { session } = await createAgentSession({
	contextFiles: [],
});
```

> See [examples/sdk/07-context-files.ts](../examples/sdk/07-context-files.ts)

### Slash Commands

```typescript
import { createAgentSession, discoverSlashCommands, type FileSlashCommand } from "@oh-my-pi/pi-coding-agent";

const discovered = await discoverSlashCommands();

const customCommand: FileSlashCommand = {
	name: "deploy",
	description: "Deploy the application",
	source: "(custom)",
	content: "# Deploy\n\n1. Build\n2. Test\n3. Deploy",
};

const { session } = await createAgentSession({
	slashCommands: [...discovered, customCommand],
});
```

> See [examples/sdk/08-slash-commands.ts](../examples/sdk/08-slash-commands.ts)

### Session Management

Sessions use a tree structure with `id`/`parentId` linking, enabling in-place branching.

```typescript
import { createAgentSession, SessionManager } from "@oh-my-pi/pi-coding-agent";

// In-memory (no persistence)
const { session } = await createAgentSession({
	sessionManager: SessionManager.inMemory(),
});

// New persistent session
const { session } = await createAgentSession({
	sessionManager: SessionManager.create(process.cwd()),
});

// Continue most recent (async)
const { session, modelFallbackMessage } = await createAgentSession({
	sessionManager: await SessionManager.continueRecent(process.cwd()),
});
if (modelFallbackMessage) {
	console.log("Note:", modelFallbackMessage);
}

// Open specific file (async)
const { session } = await createAgentSession({
	sessionManager: await SessionManager.open("/path/to/session.jsonl"),
});

// List available sessions (async)
const sessions = await SessionManager.list(process.cwd());
for (const info of sessions) {
	console.log(`${info.id}: ${info.firstMessage} (${info.messageCount} messages)`);
}

// Custom session directory (no cwd encoding)
const customDir = "/path/to/my-sessions";
const { session } = await createAgentSession({
	sessionManager: SessionManager.create(process.cwd(), customDir),
});
```

**SessionManager static factories:**

- `SessionManager.create(cwd, sessionDir?)` - New persistent session (sync)
- `SessionManager.inMemory(cwd?)` - In-memory session (sync)
- `SessionManager.open(filePath, sessionDir?)` - Open existing file (async)
- `SessionManager.continueRecent(cwd, sessionDir?)` - Most recent session (async)
- `SessionManager.list(cwd, sessionDir?)` - List sessions (async)
- `SessionManager.listAll()` - List all sessions across cwds (async)
- `SessionManager.forkFrom(sourcePath, cwd, sessionDir?)` - Fork from existing (async)

**SessionManager tree API:**

```typescript
const sm = await SessionManager.open("/path/to/session.jsonl");

// Tree traversal
const entries = sm.getEntries(); // All entries (excludes header)
const tree = sm.getTree(); // Full tree structure
const branch = sm.getBranch(); // Path from root to current leaf
const leaf = sm.getLeafEntry(); // Current leaf entry
const entry = sm.getEntry(id); // Get entry by ID
const children = sm.getChildren(id); // Direct children of entry

// Labels
const label = sm.getLabel(id); // Get label for entry
sm.appendLabelChange(id, "checkpoint"); // Set label

// Branching
sm.branch(entryId); // Move leaf to earlier entry
sm.branchWithSummary(id, "Summary..."); // Branch with context summary
sm.createBranchedSession(leafId); // Extract path to new file
```

> See [examples/sdk/11-sessions.ts](../examples/sdk/11-sessions.ts) and [docs/session.md](session.md)

### Settings Management

```typescript
import { createAgentSession, Settings, SessionManager } from "@oh-my-pi/pi-coding-agent";

// Default: loads from files (global config.yml + project settings.json merged)
const settingsInstance = await Settings.init();

const { session } = await createAgentSession({
	settingsInstance,
});

// Read/write settings
const enabled = settingsInstance.get("compaction.enabled");
settingsInstance.set("compaction.enabled", false);

// In-memory (no file I/O, for testing)
const isolated = Settings.isolated({
	"compaction.enabled": false,
	"retry.enabled": true,
});

const { session } = await createAgentSession({
	settingsInstance: isolated,
	sessionManager: SessionManager.inMemory(),
});

// Custom directories
const { session } = await createAgentSession({
	cwd: "/custom/cwd",
	agentDir: "/custom/agent",
});
```

**Settings static factories:**

- `Settings.init(options?)` - Load from files (async)
- `Settings.isolated(overrides?)` - In-memory, no file I/O (sync)
- `Settings.instance` - Global singleton (throws if not initialized)

**Settings file locations:**

Settings load from two locations and merge:

1. Global: `<agentDir>/config.yml` (default `~/.omp/agent/config.yml`)
2. Project: `settings.json` from the first matching config dir (`.omp/`, `.pi/`, `.claude/`, `.codex/`, `.gemini/`)

Project overrides global. Nested objects merge keys.

## Discovery Functions

Discovery functions accept optional `cwd` and `agentDir` parameters where applicable.

```typescript
import { getModel } from "@oh-my-pi/pi-ai";
import appendPrompt from "./APPEND_SYSTEM.md" with { type: "text" };
import {
	AuthStorage,
	ModelRegistry,
	discoverAuthStorage,
	discoverModels,
	discoverSkills,
	discoverExtensions,
	discoverContextFiles,
	discoverSlashCommands,
	discoverPromptTemplates,
	discoverCustomTSCommands,
	discoverMCPServers,
	buildSystemPrompt,
	Settings,
} from "@oh-my-pi/pi-coding-agent";

// Auth and Models
const authStorage = await discoverAuthStorage(); // <agentDir>/auth.json → agent.db (with fallbacks)
const modelRegistry = discoverModels(authStorage); // + <agentDir>/models.yml (or models.json)
const allModels = modelRegistry.getAll(); // All models (built-in + custom)
const available = modelRegistry.getAvailable(); // Only models with API keys
const model = modelRegistry.find("provider", "id"); // Find specific model
const builtIn = getModel("anthropic", "claude-opus-4-5"); // Built-in only

// Skills (async)
const { skills, warnings } = await discoverSkills(cwd, agentDir, skillsSettings);

// Extensions (async - loads TypeScript)
const extensionsResult = await discoverExtensions(cwd);

// Custom TS commands (async - loads TypeScript)
const customCommands = await discoverCustomTSCommands(cwd, agentDir);

// Context files (async)
const contextFiles = await discoverContextFiles(cwd, agentDir);

// Slash commands (async)
const commands = await discoverSlashCommands(cwd);

// Prompt templates (async)
const promptTemplates = await discoverPromptTemplates(cwd, agentDir);

// MCP servers (async)
const mcp = await discoverMCPServers(cwd);

// Settings (async - global + project merged)
const settings = await Settings.init({ cwd, agentDir });

// Build system prompt manually
const prompt = await buildSystemPrompt({
	skills,
	contextFiles,
	appendPrompt,
	cwd,
});
```

## Return Value

`createAgentSession()` returns:

```typescript
interface CreateAgentSessionResult {
	// The session
	session: AgentSession;

	// Extensions result (loaded extensions + runtime)
	extensionsResult: LoadExtensionsResult;

	// Update tool UI context (interactive mode)
	setToolUIContext: (uiContext: ExtensionUIContext, hasUI: boolean) => void;

	// MCP manager for server lifecycle management (undefined if MCP disabled)
	mcpManager?: MCPManager;

	// Warning if session model couldn't be restored
	modelFallbackMessage?: string;

	// LSP servers that were warmed up at startup
	lspServers?: Array<{ name: string; status: "ready" | "error"; fileTypes: string[]; error?: string }>;
}
```

## Complete Example

```typescript
import { getModel } from "@oh-my-pi/pi-ai";
import { Type } from "@sinclair/typebox";
import {
	createAgentSession,
	discoverAuthStorage,
	discoverModels,
	SessionManager,
	Settings,
	type ExtensionFactory,
	type CustomTool,
} from "@oh-my-pi/pi-coding-agent";
import systemPrompt from "./SYSTEM.md" with { type: "text" };

// Set up auth storage
const authStorage = await discoverAuthStorage();

// Runtime API key override (not persisted)
if (process.env.MY_KEY) {
	authStorage.setRuntimeApiKey("anthropic", process.env.MY_KEY);
}

// Model registry
const modelRegistry = discoverModels(authStorage);

// Inline extension
const auditExtension: ExtensionFactory = (api) => {
	api.on("tool_call", async (event) => {
		console.log(`[Audit] ${event.toolName}`);
		return undefined;
	});
};

// Inline tool
const statusTool: CustomTool = {
	name: "status",
	label: "Status",
	description: "Get system status",
	parameters: Type.Object({}),
	execute: async (toolCallId, params, onUpdate, ctx, signal) => ({
		content: [{ type: "text", text: `Uptime: ${process.uptime()}s` }],
	}),
};

const model = getModel("anthropic", "claude-opus-4-5");
if (!model) throw new Error("Model not found");

// In-memory settings with overrides
const settingsInstance = Settings.isolated({
	"compaction.enabled": false,
	"retry.enabled": true,
});

const { session } = await createAgentSession({
	cwd: process.cwd(),
	agentDir: "/custom/agent",

	model,
	thinkingLevel: "off",
	authStorage,
	modelRegistry,

	systemPrompt,

	toolNames: ["read", "bash"],
	customTools: [statusTool],
	extensions: [auditExtension],
	skills: [],
	contextFiles: [],
	slashCommands: [],

	sessionManager: SessionManager.inMemory(),
	settingsInstance,
});

session.subscribe((event) => {
	if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
		process.stdout.write(event.assistantMessageEvent.delta);
	}
});

await session.prompt("Get status and list files.");
```

## RPC Mode Alternative

For subprocess-based integration, use RPC mode instead of the SDK:

```bash
omp --mode rpc --no-session
```

See [RPC documentation](rpc.md) for the JSON protocol.

The SDK is preferred when:

- You want type safety
- You're in the same Node.js process
- You need direct access to agent state
- You want to customize tools/extensions programmatically

RPC mode is preferred when:

- You're integrating from another language
- You want process isolation
- You're building a language-agnostic client

## Exports

The main entry point exports:

```typescript
// Factory
createAgentSession

// Auth and Models
AuthStorage
ModelRegistry
discoverAuthStorage
discoverModels

// Discovery
discoverSkills
discoverExtensions
discoverCustomTSCommands
discoverContextFiles
discoverSlashCommands
discoverPromptTemplates
discoverMCPServers

// Helpers
buildSystemPrompt
Settings

// Session management
SessionManager

// Tool registry and factory
BUILTIN_TOOLS              // Map of tool name to factory
createTools                // Create all tools from ToolSession
type ToolSession           // Session context for tool creation

// Individual tool classes
ReadTool, BashTool, EditTool, WriteTool
GrepTool, FindTool, PythonTool
loadSshTool

// Types
type CreateAgentSessionOptions
type CreateAgentSessionResult
type CustomTool
type ExtensionFactory
type Skill
type FileSlashCommand
type SkillsSettings
type Tool
```

For extension types, import from the main package:

```typescript
import type {
	ExtensionAPI,
	ExtensionFactory,
	ExtensionContext,
	ExtensionCommandContext,
	ToolDefinition,
} from "@oh-my-pi/pi-coding-agent";
```

For legacy hook types (deprecated, use extensions instead):

```typescript
import type { HookAPI, HookFactory, HookContext, HookCommandContext } from "@oh-my-pi/pi-coding-agent/hooks";
```

For config utilities:

```typescript
import { getAgentDir } from "@oh-my-pi/pi-coding-agent";
```
