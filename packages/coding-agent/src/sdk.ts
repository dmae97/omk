import {
	Agent,
	type AgentEvent,
	type AgentMessage,
	type AgentTool,
	INTENT_FIELD,
	type ThinkingLevel,
} from "@oh-my-pi/pi-agent-core";
import { type Message, type Model, supportsXhigh } from "@oh-my-pi/pi-ai";
import { prewarmOpenAICodexResponses } from "@oh-my-pi/pi-ai/providers/openai-codex-responses";
import type { Component } from "@oh-my-pi/pi-tui";
import { $env, getAgentDbPath, getAgentDir, getProjectDir, logger, postmortem } from "@oh-my-pi/pi-utils";
import chalk from "chalk";
import { AsyncJobManager } from "./async";
import { loadCapability } from "./capability";
import { type Rule, ruleCapability } from "./capability/rule";
import { ModelRegistry } from "./config/model-registry";
import { formatModelString, parseModelPattern, parseModelString } from "./config/model-resolver";
import {
	loadPromptTemplates as loadPromptTemplatesInternal,
	type PromptTemplate,
	renderPromptTemplate,
} from "./config/prompt-templates";
import { Settings, type SkillsSettings } from "./config/settings";
import { CursorExecHandlers } from "./cursor";
import "./discovery";
import { resolveConfigValue } from "./config/resolve-config-value";
import { initializeWithSettings } from "./discovery";
import { TtsrManager } from "./export/ttsr";
import {
	type CustomCommandsLoadResult,
	loadCustomCommands as loadCustomCommandsInternal,
} from "./extensibility/custom-commands";
import { discoverAndLoadCustomTools } from "./extensibility/custom-tools";
import type { CustomTool, CustomToolContext, CustomToolSessionEvent } from "./extensibility/custom-tools/types";
import { CustomToolAdapter } from "./extensibility/custom-tools/wrapper";
import {
	discoverAndLoadExtensions,
	type ExtensionContext,
	type ExtensionFactory,
	ExtensionRunner,
	ExtensionToolWrapper,
	type ExtensionUIContext,
	type LoadExtensionsResult,
	loadExtensionFromFactory,
	loadExtensions,
	type ToolDefinition,
	wrapRegisteredTools,
} from "./extensibility/extensions";
import { loadSkills as loadSkillsInternal, type Skill, type SkillWarning } from "./extensibility/skills";
import { type FileSlashCommand, loadSlashCommands as loadSlashCommandsInternal } from "./extensibility/slash-commands";
import {
	AgentProtocolHandler,
	ArtifactProtocolHandler,
	InternalUrlRouter,
	JobsProtocolHandler,
	LocalProtocolHandler,
	MemoryProtocolHandler,
	PiProtocolHandler,
	RuleProtocolHandler,
	SkillProtocolHandler,
} from "./internal-urls";
import { disposeAllKernelSessions } from "./ipy/executor";
import { discoverAndLoadMCPTools, type MCPManager, type MCPToolsLoadResult } from "./mcp";
import { buildMemoryToolDeveloperInstructions, getMemoryRoot, startMemoryStartupTask } from "./memories";
import asyncResultTemplate from "./prompts/tools/async-result.md" with { type: "text" };
import { collectEnvSecrets, loadSecrets, obfuscateMessages, SecretObfuscator } from "./secrets";
import { AgentSession } from "./session/agent-session";
import { AuthStorage } from "./session/auth-storage";
import { convertToLlm } from "./session/messages";
import { SessionManager } from "./session/session-manager";
import { closeAllConnections } from "./ssh/connection-manager";
import { unmountAll } from "./ssh/sshfs-mount";
import {
	buildSystemPrompt as buildSystemPromptInternal,
	loadProjectContextFiles as loadContextFilesInternal,
} from "./system-prompt";
import { AgentOutputManager } from "./task/output-manager";
import {
	BashTool,
	BUILTIN_TOOLS,
	createTools,
	EditTool,
	FindTool,
	GrepTool,
	getSearchTools,
	loadSshTool,
	PythonTool,
	ReadTool,
	setPreferredImageProvider,
	setPreferredSearchProvider,
	type Tool,
	type ToolSession,
	WriteTool,
	warmupLspServers,
} from "./tools";
import { ToolContextStore } from "./tools/context";
import { getGeminiImageTools } from "./tools/gemini-image";
import { EventBus } from "./utils/event-bus";

// Types
export interface CreateAgentSessionOptions {
	/** Working directory for project-local discovery. Default: getProjectDir() */
	cwd?: string;
	/** Global config directory. Default: ~/.omp/agent */
	agentDir?: string;
	/** Spawns to allow. Default: "*" */
	spawns?: string;

	/** Auth storage for credentials. Default: discoverAuthStorage(agentDir) */
	authStorage?: AuthStorage;
	/** Model registry. Default: discoverModels(authStorage, agentDir) */
	modelRegistry?: ModelRegistry;

	/** Model to use. Default: from settings, else first available */
	model?: Model;
	/** Raw model pattern string (e.g. from --model CLI flag) to resolve after extensions load.
	 * Used when model lookup is deferred because extension-provided models aren't registered yet. */
	modelPattern?: string;
	/** Thinking level. Default: from settings, else 'off' (clamped to model capabilities) */
	thinkingLevel?: ThinkingLevel;
	/** Models available for cycling (Ctrl+P in interactive mode) */
	scopedModels?: Array<{ model: Model; thinkingLevel: ThinkingLevel }>;

	/** System prompt. String replaces default, function receives default and returns final. */
	systemPrompt?: string | ((defaultPrompt: string) => string);

	/** Custom tools to register (in addition to built-in tools). Accepts both CustomTool and ToolDefinition. */
	customTools?: (CustomTool | ToolDefinition)[];
	/** Inline extensions (merged with discovery). */
	extensions?: ExtensionFactory[];
	/** Additional extension paths to load (merged with discovery). */
	additionalExtensionPaths?: string[];
	/** Disable extension discovery (explicit paths still load). */
	disableExtensionDiscovery?: boolean;
	/**
	 * Pre-loaded extensions (skips file discovery).
	 * @internal Used by CLI when extensions are loaded early to parse custom flags.
	 */
	preloadedExtensions?: LoadExtensionsResult;

	/** Shared event bus for tool/extension communication. Default: creates new bus. */
	eventBus?: EventBus;

