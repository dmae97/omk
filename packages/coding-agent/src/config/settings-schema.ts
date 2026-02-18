/**
 * Unified settings schema - single source of truth for all settings.
 *
 * Each setting is defined once here with:
 * - Type and default value
 * - Optional UI metadata (label, description, tab)
 *
 * The Settings singleton provides type-safe path-based access:
 *   settings.get("compaction.enabled")  // => boolean
 *   settings.set("theme.dark", "titanium")  // sync, saves in background
 */

// ═══════════════════════════════════════════════════════════════════════════
// Schema Definition Types
// ═══════════════════════════════════════════════════════════════════════════

export type SettingTab =
	| "display"
	| "agent"
	| "input"
	| "tools"
	| "config"
	| "services"
	| "bash"
	| "lsp"
	| "ttsr"
	| "status";

/** Tab display metadata - icon is resolved via theme.symbol() */
export type TabMetadata = { label: string; icon: `tab.${string}` };

/** Ordered list of tabs for UI rendering (status excluded - custom menu) */
export const SETTING_TABS: SettingTab[] = [
	"display",
	"agent",
	"input",
	"tools",
	"config",
	"services",
	"bash",
	"lsp",
	"ttsr",
];

/** Tab display metadata - icon is a symbol key from theme.ts (tab.*) */
export const TAB_METADATA: Record<SettingTab, { label: string; icon: `tab.${string}` }> = {
	display: { label: "Display", icon: "tab.display" },
	agent: { label: "Agent", icon: "tab.agent" },
	input: { label: "Input", icon: "tab.input" },
	tools: { label: "Tools", icon: "tab.tools" },
	config: { label: "Config", icon: "tab.config" },
	services: { label: "Services", icon: "tab.services" },
	bash: { label: "Bash", icon: "tab.bash" },
	lsp: { label: "LSP", icon: "tab.lsp" },
	ttsr: { label: "TTSR", icon: "tab.ttsr" },
	status: { label: "Status", icon: "tab.status" },
};

/** Status line segment identifiers */
export type StatusLineSegmentId =
	| "pi"
	| "model"
	| "plan_mode"
	| "path"
	| "git"
	| "subagents"
	| "token_in"
	| "token_out"
	| "token_total"
	| "cost"
	| "context_pct"
	| "context_total"
	| "time_spent"
	| "time"
	| "session"
	| "hostname"
	| "cache_read"
	| "cache_write";

interface UiMetadata {
	tab: SettingTab;
	label: string;
	description: string;
	/** For enum/submenu - display as inline toggle vs dropdown */
	submenu?: boolean;
	/** Condition function name - setting only shown when true */
	condition?: string;
}

interface BooleanDef {
	type: "boolean";
	default: boolean;
	ui?: UiMetadata;
}

interface StringDef {
	type: "string";
	default: string | undefined;
	ui?: UiMetadata;
}

interface NumberDef {
	type: "number";
	default: number;
	ui?: UiMetadata;
}

interface EnumDef<T extends readonly string[]> {
	type: "enum";
	values: T;
	default: T[number];
	ui?: UiMetadata;
}

interface ArrayDef<T> {
	type: "array";
	default: T[];
	ui?: UiMetadata;
}

interface RecordDef<T> {
	type: "record";
	default: Record<string, T>;
	ui?: UiMetadata;
}

type SettingDef =
	| BooleanDef
	| StringDef
	| NumberDef
	| EnumDef<readonly string[]>
	| ArrayDef<unknown>
	| RecordDef<unknown>;

// ═══════════════════════════════════════════════════════════════════════════
// Schema Definition
// ═══════════════════════════════════════════════════════════════════════════