	/** Skills. Default: discovered from multiple locations */
	skills?: Skill[];
	/** Rules. Default: discovered from multiple locations */
	rules?: Rule[];
	/** Context files (AGENTS.md content). Default: discovered walking up from cwd */
	contextFiles?: Array<{ path: string; content: string }>;
	/** Prompt templates. Default: discovered from cwd/.omp/prompts/ + agentDir/prompts/ */
	promptTemplates?: PromptTemplate[];
	/** File-based slash commands. Default: discovered from commands/ directories */
	slashCommands?: FileSlashCommand[];

	/** Enable MCP server discovery from .mcp.json files. Default: true */
	enableMCP?: boolean;

	/** Enable LSP integration (tool, formatting, diagnostics, warmup). Default: true */
	enableLsp?: boolean;
	/** Skip Python kernel availability check and prelude warmup */
	skipPythonPreflight?: boolean;

	/** Tool names explicitly requested (enables disabled-by-default tools) */
	toolNames?: string[];

	/** Output schema for structured completion (subagents) */
	outputSchema?: unknown;
	/** Whether to include the submit_result tool by default */
	requireSubmitResultTool?: boolean;
	/** Task recursion depth (for subagent sessions). Default: 0 */
	taskDepth?: number;
	/** Parent task ID prefix for nested artifact naming (e.g., "6-Extensions") */
	parentTaskPrefix?: string;

	/** Session manager. Default: SessionManager.create(cwd) */
	sessionManager?: SessionManager;

	/** Settings instance. Default: Settings.init({ cwd, agentDir }) */
	settings?: Settings;

	/** Whether UI is available (enables interactive tools like ask). Default: false */
	hasUI?: boolean;
}

/** Result from createAgentSession */
export interface CreateAgentSessionResult {
	/** The created session */
	session: AgentSession;
	/** Extensions result (loaded extensions + runtime) */
	extensionsResult: LoadExtensionsResult;
	/** Update tool UI context (interactive mode) */
	setToolUIContext: (uiContext: ExtensionUIContext, hasUI: boolean) => void;
	/** MCP manager for server lifecycle management (undefined if MCP disabled) */
	mcpManager?: MCPManager;
	/** Warning if session was restored with a different model than saved */
	modelFallbackMessage?: string;
	/** LSP servers that were warmed up at startup */
	lspServers?: Array<{ name: string; status: "ready" | "error"; fileTypes: string[]; error?: string }>;
}

// Re-exports

export type { PromptTemplate } from "./config/prompt-templates";
export { Settings, type SkillsSettings } from "./config/settings";
export type { CustomCommand, CustomCommandFactory } from "./extensibility/custom-commands/types";
export type { CustomTool, CustomToolFactory } from "./extensibility/custom-tools/types";
export type * from "./extensibility/extensions";
export type { Skill } from "./extensibility/skills";
export type { FileSlashCommand } from "./extensibility/slash-commands";
export type { MCPManager, MCPServerConfig, MCPServerConnection, MCPToolsLoadResult } from "./mcp";
export type { Tool } from "./tools";

export {
	// Individual tool classes (for custom usage)
	BashTool,
	// Tool classes and factories
	BUILTIN_TOOLS,
	createTools,
	EditTool,
	FindTool,
	GrepTool,
	loadSshTool,
	PythonTool,
	ReadTool,
	WriteTool,
	type ToolSession,
};

// Helper Functions

function getDefaultAgentDir(): string {
	return getAgentDir();
}

// Discovery Functions

/**
 * Create an AuthStorage instance with fallback support.
 * Reads from primary path first, then falls back to legacy paths (.pi, .claude).
 */
export async function discoverAuthStorage(agentDir: string = getDefaultAgentDir()): Promise<AuthStorage> {
	const dbPath = getAgentDbPath(agentDir);
	logger.debug("discoverAuthStorage", { agentDir, dbPath });

	const storage = await AuthStorage.create(dbPath, { configValueResolver: resolveConfigValue });
	await storage.reload();
	return storage;
}

/**
 * Discover extensions from cwd.
 */
export async function discoverExtensions(cwd?: string): Promise<LoadExtensionsResult> {
	const resolvedCwd = cwd ?? getProjectDir();

	return discoverAndLoadExtensions([], resolvedCwd);
}

/**
 * Discover skills from cwd and agentDir.
 */
export async function discoverSkills(
	cwd?: string,
	_agentDir?: string,
	settings?: SkillsSettings,
): Promise<{ skills: Skill[]; warnings: SkillWarning[] }> {
	return await loadSkillsInternal({
		...settings,
		cwd: cwd ?? getProjectDir(),
	});
}

/**
 * Discover context files (AGENTS.md) walking up from cwd.
 * Returns files sorted by depth (farther from cwd first, so closer files appear last/more prominent).
 */
export async function discoverContextFiles(
	cwd?: string,
	_agentDir?: string,
): Promise<Array<{ path: string; content: string; depth?: number }>> {
	return await loadContextFilesInternal({
		cwd: cwd ?? getProjectDir(),
	});
}

/**
 * Discover prompt templates from cwd and agentDir.
 */
export async function discoverPromptTemplates(cwd?: string, agentDir?: string): Promise<PromptTemplate[]> {
	return await loadPromptTemplatesInternal({
		cwd: cwd ?? getProjectDir(),
		agentDir: agentDir ?? getDefaultAgentDir(),
	});
}

/**
 * Discover file-based slash commands from commands/ directories.
 */
export async function discoverSlashCommands(cwd?: string): Promise<FileSlashCommand[]> {
	return loadSlashCommandsInternal({ cwd: cwd ?? getProjectDir() });
}

/**
 * Discover custom commands (TypeScript slash commands) from cwd and agentDir.
 */
export async function discoverCustomTSCommands(cwd?: string, agentDir?: string): Promise<CustomCommandsLoadResult> {
	const resolvedCwd = cwd ?? getProjectDir();
	const resolvedAgentDir = agentDir ?? getDefaultAgentDir();

	return loadCustomCommandsInternal({
		cwd: resolvedCwd,
		agentDir: resolvedAgentDir,
	});
}

/**
 * Discover MCP servers from .mcp.json files.
 * Returns the manager and loaded tools.
 */
export async function discoverMCPServers(cwd?: string): Promise<MCPToolsLoadResult> {
	const resolvedCwd = cwd ?? getProjectDir();
	return discoverAndLoadMCPTools(resolvedCwd);
}

// API Key Helpers

// System Prompt

export interface BuildSystemPromptOptions {
	tools?: Tool[];
	skills?: Skill[];
	contextFiles?: Array<{ path: string; content: string }>;
	cwd?: string;
	appendPrompt?: string;
	repeatToolDescriptions?: boolean;
}

/**
 * Build the default system prompt.
 */
export async function buildSystemPrompt(options: BuildSystemPromptOptions = {}): Promise<string> {
	return await buildSystemPromptInternal({
		cwd: options.cwd,
		skills: options.skills,
		contextFiles: options.contextFiles,
		appendSystemPrompt: options.appendPrompt,
		repeatToolDescriptions: options.repeatToolDescriptions,
	});
}

// Internal Helpers

function createCustomToolContext(ctx: ExtensionContext): CustomToolContext {
	return {
		sessionManager: ctx.sessionManager,
		modelRegistry: ctx.modelRegistry,
		model: ctx.model,
		isIdle: ctx.isIdle,
		hasQueuedMessages: ctx.hasPendingMessages,
		abort: ctx.abort,
	};
}

function isCustomTool(tool: CustomTool | ToolDefinition): tool is CustomTool {
	// To distinguish, we mark converted tools with a hidden symbol property.
	// If the tool doesn't have this marker, it's a CustomTool that needs conversion.
	return !(tool as any).__isToolDefinition;
}

const TOOL_DEFINITION_MARKER = Symbol("__isToolDefinition");

let sshCleanupRegistered = false;

async function cleanupSshResources(): Promise<void> {
	const results = await Promise.allSettled([closeAllConnections(), unmountAll()]);
	for (const result of results) {
		if (result.status === "rejected") {
			logger.warn("SSH cleanup failed", { error: String(result.reason) });
		}
	}
}

function registerSshCleanup(): void {
	if (sshCleanupRegistered) return;
	sshCleanupRegistered = true;
	postmortem.register("ssh-cleanup", cleanupSshResources);
}

let pythonCleanupRegistered = false;

function registerPythonCleanup(): void {
	if (pythonCleanupRegistered) return;
	pythonCleanupRegistered = true;
	postmortem.register("python-cleanup", disposeAllKernelSessions);
}

function customToolToDefinition(tool: CustomTool): ToolDefinition {
	const definition: ToolDefinition & { [TOOL_DEFINITION_MARKER]: true } = {
		name: tool.name,
		label: tool.label,
		description: tool.description,
		parameters: tool.parameters,
		execute: (toolCallId, params, signal, onUpdate, ctx) =>
			tool.execute(toolCallId, params, onUpdate, createCustomToolContext(ctx), signal),
		onSession: tool.onSession ? (event, ctx) => tool.onSession?.(event, createCustomToolContext(ctx)) : undefined,
		renderCall: tool.renderCall,
		renderResult: tool.renderResult
			? (result, options, theme): Component => {
					const component = tool.renderResult?.(
						result,
						{ expanded: options.expanded, isPartial: options.isPartial, spinnerFrame: options.spinnerFrame },
						theme,
					);
					// Return empty component if undefined to match Component type requirement
					return component ?? ({ render: () => [] } as unknown as Component);
				}
			: undefined,
		[TOOL_DEFINITION_MARKER]: true,
	};
	return definition;
}

function createCustomToolsExtension(tools: CustomTool[]): ExtensionFactory {
	return api => {
		for (const tool of tools) {
			api.registerTool(customToolToDefinition(tool));
		}

		const runOnSession = async (event: CustomToolSessionEvent, ctx: ExtensionContext) => {
			for (const tool of tools) {
				if (!tool.onSession) continue;
				try {
					await tool.onSession(event, createCustomToolContext(ctx));
				} catch (err) {
					logger.warn("Custom tool onSession error", { tool: tool.name, error: String(err) });
				}
			}
		};

		api.on("session_start", async (_event, ctx) =>
			runOnSession({ reason: "start", previousSessionFile: undefined }, ctx),
		);
		api.on("session_switch", async (event, ctx) =>
			runOnSession({ reason: "switch", previousSessionFile: event.previousSessionFile }, ctx),
		);
		api.on("session_branch", async (event, ctx) =>
			runOnSession({ reason: "branch", previousSessionFile: event.previousSessionFile }, ctx),
		);
		api.on("session_tree", async (_event, ctx) =>
			runOnSession({ reason: "tree", previousSessionFile: undefined }, ctx),
		);
		api.on("session_shutdown", async (_event, ctx) =>
			runOnSession({ reason: "shutdown", previousSessionFile: undefined }, ctx),
		);
		api.on("auto_compaction_start", async (event, ctx) =>
			runOnSession({ reason: "auto_compaction_start", trigger: event.reason }, ctx),
		);
		api.on("auto_compaction_end", async (event, ctx) =>
			runOnSession(
				{
					reason: "auto_compaction_end",
					result: event.result,
					aborted: event.aborted,
					willRetry: event.willRetry,
					errorMessage: event.errorMessage,
				},
				ctx,
			),
		);
		api.on("auto_retry_start", async (event, ctx) =>
			runOnSession(
				{
					reason: "auto_retry_start",
					attempt: event.attempt,
					maxAttempts: event.maxAttempts,
					delayMs: event.delayMs,
					errorMessage: event.errorMessage,
				},
				ctx,
			),
		);
		api.on("auto_retry_end", async (event, ctx) =>
			runOnSession(
				{
					reason: "auto_retry_end",
					success: event.success,
					attempt: event.attempt,
					finalError: event.finalError,
				},
				ctx,
			),
		);
		api.on("ttsr_triggered", async (event, ctx) =>
			runOnSession({ reason: "ttsr_triggered", rules: event.rules }, ctx),
		);
		api.on("todo_reminder", async (event, ctx) =>
			runOnSession(
				{
					reason: "todo_reminder",
					todos: event.todos,
					attempt: event.attempt,
					maxAttempts: event.maxAttempts,
				},
				ctx,
			),
		);
	};
}

// Factory

/**
 * Create an AgentSession with the specified options.
 *
 * @example
 * ```typescript
 * // Minimal - uses defaults
 * const { session } = await createAgentSession();
 *
 * // With explicit model
 * import { getModel } from '@oh-my-pi/pi-ai';
 * const { session } = await createAgentSession({
 *   model: getModel('anthropic', 'claude-opus-4-5'),
 *   thinkingLevel: 'high',
 * });
 *
 * // Continue previous session
 * const { session, modelFallbackMessage } = await createAgentSession({
 *   continueSession: true,
 * });
 *
 * // Full control
 * const { session } = await createAgentSession({
 *   model: myModel,
 *   getApiKey: async () => Bun.env.MY_KEY,
 *   systemPrompt: 'You are helpful.',
 *   tools: codingTools({ cwd: getProjectDir() }),
 *   skills: [],
 *   sessionManager: SessionManager.inMemory(),
 * });
 * ```
 */