export const SETTINGS_SCHEMA = {
	// ─────────────────────────────────────────────────────────────────────────
	// Top-level settings
	// ─────────────────────────────────────────────────────────────────────────
	lastChangelogVersion: { type: "string", default: undefined },
	"theme.dark": {
		type: "string",
		default: "titanium",
		ui: {
			tab: "display",
			label: "Dark theme",
			description: "Theme used when terminal has dark background",
			submenu: true,
		},
	},
	"theme.light": {
		type: "string",
		default: "light",
		ui: {
			tab: "display",
			label: "Light theme",
			description: "Theme used when terminal has light background",
			submenu: true,
		},
	},
	symbolPreset: {
		type: "enum",
		values: ["unicode", "nerd", "ascii"] as const,
		default: "unicode",
		ui: { tab: "display", label: "Symbol preset", description: "Icon/symbol style", submenu: true },
	},
	colorBlindMode: {
		type: "boolean",
		default: false,
		ui: {
			tab: "display",
			label: "Color blind mode",
			description: "Use blue instead of green for diff additions",
		},
	},
	defaultThinkingLevel: {
		type: "enum",
		values: ["off", "minimal", "low", "medium", "high", "xhigh"] as const,
		default: "off",
		ui: {
			tab: "agent",
			label: "Thinking level",
			description: "Reasoning depth for thinking-capable models",
			submenu: true,
		},
	},
	temperature: {
		type: "number",
		default: -1,
		ui: {
			tab: "agent",
			label: "Temperature",
			description: "Sampling temperature (0 = deterministic, 1 = creative, -1 = provider default)",
			submenu: true,
		},
	},
	hideThinkingBlock: {
		type: "boolean",
		default: false,
		ui: { tab: "agent", label: "Hide thinking", description: "Hide thinking blocks in assistant responses" },
	},
	steeringMode: {
		type: "enum",
		values: ["all", "one-at-a-time"] as const,
		default: "one-at-a-time",
		ui: {
			tab: "agent",
			label: "Steering mode",
			description: "How to process queued messages while agent is working",
		},
	},
	followUpMode: {
		type: "enum",
		values: ["all", "one-at-a-time"] as const,
		default: "one-at-a-time",
		ui: {
			tab: "agent",
			label: "Follow-up mode",
			description: "How to drain follow-up messages after a turn completes",
		},
	},
	interruptMode: {
		type: "enum",
		values: ["immediate", "wait"] as const,
		default: "immediate",
		ui: { tab: "agent", label: "Interrupt mode", description: "When steering messages interrupt tool execution" },
	},
	doubleEscapeAction: {
		type: "enum",
		values: ["branch", "tree", "none"] as const,
		default: "tree",
		ui: {
			tab: "input",
			label: "Double-escape action",
			description: "Action when pressing Escape twice with empty editor",
		},
	},
	shellPath: { type: "string", default: undefined },
	collapseChangelog: {
		type: "boolean",
		default: false,
		ui: { tab: "input", label: "Collapse changelog", description: "Show condensed changelog after updates" },
	},
	autocompleteMaxVisible: {
		type: "number",
		default: 5,
		ui: {
			tab: "input",
			label: "Autocomplete max items",
			description: "Max visible items in autocomplete dropdown (3-20)",
			submenu: true,
		},
	},
	normativeRewrite: {
		type: "boolean",
		default: false,
		ui: {
			tab: "agent",
			label: "Normative rewrite",
			description: "Rewrite tool call arguments to normalized format in session history",
		},
	},
	repeatToolDescriptions: {
		type: "boolean",
		default: false,
		ui: {
			tab: "agent",
			label: "Repeat tool descriptions",
			description: "Render full tool descriptions in the system prompt instead of a tool name list",
		},
	},
	readLineNumbers: {
		type: "boolean",
		default: false,
		ui: {
			tab: "config",
			label: "Read line numbers",
			description: "Prepend line numbers to read tool output by default",
		},
	},
	readHashLines: {
		type: "boolean",
		default: true,
		ui: {
			tab: "config",
			label: "Read hash lines",
			description: "Include line hashes in read output for hashline edit mode (LINE:HASH|content)",
		},
	},
	showHardwareCursor: {
		type: "boolean",
		default: true, // will be computed based on platform if undefined
		ui: { tab: "display", label: "Hardware cursor", description: "Show terminal cursor for IME support" },
	},
	clearOnShrink: {
		type: "boolean",
		default: false,
		ui: {
			tab: "display",
			label: "Clear on shrink",
			description: "Clear empty rows when content shrinks (may cause flicker)",
		},
	},
	extensions: { type: "array", default: [] as string[] },
	enabledModels: { type: "array", default: [] as string[] },
	disabledProviders: { type: "array", default: [] as string[] },
	disabledExtensions: { type: "array", default: [] as string[] },
	modelRoles: { type: "record", default: {} as Record<string, string> },
	"contextPromotion.enabled": {
		type: "boolean",
		default: true,
		ui: {
			tab: "agent",
			label: "Auto-promote context",
			description: "Promote to a larger-context model on context overflow instead of compacting",
		},
	},

	// ─────────────────────────────────────────────────────────────────────────
	// Secrets settings
	// ─────────────────────────────────────────────────────────────────────────
	"secrets.enabled": {
		type: "boolean",
		default: false,
		ui: { tab: "config", label: "Hide secrets", description: "Obfuscate secrets before sending to AI providers" },
	},

	// ─────────────────────────────────────────────────────────────────────────
	// Compaction settings
	// ─────────────────────────────────────────────────────────────────────────
	"compaction.enabled": {
		type: "boolean",
		default: true,
		ui: {
			tab: "agent",
			label: "Auto-compact",
			description: "Automatically compact context when it gets too large",
		},
	},
	"compaction.reserveTokens": { type: "number", default: 16384 },
	"compaction.keepRecentTokens": { type: "number", default: 20000 },
	"compaction.autoContinue": { type: "boolean", default: true },
	"compaction.remoteEndpoint": { type: "string", default: undefined },

	// ─────────────────────────────────────────────────────────────────────────
	// Branch summary settings
	// ─────────────────────────────────────────────────────────────────────────
	"branchSummary.enabled": {
		type: "boolean",
		default: false,
		ui: { tab: "agent", label: "Branch summaries", description: "Prompt to summarize when leaving a branch" },
	},
	"branchSummary.reserveTokens": { type: "number", default: 16384 },

	// ─────────────────────────────────────────────────────────────────────────
	// Memories settings
	// ─────────────────────────────────────────────────────────────────────────
	"memories.enabled": {
		type: "boolean",
		default: false,
		ui: {
			tab: "agent",
			label: "Memories",
			description: "Enable autonomous memory extraction and consolidation",
		},
	},
	"memories.maxRolloutsPerStartup": { type: "number", default: 64 },
	"memories.maxRolloutAgeDays": { type: "number", default: 30 },
	"memories.minRolloutIdleHours": { type: "number", default: 12 },
	"memories.threadScanLimit": { type: "number", default: 300 },
	"memories.maxRawMemoriesForGlobal": { type: "number", default: 200 },
	"memories.stage1Concurrency": { type: "number", default: 8 },
	"memories.stage1LeaseSeconds": { type: "number", default: 120 },
	"memories.stage1RetryDelaySeconds": { type: "number", default: 120 },
	"memories.phase2LeaseSeconds": { type: "number", default: 180 },
	"memories.phase2RetryDelaySeconds": { type: "number", default: 180 },
	"memories.phase2HeartbeatSeconds": { type: "number", default: 30 },
	"memories.rolloutPayloadPercent": { type: "number", default: 0.7 },
	"memories.fallbackTokenLimit": { type: "number", default: 16000 },
	"memories.summaryInjectionTokenLimit": { type: "number", default: 5000 },

	// ─────────────────────────────────────────────────────────────────────────
	// Retry settings
	// ─────────────────────────────────────────────────────────────────────────
	"retry.enabled": { type: "boolean", default: true },
	"retry.maxRetries": {
		type: "number",
		default: 3,
		ui: {
			tab: "agent",
			label: "Retry max attempts",
			description: "Maximum retry attempts on API errors",
			submenu: true,
		},
	},
	"retry.baseDelayMs": { type: "number", default: 2000 },

	// ─────────────────────────────────────────────────────────────────────────
	// Todo completion settings
	// ─────────────────────────────────────────────────────────────────────────
	"todo.reminders": {
		type: "boolean",
		default: false,
		ui: { tab: "agent", label: "Todo reminders", description: "Remind agent to complete todos before stopping" },
	},
	"todo.reminders.max": {
		type: "number",
		default: 3,
		ui: {
			tab: "agent",
			label: "Todo max reminders",
			description: "Maximum reminders to complete todos before giving up",
			submenu: true,
		},
	},

	// ─────────────────────────────────────────────────────────────────────────
	// Optional tools
	// ─────────────────────────────────────────────────────────────────────────
	"todo.enabled": {
		type: "boolean",
		default: true,
		ui: { tab: "tools", label: "Enable Todos", description: "Enable the todo_write tool for task tracking" },
	},
	"find.enabled": {
		type: "boolean",
		default: true,
		ui: { tab: "tools", label: "Enable Find", description: "Enable the find tool for file searching" },
	},
	"grep.enabled": {
		type: "boolean",
		default: true,
		ui: { tab: "tools", label: "Enable Grep", description: "Enable the grep tool for content searching" },
	},
	"grep.contextBefore": {
		type: "number",
		default: 0,
		ui: {
			tab: "tools",
			label: "Grep context before",
			description: "Lines of context before each grep match",
			submenu: true,
		},
	},
	"grep.contextAfter": {
		type: "number",
		default: 0,
		ui: {
			tab: "tools",
			label: "Grep context after",
			description: "Lines of context after each grep match",
			submenu: true,
		},
	},
	"notebook.enabled": {
		type: "boolean",
		default: true,
		ui: { tab: "tools", label: "Enable Notebook", description: "Enable the notebook tool for notebook editing" },
	},
	"fetch.enabled": {
		type: "boolean",
		default: true,
		ui: { tab: "tools", label: "Enable Fetch", description: "Enable the fetch tool for URL fetching" },
	},
	"web_search.enabled": {
		type: "boolean",
		default: true,
		ui: { tab: "tools", label: "Enable Web Search", description: "Enable the web_search tool for web searching" },
	},
	"lsp.enabled": {
		type: "boolean",
		default: true,
		ui: { tab: "tools", label: "Enable LSP", description: "Enable the lsp tool for language server protocol" },
	},
	"calc.enabled": {
		type: "boolean",
		default: false,
		ui: {
			tab: "tools",
			label: "Enable Calculator",
			description: "Enable the calculator tool for basic calculations",
		},
	},
	"browser.enabled": {
		type: "boolean",
		default: true,
		ui: {
			tab: "tools",
			label: "Enable Browser",
			description: "Enable the browser tool (Ulixee Hero)",
		},
	},
	"browser.headless": {
		type: "boolean",
		default: true,
		ui: {
			tab: "tools",
			label: "Browser headless",
			description: "Launch browser in headless mode (disable to show browser UI)",
		},
	},

	// ─────────────────────────────────────────────────────────────────────────
	// Task tool settings
	// ─────────────────────────────────────────────────────────────────────────
	"task.isolation.enabled": {
		type: "boolean",
		default: false,
		ui: {
			tab: "tools",
			label: "Task isolation",
			description: "Run subagents in isolated git worktrees",
			submenu: true,
		},
	},
	"task.maxConcurrency": {
		type: "number",
		default: 32,
		ui: {
			tab: "tools",
			label: "Task max concurrency",
			description: "Concurrent limit for subagents",
			submenu: true,
		},
	},
	"task.maxRecursionDepth": {
		type: "number",
		default: 2,
		ui: {
			tab: "tools",
			label: "Task max recursion depth",
			description: "How many levels deep subagents can spawn their own subagents",
			submenu: true,
		},
	},

	// ─────────────────────────────────────────────────────────────────────────
	// Startup settings
	// ─────────────────────────────────────────────────────────────────────────
	"startup.quiet": {
		type: "boolean",
		default: false,
		ui: { tab: "input", label: "Startup quiet", description: "Skip welcome screen and startup status messages" },
	},

	// ─────────────────────────────────────────────────────────────────────────
	// Notification settings
	// ─────────────────────────────────────────────────────────────────────────
	"completion.notify": {
		type: "enum",
		values: ["on", "off"] as const,
		default: "on",
		ui: { tab: "input", label: "Completion notification", description: "Notify when the agent completes" },
	},

	// ─────────────────────────────────────────────────────────────────────────
	// Ask settings
	// ─────────────────────────────────────────────────────────────────────────
	"ask.timeout": {
		type: "number",
		default: 30,
		ui: {
			tab: "input",
			label: "Ask tool timeout",
			description: "Auto-select recommended option after timeout (0 to disable)",
			submenu: true,
		},
	},
	"ask.notify": {
		type: "enum",
		values: ["on", "off"] as const,
		default: "on",
		ui: { tab: "input", label: "Ask notification", description: "Notify when ask tool is waiting for input" },
	},

	// ─────────────────────────────────────────────────────────────────────────
	// Terminal settings
	// ─────────────────────────────────────────────────────────────────────────
	"terminal.showImages": {
		type: "boolean",
		default: true,
		ui: {
			tab: "display",
			label: "Show images",
			description: "Render images inline in terminal",
			condition: "hasImageProtocol",
		},
	},

	// ─────────────────────────────────────────────────────────────────────────
	// Image settings
	// ─────────────────────────────────────────────────────────────────────────
	"images.autoResize": {
		type: "boolean",
		default: true,
		ui: {
			tab: "display",
			label: "Auto-resize images",
			description: "Resize large images to 2000x2000 max for better model compatibility",
		},
	},
	"images.blockImages": {
		type: "boolean",
		default: false,
		ui: { tab: "display", label: "Block images", description: "Prevent images from being sent to LLM providers" },
	},

	// ─────────────────────────────────────────────────────────────────────────
	// Skills settings
	// ─────────────────────────────────────────────────────────────────────────
	"skills.enabled": { type: "boolean", default: true },
	"skills.enableSkillCommands": {
		type: "boolean",
		default: true,
		ui: { tab: "tools", label: "Skill commands", description: "Register skills as /skill:name commands" },
	},
	"skills.enableCodexUser": { type: "boolean", default: true },
	"skills.enableClaudeUser": { type: "boolean", default: true },
	"skills.enableClaudeProject": { type: "boolean", default: true },
	"skills.enablePiUser": { type: "boolean", default: true },
	"skills.enablePiProject": { type: "boolean", default: true },
	"skills.customDirectories": { type: "array", default: [] as string[] },
	"skills.ignoredSkills": { type: "array", default: [] as string[] },
	"skills.includeSkills": { type: "array", default: [] as string[] },

	// ─────────────────────────────────────────────────────────────────────────
	// Commands settings
	// ─────────────────────────────────────────────────────────────────────────
	"commands.enableClaudeUser": {
		type: "boolean",
		default: true,
		ui: { tab: "tools", label: "Claude user commands", description: "Load commands from ~/.claude/commands/" },
	},
	"commands.enableClaudeProject": {
		type: "boolean",
		default: true,
		ui: { tab: "tools", label: "Claude project commands", description: "Load commands from .claude/commands/" },
	},

	// ─────────────────────────────────────────────────────────────────────────
	// Provider settings
	// ─────────────────────────────────────────────────────────────────────────
	"providers.webSearch": {
		type: "enum",
		values: ["auto", "exa", "brave", "jina", "zai", "perplexity", "anthropic"] as const,
		default: "auto",
		ui: { tab: "services", label: "Web search provider", description: "Provider for web search tool", submenu: true },
	},
	"providers.image": {
		type: "enum",
		values: ["auto", "gemini", "openrouter"] as const,
		default: "auto",
		ui: {
			tab: "services",
			label: "Image provider",
			description: "Provider for image generation tool",
			submenu: true,
		},
	},
	"providers.kimiApiFormat": {
		type: "enum",
		values: ["openai", "anthropic"] as const,
		default: "anthropic",
		ui: {
			tab: "services",
			label: "Kimi API format",
			description: "API format for Kimi Code provider",
			submenu: true,
		},
	},
	"providers.openaiWebsockets": {
		type: "enum",
		values: ["auto", "off", "on"] as const,
		default: "auto",
		ui: {
			tab: "services",
			label: "OpenAI websockets",
			description: "Websocket policy for OpenAI Codex models (auto uses model defaults, on forces, off disables)",
			submenu: true,
		},
	},

	// ─────────────────────────────────────────────────────────────────────────
	// Exa settings
	// ─────────────────────────────────────────────────────────────────────────
	"exa.enabled": {
		type: "boolean",
		default: true,
		ui: { tab: "services", label: "Exa enabled", description: "Master toggle for all Exa search tools" },
	},
	"exa.enableSearch": {
		type: "boolean",
		default: true,
		ui: { tab: "services", label: "Exa search", description: "Basic search, deep search, code search, crawl" },
	},
	"exa.enableLinkedin": {
		type: "boolean",
		default: false,
		ui: { tab: "services", label: "Exa LinkedIn", description: "Search LinkedIn for people and companies" },
	},
	"exa.enableCompany": {
		type: "boolean",
		default: false,
		ui: { tab: "services", label: "Exa company", description: "Comprehensive company research tool" },
	},
	"exa.enableResearcher": {
		type: "boolean",
		default: false,
		ui: { tab: "services", label: "Exa researcher", description: "AI-powered deep research tasks" },
	},
	"exa.enableWebsets": {
		type: "boolean",
		default: false,
		ui: { tab: "services", label: "Exa websets", description: "Webset management and enrichment tools" },
	},

	// ─────────────────────────────────────────────────────────────────────────
	// Bash interceptor settings
	// ─────────────────────────────────────────────────────────────────────────
	"bash.virtualTerminal": {
		type: "enum",
		values: ["on", "off"] as const,
		default: "off",
		ui: {
			tab: "bash",
			label: "Virtual terminal",
			description: "Use PTY-backed interactive execution for bash",
			submenu: true,
		},
	},
	"bashInterceptor.enabled": {
		type: "boolean",
		default: false,
		ui: { tab: "bash", label: "Interceptor", description: "Block shell commands that have dedicated tools" },
	},
	"bashInterceptor.simpleLs": {
		type: "boolean",
		default: true,
		ui: {
			tab: "bash",
			label: "Intercept ls",
			description: "Intercept bare ls commands (when interceptor is enabled)",
		},
	},
	// bashInterceptor.patterns is complex - handle separately

	// ─────────────────────────────────────────────────────────────────────────
	// MCP settings
	// ─────────────────────────────────────────────────────────────────────────
	"mcp.enableProjectConfig": {
		type: "boolean",
		default: true,
		ui: { tab: "tools", label: "MCP project config", description: "Load .mcp.json/mcp.json from project root" },
	},

	// ─────────────────────────────────────────────────────────────────────────
	// LSP settings
	// ─────────────────────────────────────────────────────────────────────────
	"lsp.formatOnWrite": {
		type: "boolean",
		default: false,
		ui: {
			tab: "lsp",
			label: "Format on write",
			description: "Automatically format code files using LSP after writing",
		},
	},
	"lsp.diagnosticsOnWrite": {
		type: "boolean",
		default: true,
		ui: { tab: "lsp", label: "Diagnostics on write", description: "Return LSP diagnostics after writing code files" },
	},
	"lsp.diagnosticsOnEdit": {
		type: "boolean",
		default: false,
		ui: { tab: "lsp", label: "Diagnostics on edit", description: "Return LSP diagnostics after editing code files" },
	},

	// ─────────────────────────────────────────────────────────────────────────
	// Python settings
	// ─────────────────────────────────────────────────────────────────────────
	"python.toolMode": {
		type: "enum",
		values: ["ipy-only", "bash-only", "both"] as const,
		default: "both",
		ui: { tab: "config", label: "Python tool mode", description: "How Python code is executed" },
	},
	"python.kernelMode": {
		type: "enum",
		values: ["session", "per-call"] as const,
		default: "session",
		ui: {
			tab: "config",
			label: "Python kernel mode",
			description: "Whether to keep IPython kernel alive across calls",
		},
	},
	"python.sharedGateway": {
		type: "boolean",
		default: true,
		ui: {
			tab: "config",
			label: "Python shared gateway",
			description: "Share IPython kernel gateway across pi instances",
		},
	},

	// ─────────────────────────────────────────────────────────────────────────
	// STT settings
	// ─────────────────────────────────────────────────────────────────────────
	"stt.enabled": {
		type: "boolean",
		default: false,
		ui: { tab: "input", label: "Speech-to-text", description: "Enable speech-to-text input via microphone" },
	},
	"stt.language": {
		type: "string",
		default: "en",
		ui: {
			tab: "input",
			label: "STT language",
			description: "Language code for transcription (e.g., en, es, fr)",
			submenu: true,
		},
	},
	"stt.modelName": {
		type: "enum",
		values: ["tiny", "tiny.en", "base", "base.en", "small", "small.en", "medium", "medium.en", "large"] as const,
		default: "base.en",
		ui: {
			tab: "input",
			label: "STT model",
			description: "Whisper model size (larger = more accurate but slower)",
			submenu: true,
		},
	},

	// ─────────────────────────────────────────────────────────────────────────
	// Edit settings
	// ─────────────────────────────────────────────────────────────────────────
	"edit.fuzzyMatch": {
		type: "boolean",
		default: true,
		ui: {
			tab: "config",
			label: "Edit fuzzy match",
			description: "Accept high-confidence fuzzy matches for whitespace differences",
		},
	},
	"edit.fuzzyThreshold": {
		type: "number",
		default: 0.95,
		ui: {
			tab: "config",
			label: "Edit fuzzy threshold",
			description: "Similarity threshold for fuzzy matches",
			submenu: true,
		},
	},
	"edit.mode": {
		type: "enum",
		values: ["replace", "patch", "hashline"] as const,
		default: "hashline",
		ui: {
			tab: "config",
			label: "Edit mode",
			description: "Select the edit tool variant (replace, patch, or hashline)",
		},
	},
	"edit.streamingAbort": {
		type: "boolean",
		default: false,
		ui: {
			tab: "config",
			label: "Edit streaming abort",
			description: "Abort streaming edit tool calls when patch preview fails",
		},
	},
	// edit.modelVariants is complex - handle separately

	// ─────────────────────────────────────────────────────────────────────────
	// TTSR settings
	// ─────────────────────────────────────────────────────────────────────────
	"ttsr.enabled": {
		type: "boolean",
		default: true,
		ui: {
			tab: "ttsr",
			label: "TTSR enabled",
			description: "Time Traveling Stream Rules: interrupt agent when output matches patterns",
		},
	},
	"ttsr.contextMode": {
		type: "enum",
		values: ["discard", "keep"] as const,
		default: "discard",
		ui: { tab: "ttsr", label: "TTSR context mode", description: "What to do with partial output when TTSR triggers" },
	},
	"ttsr.interruptMode": {
		type: "enum",
		values: ["never", "prose-only", "tool-only", "always"] as const,
		default: "always",
		ui: {
			tab: "ttsr",
			label: "TTSR interrupt mode",
			description: "When to interrupt mid-stream vs inject warning after completion",
			submenu: true,
		},
	},
	"ttsr.repeatMode": {
		type: "enum",
		values: ["once", "after-gap"] as const,
		default: "once",
		ui: {
			tab: "ttsr",
			label: "TTSR repeat mode",
			description: "How rules can repeat: once per session or after a message gap",
		},
	},
	"ttsr.repeatGap": {
		type: "number",
		default: 10,
		ui: {
			tab: "ttsr",
			label: "TTSR repeat gap",
			description: "Messages before a rule can trigger again",
			submenu: true,
		},
	},

	// ─────────────────────────────────────────────────────────────────────────
	// Commit settings (no UI - advanced)
	// ─────────────────────────────────────────────────────────────────────────
	"commit.mapReduceEnabled": { type: "boolean", default: true },
	"commit.mapReduceMinFiles": { type: "number", default: 4 },
	"commit.mapReduceMaxFileTokens": { type: "number", default: 50000 },
	"commit.mapReduceTimeoutMs": { type: "number", default: 120000 },
	"commit.mapReduceMaxConcurrency": { type: "number", default: 5 },
	"commit.changelogMaxDiffChars": { type: "number", default: 120000 },

	// ─────────────────────────────────────────────────────────────────────────
	// Thinking budgets (no UI - advanced)
	// ─────────────────────────────────────────────────────────────────────────
	"thinkingBudgets.minimal": { type: "number", default: 1024 },
	"thinkingBudgets.low": { type: "number", default: 2048 },
	"thinkingBudgets.medium": { type: "number", default: 8192 },
	"thinkingBudgets.high": { type: "number", default: 16384 },

	// ─────────────────────────────────────────────────────────────────────────
	// Status line settings
	// ─────────────────────────────────────────────────────────────────────────
	"statusLine.preset": {
		type: "enum",
		values: ["default", "minimal", "compact", "full", "nerd", "ascii", "custom"] as const,
		default: "default",
		ui: { tab: "status", label: "Preset", description: "Pre-built status line configurations", submenu: true },
	},
	"statusLine.separator": {
		type: "enum",
		values: ["powerline", "powerline-thin", "slash", "pipe", "block", "none", "ascii"] as const,
		default: "powerline-thin",
		ui: {
			tab: "status",
			label: "Separator style",
			description: "Style of separators between segments",
			submenu: true,
		},
	},
	"statusLine.showHookStatus": {
		type: "boolean",
		default: true,
		ui: {
			tab: "status",
			label: "Show extension status",
			description: "Display hook status messages below status line",
		},
	},
	"statusLine.leftSegments": { type: "array", default: [] as StatusLineSegmentId[] },
	"statusLine.rightSegments": { type: "array", default: [] as StatusLineSegmentId[] },
	"statusLine.segmentOptions": { type: "record", default: {} as Record<string, unknown> },
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// Type Inference
// ═══════════════════════════════════════════════════════════════════════════

type Schema = typeof SETTINGS_SCHEMA;

/** All valid setting paths */
export type SettingPath = keyof Schema;

/** Infer the value type for a setting path */
export type SettingValue<P extends SettingPath> = Schema[P] extends { type: "boolean" }
	? boolean
	: Schema[P] extends { type: "string" }
		? string | undefined
		: Schema[P] extends { type: "number" }
			? number
			: Schema[P] extends { type: "enum"; values: infer V }
				? V extends readonly string[]
					? V[number]
					: never
				: Schema[P] extends { type: "array"; default: infer D }
					? D
					: Schema[P] extends { type: "record"; default: infer D }
						? D
						: never;

/** Get the default value for a setting path */
export function getDefault<P extends SettingPath>(path: P): SettingValue<P> {
	return SETTINGS_SCHEMA[path].default as SettingValue<P>;
}

/** Check if a path has UI metadata (should appear in settings panel) */
export function hasUi(path: SettingPath): boolean {
	return "ui" in SETTINGS_SCHEMA[path];
}

/** Get UI metadata for a path (undefined if no UI) */
export function getUi(path: SettingPath): UiMetadata | undefined {
	const def = SETTINGS_SCHEMA[path];
	return "ui" in def ? (def.ui as UiMetadata) : undefined;
}

/** Get all paths for a specific tab */
export function getPathsForTab(tab: SettingTab): SettingPath[] {
	return (Object.keys(SETTINGS_SCHEMA) as SettingPath[]).filter(path => {
		const ui = getUi(path);
		return ui?.tab === tab;
	});
}

/** Get the type of a setting */
export function getType(path: SettingPath): SettingDef["type"] {
	return SETTINGS_SCHEMA[path].type;
}

/** Get enum values for an enum setting */
export function getEnumValues(path: SettingPath): readonly string[] | undefined {
	const def = SETTINGS_SCHEMA[path];
	return "values" in def ? (def.values as readonly string[]) : undefined;
}

// ═══════════════════════════════════════════════════════════════════════════
// Derived Types from Schema
// ═══════════════════════════════════════════════════════════════════════════

/** Status line preset - derived from schema */
export type StatusLinePreset = SettingValue<"statusLine.preset">;

/** Status line separator style - derived from schema */
export type StatusLineSeparatorStyle = SettingValue<"statusLine.separator">;

// ═══════════════════════════════════════════════════════════════════════════
// Typed Group Definitions
// ═══════════════════════════════════════════════════════════════════════════

export interface CompactionSettings {
	enabled: boolean;
	reserveTokens: number;
	keepRecentTokens: number;
	autoContinue: boolean;
	remoteEndpoint: string | undefined;
}

export interface ContextPromotionSettings {
	enabled: boolean;
}
export interface RetrySettings {
	enabled: boolean;
	maxRetries: number;
	baseDelayMs: number;
}

export interface MemoriesSettings {
	enabled: boolean;
	maxRolloutsPerStartup: number;
	maxRolloutAgeDays: number;
	minRolloutIdleHours: number;
	threadScanLimit: number;
	maxRawMemoriesForGlobal: number;
	stage1Concurrency: number;
	stage1LeaseSeconds: number;
	stage1RetryDelaySeconds: number;
	phase2LeaseSeconds: number;
	phase2RetryDelaySeconds: number;
	phase2HeartbeatSeconds: number;
	rolloutPayloadPercent: number;
	fallbackTokenLimit: number;
	summaryInjectionTokenLimit: number;
}

export interface TodoCompletionSettings {
	enabled: boolean;
	maxReminders: number;
}

export interface BranchSummarySettings {
	enabled: boolean;
	reserveTokens: number;
}

export interface SkillsSettings {
	enabled?: boolean;
	enableSkillCommands?: boolean;
	enableCodexUser?: boolean;
	enableClaudeUser?: boolean;
	enableClaudeProject?: boolean;
	enablePiUser?: boolean;
	enablePiProject?: boolean;
	customDirectories?: string[];
	ignoredSkills?: string[];
	includeSkills?: string[];
}

export interface CommitSettings {
	mapReduceEnabled: boolean;
	mapReduceMinFiles: number;
	mapReduceMaxFileTokens: number;
	mapReduceTimeoutMs: number;
	mapReduceMaxConcurrency: number;
	changelogMaxDiffChars: number;
}

export interface TtsrSettings {
	enabled: boolean;
	contextMode: "discard" | "keep";
	interruptMode: "never" | "prose-only" | "tool-only" | "always";
	repeatMode: "once" | "after-gap";
	repeatGap: number;
}

export interface ExaSettings {
	enabled: boolean;
	enableSearch: boolean;
	enableLinkedin: boolean;
	enableCompany: boolean;
	enableResearcher: boolean;
	enableWebsets: boolean;
}

export interface StatusLineSettings {
	preset: StatusLinePreset;
	separator: StatusLineSeparatorStyle;
	showHookStatus: boolean;
	leftSegments: StatusLineSegmentId[];
	rightSegments: StatusLineSegmentId[];
	segmentOptions: Record<string, unknown>;
}

export interface ThinkingBudgetsSettings {
	minimal: number;
	low: number;
	medium: number;
	high: number;
}

export interface SttSettings {
	enabled: boolean;
	language: string | undefined;
	modelName: string;
	whisperPath: string | undefined;
	modelPath: string | undefined;
}

export interface BashInterceptorRule {
	pattern: string;
	flags?: string;
	tool: string;
	message: string;
	allowSubcommands?: string[];
}

/** Map group prefix -> typed settings interface */
export interface GroupTypeMap {
	compaction: CompactionSettings;
	contextPromotion: ContextPromotionSettings;
	retry: RetrySettings;
	memories: MemoriesSettings;
	branchSummary: BranchSummarySettings;
	skills: SkillsSettings;
	commit: CommitSettings;
	ttsr: TtsrSettings;
	exa: ExaSettings;
	statusLine: StatusLineSettings;
	thinkingBudgets: ThinkingBudgetsSettings;
	stt: SttSettings;
	modelRoles: Record<string, string>;
}

export type GroupPrefix = keyof GroupTypeMap;