export async function createAgentSession(options: CreateAgentSessionOptions = {}): Promise<CreateAgentSessionResult> {
	const cwd = options.cwd ?? getProjectDir();
	const agentDir = options.agentDir ?? getDefaultAgentDir();
	const eventBus = options.eventBus ?? new EventBus();

	registerSshCleanup();
	registerPythonCleanup();

	// Use provided or create AuthStorage and ModelRegistry
	const { authStorage, modelRegistry } = await logger.timeAsync("discoverModels", async () => {
		const authStorage = options.authStorage ?? (await discoverAuthStorage(agentDir));
		const modelRegistry = options.modelRegistry ?? new ModelRegistry(authStorage);
		if (!options.modelRegistry) {
			await modelRegistry.refresh();
		}
		return { authStorage, modelRegistry };
	});

	const settings = await logger.timeAsync(
		"settings",
		async () => options.settings ?? (await Settings.init({ cwd, agentDir })),
	);
	logger.time("initializeWithSettings", initializeWithSettings, settings);
	const skillsSettings = settings.getGroup("skills") as SkillsSettings;
	const discoveredSkillsPromise =
		options.skills === undefined ? discoverSkills(cwd, agentDir, skillsSettings) : undefined;

	// Initialize provider preferences from settings
	setPreferredSearchProvider(settings.get("providers.webSearch") ?? "auto");
	setPreferredImageProvider(settings.get("providers.image") ?? "auto");

	const sessionManager = options.sessionManager ?? logger.time("sessionManager", SessionManager.create, cwd);
	const sessionId = sessionManager.getSessionId();
	const modelApiKeyAvailability = new Map<string, boolean>();
	const getModelAvailabilityKey = (candidate: Model): string =>
		`${candidate.provider}\u0000${candidate.baseUrl ?? ""}`;
	const hasModelApiKey = async (candidate: Model): Promise<boolean> => {
		const availabilityKey = getModelAvailabilityKey(candidate);
		const cached = modelApiKeyAvailability.get(availabilityKey);
		if (cached !== undefined) {
			return cached;
		}

		const hasKey = !!(await modelRegistry.getApiKey(candidate, sessionId));
		modelApiKeyAvailability.set(availabilityKey, hasKey);
		return hasKey;
	};

	// Check if session has existing data to restore
	const existingSession = logger.time("loadSession", () => sessionManager.buildSessionContext());
	const hasExistingSession = existingSession.messages.length > 0;
	const hasThinkingEntry = sessionManager.getBranch().some(entry => entry.type === "thinking_level_change");

	const hasExplicitModel = options.model !== undefined || options.modelPattern !== undefined;
	let model = options.model;
	let modelFallbackMessage: string | undefined;
	// If session has data, try to restore model from it.
	// Skip restore when an explicit model was requested.
	const defaultModelStr = existingSession.models.default;
	if (!hasExplicitModel && !model && hasExistingSession && defaultModelStr) {
		const parsedModel = parseModelString(defaultModelStr);
		if (parsedModel) {
			const restoredModel = modelRegistry.find(parsedModel.provider, parsedModel.id);
			if (restoredModel && (await hasModelApiKey(restoredModel))) {
				model = restoredModel;
			}
		}
		if (!model) {
			modelFallbackMessage = `Could not restore model ${defaultModelStr}`;
		}
	}

	// If still no model, try settings default.
	// Skip settings fallback when an explicit model was requested.
	if (!hasExplicitModel && !model) {
		const settingsDefaultModel = settings.getModelRole("default");
		if (settingsDefaultModel) {
			const parsedModel = parseModelString(settingsDefaultModel);
			if (parsedModel) {
				const settingsModel = modelRegistry.find(parsedModel.provider, parsedModel.id);
				if (settingsModel && (await hasModelApiKey(settingsModel))) {
					model = settingsModel;
				}
			}
		}
	}

	// For subagent sessions using GitHub Copilot, add X-Initiator header
	// to ensure proper billing (agent-initiated vs user-initiated)
	const taskDepth = options.taskDepth ?? 0;
	const forceCopilotAgentInitiator = taskDepth > 0;
	if (forceCopilotAgentInitiator && model?.provider === "github-copilot") {
		model = {
			...model,
			headers: {
				...model.headers,
				"X-Initiator": "agent",
			},
		};
	}

	let thinkingLevel = options.thinkingLevel;

	// If session has data, restore thinking level from it
	if (thinkingLevel === undefined && hasExistingSession) {
		thinkingLevel = hasThinkingEntry
			? (existingSession.thinkingLevel as ThinkingLevel)
			: ((settings.get("defaultThinkingLevel") ?? "off") as ThinkingLevel);
	}

	// Fall back to settings default
	if (thinkingLevel === undefined) {
		thinkingLevel = settings.get("defaultThinkingLevel") ?? "off";
	}

	// Clamp to model capabilities
	if (!model || !model.reasoning) {
		thinkingLevel = "off";
	} else if (thinkingLevel === "xhigh" && !supportsXhigh(model)) {
		thinkingLevel = "high";
	}

	let skills: Skill[];
	let skillWarnings: SkillWarning[];
	if (options.skills !== undefined) {
		skills = options.skills;
		skillWarnings = [];
	} else {
		const discovered = await logger.timeAsync("discoverSkills", async () =>
			discoveredSkillsPromise ? await discoveredSkillsPromise : { skills: [], warnings: [] },
		);
		skills = discovered.skills;
		skillWarnings = discovered.warnings;
	}

	// Discover rules
	const { ttsrManager, rulesResult, registeredTtsrRuleNames } = await logger.timeAsync(
		"discoverTtsrRules",
		async () => {
			const ttsrSettings = settings.getGroup("ttsr");
			const ttsrManager = new TtsrManager(ttsrSettings);
			const rulesResult =
				options.rules !== undefined
					? { items: options.rules, warnings: undefined }
					: await loadCapability<Rule>(ruleCapability.id, { cwd });
			const registeredTtsrRuleNames = new Set<string>();
			for (const rule of rulesResult.items) {
				if (rule.condition && rule.condition.length > 0) {
					if (ttsrManager.addRule(rule)) {
						registeredTtsrRuleNames.add(rule.name);
					}
				}
			}
			if (existingSession.injectedTtsrRules.length > 0) {
				ttsrManager.restoreInjected(existingSession.injectedTtsrRules);
			}
			return { ttsrManager, rulesResult, registeredTtsrRuleNames };
		},
	);

	// Filter rules for the rulebook (non-TTSR, non-alwaysApply, with descriptions)
	const rulebookRules = logger.time("filterRulebookRules", () =>
		rulesResult.items.filter((rule: Rule) => {
			if (registeredTtsrRuleNames.has(rule.name)) return false;
			if (rule.alwaysApply) return false;
			if (!rule.description) return false;
			return true;
		}),
	);

	const contextFiles = await logger.timeAsync(
		"discoverContextFiles",
		async () => options.contextFiles ?? (await discoverContextFiles(cwd, agentDir)),
	);

	let agent: Agent;
	let session: AgentSession;

	const enableLsp = options.enableLsp ?? true;
	const asyncEnabled = settings.get("async.enabled");
	const asyncMaxJobs = Math.min(100, Math.max(1, settings.get("async.maxJobs") ?? 100));
	const ASYNC_INLINE_RESULT_MAX_CHARS = 12_000;
	const ASYNC_PREVIEW_MAX_CHARS = 4_000;
	const formatAsyncResultForFollowUp = async (result: string): Promise<string> => {
		if (result.length <= ASYNC_INLINE_RESULT_MAX_CHARS) {
			return result;
		}

		const preview = `${result.slice(0, ASYNC_PREVIEW_MAX_CHARS)}\n\n[Output truncated. Showing first ${ASYNC_PREVIEW_MAX_CHARS.toLocaleString()} characters.]`;
		try {
			const { path: artifactPath, id: artifactId } = await sessionManager.allocateArtifactPath("async");
			if (artifactPath && artifactId) {
				await Bun.write(artifactPath, result);
				return `${preview}\nFull output: artifact://${artifactId}`;
			}
		} catch (error) {
			logger.warn("Failed to persist async follow-up artifact", {
				error: error instanceof Error ? error.message : String(error),
			});
		}

		return preview;
	};
	const asyncJobManager = asyncEnabled
		? new AsyncJobManager({
				maxRunningJobs: asyncMaxJobs,
				onJobComplete: async (jobId, result, job) => {
					if (!session) return;
					const formattedResult = await formatAsyncResultForFollowUp(result);
					const message = renderPromptTemplate(asyncResultTemplate, { jobId, result: formattedResult });
					const durationMs = job ? Math.max(0, Date.now() - job.startTime) : undefined;
					await session.sendCustomMessage(
						{
							customType: "async-result",
							content: message,
							display: true,
							details: {
								jobId,
								type: job?.type,
								label: job?.label,
								durationMs,
							},
						},
						{ deliverAs: "followUp", triggerTurn: true },
					);
				},
			})
		: undefined;

	const toolSession: ToolSession = {
		cwd,
		hasUI: options.hasUI ?? false,
		enableLsp,
		get hasEditTool() {
			return !options.toolNames || options.toolNames.includes("edit");
		},
		skipPythonPreflight: options.skipPythonPreflight,
		contextFiles,
		skills,
		eventBus,
		outputSchema: options.outputSchema,
		requireSubmitResultTool: options.requireSubmitResultTool,
		taskDepth: options.taskDepth ?? 0,
		getSessionFile: () => sessionManager.getSessionFile() ?? null,
		getSessionId: () => sessionManager.getSessionId?.() ?? null,
		getSessionSpawns: () => options.spawns ?? "*",
		getModelString: () => (hasExplicitModel && model ? formatModelString(model) : undefined),
		getActiveModelString: () => {
			const activeModel = agent?.state.model;
			if (activeModel) return formatModelString(activeModel);
			// Fall back to initial model during tool creation (before agent exists)
			if (model) return formatModelString(model);
			return undefined;
		},
		getPlanModeState: () => session.getPlanModeState(),
		getCompactContext: () => session.formatCompactContext(),
		getTodoPhases: () => session.getTodoPhases(),
		setTodoPhases: phases => session.setTodoPhases(phases),
		allocateOutputArtifact: async toolType => {
			try {
				return await sessionManager.allocateArtifactPath(toolType);
			} catch {
				return {};
			}
		},
		settings,
		authStorage,
		modelRegistry,
		asyncJobManager,
	};

	// Initialize internal URL router for internal protocols (agent://, artifact://, memory://, skill://, rule://, local://)
	const internalRouter = new InternalUrlRouter();
	const getArtifactsDir = () => sessionManager.getArtifactsDir();
	internalRouter.register(new AgentProtocolHandler({ getArtifactsDir }));
	internalRouter.register(new ArtifactProtocolHandler({ getArtifactsDir }));
	internalRouter.register(
		new MemoryProtocolHandler({
			getMemoryRoot: () => getMemoryRoot(agentDir, settings.getCwd()),
		}),
	);
	internalRouter.register(
		new LocalProtocolHandler({
			getArtifactsDir,
			getSessionId: () => sessionManager.getSessionId(),
		}),
	);
	internalRouter.register(
		new SkillProtocolHandler({
			getSkills: () => skills,
		}),
	);
	internalRouter.register(
		new RuleProtocolHandler({
			getRules: () => rulebookRules,
		}),
	);
	internalRouter.register(new PiProtocolHandler());
	internalRouter.register(new JobsProtocolHandler({ getAsyncJobManager: () => asyncJobManager }));
	toolSession.internalRouter = internalRouter;
	toolSession.getArtifactsDir = getArtifactsDir;
	toolSession.agentOutputManager = new AgentOutputManager(
		getArtifactsDir,
		options.parentTaskPrefix ? { parentPrefix: options.parentTaskPrefix } : undefined,
	);

	// Create built-in tools (already wrapped with meta notice formatting)
	const builtinTools = await logger.timeAsync("createAllTools", () => createTools(toolSession, options.toolNames));

	// Discover MCP tools from .mcp.json files
	let mcpManager: MCPManager | undefined;
	const enableMCP = options.enableMCP ?? true;
	const customTools: CustomTool[] = [];
	if (enableMCP) {
		const mcpResult = await logger.timeAsync("discoverAndLoadMCPTools", () =>
			discoverAndLoadMCPTools(cwd, {
				onConnecting: serverNames => {
					if (options.hasUI && serverNames.length > 0) {
						process.stderr.write(`${chalk.gray(`Connecting to MCP servers: ${serverNames.join(", ")}…`)}\n`);
					}
				},
				enableProjectConfig: settings.get("mcp.enableProjectConfig") ?? true,
				// Always filter Exa - we have native integration
				filterExa: true,
				// Filter browser MCP servers when builtin browser tool is active
				filterBrowser: (settings.get("browser.enabled") as boolean) ?? false,
				cacheStorage: settings.getStorage(),
				authStorage,
			}),
		);
		mcpManager = mcpResult.manager;
		toolSession.mcpManager = mcpManager;

		// If we extracted Exa API keys from MCP configs and EXA_API_KEY isn't set, use the first one
		if (mcpResult.exaApiKeys.length > 0 && !$env.EXA_API_KEY) {
			Bun.env.EXA_API_KEY = mcpResult.exaApiKeys[0];
		}

		// Log MCP errors
		for (const { path, error } of mcpResult.errors) {
			logger.error("MCP tool load failed", { path, error });
		}

		if (mcpResult.tools.length > 0) {
			// MCP tools are LoadedCustomTool, extract the tool property
			customTools.push(...mcpResult.tools.map(loaded => loaded.tool));
		}
	}

	// Add Gemini image tools if GEMINI_API_KEY (or GOOGLE_API_KEY) is available
	const geminiImageTools = await logger.timeAsync("getGeminiImageTools", getGeminiImageTools);
	if (geminiImageTools.length > 0) {
		customTools.push(...(geminiImageTools as unknown as CustomTool[]));
	}

	// Add specialized Exa web search tools if EXA_API_KEY is available
	const exaSettings = settings.getGroup("exa");
	if (exaSettings.enabled && exaSettings.enableSearch) {
		const exaSearchTools = await logger.timeAsync("getSearchTools", getSearchTools, {
			enableLinkedin: exaSettings.enableLinkedin as boolean,
			enableCompany: exaSettings.enableCompany as boolean,
		});
		// Filter out the base web_search (already in built-in tools), add specialized Exa tools
		const specializedTools = exaSearchTools.filter(t => t.name !== "web_search");
		if (specializedTools.length > 0) {
			customTools.push(...specializedTools);
		}
	}

	// Discover and load custom tools from .omp/tools/, .claude/tools/, etc.
	const builtInToolNames = builtinTools.map(t => t.name);
	const discoveredCustomTools = await logger.timeAsync(
		"discoverAndLoadCustomTools",
		discoverAndLoadCustomTools,
		[],
		cwd,
		builtInToolNames,
	);
	for (const { path, error } of discoveredCustomTools.errors) {
		logger.error("Custom tool load failed", { path, error });
	}
	if (discoveredCustomTools.tools.length > 0) {
		customTools.push(...discoveredCustomTools.tools.map(loaded => loaded.tool));
	}

	const inlineExtensions: ExtensionFactory[] = options.extensions ? [...options.extensions] : [];
	if (customTools.length > 0) {
		inlineExtensions.push(createCustomToolsExtension(customTools));
	}

	// Load extensions (discovers from standard locations + configured paths)
	let extensionsResult: LoadExtensionsResult;
	if (options.disableExtensionDiscovery) {
		const configuredPaths = options.additionalExtensionPaths ?? [];
		extensionsResult = await logger.timeAsync("loadExtensions", loadExtensions, configuredPaths, cwd, eventBus);
		for (const { path, error } of extensionsResult.errors) {
			logger.error("Failed to load extension", { path, error });
		}
	} else if (options.preloadedExtensions) {
		extensionsResult = options.preloadedExtensions;
	} else {
		// Merge CLI extension paths with settings extension paths
		const configuredPaths = [
			...(options.additionalExtensionPaths ?? []),
			...((settings.get("extensions") as string[]) ?? []),
		];
		extensionsResult = await logger.timeAsync(
			"discoverAndLoadExtensions",
			discoverAndLoadExtensions,
			configuredPaths,
			cwd,
			eventBus,
		);
		for (const { path, error } of extensionsResult.errors) {
			logger.error("Failed to load extension", { path, error });
		}
	}

	// Load inline extensions from factories
	if (inlineExtensions.length > 0) {
		for (let i = 0; i < inlineExtensions.length; i++) {
			const factory = inlineExtensions[i];
			const loaded = await loadExtensionFromFactory(
				factory,
				cwd,
				eventBus,
				extensionsResult.runtime,
				`<inline-${i}>`,
			);
			extensionsResult.extensions.push(loaded);
		}
	}

	// Process provider registrations queued during extension loading.
	// This must happen before the runner is created so that models registered by
	// extensions are available for model selection on session resume / fallback.
	const activeExtensionSources = extensionsResult.extensions.map(extension => extension.path);
	modelRegistry.syncExtensionSources(activeExtensionSources);
	for (const sourceId of new Set(activeExtensionSources)) {
		modelRegistry.clearSourceRegistrations(sourceId);
	}
	if (extensionsResult.runtime.pendingProviderRegistrations.length > 0) {
		for (const { name, config, sourceId } of extensionsResult.runtime.pendingProviderRegistrations) {
			modelRegistry.registerProvider(name, config, sourceId);
		}
		extensionsResult.runtime.pendingProviderRegistrations = [];
	}

	// Resolve deferred --model pattern now that extension models are registered.
	if (!model && options.modelPattern) {
		const availableModels = modelRegistry.getAll();
		const matchPreferences = {
			usageOrder: settings.getStorage()?.getModelUsageOrder(),
		};
		const { model: resolved } = parseModelPattern(options.modelPattern, availableModels, matchPreferences);
		if (resolved) {
			model = resolved;
			modelFallbackMessage = undefined;
		} else {
			modelFallbackMessage = `Model "${options.modelPattern}" not found`;
		}
	}

	// Fall back to first available model with a valid API key.
	// Skip fallback if the user explicitly requested a model via --model that wasn't found.
	if (!model && !options.modelPattern) {
		const allModels = modelRegistry.getAll();
		for (const candidate of allModels) {
			if (await hasModelApiKey(candidate)) {
				model = candidate;
				break;
			}
		}
		if (model) {
			if (modelFallbackMessage) {
				modelFallbackMessage += `. Using ${model.provider}/${model.id}`;
			}
		} else {
			modelFallbackMessage =
				"No models available. Use /login or set an API key environment variable. Then use /model to select a model.";
		}
	}

	// Discover custom commands (TypeScript slash commands)
	const customCommandsResult: CustomCommandsLoadResult = options.disableExtensionDiscovery
		? { commands: [], errors: [] }
		: await logger.timeAsync("discoverCustomCommands", loadCustomCommandsInternal, { cwd, agentDir });
	if (!options.disableExtensionDiscovery) {
		for (const { path, error } of customCommandsResult.errors) {
			logger.error("Failed to load custom command", { path, error });
		}
	}

	let extensionRunner: ExtensionRunner | undefined;
	if (extensionsResult.extensions.length > 0) {
		extensionRunner = new ExtensionRunner(
			extensionsResult.extensions,
			extensionsResult.runtime,
			cwd,
			sessionManager,
			modelRegistry,
		);
	}

	const getSessionContext = () => ({
		sessionManager,
		modelRegistry,
		model: agent.state.model,
		isIdle: () => !session.isStreaming,
		hasQueuedMessages: () => session.queuedMessageCount > 0,
		abort: () => {
			session.abort();
		},
	});
	const toolContextStore = new ToolContextStore(getSessionContext);

	const registeredTools = extensionRunner?.getAllRegisteredTools() ?? [];
	let wrappedExtensionTools: AgentTool[];

	if (extensionRunner) {
		// With extension runner: convert CustomTools to ToolDefinitions and wrap all together
		const allCustomTools = [
			...registeredTools,
			...(options.customTools?.map(tool => {
				const definition = isCustomTool(tool) ? customToolToDefinition(tool) : tool;
				return { definition, extensionPath: "<sdk>" };
			}) ?? []),
		];
		wrappedExtensionTools = wrapRegisteredTools(allCustomTools, extensionRunner);
	} else {
		// Without extension runner: wrap CustomTools directly with CustomToolAdapter
		// ToolDefinition items require ExtensionContext and cannot be used without a runner
		const customToolContext = (): CustomToolContext => ({
			sessionManager,
			modelRegistry,
			model: agent?.state.model,
			isIdle: () => !session?.isStreaming,
			hasQueuedMessages: () => (session?.queuedMessageCount ?? 0) > 0,
			abort: () => session?.abort(),
		});
		wrappedExtensionTools = (options.customTools ?? [])
			.filter(isCustomTool)
			.map(tool => CustomToolAdapter.wrap(tool, customToolContext) as AgentTool);
	}

	// All built-in tools are active (conditional tools like git/ask return null from factory if disabled)
	const toolRegistry = new Map<string, AgentTool>();
	for (const tool of builtinTools) {
		toolRegistry.set(tool.name, tool as AgentTool);
	}
	for (const tool of wrappedExtensionTools) {
		toolRegistry.set(tool.name, tool);
	}
	if (extensionRunner) {
		for (const tool of toolRegistry.values()) {
			toolRegistry.set(tool.name, new ExtensionToolWrapper(tool, extensionRunner));
		}
	}
	if (model?.provider === "cursor") {
		toolRegistry.delete("edit");
	}

	let cursorEventEmitter: ((event: AgentEvent) => void) | undefined;
	const cursorExecHandlers = new CursorExecHandlers({
		cwd,
		tools: toolRegistry,
		getToolContext: () => toolContextStore.getContext(),
		emitEvent: event => cursorEventEmitter?.(event),
	});

	const repeatToolDescriptions = settings.get("repeatToolDescriptions");
	const eagerTasks = settings.get("task.eager");
	const intentField = settings.get("tools.intentTracing") || $env.PI_INTENT_TRACING === "1" ? INTENT_FIELD : undefined;
	const rebuildSystemPrompt = async (toolNames: string[], tools: Map<string, AgentTool>): Promise<string> => {
		toolContextStore.setToolNames(toolNames);
		const memoryInstructions = await buildMemoryToolDeveloperInstructions(agentDir, settings);
		const defaultPrompt = await buildSystemPromptInternal({
			cwd,
			skills,
			contextFiles,
			tools,
			toolNames,
			rules: rulebookRules,
			skillsSettings: settings.getGroup("skills") as SkillsSettings,
			appendSystemPrompt: memoryInstructions,
			repeatToolDescriptions,
			eagerTasks,
			intentField,
		});

		if (options.systemPrompt === undefined) {
			return defaultPrompt;
		}
		if (typeof options.systemPrompt === "string") {
			return await buildSystemPromptInternal({
				cwd,
				skills,
				contextFiles,
				tools,
				toolNames,
				rules: rulebookRules,
				skillsSettings: settings.getGroup("skills") as SkillsSettings,
				customPrompt: options.systemPrompt,
				appendSystemPrompt: memoryInstructions,
				repeatToolDescriptions,
				eagerTasks,
				intentField,
			});
		}
		return options.systemPrompt(defaultPrompt);
	};

	const toolNamesFromRegistry = Array.from(toolRegistry.keys());
	const requestedToolNames = options.toolNames ?? toolNamesFromRegistry;
	const normalizedRequested = requestedToolNames.filter(name => toolRegistry.has(name));
	const includeExitPlanMode = options.toolNames?.includes("exit_plan_mode") ?? false;
	const initialToolNames = includeExitPlanMode
		? normalizedRequested
		: normalizedRequested.filter(name => name !== "exit_plan_mode");

	// Custom tools and extension-registered tools are always included regardless of toolNames filter
	const alwaysInclude: string[] = [
		...(options.customTools?.map(t => (isCustomTool(t) ? t.name : t.name)) ?? []),
		...registeredTools.map(t => t.definition.name),
	];
	for (const name of alwaysInclude) {
		if (toolRegistry.has(name) && !initialToolNames.includes(name)) {
			initialToolNames.push(name);
		}
	}

	const systemPrompt = await logger.timeAsync(
		"buildSystemPrompt",
		rebuildSystemPrompt,
		initialToolNames,
		toolRegistry,
	);

	const promptTemplates =
		options.promptTemplates ??
		(await logger.timeAsync("discoverPromptTemplates", discoverPromptTemplates, cwd, agentDir));
	toolSession.promptTemplates = promptTemplates;

	const slashCommands =
		options.slashCommands ?? (await logger.timeAsync("discoverSlashCommands", discoverSlashCommands, cwd));

	// Create convertToLlm wrapper that filters images if blockImages is enabled (defense-in-depth)
	const convertToLlmWithBlockImages = (messages: AgentMessage[]): Message[] => {
		const converted = convertToLlm(messages);
		// Check setting dynamically so mid-session changes take effect
		if (!settings.get("images.blockImages")) {
			return converted;
		}
		// Filter out ImageContent from all messages, replacing with text placeholder
		return converted.map(msg => {
			if (msg.role === "user" || msg.role === "toolResult") {
				const content = msg.content;
				if (Array.isArray(content)) {
					const hasImages = content.some(c => c.type === "image");
					if (hasImages) {
						const filteredContent = content
							.map(c => (c.type === "image" ? { type: "text" as const, text: "Image reading is disabled." } : c))
							.filter(
								(c, i, arr) =>
									// Dedupe consecutive "Image reading is disabled." texts
									!(
										c.type === "text" &&
										c.text === "Image reading is disabled." &&
										i > 0 &&
										arr[i - 1].type === "text" &&
										(arr[i - 1] as { type: "text"; text: string }).text === "Image reading is disabled."
									),
							);
						return { ...msg, content: filteredContent };
					}
				}
			}
			return msg;
		});
	};

	// Load and create secret obfuscator if secrets are enabled
	let obfuscator: SecretObfuscator | undefined;
	if (settings.get("secrets.enabled")) {
		const fileEntries = await logger.timeAsync("loadSecrets", loadSecrets, cwd, agentDir);
		const envEntries = collectEnvSecrets();
		const allEntries = [...envEntries, ...fileEntries];
		if (allEntries.length > 0) {
			obfuscator = new SecretObfuscator(allEntries);
		}
	}

	// Final convertToLlm: chain block-images filter with secret obfuscation
	const convertToLlmFinal = (messages: AgentMessage[]): Message[] => {
		const converted = convertToLlmWithBlockImages(messages);
		if (!obfuscator?.hasSecrets()) return converted;
		return obfuscateMessages(obfuscator, converted);
	};

	const setToolUIContext = (uiContext: ExtensionUIContext, hasUI: boolean) => {
		toolContextStore.setUIContext(uiContext, hasUI);
	};

	const initialTools = initialToolNames
		.map(name => toolRegistry.get(name))
		.filter((tool): tool is AgentTool => tool !== undefined);

	const openaiWebsocketSetting = settings.get("providers.openaiWebsockets") ?? "auto";
	const preferOpenAICodexWebsockets =
		openaiWebsocketSetting === "on" ? true : openaiWebsocketSetting === "off" ? false : undefined;

	agent = new Agent({
		initialState: {
			systemPrompt,
			model,
			thinkingLevel,
			tools: initialTools,
		},
		convertToLlm: convertToLlmFinal,
		sessionId: sessionManager.getSessionId(),
		transformContext: extensionRunner
			? async messages => {
					return extensionRunner.emitContext(messages);
				}
			: undefined,
		steeringMode: settings.get("steeringMode") ?? "one-at-a-time",
		followUpMode: settings.get("followUpMode") ?? "one-at-a-time",
		interruptMode: settings.get("interruptMode") ?? "immediate",
		thinkingBudgets: settings.getGroup("thinkingBudgets"),
		temperature: settings.get("temperature") >= 0 ? settings.get("temperature") : undefined,
		topP: settings.get("topP") >= 0 ? settings.get("topP") : undefined,
		topK: settings.get("topK") >= 0 ? settings.get("topK") : undefined,
		minP: settings.get("minP") >= 0 ? settings.get("minP") : undefined,
		presencePenalty: settings.get("presencePenalty") >= 0 ? settings.get("presencePenalty") : undefined,
		repetitionPenalty: settings.get("repetitionPenalty") >= 0 ? settings.get("repetitionPenalty") : undefined,
		kimiApiFormat: settings.get("providers.kimiApiFormat") ?? "anthropic",
		preferWebsockets: preferOpenAICodexWebsockets,
		getToolContext: tc => toolContextStore.getContext(tc),
		getApiKey: async provider => {
			// Use the provider argument from the in-flight request;
			// agent.state.model may already be switched mid-turn.
			const key = await modelRegistry.getApiKeyForProvider(provider, sessionId);
			if (!key) {
				throw new Error(`No API key found for provider "${provider}"`);
			}
			return key;
		},
		cursorExecHandlers,
		transformToolCallArguments: (args, _toolName) => {
			let result = args;
			const maxTimeout = settings.get("tools.maxTimeout");
			if (maxTimeout > 0 && typeof result.timeout === "number") {
				result = { ...result, timeout: Math.min(result.timeout, maxTimeout) };
			}
			if (obfuscator?.hasSecrets()) {
				result = obfuscator.deobfuscateObject(result);
			}
			return result;
		},
		intentTracing: !!intentField,
	});
	cursorEventEmitter = event => agent.emitExternalEvent(event);

	// Restore messages if session has existing data
	if (hasExistingSession) {
		agent.replaceMessages(existingSession.messages);
		if (!hasThinkingEntry) {
			sessionManager.appendThinkingLevelChange(thinkingLevel);
		}
	} else {
		// Save initial model and thinking level for new sessions so they can be restored on resume
		if (model) {
			sessionManager.appendModelChange(`${model.provider}/${model.id}`);
		}
		sessionManager.appendThinkingLevelChange(thinkingLevel);
	}

	session = new AgentSession({
		agent,
		sessionManager,
		settings,
		scopedModels: options.scopedModels,
		promptTemplates,
		slashCommands,
		extensionRunner,
		customCommands: customCommandsResult.commands,
		skills,
		skillWarnings,
		skillsSettings: settings.getGroup("skills") as Required<SkillsSettings>,
		modelRegistry,
		toolRegistry,
		rebuildSystemPrompt,
		ttsrManager,
		forceCopilotAgentInitiator,
		obfuscator,
		asyncJobManager,
	});

	if (model?.api === "openai-codex-responses") {
		try {
			await logger.timeAsync("prewarmCodexWebsocket", prewarmOpenAICodexResponses, model, {
				apiKey: await modelRegistry.getApiKey(model, sessionId),
				sessionId,
				preferWebsockets: preferOpenAICodexWebsockets,
				providerSessionState: session.providerSessionState,
			});
		} catch (error) {
			logger.debug("Codex websocket prewarm failed", {
				error: error instanceof Error ? error.message : String(error),
				provider: model.provider,
				model: model.id,
			});
		}
	}

	// Warm up LSP servers (connects to detected servers)
	let lspServers: CreateAgentSessionResult["lspServers"];
	if (enableLsp && settings.get("lsp.diagnosticsOnWrite")) {
		try {
			const result = await logger.timeAsync("warmupLspServers", warmupLspServers, cwd, {
				onConnecting: serverNames => {
					if (options.hasUI && serverNames.length > 0) {
						process.stderr.write(chalk.gray(`Starting LSP servers: ${serverNames.join(", ")}…\n`));
					}
				},
			});
			lspServers = result.servers;
		} catch (error) {
			logger.warn("LSP server warmup failed", { cwd, error: String(error) });
		}
	}

	startMemoryStartupTask({
		session,
		settings,
		modelRegistry,
		agentDir,
		taskDepth,
	});

	return {
		session,
		extensionsResult,
		setToolUIContext,
		mcpManager,
		modelFallbackMessage,
		lspServers,
	};
}
