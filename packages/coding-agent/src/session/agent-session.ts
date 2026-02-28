/**
 * AgentSession - Core abstraction for agent lifecycle and session management.
 *
 * This class is shared between all run modes (interactive, print, rpc).
 * It encapsulates:
 * - Agent state access
 * - Event subscription with automatic session persistence
 * - Model and thinking level management
 * - Compaction (manual and auto)
 * - Bash execution
 * - Session switching and branching
 *
 * Modes use this class and add their own I/O layer on top.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
	type Agent,
	AgentBusyError,
	type AgentEvent,
	type AgentMessage,
	type AgentState,
	type AgentTool,
	INTENT_FIELD,
	type ThinkingLevel,
} from "@oh-my-pi/pi-agent-core";
import type {
	AssistantMessage,
	ImageContent,
	Message,
	Model,
	ProviderSessionState,
	TextContent,
	ToolCall,
	ToolChoice,
	Usage,
	UsageReport,
} from "@oh-my-pi/pi-ai";
import { isContextOverflow, modelsAreEqual, supportsXhigh } from "@oh-my-pi/pi-ai";
import { abortableSleep, getAgentDbPath, isEnoent, logger } from "@oh-my-pi/pi-utils";
import type { AsyncJob, AsyncJobManager } from "../async";
import type { Rule } from "../capability/rule";
import { MODEL_ROLE_IDS, type ModelRegistry, type ModelRole } from "../config/model-registry";
import { expandRoleAlias, parseModelString } from "../config/model-resolver";
import { expandPromptTemplate, type PromptTemplate, renderPromptTemplate } from "../config/prompt-templates";
import type { Settings, SkillsSettings } from "../config/settings";
import { type BashResult, executeBash as executeBashCommand } from "../exec/bash-executor";
import { exportSessionToHtml } from "../export/html";
import type { TtsrManager, TtsrMatchContext } from "../export/ttsr";
import type { LoadedCustomCommand } from "../extensibility/custom-commands";
import type { CustomTool, CustomToolContext } from "../extensibility/custom-tools/types";
import { CustomToolAdapter } from "../extensibility/custom-tools/wrapper";
import type {
	ExtensionCommandContext,
	ExtensionRunner,
	ExtensionUIContext,
	MessageEndEvent,
	MessageStartEvent,
	MessageUpdateEvent,
	SessionBeforeBranchResult,
	SessionBeforeCompactResult,
	SessionBeforeSwitchResult,
	SessionBeforeTreeResult,
	ToolExecutionEndEvent,
	ToolExecutionStartEvent,
	ToolExecutionUpdateEvent,
	TreePreparation,
	TurnEndEvent,
	TurnStartEvent,
} from "../extensibility/extensions";
import type { CompactOptions, ContextUsage } from "../extensibility/extensions/types";
import { ExtensionToolWrapper } from "../extensibility/extensions/wrapper";
import type { HookCommandContext } from "../extensibility/hooks/types";
import type { Skill, SkillWarning } from "../extensibility/skills";
import { expandSlashCommand, type FileSlashCommand } from "../extensibility/slash-commands";
import { resolveLocalUrlToPath } from "../internal-urls";
import { executePython as executePythonCommand, type PythonResult } from "../ipy/executor";
import { getCurrentThemeName, theme } from "../modes/theme/theme";
import { normalizeDiff, normalizeToLF, ParseError, previewPatch, stripBom } from "../patch";
import type { PlanModeState } from "../plan-mode/state";
import planModeActivePrompt from "../prompts/system/plan-mode-active.md" with { type: "text" };
import planModeReferencePrompt from "../prompts/system/plan-mode-reference.md" with { type: "text" };
import ttsrInterruptTemplate from "../prompts/system/ttsr-interrupt.md" with { type: "text" };
import type { SecretObfuscator } from "../secrets/obfuscator";
import { outputMeta } from "../tools/output-meta";
import { resolveToCwd } from "../tools/path-utils";
import { getLatestTodoPhasesFromEntries, type TodoItem, type TodoPhase } from "../tools/todo-write";
import { parseCommandArgs } from "../utils/command-args";
import { resolveFileDisplayMode } from "../utils/file-display-mode";
import { extractFileMentions, generateFileMentionMessages } from "../utils/file-mentions";
import {
	type CompactionResult,
	calculateContextTokens,
	collectEntriesForBranchSummary,
	compact,
	estimateTokens,
	generateBranchSummary,
	prepareCompaction,
	shouldCompact,
} from "./compaction";
import { DEFAULT_PRUNE_CONFIG, pruneToolOutputs } from "./compaction/pruning";
import {
	type BashExecutionMessage,
	type BranchSummaryMessage,
	bashExecutionToText,
	type CompactionSummaryMessage,
	type CustomMessage,
	type FileMentionMessage,
	type HookMessage,
	type PythonExecutionMessage,
	pythonExecutionToText,
} from "./messages";
import type { BranchSummaryEntry, CompactionEntry, NewSessionOptions, SessionManager } from "./session-manager";
import { getLatestCompactionEntry } from "./session-manager";

/** Session-specific events that extend the core AgentEvent */
export type AgentSessionEvent =
	| AgentEvent
	| { type: "auto_compaction_start"; reason: "threshold" | "overflow" }
	| {
			type: "auto_compaction_end";
			result: CompactionResult | undefined;
			aborted: boolean;
			willRetry: boolean;
			errorMessage?: string;
	  }
	| { type: "auto_retry_start"; attempt: number; maxAttempts: number; delayMs: number; errorMessage: string }
	| { type: "auto_retry_end"; success: boolean; attempt: number; finalError?: string }
	| { type: "ttsr_triggered"; rules: Rule[] }
	| { type: "todo_reminder"; todos: TodoItem[]; attempt: number; maxAttempts: number };

/** Listener function for agent session events */
export type AgentSessionEventListener = (event: AgentSessionEvent) => void;
export type AsyncJobSnapshotItem = Pick<AsyncJob, "id" | "type" | "status" | "label" | "startTime">;

export interface AsyncJobSnapshot {
	running: AsyncJobSnapshotItem[];
	recent: AsyncJobSnapshotItem[];
}

// ============================================================================
// Types
// ============================================================================

export interface AgentSessionConfig {
	agent: Agent;
	sessionManager: SessionManager;
	settings: Settings;
	/** Async background jobs launched by tools */
	asyncJobManager?: AsyncJobManager;
	/** Models to cycle through with Ctrl+P (from --models flag) */
	scopedModels?: Array<{ model: Model; thinkingLevel: ThinkingLevel }>;
	/** Prompt templates for expansion */
	promptTemplates?: PromptTemplate[];
	/** File-based slash commands for expansion */
	slashCommands?: FileSlashCommand[];
	/** Extension runner (created in main.ts with wrapped tools) */
	extensionRunner?: ExtensionRunner;
	/** Loaded skills (already discovered by SDK) */
	skills?: Skill[];
	/** Skill loading warnings (already captured by SDK) */
	skillWarnings?: SkillWarning[];
	/** Custom commands (TypeScript slash commands) */
	customCommands?: LoadedCustomCommand[];
	skillsSettings?: Required<SkillsSettings>;
	/** Model registry for API key resolution and model discovery */
	modelRegistry: ModelRegistry;
	/** Tool registry for LSP and settings */
	toolRegistry?: Map<string, AgentTool>;
	/** System prompt builder that can consider tool availability */
	rebuildSystemPrompt?: (toolNames: string[], tools: Map<string, AgentTool>) => Promise<string>;
	/** TTSR manager for time-traveling stream rules */
	ttsrManager?: TtsrManager;
	/** Force X-Initiator: agent for GitHub Copilot model selections in this session. */
	forceCopilotAgentInitiator?: boolean;
	/** Secret obfuscator for deobfuscating streaming edit content */
	obfuscator?: SecretObfuscator;
}

/** Options for AgentSession.prompt() */
export interface PromptOptions {
	/** Whether to expand file-based prompt templates (default: true) */
	expandPromptTemplates?: boolean;
	/** Image attachments */
	images?: ImageContent[];
	/** When streaming, how to queue the message: "steer" (interrupt) or "followUp" (wait). */
	streamingBehavior?: "steer" | "followUp";
	/** Optional tool choice override for the next LLM call. */
	toolChoice?: ToolChoice;
	/** Send as developer/system message instead of user. Providers that support it use the developer role; others fall back to user. */
	synthetic?: boolean;
}

/** Result from cycleModel() */
export interface ModelCycleResult {
	model: Model;
	thinkingLevel: ThinkingLevel;
	/** Whether cycling through scoped models (--models flag) or all available */
	isScoped: boolean;
}

/** Result from cycleRoleModels() */
export interface RoleModelCycleResult {
	model: Model;
	thinkingLevel: ThinkingLevel;
	role: ModelRole;
}

/** Session statistics for /session command */
export interface SessionStats {
	sessionFile: string | undefined;
	sessionId: string;
	userMessages: number;
	assistantMessages: number;
	toolCalls: number;
	toolResults: number;
	totalMessages: number;
	tokens: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		total: number;
	};
	cost: number;
}

/** Result from handoff() */
export interface HandoffResult {
	document: string;
}

/** Internal marker for hook messages queued through the agent loop */
// ============================================================================
// Constants
// ============================================================================

/** Standard thinking levels */
const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high"];

/** Thinking levels including xhigh (for supported models) */
const THINKING_LEVELS_WITH_XHIGH: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

const noOpUIContext: ExtensionUIContext = {
	select: async (_title, _options, _dialogOptions) => undefined,
	confirm: async (_title, _message, _dialogOptions) => false,
	input: async (_title, _placeholder, _dialogOptions) => undefined,
	notify: () => {},
	onTerminalInput: () => () => {},
	setStatus: () => {},
	setWorkingMessage: () => {},
	setWidget: () => {},
	setTitle: () => {},
	custom: async () => undefined as never,
	setEditorText: () => {},
	pasteToEditor: () => {},
	getEditorText: () => "",
	editor: async () => undefined,
	get theme() {
		return theme;
	},
	getAllThemes: () => Promise.resolve([]),
	getTheme: () => Promise.resolve(undefined),
	setTheme: _theme => Promise.resolve({ success: false, error: "UI not available" }),
	setFooter: () => {},
	setHeader: () => {},
	setEditorComponent: () => {},
	getToolsExpanded: () => false,
	setToolsExpanded: () => {},
};

// ============================================================================
// AgentSession Class
// ============================================================================

export class AgentSession {
	readonly agent: Agent;
	readonly sessionManager: SessionManager;
	readonly settings: Settings;

	#asyncJobManager: AsyncJobManager | undefined = undefined;

	#scopedModels: Array<{ model: Model; thinkingLevel: ThinkingLevel }>;
	#promptTemplates: PromptTemplate[];
	#slashCommands: FileSlashCommand[];

	// Event subscription state
	#unsubscribeAgent?: () => void;
	#eventListeners: AgentSessionEventListener[] = [];

	/** Tracks pending steering messages for UI display. Removed when delivered. */
	#steeringMessages: string[] = [];
	/** Tracks pending follow-up messages for UI display. Removed when delivered. */
	#followUpMessages: string[] = [];
	/** Messages queued to be included with the next user prompt as context ("asides"). */
	#pendingNextTurnMessages: CustomMessage[] = [];
	#planModeState: PlanModeState | undefined;
	#planReferenceSent = false;
	#planReferencePath = "local://PLAN.md";

	// Compaction state
	#compactionAbortController: AbortController | undefined = undefined;
	#autoCompactionAbortController: AbortController | undefined = undefined;

	// Branch summarization state
	#branchSummaryAbortController: AbortController | undefined = undefined;

	// Handoff state
	#handoffAbortController: AbortController | undefined = undefined;
	#skipPostTurnMaintenanceAssistantTimestamp: number | undefined = undefined;

	// Retry state
	#retryAbortController: AbortController | undefined = undefined;
	#retryAttempt = 0;
	#retryPromise: Promise<void> | undefined = undefined;
	#retryResolve: (() => void) | undefined = undefined;

	// Todo completion reminder state
	#todoReminderCount = 0;
	#todoPhases: TodoPhase[] = [];

	// Bash execution state
	#bashAbortController: AbortController | undefined = undefined;
	#pendingBashMessages: BashExecutionMessage[] = [];

	// Python execution state
	#pythonAbortController: AbortController | undefined = undefined;
	#pendingPythonMessages: PythonExecutionMessage[] = [];

	// Extension system
	#extensionRunner: ExtensionRunner | undefined = undefined;
	#turnIndex = 0;

	#skills: Skill[];
	#skillWarnings: SkillWarning[];

	// Custom commands (TypeScript slash commands)
	#customCommands: LoadedCustomCommand[] = [];

	#skillsSettings: Required<SkillsSettings> | undefined;

	// Model registry for API key resolution
	#modelRegistry: ModelRegistry;

	// Tool registry and prompt builder for extensions
	#toolRegistry: Map<string, AgentTool>;
	#rebuildSystemPrompt: ((toolNames: string[], tools: Map<string, AgentTool>) => Promise<string>) | undefined;
	#baseSystemPrompt: string;
	#forceCopilotAgentInitiator = false;

	// TTSR manager for time-traveling stream rules
	#ttsrManager: TtsrManager | undefined = undefined;
	#pendingTtsrInjections: Rule[] = [];
	#ttsrAbortPending = false;
	#ttsrRetryToken = 0;
	#ttsrResumePromise: Promise<void> | undefined = undefined;
	#ttsrResumeResolve: (() => void) | undefined = undefined;
	#postPromptTaskCounter = 0;
	#postPromptTaskIds = new Set<number>();
	#postPromptTasksPromise: Promise<void> | undefined = undefined;
	#postPromptTasksResolve: (() => void) | undefined = undefined;
	#postPromptTasksAbortController = new AbortController();

	#streamingEditAbortTriggered = false;
	#streamingEditCheckedLineCounts = new Map<string, number>();
	#streamingEditFileCache = new Map<string, string>();
	#promptInFlight = false;
	#obfuscator: SecretObfuscator | undefined;
	#promptGeneration = 0;
	#providerSessionState = new Map<string, ProviderSessionState>();

	constructor(config: AgentSessionConfig) {
		this.agent = config.agent;
		this.sessionManager = config.sessionManager;
		this.settings = config.settings;
		this.#asyncJobManager = config.asyncJobManager;
		this.#scopedModels = config.scopedModels ?? [];
		this.#promptTemplates = config.promptTemplates ?? [];
		this.#slashCommands = config.slashCommands ?? [];
		this.#extensionRunner = config.extensionRunner;
		this.#skills = config.skills ?? [];
		this.#skillWarnings = config.skillWarnings ?? [];
		this.#customCommands = config.customCommands ?? [];
		this.#skillsSettings = config.skillsSettings;
		this.#modelRegistry = config.modelRegistry;
		this.#toolRegistry = config.toolRegistry ?? new Map();
		this.#rebuildSystemPrompt = config.rebuildSystemPrompt;
		this.#baseSystemPrompt = this.agent.state.systemPrompt;
		this.#ttsrManager = config.ttsrManager;
		this.#forceCopilotAgentInitiator = config.forceCopilotAgentInitiator ?? false;
		this.#obfuscator = config.obfuscator;
		this.agent.providerSessionState = this.#providerSessionState;
		this.#syncTodoPhasesFromBranch();

		// Always subscribe to agent events for internal handling
		// (session persistence, hooks, auto-compaction, retry logic)
		this.#unsubscribeAgent = this.agent.subscribe(this.#handleAgentEvent);
	}

	/** Model registry for API key resolution and model discovery */
	get modelRegistry(): ModelRegistry {
		return this.#modelRegistry;
	}

	/** Provider-scoped mutable state store for transport/session caches. */
	get providerSessionState(): Map<string, ProviderSessionState> {
		return this.#providerSessionState;
	}

	/** TTSR manager for time-traveling stream rules */
	get ttsrManager(): TtsrManager | undefined {
		return this.#ttsrManager;
	}

	/** Whether a TTSR abort is pending (stream was aborted to inject rules) */
	get isTtsrAbortPending(): boolean {
		return this.#ttsrAbortPending;
	}

	getAsyncJobSnapshot(options?: { recentLimit?: number }): AsyncJobSnapshot | null {
		if (!this.#asyncJobManager) return null;
		const running = this.#asyncJobManager.getRunningJobs().map(job => ({
			id: job.id,
			type: job.type,
			status: job.status,
			label: job.label,
			startTime: job.startTime,
		}));
		const recent = this.#asyncJobManager.getRecentJobs(options?.recentLimit ?? 5).map(job => ({
			id: job.id,
			type: job.type,
			status: job.status,
			label: job.label,
			startTime: job.startTime,
		}));
		return { running, recent };
	}

	// =========================================================================
	// Event Subscription
	// =========================================================================

	/** Emit an event to all listeners */
	#emit(event: AgentSessionEvent): void {
		// Copy array before iteration to avoid mutation during iteration
		const listeners = [...this.#eventListeners];
		for (const l of listeners) {
			l(event);
		}
	}

	async #emitSessionEvent(event: AgentSessionEvent): Promise<void> {
		await this.#emitExtensionEvent(event);
		this.#emit(event);
	}

	// Track last assistant message for auto-compaction check
	#lastAssistantMessage: AssistantMessage | undefined = undefined;

	/** Internal handler for agent events - shared by subscribe and reconnect */
	#handleAgentEvent = async (event: AgentEvent): Promise<void> => {
		// When a user message starts, check if it's from either queue and remove it BEFORE emitting
		// This ensures the UI sees the updated queue state
		if (event.type === "message_start" && event.message.role === "user") {
			const messageText = this.#getUserMessageText(event.message);
			if (messageText) {
				// Check steering queue first
				const steeringIndex = this.#steeringMessages.indexOf(messageText);
				if (steeringIndex !== -1) {
					this.#steeringMessages.splice(steeringIndex, 1);
				} else {
					// Check follow-up queue
					const followUpIndex = this.#followUpMessages.indexOf(messageText);
					if (followUpIndex !== -1) {
						this.#followUpMessages.splice(followUpIndex, 1);
					}
				}
			}
		}

		await this.#emitSessionEvent(event);

		if (event.type === "turn_start") {
			this.#resetStreamingEditState();
			// TTSR: Reset buffer on turn start
			this.#ttsrManager?.resetBuffer();
		}

		// TTSR: Increment message count on turn end (for repeat-after-gap tracking)
		if (event.type === "turn_end" && this.#ttsrManager) {
			this.#ttsrManager.incrementMessageCount();
		}

		// TTSR: Check for pattern matches on assistant text/thinking and tool argument deltas
		if (event.type === "message_update" && this.#ttsrManager?.hasRules()) {
			const assistantEvent = event.assistantMessageEvent;
			let matchContext: TtsrMatchContext | undefined;

			if (assistantEvent.type === "text_delta") {
				matchContext = { source: "text" };
			} else if (assistantEvent.type === "thinking_delta") {
				matchContext = { source: "thinking" };
			} else if (assistantEvent.type === "toolcall_delta") {
				matchContext = this.#getTtsrToolMatchContext(event.message, assistantEvent.contentIndex);
			}

			if (matchContext && "delta" in assistantEvent) {
				const matches = this.#ttsrManager.checkDelta(assistantEvent.delta, matchContext);
				if (matches.length > 0) {
					// Queue rules for injection; mark as injected only after successful enqueue.

					this.#addPendingTtsrInjections(matches);

					if (this.#shouldInterruptForTtsrMatch(matchContext)) {
						// Abort the stream immediately — do not gate on extension callbacks
						this.#ttsrAbortPending = true;
						this.#ensureTtsrResumePromise();
						this.agent.abort();
						// Notify extensions (fire-and-forget, does not block abort)
						this.#emitSessionEvent({ type: "ttsr_triggered", rules: matches }).catch(() => {});
						// Schedule retry after a short delay
						const retryToken = ++this.#ttsrRetryToken;
						const generation = this.#promptGeneration;
						const targetMessageTimestamp =
							event.message.role === "assistant" ? event.message.timestamp : undefined;
						this.#schedulePostPromptTask(
							async () => {
								if (this.#ttsrRetryToken !== retryToken) {
									this.#resolveTtsrResume();
									return;
								}

								const targetAssistantIndex = this.#findTtsrAssistantIndex(targetMessageTimestamp);
								if (
									!this.#ttsrAbortPending ||
									this.#promptGeneration !== generation ||
									targetAssistantIndex === -1
								) {
									this.#ttsrAbortPending = false;
									this.#pendingTtsrInjections = [];
									this.#resolveTtsrResume();
									return;
								}
								this.#ttsrAbortPending = false;
								const ttsrSettings = this.#ttsrManager?.getSettings();
								if (ttsrSettings?.contextMode === "discard") {
									// Remove the partial/aborted assistant turn from agent state
									this.agent.replaceMessages(this.agent.state.messages.slice(0, targetAssistantIndex));
								}
								// Inject TTSR rules as system reminder before retry
								const injection = this.#getTtsrInjectionContent();
								if (injection) {
									const details = { rules: injection.rules.map(rule => rule.name) };
									this.agent.appendMessage({
										role: "custom",
										customType: "ttsr-injection",
										content: injection.content,
										display: false,
										details,
										timestamp: Date.now(),
									});
									this.sessionManager.appendCustomMessageEntry(
										"ttsr-injection",
										injection.content,
										false,
										details,
									);
									this.#markTtsrInjected(details.rules);
								}
								try {
									await this.agent.continue();
								} catch {
									this.#resolveTtsrResume();
								}
							},
							{ delayMs: 50 },
						);
						return;
					}
				}
			}
		}

		if (event.type === "message_update" && event.assistantMessageEvent.type === "toolcall_start") {
			this.#preCacheStreamingEditFile(event);
		}

		if (
			event.type === "message_update" &&
			(event.assistantMessageEvent.type === "toolcall_end" || event.assistantMessageEvent.type === "toolcall_delta")
		) {
			this.#maybeAbortStreamingEdit(event);
		}

		// Handle session persistence
		if (event.type === "message_end") {
			// Check if this is a hook/custom message
			if (event.message.role === "hookMessage" || event.message.role === "custom") {
				// Persist as CustomMessageEntry
				this.sessionManager.appendCustomMessageEntry(
					event.message.customType,
					event.message.content,
					event.message.display,
					event.message.details,
				);
				if (event.message.role === "custom" && event.message.customType === "ttsr-injection") {
					this.#markTtsrInjected(this.#extractTtsrRuleNames(event.message.details));
				}
			} else if (
				event.message.role === "user" ||
				event.message.role === "developer" ||
				event.message.role === "assistant" ||
				event.message.role === "toolResult" ||
				event.message.role === "fileMention"
			) {
				// Regular LLM message - persist as SessionMessageEntry
				this.sessionManager.appendMessage(event.message);
			}
			// Other message types (bashExecution, compactionSummary, branchSummary) are persisted elsewhere

			// Track assistant message for auto-compaction (checked on agent_end)
			if (event.message.role === "assistant") {
				this.#lastAssistantMessage = event.message;
				const assistantMsg = event.message as AssistantMessage;
				// Resolve TTSR resume gate before checking for new deferred injections.
				// Gate on #ttsrAbortPending, not stopReason: a non-TTSR abort (e.g. streaming
				// edit) also produces stopReason === "aborted" but has no continuation coming.
				// Only skip when #ttsrAbortPending is true (TTSR continuation is imminent).
				if (!this.#ttsrAbortPending) {
					this.#resolveTtsrResume();
				}
				this.#queueDeferredTtsrInjectionIfNeeded(assistantMsg);
				if (this.#handoffAbortController) {
					this.#skipPostTurnMaintenanceAssistantTimestamp = assistantMsg.timestamp;
				}
				if (
					assistantMsg.stopReason !== "error" &&
					assistantMsg.stopReason !== "aborted" &&
					this.#retryAttempt > 0
				) {
					await this.#emitSessionEvent({
						type: "auto_retry_end",
						success: true,
						attempt: this.#retryAttempt,
					});
					this.#retryAttempt = 0;
					this.#resolveRetry();
				}
			}

			if (event.message.role === "toolResult") {
				const { toolName, details, isError, content } = event.message as {
					toolName?: string;
					details?: { path?: string; phases?: TodoPhase[] };
					isError?: boolean;
					content?: Array<TextContent | ImageContent>;
				};
				// Invalidate streaming edit cache when edit tool completes to prevent stale data
				if (toolName === "edit" && details?.path) {
					this.#invalidateFileCacheForPath(details.path);
				}
				if (toolName === "todo_write" && !isError && Array.isArray(details?.phases)) {
					this.setTodoPhases(details.phases);
				}
				if (toolName === "todo_write" && isError) {
					const errorText = content?.find(part => part.type === "text")?.text;
					const reminderText = [
						"<system-reminder>",
						"todo_write failed, so todo progress is not visible to the user.",
						errorText ? `Failure: ${errorText}` : "Failure: todo_write returned an error.",
						"Fix the todo payload and call todo_write again before continuing.",
						"</system-reminder>",
					].join("\n");
					await this.sendCustomMessage(
						{
							customType: "todo-write-error-reminder",
							content: reminderText,
							display: false,
							details: { toolName, errorText },
						},
						{ deliverAs: "nextTurn" },
					);
				}
			}
		}

		// Check auto-retry and auto-compaction after agent completes
		if (event.type === "agent_end" && this.#lastAssistantMessage) {
			const msg = this.#lastAssistantMessage;
			this.#lastAssistantMessage = undefined;

			if (this.#skipPostTurnMaintenanceAssistantTimestamp === msg.timestamp) {
				this.#skipPostTurnMaintenanceAssistantTimestamp = undefined;
				return;
			}

			// Check for retryable errors first (overloaded, rate limit, server errors)
			if (this.#isRetryableError(msg)) {
				const didRetry = await this.#handleRetryableError(msg);
				if (didRetry) return; // Retry was initiated, don't proceed to compaction
			}

			const compactionTask = this.#checkCompaction(msg);
			this.#trackPostPromptTask(compactionTask);
			await compactionTask;
			// Check for incomplete todos (unless there was an error or abort)
			if (msg.stopReason !== "error" && msg.stopReason !== "aborted") {
				await this.#checkTodoCompletion();
			}
		}
	};

	/** Resolve the pending retry promise */
	#resolveRetry(): void {
		if (this.#retryResolve) {
			this.#retryResolve();
			this.#retryResolve = undefined;
			this.#retryPromise = undefined;
		}
	}

	/** Create the TTSR resume gate promise if one doesn't already exist. */
	#ensureTtsrResumePromise(): void {
		if (this.#ttsrResumePromise) return;
		const { promise, resolve } = Promise.withResolvers<void>();
		this.#ttsrResumePromise = promise;
		this.#ttsrResumeResolve = resolve;
	}

	/** Resolve and clear the TTSR resume gate. */
	#resolveTtsrResume(): void {
		if (!this.#ttsrResumeResolve) return;
		this.#ttsrResumeResolve();
		this.#ttsrResumeResolve = undefined;
		this.#ttsrResumePromise = undefined;
	}

	#ensurePostPromptTasksPromise(): void {
		if (this.#postPromptTasksPromise) return;
		const { promise, resolve } = Promise.withResolvers<void>();
		this.#postPromptTasksPromise = promise;
		this.#postPromptTasksResolve = resolve;
	}

	#resolvePostPromptTasks(): void {
		if (!this.#postPromptTasksResolve) return;
		this.#postPromptTasksResolve();
		this.#postPromptTasksResolve = undefined;
		this.#postPromptTasksPromise = undefined;
	}

	#trackPostPromptTask(task: Promise<void>): void {
		const taskId = ++this.#postPromptTaskCounter;
		this.#postPromptTaskIds.add(taskId);
		this.#ensurePostPromptTasksPromise();
		void task
			.catch(() => {})
			.finally(() => {
				this.#postPromptTaskIds.delete(taskId);
				if (this.#postPromptTaskIds.size === 0) {
					this.#resolvePostPromptTasks();
				}
			});
	}

	#schedulePostPromptTask(
		task: (signal: AbortSignal) => Promise<void>,
		options?: { delayMs?: number; generation?: number; onSkip?: () => void },
	): void {
		const delayMs = options?.delayMs ?? 0;
		const signal = this.#postPromptTasksAbortController.signal;
		const scheduled = (async () => {
			if (delayMs > 0) {
				try {
					await abortableSleep(delayMs, signal);
				} catch {
					return;
				}
			}
			if (signal.aborted) {
				options?.onSkip?.();
				return;
			}
			if (options?.generation !== undefined && this.#promptGeneration !== options.generation) {
				options.onSkip?.();
				return;
			}
			await task(signal);
		})();
		this.#trackPostPromptTask(scheduled);
	}

	#scheduleAgentContinue(options?: {
		delayMs?: number;
		generation?: number;
		shouldContinue?: () => boolean;
		onSkip?: () => void;
		onError?: () => void;
	}): void {
		this.#schedulePostPromptTask(
			async () => {
				if (options?.shouldContinue && !options.shouldContinue()) {
					options.onSkip?.();
					return;
				}
				try {
					await this.agent.continue();
				} catch {
					options?.onError?.();
				}
			},
			{
				delayMs: options?.delayMs,
				generation: options?.generation,
				onSkip: options?.onSkip,
			},
		);
	}

	#cancelPostPromptTasks(): void {
		this.#postPromptTasksAbortController.abort();
		this.#postPromptTasksAbortController = new AbortController();
		this.#postPromptTaskIds.clear();
		this.#resolvePostPromptTasks();
	}
	/**
	 * Wait for retry, TTSR resume, and any background continuation to settle.
	 * Loops because a TTSR continuation can trigger a retry (or vice-versa),
	 * and fire-and-forget `agent.continue()` may still be streaming after
	 * the TTSR resume gate resolves.
	 */
	async #waitForPostPromptRecovery(): Promise<void> {
		while (true) {
			if (this.#retryPromise) {
				await this.#retryPromise;
				continue;
			}
			if (this.#ttsrResumePromise) {
				await this.#ttsrResumePromise;
				continue;
			}
			if (this.#postPromptTasksPromise) {
				await this.#postPromptTasksPromise;
				continue;
			}
			// Tracked post-prompt tasks cover deferred continuations scheduled from
			// event handlers. Keep the streaming fallback for direct agent activity
			// outside the scheduler.
			if (this.agent.state.isStreaming) {
				await this.agent.waitForIdle();
				continue;
			}
			break;
		}
	}

	/** Get TTSR injection payload and clear pending injections. */
	#getTtsrInjectionContent(): { content: string; rules: Rule[] } | undefined {
		if (this.#pendingTtsrInjections.length === 0) return undefined;
		const rules = this.#pendingTtsrInjections;
		const content = rules
			.map(r => renderPromptTemplate(ttsrInterruptTemplate, { name: r.name, path: r.path, content: r.content }))
			.join("\n\n");
		this.#pendingTtsrInjections = [];
		return { content, rules };
	}

	#addPendingTtsrInjections(rules: Rule[]): void {
		const seen = new Set(this.#pendingTtsrInjections.map(rule => rule.name));
		for (const rule of rules) {
			if (seen.has(rule.name)) continue;
			this.#pendingTtsrInjections.push(rule);
			seen.add(rule.name);
		}
	}

	#extractTtsrRuleNames(details: unknown): string[] {
		if (!details || typeof details !== "object" || Array.isArray(details)) {
			return [];
		}
		const rules = (details as { rules?: unknown }).rules;
		if (!Array.isArray(rules)) {
			return [];
		}
		return rules.filter((ruleName): ruleName is string => typeof ruleName === "string");
	}

	#markTtsrInjected(ruleNames: string[]): void {
		const uniqueRuleNames = Array.from(
			new Set(ruleNames.map(ruleName => ruleName.trim()).filter(ruleName => ruleName.length > 0)),
		);
		if (uniqueRuleNames.length === 0) {
			return;
		}
		this.#ttsrManager?.markInjectedByNames(uniqueRuleNames);
		this.sessionManager.appendTtsrInjection(uniqueRuleNames);
	}

	#findTtsrAssistantIndex(targetTimestamp: number | undefined): number {
		const messages = this.agent.state.messages;
		for (let i = messages.length - 1; i >= 0; i--) {
			const message = messages[i];
			if (message.role !== "assistant") {
				continue;
			}
			if (targetTimestamp === undefined || message.timestamp === targetTimestamp) {
				return i;
			}
		}
		return -1;
	}

	#shouldInterruptForTtsrMatch(matchContext: TtsrMatchContext): boolean {
		const mode = this.#ttsrManager?.getSettings().interruptMode ?? "always";
		if (mode === "never") {
			return false;
		}
		if (mode === "prose-only") {
			return matchContext.source === "text" || matchContext.source === "thinking";
		}
		if (mode === "tool-only") {
			return matchContext.source === "tool";
		}
		return true;
	}

	#queueDeferredTtsrInjectionIfNeeded(assistantMsg: AssistantMessage): void {
		if (this.#ttsrAbortPending || this.#pendingTtsrInjections.length === 0) {
			return;
		}
		if (assistantMsg.stopReason === "aborted" || assistantMsg.stopReason === "error") {
			this.#pendingTtsrInjections = [];
			return;
		}

		const injection = this.#getTtsrInjectionContent();
		if (!injection) {
			return;
		}
		this.agent.followUp({
			role: "custom",
			customType: "ttsr-injection",
			content: injection.content,
			display: false,
			details: { rules: injection.rules.map(rule => rule.name) },
			timestamp: Date.now(),
		});
		this.#ensureTtsrResumePromise();
		// Mark as injected after this custom message is delivered and persisted (handled in message_end).
		// followUp() only enqueues; resume on the next tick once streaming settles.
		this.#scheduleAgentContinue({
			delayMs: 1,
			generation: this.#promptGeneration,
			onSkip: () => {
				this.#resolveTtsrResume();
			},
			shouldContinue: () => {
				if (this.agent.state.isStreaming || !this.agent.hasQueuedMessages()) {
					this.#resolveTtsrResume();
					return false;
				}
				return true;
			},
			onError: () => {
				this.#resolveTtsrResume();
			},
		});
	}

	/** Build TTSR match context for tool call argument deltas. */
	#getTtsrToolMatchContext(message: AgentMessage, contentIndex: number): TtsrMatchContext {
		const context: TtsrMatchContext = { source: "tool" };
		if (message.role !== "assistant") {
			return context;
		}

		const content = message.content;
		if (!Array.isArray(content) || contentIndex < 0 || contentIndex >= content.length) {
			return context;
		}

		const block = content[contentIndex];
		if (!block || typeof block !== "object" || block.type !== "toolCall") {
			return context;
		}

		const toolCall = block as ToolCall;
		context.toolName = toolCall.name;
		context.streamKey = toolCall.id ? `toolcall:${toolCall.id}` : `tool:${toolCall.name}:${contentIndex}`;
		context.filePaths = this.#extractTtsrFilePathsFromArgs(toolCall.arguments);
		return context;
	}

	/** Extract path-like arguments from tool call payload for TTSR glob matching. */
	#extractTtsrFilePathsFromArgs(args: unknown): string[] | undefined {
		if (!args || typeof args !== "object" || Array.isArray(args)) {
			return undefined;
		}

		const rawPaths: string[] = [];
		for (const [key, value] of Object.entries(args)) {
			const normalizedKey = key.toLowerCase();
			if (typeof value === "string" && (normalizedKey === "path" || normalizedKey.endsWith("path"))) {
				rawPaths.push(value);
				continue;
			}
			if (Array.isArray(value) && (normalizedKey === "paths" || normalizedKey.endsWith("paths"))) {
				for (const candidate of value) {
					if (typeof candidate === "string") {
						rawPaths.push(candidate);
					}
				}
			}
		}

		const normalizedPaths = rawPaths.flatMap(pathValue => this.#normalizeTtsrPathCandidates(pathValue));
		if (normalizedPaths.length === 0) {
			return undefined;
		}

		return Array.from(new Set(normalizedPaths));
	}

	/** Convert a path argument into stable relative/absolute candidates for glob checks. */
	#normalizeTtsrPathCandidates(rawPath: string): string[] {
		const trimmed = rawPath.trim();
		if (trimmed.length === 0) {
			return [];
		}

		const normalizedInput = trimmed.replaceAll("\\", "/");
		const candidates = new Set<string>([normalizedInput]);
		if (normalizedInput.startsWith("./")) {
			candidates.add(normalizedInput.slice(2));
		}

		const cwd = this.sessionManager.getCwd();
		const absolutePath = path.isAbsolute(trimmed) ? path.normalize(trimmed) : path.resolve(cwd, trimmed);
		candidates.add(absolutePath.replaceAll("\\", "/"));

		const relativePath = path.relative(cwd, absolutePath).replaceAll("\\", "/");
		if (relativePath && relativePath !== "." && !relativePath.startsWith("../") && relativePath !== "..") {
			candidates.add(relativePath);
		}

		return Array.from(candidates);
	}
	/** Extract text content from a message */
	#getUserMessageText(message: Message): string {
		if (message.role !== "user") return "";
		const content = message.content;
		if (typeof content === "string") return content;
		const textBlocks = content.filter(c => c.type === "text");
		const text = textBlocks.map(c => (c as TextContent).text).join("");
		if (text.length > 0) return text;
		const hasImages = content.some(c => c.type === "image");
		return hasImages ? "[Image]" : "";
	}

	/** Find the last assistant message in agent state (including aborted ones) */
	#findLastAssistantMessage(): AssistantMessage | undefined {
		const messages = this.agent.state.messages;
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i];
			if (msg.role === "assistant") {
				return msg as AssistantMessage;
			}
		}
		return undefined;
	}

	#resetStreamingEditState(): void {
		this.#streamingEditAbortTriggered = false;
		this.#streamingEditCheckedLineCounts.clear();
		this.#streamingEditFileCache.clear();
	}

	async #preCacheStreamingEditFile(event: AgentEvent): Promise<void> {
		if (!this.settings.get("edit.streamingAbort")) return;
		if (event.type !== "message_update") return;
		const assistantEvent = event.assistantMessageEvent;
		if (assistantEvent.type !== "toolcall_start") return;
		if (event.message.role !== "assistant") return;

		const contentIndex = assistantEvent.contentIndex;
		const messageContent = event.message.content;
		if (!Array.isArray(messageContent) || contentIndex >= messageContent.length) return;
		const toolCall = messageContent[contentIndex] as ToolCall;
		if (toolCall.name !== "edit") return;

		const args = toolCall.arguments;
		if (!args || typeof args !== "object" || Array.isArray(args)) return;
		if ("old_text" in args || "new_text" in args) return;

		const path = typeof args.path === "string" ? args.path : undefined;
		if (!path) return;

		const resolvedPath = resolveToCwd(path, this.sessionManager.getCwd());
		this.#ensureFileCache(resolvedPath);
	}

	#ensureFileCache(resolvedPath: string): void {
		if (this.#streamingEditFileCache.has(resolvedPath)) return;

		try {
			const rawText = fs.readFileSync(resolvedPath, "utf-8");
			const { text } = stripBom(rawText);
			this.#streamingEditFileCache.set(resolvedPath, normalizeToLF(text));
		} catch {
			// Don't cache on read errors (including ENOENT) - let the edit tool handle them
		}
	}

	/** Invalidate cache for a file after an edit completes to prevent stale data */
	#invalidateFileCacheForPath(path: string): void {
		const resolvedPath = resolveToCwd(path, this.sessionManager.getCwd());
		this.#streamingEditFileCache.delete(resolvedPath);
	}

	#maybeAbortStreamingEdit(event: AgentEvent): void {
		if (!this.settings.get("edit.streamingAbort")) return;
		if (this.#streamingEditAbortTriggered) return;
		if (event.type !== "message_update") return;
		const assistantEvent = event.assistantMessageEvent;
		if (assistantEvent.type !== "toolcall_end" && assistantEvent.type !== "toolcall_delta") return;
		if (event.message.role !== "assistant") return;

		const contentIndex = assistantEvent.contentIndex;
		const messageContent = event.message.content;
		if (!Array.isArray(messageContent) || contentIndex >= messageContent.length) return;
		const toolCall = messageContent[contentIndex] as ToolCall;
		if (toolCall.name !== "edit" || !toolCall.id) return;

		const args = toolCall.arguments;
		if (!args || typeof args !== "object" || Array.isArray(args)) return;
		if ("old_text" in args || "new_text" in args) return;

		const path = typeof args.path === "string" ? args.path : undefined;
		const diff = typeof args.diff === "string" ? args.diff : undefined;
		const op = typeof args.op === "string" ? args.op : undefined;
		if (!path || !diff) return;
		if (op && op !== "update") return;

		if (!diff.includes("\n")) return;
		const lastNewlineIndex = diff.lastIndexOf("\n");
		if (lastNewlineIndex < 0) return;
		const diffForCheck = diff.endsWith("\n") ? diff : diff.slice(0, lastNewlineIndex + 1);
		if (diffForCheck.trim().length === 0) return;

		let normalizedDiff = normalizeDiff(diffForCheck.replace(/\r/g, ""));
		if (!normalizedDiff) return;
		// Deobfuscate the diff so removed lines match real file content
		if (this.#obfuscator) normalizedDiff = this.#obfuscator.deobfuscate(normalizedDiff);
		if (!normalizedDiff) return;
		const lines = normalizedDiff.split("\n");
		const hasChangeLine = lines.some(line => line.startsWith("+") || line.startsWith("-"));
		if (!hasChangeLine) return;

		const lineCount = lines.length;
		const lastChecked = this.#streamingEditCheckedLineCounts.get(toolCall.id);
		if (lastChecked !== undefined && lineCount <= lastChecked) return;
		this.#streamingEditCheckedLineCounts.set(toolCall.id, lineCount);

		const rename = typeof args.rename === "string" ? args.rename : undefined;

		const removedLines = lines
			.filter(line => line.startsWith("-") && !line.startsWith("--- "))
			.map(line => line.slice(1));
		if (removedLines.length > 0) {
			const resolvedPath = resolveToCwd(path, this.sessionManager.getCwd());
			let cachedContent = this.#streamingEditFileCache.get(resolvedPath);
			if (cachedContent === undefined) {
				this.#ensureFileCache(resolvedPath);
				cachedContent = this.#streamingEditFileCache.get(resolvedPath);
			}
			if (cachedContent !== undefined) {
				const missing = removedLines.find(line => !cachedContent.includes(normalizeToLF(line)));
				if (missing) {
					this.#streamingEditAbortTriggered = true;
					logger.warn("Streaming edit aborted due to patch preview failure", {
						toolCallId: toolCall.id,
						path,
						error: `Failed to find expected lines in ${path}:\n${missing}`,
					});
					this.agent.abort();
				}
				return;
			}
			if (assistantEvent.type === "toolcall_delta") return;
			void this.#checkRemovedLinesAsync(toolCall.id, path, resolvedPath, removedLines);
			return;
		}

		if (assistantEvent.type === "toolcall_delta") return;
		void this.#checkPreviewPatchAsync(toolCall.id, path, rename, normalizedDiff);
	}

	async #checkRemovedLinesAsync(
		toolCallId: string,
		path: string,
		resolvedPath: string,
		removedLines: string[],
	): Promise<void> {
		if (this.#streamingEditAbortTriggered) return;
		try {
			const { text } = stripBom(await Bun.file(resolvedPath).text());
			const normalizedContent = normalizeToLF(text);
			const missing = removedLines.find(line => !normalizedContent.includes(normalizeToLF(line)));
			if (missing) {
				this.#streamingEditAbortTriggered = true;
				logger.warn("Streaming edit aborted due to patch preview failure", {
					toolCallId,
					path,
					error: `Failed to find expected lines in ${path}:\n${missing}`,
				});
				this.agent.abort();
			}
		} catch (err) {
			// Ignore ENOENT (file not found) - let the edit tool handle missing files
			// Also ignore other errors during async fallback
			if (!isEnoent(err)) {
				// Log unexpected errors but don't abort
			}
		}
	}

	async #checkPreviewPatchAsync(
		toolCallId: string,
		path: string,
		rename: string | undefined,
		normalizedDiff: string,
	): Promise<void> {
		if (this.#streamingEditAbortTriggered) return;
		try {
			await previewPatch(
				{ path, op: "update", rename, diff: normalizedDiff },
				{
					cwd: this.sessionManager.getCwd(),
					allowFuzzy: this.settings.get("edit.fuzzyMatch"),
					fuzzyThreshold: this.settings.get("edit.fuzzyThreshold"),
				},
			);
		} catch (error) {
			if (error instanceof ParseError) return;
			this.#streamingEditAbortTriggered = true;
			logger.warn("Streaming edit aborted due to patch preview failure", {
				toolCallId,
				path,
				error: error instanceof Error ? error.message : String(error),
			});
			this.agent.abort();
		}
	}

	/** Emit extension events based on session events */
	async #emitExtensionEvent(event: AgentSessionEvent): Promise<void> {
		if (!this.#extensionRunner) return;
		if (event.type === "agent_start") {
			this.#turnIndex = 0;
			await this.#extensionRunner.emit({ type: "agent_start" });
		} else if (event.type === "agent_end") {
			await this.#extensionRunner.emit({ type: "agent_end", messages: event.messages });
		} else if (event.type === "turn_start") {
			const hookEvent: TurnStartEvent = {
				type: "turn_start",
				turnIndex: this.#turnIndex,
				timestamp: Date.now(),
			};
			await this.#extensionRunner.emit(hookEvent);
		} else if (event.type === "turn_end") {
			const hookEvent: TurnEndEvent = {
				type: "turn_end",
				turnIndex: this.#turnIndex,
				message: event.message,
				toolResults: event.toolResults,
			};
			await this.#extensionRunner.emit(hookEvent);
			this.#turnIndex++;
		} else if (event.type === "message_start") {
			const extensionEvent: MessageStartEvent = {
				type: "message_start",
				message: event.message,
			};
			await this.#extensionRunner.emit(extensionEvent);
		} else if (event.type === "message_update") {
			const extensionEvent: MessageUpdateEvent = {
				type: "message_update",
				message: event.message,
				assistantMessageEvent: event.assistantMessageEvent,
			};
			await this.#extensionRunner.emit(extensionEvent);
		} else if (event.type === "message_end") {
			const extensionEvent: MessageEndEvent = {
				type: "message_end",
				message: event.message,
			};
			await this.#extensionRunner.emit(extensionEvent);
		} else if (event.type === "tool_execution_start") {
			const extensionEvent: ToolExecutionStartEvent = {
				type: "tool_execution_start",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				args: event.args,
				intent: event.intent,
			};
			await this.#extensionRunner.emit(extensionEvent);
		} else if (event.type === "tool_execution_update") {
			const extensionEvent: ToolExecutionUpdateEvent = {
				type: "tool_execution_update",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				args: event.args,
				partialResult: event.partialResult,
			};
			await this.#extensionRunner.emit(extensionEvent);
		} else if (event.type === "tool_execution_end") {
			const extensionEvent: ToolExecutionEndEvent = {
				type: "tool_execution_end",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				result: event.result,
				isError: event.isError ?? false,
			};
			await this.#extensionRunner.emit(extensionEvent);
		} else if (event.type === "auto_compaction_start") {
			await this.#extensionRunner.emit({ type: "auto_compaction_start", reason: event.reason });
		} else if (event.type === "auto_compaction_end") {
			await this.#extensionRunner.emit({
				type: "auto_compaction_end",
				result: event.result,
				aborted: event.aborted,
				willRetry: event.willRetry,
				errorMessage: event.errorMessage,
			});
		} else if (event.type === "auto_retry_start") {
			await this.#extensionRunner.emit({
				type: "auto_retry_start",
				attempt: event.attempt,
				maxAttempts: event.maxAttempts,
				delayMs: event.delayMs,
				errorMessage: event.errorMessage,
			});
		} else if (event.type === "auto_retry_end") {
			await this.#extensionRunner.emit({
				type: "auto_retry_end",
				success: event.success,
				attempt: event.attempt,
				finalError: event.finalError,
			});
		} else if (event.type === "ttsr_triggered") {
			await this.#extensionRunner.emit({ type: "ttsr_triggered", rules: event.rules });
		} else if (event.type === "todo_reminder") {
			await this.#extensionRunner.emit({
				type: "todo_reminder",
				todos: event.todos,
				attempt: event.attempt,
				maxAttempts: event.maxAttempts,
			});
		}
	}

	/**
	 * Subscribe to agent events.
	 * Session persistence is handled internally (saves messages on message_end).
	 * Multiple listeners can be added. Returns unsubscribe function for this listener.
	 */
	subscribe(listener: AgentSessionEventListener): () => void {
		this.#eventListeners.push(listener);

		// Return unsubscribe function for this specific listener
		return () => {
			const index = this.#eventListeners.indexOf(listener);
			if (index !== -1) {
				this.#eventListeners.splice(index, 1);
			}
		};
	}

	/**
	 * Temporarily disconnect from agent events.
	 * User listeners are preserved and will receive events again after resubscribe().
	 * Used internally during operations that need to pause event processing.
	 */
	#disconnectFromAgent(): void {
		if (this.#unsubscribeAgent) {
			this.#unsubscribeAgent();
			this.#unsubscribeAgent = undefined;
		}
	}

	/**
	 * Reconnect to agent events after _disconnectFromAgent().
	 * Preserves all existing listeners.
	 */
	#reconnectToAgent(): void {
		if (this.#unsubscribeAgent) return; // Already connected
		this.#unsubscribeAgent = this.agent.subscribe(this.#handleAgentEvent);
	}

	/**
	 * Remove all listeners, flush pending writes, and disconnect from agent.
	 * Call this when completely done with the session.
	 */
	async dispose(): Promise<void> {
		try {
			if (this.#extensionRunner?.hasHandlers("session_shutdown")) {
				await this.#extensionRunner.emit({ type: "session_shutdown" });
			}
		} catch (error) {
			logger.warn("Failed to emit session_shutdown event", { error: String(error) });
		}
		this.#cancelPostPromptTasks();
		const drained = await this.#asyncJobManager?.dispose({ timeoutMs: 3_000 });
		const deliveryState = this.#asyncJobManager?.getDeliveryState();
		if (drained === false && deliveryState) {
			logger.warn("Async job completion deliveries still pending during dispose", { ...deliveryState });
		}
		await this.sessionManager.flush();
		for (const state of this.#providerSessionState.values()) {
			state.close();
		}
		this.#providerSessionState.clear();
		this.#disconnectFromAgent();
		this.#eventListeners = [];
	}

	// =========================================================================
	// Read-only State Access
	// =========================================================================

	/** Full agent state */
	get state(): AgentState {
		return this.agent.state;
	}

	/** Current model (may be undefined if not yet selected) */
	get model(): Model | undefined {
		return this.agent.state.model;
	}

	#applySessionModelOverrides(model: Model): Model {
		if (!this.#forceCopilotAgentInitiator || model.provider !== "github-copilot") {
			return model;
		}
		return {
			...model,
			headers: {
				...model.headers,
				"X-Initiator": "agent",
			},
		};
	}

	/** Current thinking level */
	get thinkingLevel(): ThinkingLevel {
		return this.agent.state.thinkingLevel;
	}

	/** Whether agent is currently streaming a response */
	get isStreaming(): boolean {
		return this.agent.state.isStreaming || this.#promptInFlight;
	}

	/** Wait until streaming and deferred recovery work are fully settled. */
	async waitForIdle(): Promise<void> {
		await this.agent.waitForIdle();
		await this.#waitForPostPromptRecovery();
	}

	/** Most recent assistant message in agent state. */
	getLastAssistantMessage(): AssistantMessage | undefined {
		return this.#findLastAssistantMessage();
	}
	/** Current effective system prompt (includes any per-turn extension modifications) */
	get systemPrompt(): string {
		return this.agent.state.systemPrompt;
	}

	/** Current retry attempt (0 if not retrying) */
	get retryAttempt(): number {
		return this.#retryAttempt;
	}

	/**
	 * Get the names of currently active tools.
	 * Returns the names of tools currently set on the agent.
	 */
	getActiveToolNames(): string[] {
		return this.agent.state.tools.map(t => t.name);
	}

	/** Whether the edit tool is registered in this session. */
	get hasEditTool(): boolean {
		return this.#toolRegistry.has("edit");
	}

	/**
	 * Get a tool by name from the registry.
	 */
	getToolByName(name: string): AgentTool | undefined {
		return this.#toolRegistry.get(name);
	}

	/**
	 * Get all configured tool names (built-in via --tools or default, plus custom tools).
	 */
	getAllToolNames(): string[] {
		return Array.from(this.#toolRegistry.keys());
	}

	/**
	 * Set active tools by name.
	 * Only tools in the registry can be enabled. Unknown tool names are ignored.
	 * Also rebuilds the system prompt to reflect the new tool set.
	 * Changes take effect on the next agent turn.
	 */
	async setActiveToolsByName(toolNames: string[]): Promise<void> {
		const tools: AgentTool[] = [];
		const validToolNames: string[] = [];
		for (const name of toolNames) {
			const tool = this.#toolRegistry.get(name);
			if (tool) {
				tools.push(tool);
				validToolNames.push(name);
			}
		}
		this.agent.setTools(tools);

		// Rebuild base system prompt with new tool set
		if (this.#rebuildSystemPrompt) {
			this.#baseSystemPrompt = await this.#rebuildSystemPrompt(validToolNames, this.#toolRegistry);
			this.agent.setSystemPrompt(this.#baseSystemPrompt);
		}
	}

	/** Rebuild the base system prompt using the current active tool set. */
	async refreshBaseSystemPrompt(): Promise<void> {
		if (!this.#rebuildSystemPrompt) return;
		const activeToolNames = this.getActiveToolNames();
		this.#baseSystemPrompt = await this.#rebuildSystemPrompt(activeToolNames, this.#toolRegistry);
		this.agent.setSystemPrompt(this.#baseSystemPrompt);
	}

	/**
	 * Replace MCP tools in the registry and activate the latest MCP tool set immediately.
	 * This allows /mcp add/remove/reauth to take effect without restarting the session.
	 */
	async refreshMCPTools(mcpTools: CustomTool[]): Promise<void> {
		const prefix = "mcp_";
		const existingNames = Array.from(this.#toolRegistry.keys());
		for (const name of existingNames) {
			if (name.startsWith(prefix)) {
				this.#toolRegistry.delete(name);
			}
		}

		const getCustomToolContext = (): CustomToolContext => ({
			sessionManager: this.sessionManager,
			modelRegistry: this.#modelRegistry,
			model: this.model,
			isIdle: () => !this.isStreaming,
			hasQueuedMessages: () => this.queuedMessageCount > 0,
			abort: () => {
				this.agent.abort();
			},
		});

		for (const customTool of mcpTools) {
			const wrapped = CustomToolAdapter.wrap(customTool, getCustomToolContext) as AgentTool;
			const finalTool = (
				this.#extensionRunner ? new ExtensionToolWrapper(wrapped, this.#extensionRunner) : wrapped
			) as AgentTool;
			this.#toolRegistry.set(finalTool.name, finalTool);
		}

		const currentActive = this.getActiveToolNames().filter(
			name => !name.startsWith(prefix) && this.#toolRegistry.has(name),
		);
		const mcpToolNames = Array.from(this.#toolRegistry.keys()).filter(name => name.startsWith(prefix));
		const nextActive = [...currentActive];
		for (const name of mcpToolNames) {
			if (!nextActive.includes(name)) {
				nextActive.push(name);
			}
		}

		await this.setActiveToolsByName(nextActive);
	}

	/** Whether auto-compaction is currently running */
	get isCompacting(): boolean {
		return this.#autoCompactionAbortController !== undefined || this.#compactionAbortController !== undefined;
	}

	/** All messages including custom types like BashExecutionMessage */
	get messages(): AgentMessage[] {
		return this.agent.state.messages;
	}

	/** Current steering mode */
	get steeringMode(): "all" | "one-at-a-time" {
		return this.agent.getSteeringMode();
	}

	/** Current follow-up mode */
	get followUpMode(): "all" | "one-at-a-time" {
		return this.agent.getFollowUpMode();
	}

	/** Current interrupt mode */
	get interruptMode(): "immediate" | "wait" {
		return this.agent.getInterruptMode();
	}

	/** Current session file path, or undefined if sessions are disabled */
	get sessionFile(): string | undefined {
		return this.sessionManager.getSessionFile();
	}

	/** Current session ID */
	get sessionId(): string {
		return this.sessionManager.getSessionId();
	}

	/** Current session display name, if set */
	get sessionName(): string | undefined {
		return this.sessionManager.getSessionName();
	}

	/** Scoped models for cycling (from --models flag) */
	get scopedModels(): ReadonlyArray<{ model: Model; thinkingLevel: ThinkingLevel }> {
		return this.#scopedModels;
	}

	/** Prompt templates */
	getPlanModeState(): PlanModeState | undefined {
		return this.#planModeState;
	}

	setPlanModeState(state: PlanModeState | undefined): void {
		this.#planModeState = state;
		if (state?.enabled) {
			this.#planReferenceSent = false;
			this.#planReferencePath = state.planFilePath;
		}
	}

	markPlanReferenceSent(): void {
		this.#planReferenceSent = true;
	}

	setPlanReferencePath(path: string): void {
		this.#planReferencePath = path;
	}

	/**
	 * Inject the plan mode context message into the conversation history.
	 */
	async sendPlanModeContext(options?: { deliverAs?: "steer" | "followUp" | "nextTurn" }): Promise<void> {
		const message = await this.#buildPlanModeMessage();
		if (!message) return;
		await this.sendCustomMessage(
			{
				customType: message.customType,
				content: message.content,
				display: message.display,
				details: message.details,
			},
			options ? { deliverAs: options.deliverAs } : undefined,
		);
	}

	resolveRoleModel(role: ModelRole): Model | undefined {
		return this.#resolveRoleModel(role, this.#modelRegistry.getAvailable(), this.model);
	}

	get promptTemplates(): ReadonlyArray<PromptTemplate> {
		return this.#promptTemplates;
	}

	/** Replace file-based slash commands used for prompt expansion. */
	setSlashCommands(slashCommands: FileSlashCommand[]): void {
		this.#slashCommands = [...slashCommands];
	}

	/** Custom commands (TypeScript slash commands) */
	get customCommands(): ReadonlyArray<LoadedCustomCommand> {
		return this.#customCommands;
	}

	// =========================================================================
	// Prompting
	// =========================================================================

	/**
	 * Build a plan mode message.
	 * Returns null if plan mode is not enabled.
	 * @returns The plan mode message, or null if plan mode is not enabled.
	 */
	async #buildPlanReferenceMessage(): Promise<CustomMessage | null> {
		if (this.#planModeState?.enabled) return null;
		if (this.#planReferenceSent) return null;

		const planFilePath = this.#planReferencePath;
		const resolvedPlanPath = resolveLocalUrlToPath(planFilePath, {
			getArtifactsDir: () => this.sessionManager.getArtifactsDir(),
			getSessionId: () => this.sessionManager.getSessionId(),
		});
		let planContent: string;
		try {
			planContent = await Bun.file(resolvedPlanPath).text();
		} catch (error) {
			if (isEnoent(error)) {
				return null;
			}
			throw error;
		}

		const content = renderPromptTemplate(planModeReferencePrompt, {
			planFilePath,
			planContent,
		});

		this.#planReferenceSent = true;

		return {
			role: "custom",
			customType: "plan-mode-reference",
			content,
			display: false,
			timestamp: Date.now(),
		};
	}

	async #buildPlanModeMessage(): Promise<CustomMessage | null> {
		const state = this.#planModeState;
		if (!state?.enabled) return null;
		const sessionPlanUrl = "local://PLAN.md";
		const resolvedPlanPath = state.planFilePath.startsWith("local://")
			? resolveLocalUrlToPath(state.planFilePath, {
					getArtifactsDir: () => this.sessionManager.getArtifactsDir(),
					getSessionId: () => this.sessionManager.getSessionId(),
				})
			: resolveToCwd(state.planFilePath, this.sessionManager.getCwd());
		const resolvedSessionPlan = resolveLocalUrlToPath(sessionPlanUrl, {
			getArtifactsDir: () => this.sessionManager.getArtifactsDir(),
			getSessionId: () => this.sessionManager.getSessionId(),
		});
		const displayPlanPath =
			state.planFilePath.startsWith("local://") || resolvedPlanPath !== resolvedSessionPlan
				? state.planFilePath
				: sessionPlanUrl;

		const planExists = fs.existsSync(resolvedPlanPath);
		const content = renderPromptTemplate(planModeActivePrompt, {
			planFilePath: displayPlanPath,
			planExists,
			askToolName: "ask",
			writeToolName: "write",
			editToolName: "edit",
			exitToolName: "exit_plan_mode",
			reentry: state.reentry ?? false,
			iterative: state.workflow === "iterative",
		});

		return {
			role: "custom",
			customType: "plan-mode-context",
			content,
			display: false,
			timestamp: Date.now(),
		};
	}

	/**
	 * Send a prompt to the agent.
	 * - Handles extension commands (registered via pi.registerCommand) immediately, even during streaming
	 * - Expands file-based prompt templates by default
	 * - During streaming, queues via steer() or followUp() based on streamingBehavior option
	 * - Validates model and API key before sending (when not streaming)
	 * @throws Error if streaming and no streamingBehavior specified
	 * @throws Error if no model selected or no API key available (when not streaming)
	 */
	async prompt(text: string, options?: PromptOptions): Promise<void> {
		const expandPromptTemplates = options?.expandPromptTemplates ?? true;

		// Handle extension commands first (execute immediately, even during streaming)
		if (expandPromptTemplates && text.startsWith("/")) {
			const handled = await this.#tryExecuteExtensionCommand(text);
			if (handled) {
				return;
			}

			// Try custom commands (TypeScript slash commands)
			const customResult = await this.#tryExecuteCustomCommand(text);
			if (customResult !== null) {
				if (customResult === "") {
					return;
				}
				text = customResult;
			}

			// Try file-based slash commands (markdown files from commands/ directories)
			// Only if text still starts with "/" (wasn't transformed by custom command)
			if (text.startsWith("/")) {
				text = expandSlashCommand(text, this.#slashCommands);
			}
		}

		// Expand file-based prompt templates if requested
		const expandedText = expandPromptTemplates ? expandPromptTemplate(text, [...this.#promptTemplates]) : text;

		// If streaming, queue via steer() or followUp() based on option
		if (this.isStreaming) {
			if (!options?.streamingBehavior) {
				throw new AgentBusyError();
			}
			if (options.streamingBehavior === "followUp") {
				await this.#queueFollowUp(expandedText, options?.images);
			} else {
				await this.#queueSteer(expandedText, options?.images);
			}
			return;
		}

		const userContent: (TextContent | ImageContent)[] = [{ type: "text", text: expandedText }];
		if (options?.images) {
			userContent.push(...options.images);
		}

		const message = options?.synthetic
			? { role: "developer" as const, content: userContent, timestamp: Date.now() }
			: { role: "user" as const, content: userContent, timestamp: Date.now() };

		await this.#promptWithMessage(message, expandedText, options);
	}

	async promptCustomMessage<T = unknown>(
		message: Pick<CustomMessage<T>, "customType" | "content" | "display" | "details">,
		options?: Pick<PromptOptions, "streamingBehavior" | "toolChoice">,
	): Promise<void> {
		const textContent =
			typeof message.content === "string"
				? message.content
				: message.content
						.filter((content): content is TextContent => content.type === "text")
						.map(content => content.text)
						.join("");

		if (this.isStreaming) {
			if (!options?.streamingBehavior) {
				throw new AgentBusyError();
			}
			await this.sendCustomMessage(message, { deliverAs: options.streamingBehavior });
			return;
		}

		const customMessage: CustomMessage<T> = {
			role: "custom",
			customType: message.customType,
			content: message.content,
			display: message.display,
			details: message.details,
			timestamp: Date.now(),
		};

		await this.#promptWithMessage(customMessage, textContent, options);
	}

	async #promptWithMessage(
		message: AgentMessage,
		expandedText: string,
		options?: Pick<PromptOptions, "toolChoice" | "images"> & { skipPostPromptRecoveryWait?: boolean },
	): Promise<void> {
		this.#promptInFlight = true;
		const generation = this.#promptGeneration;
		try {
			// Flush any pending bash messages before the new prompt
			this.#flushPendingBashMessages();
			this.#flushPendingPythonMessages();

			// Reset todo reminder count on new user prompt
			this.#todoReminderCount = 0;

			// Validate model
			if (!this.model) {
				throw new Error(
					"No model selected.\n\n" +
						`Use /login, set an API key environment variable, or create ${getAgentDbPath()}\n\n` +
						"Then use /model to select a model.",
				);
			}

			// Validate API key
			const apiKey = await this.#modelRegistry.getApiKey(this.model, this.sessionId);
			if (!apiKey) {
				throw new Error(
					`No API key found for ${this.model.provider}.\n\n` +
						`Use /login, set an API key environment variable, or create ${getAgentDbPath()}`,
				);
			}

			// Check if we need to compact before sending (catches aborted responses)
			const lastAssistant = this.#findLastAssistantMessage();
			if (lastAssistant) {
				await this.#checkCompaction(lastAssistant, false);
			}

			// Build messages array (custom messages if any, then user message)
			const messages: AgentMessage[] = [];
			const planReferenceMessage = await this.#buildPlanReferenceMessage?.();
			if (planReferenceMessage) {
				messages.push(planReferenceMessage);
			}
			const planModeMessage = await this.#buildPlanModeMessage();
			if (planModeMessage) {
				messages.push(planModeMessage);
			}

			messages.push(message);

			// Early bail-out: if a newer abort/prompt cycle started during setup,
			// return before mutating shared state (nextTurn messages, system prompt).
			if (this.#promptGeneration !== generation) {
				return;
			}

			// Inject any pending "nextTurn" messages as context alongside the user message
			for (const msg of this.#pendingNextTurnMessages) {
				messages.push(msg);
			}
			this.#pendingNextTurnMessages = [];

			// Auto-read @filepath mentions
			const fileMentions = extractFileMentions(expandedText);
			if (fileMentions.length > 0) {
				const fileMentionMessages = await generateFileMentionMessages(fileMentions, this.sessionManager.getCwd(), {
					autoResizeImages: this.settings.get("images.autoResize"),
					useHashLines: resolveFileDisplayMode(this).hashLines,
				});
				messages.push(...fileMentionMessages);
			}

			// Emit before_agent_start extension event
			if (this.#extensionRunner) {
				const result = await this.#extensionRunner.emitBeforeAgentStart(
					expandedText,
					options?.images,
					this.#baseSystemPrompt,
				);
				if (result?.messages) {
					for (const msg of result.messages) {
						messages.push({
							role: "custom",
							customType: msg.customType,
							content: msg.content,
							display: msg.display,
							details: msg.details,
							timestamp: Date.now(),
						});
					}
				}

				if (result?.systemPrompt !== undefined) {
					this.agent.setSystemPrompt(result.systemPrompt);
				} else {
					this.agent.setSystemPrompt(this.#baseSystemPrompt);
				}
			}

			// Bail out if a newer abort/prompt cycle has started since we began setup
			if (this.#promptGeneration !== generation) {
				return;
			}

			const agentPromptOptions = options?.toolChoice ? { toolChoice: options.toolChoice } : undefined;
			await this.#promptAgentWithIdleRetry(messages, agentPromptOptions);
			if (!options?.skipPostPromptRecoveryWait) {
				await this.#waitForPostPromptRecovery();
			}
		} finally {
			this.#promptInFlight = false;
		}
	}

	/**
	 * Try to execute an extension command. Returns true if command was found and executed.
	 */
	async #tryExecuteExtensionCommand(text: string): Promise<boolean> {
		if (!this.#extensionRunner) return false;

		// Parse command name and args
		const spaceIndex = text.indexOf(" ");
		const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
		const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1);

		const command = this.#extensionRunner.getCommand(commandName);
		if (!command) return false;

		// Get command context from extension runner (includes session control methods)
		const ctx = this.#extensionRunner.createCommandContext();

		try {
			await command.handler(args, ctx);
			return true;
		} catch (err) {
			// Emit error via extension runner
			this.#extensionRunner.emitError({
				extensionPath: `command:${commandName}`,
				event: "command",
				error: err instanceof Error ? err.message : String(err),
			});
			return true;
		}
	}

	#createCommandContext(): ExtensionCommandContext {
		if (this.#extensionRunner) {
			return this.#extensionRunner.createCommandContext();
		}

		return {
			ui: noOpUIContext,
			hasUI: false,
			cwd: this.sessionManager.getCwd(),
			sessionManager: this.sessionManager,
			modelRegistry: this.#modelRegistry,
			model: this.model ?? undefined,
			isIdle: () => !this.isStreaming,
			abort: () => {
				void this.abort();
			},
			hasPendingMessages: () => this.queuedMessageCount > 0,
			shutdown: () => {
				void this.dispose();
				process.exit(0);
			},
			hasQueuedMessages: () => this.queuedMessageCount > 0,
			getContextUsage: () => this.getContextUsage(),
			waitForIdle: () => this.waitForIdle(),
			newSession: async options => {
				const success = await this.newSession({ parentSession: options?.parentSession });
				if (!success) {
					return { cancelled: true };
				}
				if (options?.setup) {
					await options.setup(this.sessionManager);
				}
				return { cancelled: false };
			},
			branch: async entryId => {
				const result = await this.branch(entryId);
				return { cancelled: result.cancelled };
			},
			navigateTree: async (targetId, options) => {
				const result = await this.navigateTree(targetId, { summarize: options?.summarize });
				return { cancelled: result.cancelled };
			},
			compact: async instructionsOrOptions => {
				const instructions = typeof instructionsOrOptions === "string" ? instructionsOrOptions : undefined;
				const options =
					instructionsOrOptions && typeof instructionsOrOptions === "object" ? instructionsOrOptions : undefined;
				await this.compact(instructions, options);
			},
			switchSession: async sessionPath => {
				const success = await this.switchSession(sessionPath);
				return { cancelled: !success };
			},
			reload: async () => {
				await this.reload();
			},
			getSystemPrompt: () => this.systemPrompt,
		};
	}

	/**
	 * Try to execute a custom command. Returns the prompt string if found, null otherwise.
	 * If the command returns void, returns empty string to indicate it was handled.
	 */
	async #tryExecuteCustomCommand(text: string): Promise<string | null> {
		if (this.#customCommands.length === 0) return null;

		// Parse command name and args
		const spaceIndex = text.indexOf(" ");
		const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
		const argsString = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1);

		// Find matching command
		const loaded = this.#customCommands.find(c => c.command.name === commandName);
		if (!loaded) return null;

		// Get command context from extension runner (includes session control methods)
		const baseCtx = this.#createCommandContext();
		const ctx = {
			...baseCtx,
			hasQueuedMessages: baseCtx.hasPendingMessages,
		} as unknown as HookCommandContext;

		try {
			const args = parseCommandArgs(argsString);
			const result = await loaded.command.execute(args, ctx);
			// If result is a string, it's a prompt to send to LLM
			// If void/undefined, command handled everything
			return result ?? "";
		} catch (err) {
			// Emit error via extension runner
			if (this.#extensionRunner) {
				this.#extensionRunner.emitError({
					extensionPath: `custom-command:${commandName}`,
					event: "command",
					error: err instanceof Error ? err.message : String(err),
				});
			} else {
				const message = err instanceof Error ? err.message : String(err);
				logger.error("Custom command failed", { commandName, error: message });
			}
			return ""; // Command was handled (with error)
		}
	}

	/**
	 * Queue a steering message to interrupt the agent mid-run.
	 */
	async steer(text: string, images?: ImageContent[]): Promise<void> {
		if (text.startsWith("/")) {
			this.#throwIfExtensionCommand(text);
		}

		const expandedText = expandPromptTemplate(text, [...this.#promptTemplates]);
		await this.#queueSteer(expandedText, images);
	}

	/**
	 * Queue a follow-up message to process after the agent would otherwise stop.
	 */
	async followUp(text: string, images?: ImageContent[]): Promise<void> {
		if (text.startsWith("/")) {
			this.#throwIfExtensionCommand(text);
		}

		const expandedText = expandPromptTemplate(text, [...this.#promptTemplates]);
		await this.#queueFollowUp(expandedText, images);
	}

	/**
	 * Internal: Queue a steering message (already expanded, no extension command check).
	 */
	async #queueSteer(text: string, images?: ImageContent[]): Promise<void> {
		const displayText = text || (images && images.length > 0 ? "[Image]" : "");
		this.#steeringMessages.push(displayText);
		const content: (TextContent | ImageContent)[] = [{ type: "text", text }];
		if (images && images.length > 0) {
			content.push(...images);
		}
		this.agent.steer({
			role: "user",
			content,
			timestamp: Date.now(),
		});
	}

	/**
	 * Internal: Queue a follow-up message (already expanded, no extension command check).
	 */
	async #queueFollowUp(text: string, images?: ImageContent[]): Promise<void> {
		const displayText = text || (images && images.length > 0 ? "[Image]" : "");
		this.#followUpMessages.push(displayText);
		const content: (TextContent | ImageContent)[] = [{ type: "text", text }];
		if (images && images.length > 0) {
			content.push(...images);
		}
		this.agent.followUp({
			role: "user",
			content,
			timestamp: Date.now(),
		});
	}

	/**
	 * Throw an error if the text is an extension command.
	 */
	#throwIfExtensionCommand(text: string): void {
		if (!this.#extensionRunner) return;

		const spaceIndex = text.indexOf(" ");
		const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
		const command = this.#extensionRunner.getCommand(commandName);

		if (command) {
			throw new Error(
				`Extension command "/${commandName}" cannot be queued. Use prompt() or execute the command when not streaming.`,
			);
		}
	}

	/**
	 * Send a custom message to the session. Creates a CustomMessageEntry.
	 *
	 * Handles three cases:
	 * - Streaming: queue as steer/follow-up or store for next turn
	 * - Not streaming + triggerTurn: appends to state/session, starts new turn
	 * - Not streaming + no trigger: appends to state/session, no turn
	 */
	async sendCustomMessage<T = unknown>(
		message: Pick<CustomMessage<T>, "customType" | "content" | "display" | "details">,
		options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" },
	): Promise<void> {
		const appMessage: CustomMessage<T> = {
			role: "custom",
			customType: message.customType,
			content: message.content,
			display: message.display,
			details: message.details,
			timestamp: Date.now(),
		};
		if (this.isStreaming) {
			if (options?.deliverAs === "nextTurn") {
				this.#pendingNextTurnMessages.push(appMessage);
				return;
			}

			if (options?.deliverAs === "followUp") {
				this.agent.followUp(appMessage);
			} else {
				this.agent.steer(appMessage);
			}
			return;
		}

		if (options?.triggerTurn) {
			await this.agent.prompt(appMessage);
			return;
		}

		this.agent.appendMessage(appMessage);
		this.sessionManager.appendCustomMessageEntry(
			message.customType,
			message.content,
			message.display,
			message.details,
		);
	}

	/**
	 * Send a user message to the agent. Always triggers a turn.
	 * When the agent is streaming, use deliverAs to specify how to queue the message.
	 *
	 * @param content User message content (string or content array)
	 * @param options.deliverAs Delivery mode when streaming: "steer" or "followUp"
	 */
	async sendUserMessage(
		content: string | (TextContent | ImageContent)[],
		options?: { deliverAs?: "steer" | "followUp" },
	): Promise<void> {
		// Normalize content to text string + optional images
		let text: string;
		let images: ImageContent[] | undefined;

		if (typeof content === "string") {
			text = content;
		} else {
			const textParts: string[] = [];
			images = [];
			for (const part of content) {
				if (part.type === "text") {
					textParts.push(part.text);
				} else {
					images.push(part);
				}
			}
			text = textParts.join("\n");
			if (images.length === 0) images = undefined;
		}

		// Use prompt() with expandPromptTemplates: false to skip command handling and template expansion
		await this.prompt(text, {
			expandPromptTemplates: false,
			streamingBehavior: options?.deliverAs,
			images,
		});
	}

	/**
	 * Clear queued messages and return them.
	 * Useful for restoring to editor when user aborts.
	 */
	clearQueue(): { steering: string[]; followUp: string[] } {
		const steering = [...this.#steeringMessages];
		const followUp = [...this.#followUpMessages];
		this.#steeringMessages = [];
		this.#followUpMessages = [];
		this.agent.clearAllQueues();
		return { steering, followUp };
	}

	/** Number of pending messages (includes both steering and follow-up) */
	get queuedMessageCount(): number {
		return this.#steeringMessages.length + this.#followUpMessages.length;
	}

	/** Get pending messages (read-only) */
	getQueuedMessages(): { steering: readonly string[]; followUp: readonly string[] } {
		return { steering: this.#steeringMessages, followUp: this.#followUpMessages };
	}

	/**
	 * Pop the last queued message (steering first, then follow-up).
	 * Used by dequeue keybinding to restore messages to editor one at a time.
	 */
	popLastQueuedMessage(): string | undefined {
		// Pop from steering first (LIFO)
		if (this.#steeringMessages.length > 0) {
			const message = this.#steeringMessages.pop();
			this.agent.popLastSteer();
			return message;
		}
		// Then from follow-up
		if (this.#followUpMessages.length > 0) {
			const message = this.#followUpMessages.pop();
			this.agent.popLastFollowUp();
			return message;
		}
		return undefined;
	}

	get skillsSettings(): Required<SkillsSettings> | undefined {
		return this.#skillsSettings;
	}

	/** Skills loaded by SDK (empty if --no-skills or skills: [] was passed) */
	get skills(): readonly Skill[] {
		return this.#skills;
	}

	/** Skill loading warnings captured by SDK */
	get skillWarnings(): readonly SkillWarning[] {
		return this.#skillWarnings;
	}

	getTodoPhases(): TodoPhase[] {
		return this.#cloneTodoPhases(this.#todoPhases);
	}

	setTodoPhases(phases: TodoPhase[]): void {
		this.#todoPhases = this.#cloneTodoPhases(phases);
	}

	#syncTodoPhasesFromBranch(): void {
		this.setTodoPhases(getLatestTodoPhasesFromEntries(this.sessionManager.getBranch()));
	}

	#cloneTodoPhases(phases: TodoPhase[]): TodoPhase[] {
		return phases.map(phase => ({
			id: phase.id,
			name: phase.name,
			tasks: phase.tasks.map(task => ({
				id: task.id,
				content: task.content,
				status: task.status,
				notes: task.notes,
			})),
		}));
	}

	/**
	 * Abort current operation and wait for agent to become idle.
	 */
	async abort(): Promise<void> {
		this.abortRetry();
		this.#promptGeneration++;
		this.#resolveTtsrResume();
		this.#cancelPostPromptTasks();
		this.agent.abort();
		await this.agent.waitForIdle();
		// Clear promptInFlight: waitForIdle resolves when the agent loop's finally
		// block runs (#resolveRunningPrompt), but #promptWithMessage's finally
		// (#promptInFlight = false) fires on a later microtask. Without this,
		// isStreaming stays true and a subsequent prompt() throws.
		this.#promptInFlight = false;
	}

	/**
	 * Start a new session, optionally with initial messages and parent tracking.
	 * Clears all messages and starts a new session.
	 * Listeners are preserved and will continue receiving events.
	 * @param options - Optional initial messages and parent session path
	 * @returns true if completed, false if cancelled by hook
	 */
	async newSession(options?: NewSessionOptions): Promise<boolean> {
		const previousSessionFile = this.sessionFile;

		// Emit session_before_switch event with reason "new" (can be cancelled)
		if (this.#extensionRunner?.hasHandlers("session_before_switch")) {
			const result = (await this.#extensionRunner.emit({
				type: "session_before_switch",
				reason: "new",
			})) as SessionBeforeSwitchResult | undefined;

			if (result?.cancel) {
				return false;
			}
		}

		this.#disconnectFromAgent();
		await this.abort();
		this.#asyncJobManager?.cancelAll();
		this.agent.reset();
		await this.sessionManager.flush();
		await this.sessionManager.newSession(options);
		this.setTodoPhases([]);
		this.agent.sessionId = this.sessionManager.getSessionId();
		this.#steeringMessages = [];
		this.#followUpMessages = [];
		this.#pendingNextTurnMessages = [];

		this.sessionManager.appendThinkingLevelChange(this.thinkingLevel);

		this.#todoReminderCount = 0;
		this.#planReferenceSent = false;
		this.#planReferencePath = "local://PLAN.md";
		this.#reconnectToAgent();

		// Emit session_switch event with reason "new" to hooks
		if (this.#extensionRunner) {
			await this.#extensionRunner.emit({
				type: "session_switch",
				reason: "new",
				previousSessionFile,
			});
		}

		return true;
	}

	/**
	 * Set a display name for the current session.
	 */
	setSessionName(name: string): void {
		this.sessionManager.setSessionName(name);
	}

	/**
	 * Fork the current session, creating a new session file with the exact same state.
	 * Copies all entries and artifacts to the new session.
	 * Unlike newSession(), this preserves all messages in the agent state.
	 * @returns true if completed, false if cancelled by hook or not persisting
	 */
	async fork(): Promise<boolean> {
		const previousSessionFile = this.sessionFile;

		// Emit session_before_switch event with reason "fork" (can be cancelled)
		if (this.#extensionRunner?.hasHandlers("session_before_switch")) {
			const result = (await this.#extensionRunner.emit({
				type: "session_before_switch",
				reason: "fork",
			})) as SessionBeforeSwitchResult | undefined;

			if (result?.cancel) {
				return false;
			}
		}

		// Flush current session to ensure all entries are written
		await this.sessionManager.flush();

		// Fork the session (creates new session file with same entries)
		const forkResult = await this.sessionManager.fork();
		if (!forkResult) {
			return false;
		}

		// Copy artifacts directory if it exists
		const oldArtifactDir = forkResult.oldSessionFile.slice(0, -6);
		const newArtifactDir = forkResult.newSessionFile.slice(0, -6);

		try {
			const oldDirStat = await fs.promises.stat(oldArtifactDir);
			if (oldDirStat.isDirectory()) {
				await fs.promises.cp(oldArtifactDir, newArtifactDir, { recursive: true });
			}
		} catch (err) {
			if (!isEnoent(err)) {
				logger.warn("Failed to copy artifacts during fork", {
					oldArtifactDir,
					newArtifactDir,
					error: err instanceof Error ? err.message : String(err),
				});
			}
		}

		// Update agent session ID
		this.agent.sessionId = this.sessionManager.getSessionId();

		// Emit session_switch event with reason "fork" to hooks
		if (this.#extensionRunner) {
			await this.#extensionRunner.emit({
				type: "session_switch",
				reason: "fork",
				previousSessionFile,
			});
		}

		return true;
	}

	// =========================================================================
	// Model Management
	// =========================================================================

	/**
	 * Set model directly.
	 * Validates API key, saves to session and settings.
	 * @throws Error if no API key available for the model
	 */
	async setModel(model: Model, role: ModelRole = "default"): Promise<void> {
		const apiKey = await this.#modelRegistry.getApiKey(model, this.sessionId);
		if (!apiKey) {
			throw new Error(`No API key for ${model.provider}/${model.id}`);
		}

		this.#setModelWithProviderSessionReset(model);
		this.sessionManager.appendModelChange(`${model.provider}/${model.id}`, role);
		this.settings.setModelRole(role, `${model.provider}/${model.id}`);
		this.settings.getStorage()?.recordModelUsage(`${model.provider}/${model.id}`);

		// Re-clamp thinking level for new model's capabilities without persisting settings
		this.setThinkingLevel(this.thinkingLevel);
	}

	/**
	 * Set model temporarily (for this session only).
	 * Validates API key, saves to session log but NOT to settings.
	 * @throws Error if no API key available for the model
	 */
	async setModelTemporary(model: Model): Promise<void> {
		const apiKey = await this.#modelRegistry.getApiKey(model, this.sessionId);
		if (!apiKey) {
			throw new Error(`No API key for ${model.provider}/${model.id}`);
		}

		this.#setModelWithProviderSessionReset(model);
		this.sessionManager.appendModelChange(`${model.provider}/${model.id}`, "temporary");
		this.settings.getStorage()?.recordModelUsage(`${model.provider}/${model.id}`);

		// Re-clamp thinking level for new model's capabilities without persisting settings
		this.setThinkingLevel(this.thinkingLevel);
	}

	/**
	 * Cycle to next/previous model.
	 * Uses scoped models (from --models flag) if available, otherwise all available models.
	 * @param direction - "forward" (default) or "backward"
	 * @returns The new model info, or undefined if only one model available
	 */
	async cycleModel(direction: "forward" | "backward" = "forward"): Promise<ModelCycleResult | undefined> {
		if (this.#scopedModels.length > 0) {
			return this.#cycleScopedModel(direction);
		}
		return this.#cycleAvailableModel(direction);
	}

	/**
	 * Cycle through configured role models in a fixed order.
	 * Skips missing roles.
	 * @param roleOrder - Order of roles to cycle through (e.g., ["slow", "default", "smol"])
	 * @param options - Optional settings: `temporary` to not persist to settings
	 */
	async cycleRoleModels(
		roleOrder: readonly ModelRole[],
		options?: { temporary?: boolean },
	): Promise<RoleModelCycleResult | undefined> {
		const availableModels = this.#modelRegistry.getAvailable();
		if (availableModels.length === 0) return undefined;

		const currentModel = this.model;
		if (!currentModel) return undefined;
		const roleModels: Array<{ role: ModelRole; model: Model }> = [];

		for (const role of roleOrder) {
			const roleModelStr =
				role === "default"
					? (this.settings.getModelRole("default") ?? `${currentModel.provider}/${currentModel.id}`)
					: this.settings.getModelRole(role);
			if (!roleModelStr) continue;

			const expandedRoleModelStr = expandRoleAlias(roleModelStr, this.settings);
			const parsed = parseModelString(expandedRoleModelStr);
			let match: Model | undefined;
			if (parsed) {
				match = availableModels.find(m => m.provider === parsed.provider && m.id === parsed.id);
			}
			if (!match) {
				match = availableModels.find(m => m.id.toLowerCase() === expandedRoleModelStr.toLowerCase());
			}
			if (!match) continue;

			roleModels.push({ role, model: match });
		}

		if (roleModels.length <= 1) return undefined;

		const lastRole = this.sessionManager.getLastModelChangeRole();
		let currentIndex = lastRole
			? roleModels.findIndex(entry => entry.role === lastRole)
			: roleModels.findIndex(entry => modelsAreEqual(entry.model, currentModel));
		if (currentIndex === -1) currentIndex = 0;

		const nextIndex = (currentIndex + 1) % roleModels.length;
		const next = roleModels[nextIndex];

		if (options?.temporary) {
			await this.setModelTemporary(next.model);
		} else {
			await this.setModel(next.model, next.role);
		}

		return { model: next.model, thinkingLevel: this.thinkingLevel, role: next.role };
	}

	async #getScopedModelsWithApiKey(): Promise<Array<{ model: Model; thinkingLevel: ThinkingLevel }>> {
		const apiKeysByProvider = new Map<string, string | undefined>();
		const result: Array<{ model: Model; thinkingLevel: ThinkingLevel }> = [];

		for (const scoped of this.#scopedModels) {
			const provider = scoped.model.provider;
			let apiKey: string | undefined;
			if (apiKeysByProvider.has(provider)) {
				apiKey = apiKeysByProvider.get(provider);
			} else {
				apiKey = await this.#modelRegistry.getApiKeyForProvider(provider, this.sessionId);
				apiKeysByProvider.set(provider, apiKey);
			}

			if (apiKey) {
				result.push(scoped);
			}
		}

		return result;
	}

	async #cycleScopedModel(direction: "forward" | "backward"): Promise<ModelCycleResult | undefined> {
		const scopedModels = await this.#getScopedModelsWithApiKey();
		if (scopedModels.length <= 1) return undefined;

		const currentModel = this.model;
		let currentIndex = scopedModels.findIndex(sm => modelsAreEqual(sm.model, currentModel));

		if (currentIndex === -1) currentIndex = 0;
		const len = scopedModels.length;
		const nextIndex = direction === "forward" ? (currentIndex + 1) % len : (currentIndex - 1 + len) % len;
		const next = scopedModels[nextIndex];

		// Apply model
		this.#setModelWithProviderSessionReset(next.model);
		this.sessionManager.appendModelChange(`${next.model.provider}/${next.model.id}`);
		this.settings.setModelRole("default", `${next.model.provider}/${next.model.id}`);
		this.settings.getStorage()?.recordModelUsage(`${next.model.provider}/${next.model.id}`);

		// Apply thinking level (setThinkingLevel clamps to model capabilities)
		this.setThinkingLevel(next.thinkingLevel);

		return { model: next.model, thinkingLevel: this.thinkingLevel, isScoped: true };
	}

	async #cycleAvailableModel(direction: "forward" | "backward"): Promise<ModelCycleResult | undefined> {
		const availableModels = this.#modelRegistry.getAvailable();
		if (availableModels.length <= 1) return undefined;

		const currentModel = this.model;
		let currentIndex = availableModels.findIndex(m => modelsAreEqual(m, currentModel));

		if (currentIndex === -1) currentIndex = 0;
		const len = availableModels.length;
		const nextIndex = direction === "forward" ? (currentIndex + 1) % len : (currentIndex - 1 + len) % len;
		const nextModel = availableModels[nextIndex];

		const apiKey = await this.#modelRegistry.getApiKey(nextModel, this.sessionId);
		if (!apiKey) {
			throw new Error(`No API key for ${nextModel.provider}/${nextModel.id}`);
		}

		this.#setModelWithProviderSessionReset(nextModel);
		this.sessionManager.appendModelChange(`${nextModel.provider}/${nextModel.id}`);
		this.settings.setModelRole("default", `${nextModel.provider}/${nextModel.id}`);
		this.settings.getStorage()?.recordModelUsage(`${nextModel.provider}/${nextModel.id}`);

		// Re-clamp thinking level for new model's capabilities without persisting settings
		this.setThinkingLevel(this.thinkingLevel);

		return { model: nextModel, thinkingLevel: this.thinkingLevel, isScoped: false };
	}

	/**
	 * Get all available models with valid API keys.
	 */
	getAvailableModels(): Model[] {
		return this.#modelRegistry.getAvailable();
	}

	// =========================================================================
	// Thinking Level Management
	// =========================================================================

	/**
	 * Set thinking level.
	 * Clamps to model capabilities based on available thinking levels.
	 * Saves to session and settings only if the level actually changes.
	 */
	setThinkingLevel(level: ThinkingLevel, persist: boolean = false): void {
		const availableLevels = this.getAvailableThinkingLevels();
		const effectiveLevel = availableLevels.includes(level) ? level : this.#clampThinkingLevel(level, availableLevels);

		// Only persist if actually changing
		const isChanging = effectiveLevel !== this.agent.state.thinkingLevel;

		this.agent.setThinkingLevel(effectiveLevel);

		if (isChanging) {
			this.sessionManager.appendThinkingLevelChange(effectiveLevel);
			if (persist) {
				this.settings.set("defaultThinkingLevel", effectiveLevel);
			}
		}
	}

	/**
	 * Cycle to next thinking level.
	 * @returns New level, or undefined if model doesn't support thinking
	 */
	cycleThinkingLevel(): ThinkingLevel | undefined {
		if (!this.supportsThinking()) return undefined;

		const levels = this.getAvailableThinkingLevels();
		const currentIndex = levels.indexOf(this.thinkingLevel);
		const nextIndex = (currentIndex + 1) % levels.length;
		const nextLevel = levels[nextIndex];

		this.setThinkingLevel(nextLevel);
		return nextLevel;
	}

	/**
	 * Get available thinking levels for current model.
	 * The provider will clamp to what the specific model supports internally.
	 */
	getAvailableThinkingLevels(): ThinkingLevel[] {
		if (!this.supportsThinking()) return ["off"];
		return this.supportsXhighThinking() ? THINKING_LEVELS_WITH_XHIGH : THINKING_LEVELS;
	}

	/**
	 * Check if current model supports xhigh thinking level.
	 */
	supportsXhighThinking(): boolean {
		return this.model ? supportsXhigh(this.model) : false;
	}

	/**
	 * Check if current model supports thinking/reasoning.
	 */
	supportsThinking(): boolean {
		return !!this.model?.reasoning;
	}

	#clampThinkingLevel(level: ThinkingLevel, availableLevels: ThinkingLevel[]): ThinkingLevel {
		const ordered = THINKING_LEVELS_WITH_XHIGH;
		const available = new Set(availableLevels);
		const requestedIndex = ordered.indexOf(level);
		if (requestedIndex === -1) {
			return availableLevels[0] ?? "off";
		}
		for (let i = requestedIndex; i < ordered.length; i++) {
			const candidate = ordered[i];
			if (available.has(candidate)) return candidate;
		}
		for (let i = requestedIndex - 1; i >= 0; i--) {
			const candidate = ordered[i];
			if (available.has(candidate)) return candidate;
		}
		return availableLevels[0] ?? "off";
	}

	// =========================================================================
	// Message Queue Mode Management
	// =========================================================================

	/**
	 * Set steering mode.
	 * Saves to settings.
	 */
	setSteeringMode(mode: "all" | "one-at-a-time"): void {
		this.agent.setSteeringMode(mode);
		this.settings.set("steeringMode", mode);
	}

	/**
	 * Set follow-up mode.
	 * Saves to settings.
	 */
	setFollowUpMode(mode: "all" | "one-at-a-time"): void {
		this.agent.setFollowUpMode(mode);
		this.settings.set("followUpMode", mode);
	}

	/**
	 * Set interrupt mode.
	 * Saves to settings.
	 */
	setInterruptMode(mode: "immediate" | "wait"): void {
		this.agent.setInterruptMode(mode);
		this.settings.set("interruptMode", mode);
	}

	// =========================================================================
	// Compaction
	// =========================================================================

	async #pruneToolOutputs(): Promise<{ prunedCount: number; tokensSaved: number } | undefined> {
		const branchEntries = this.sessionManager.getBranch();
		const result = pruneToolOutputs(branchEntries, DEFAULT_PRUNE_CONFIG);
		if (result.prunedCount === 0) {
			return undefined;
		}

		await this.sessionManager.rewriteEntries();
		const sessionContext = this.sessionManager.buildSessionContext();
		this.agent.replaceMessages(sessionContext.messages);
		this.#syncTodoPhasesFromBranch();
		this.#closeCodexProviderSessionsForHistoryRewrite();
		return result;
	}

	/**
	 * Manually compact the session context.
	 * Aborts current agent operation first.
	 * @param customInstructions Optional instructions for the compaction summary
	 * @param options Optional callbacks for completion/error handling
	 */
	async compact(customInstructions?: string, options?: CompactOptions): Promise<CompactionResult> {
		this.#disconnectFromAgent();
		await this.abort();
		this.#compactionAbortController = new AbortController();

		try {
			if (!this.model) {
				throw new Error("No model selected");
			}

			const compactionSettings = this.settings.getGroup("compaction");
			const compactionModel = this.model;
			const apiKey = await this.#modelRegistry.getApiKey(compactionModel, this.sessionId);
			if (!apiKey) {
				throw new Error(`No API key for ${compactionModel.provider}`);
			}

			const pathEntries = this.sessionManager.getBranch();

			const preparation = prepareCompaction(pathEntries, compactionSettings);
			if (!preparation) {
				// Check why we can't compact
				const lastEntry = pathEntries[pathEntries.length - 1];
				if (lastEntry?.type === "compaction") {
					throw new Error("Already compacted");
				}
				throw new Error("Nothing to compact (session too small)");
			}

			let hookCompaction: CompactionResult | undefined;
			let fromExtension = false;
			let hookContext: string[] | undefined;
			let hookPrompt: string | undefined;
			let preserveData: Record<string, unknown> | undefined;

			if (this.#extensionRunner?.hasHandlers("session_before_compact")) {
				const result = (await this.#extensionRunner.emit({
					type: "session_before_compact",
					preparation,
					branchEntries: pathEntries,
					customInstructions,
					signal: this.#compactionAbortController.signal,
				})) as SessionBeforeCompactResult | undefined;

				if (result?.cancel) {
					throw new Error("Compaction cancelled");
				}

				if (result?.compaction) {
					hookCompaction = result.compaction;
					fromExtension = true;
				}
			}

			if (!hookCompaction && this.#extensionRunner?.hasHandlers("session.compacting")) {
				const compactMessages = preparation.messagesToSummarize.concat(preparation.turnPrefixMessages);
				const result = (await this.#extensionRunner.emit({
					type: "session.compacting",
					sessionId: this.sessionId,
					messages: compactMessages,
				})) as { context?: string[]; prompt?: string; preserveData?: Record<string, unknown> } | undefined;

				hookContext = result?.context;
				hookPrompt = result?.prompt;
				preserveData = result?.preserveData;
			}

			let summary: string;
			let shortSummary: string | undefined;
			let firstKeptEntryId: string;
			let tokensBefore: number;
			let details: unknown;

			if (hookCompaction) {
				// Extension provided compaction content
				summary = hookCompaction.summary;
				shortSummary = hookCompaction.shortSummary;
				firstKeptEntryId = hookCompaction.firstKeptEntryId;
				tokensBefore = hookCompaction.tokensBefore;
				details = hookCompaction.details;
				preserveData ??= hookCompaction.preserveData;
			} else {
				// Generate compaction result
				const result = await compact(
					preparation,
					compactionModel,
					apiKey,
					customInstructions,
					this.#compactionAbortController.signal,
					{ promptOverride: hookPrompt, extraContext: hookContext },
				);
				summary = result.summary;
				shortSummary = result.shortSummary;
				firstKeptEntryId = result.firstKeptEntryId;
				tokensBefore = result.tokensBefore;
				details = result.details;
			}

			if (this.#compactionAbortController.signal.aborted) {
				throw new Error("Compaction cancelled");
			}

			this.sessionManager.appendCompaction(
				summary,
				shortSummary,
				firstKeptEntryId,
				tokensBefore,
				details,
				fromExtension,
				preserveData,
			);
			const newEntries = this.sessionManager.getEntries();
			const sessionContext = this.sessionManager.buildSessionContext();
			this.agent.replaceMessages(sessionContext.messages);
			this.#syncTodoPhasesFromBranch();
			this.#closeCodexProviderSessionsForHistoryRewrite();

			// Get the saved compaction entry for the hook
			const savedCompactionEntry = newEntries.find(e => e.type === "compaction" && e.summary === summary) as
				| CompactionEntry
				| undefined;

			if (this.#extensionRunner && savedCompactionEntry) {
				await this.#extensionRunner.emit({
					type: "session_compact",
					compactionEntry: savedCompactionEntry,
					fromExtension,
				});
			}

			const compactionResult: CompactionResult = {
				summary,
				shortSummary,
				firstKeptEntryId,
				tokensBefore,
				details,
				preserveData,
			};
			options?.onComplete?.(compactionResult);
			return compactionResult;
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			options?.onError?.(err);
			throw error;
		} finally {
			this.#compactionAbortController = undefined;
			this.#reconnectToAgent();
		}
	}

	/**
	 * Cancel in-progress compaction (manual or auto).
	 */
	abortCompaction(): void {
		this.#compactionAbortController?.abort();
		this.#autoCompactionAbortController?.abort();
	}

	/**
	 * Cancel in-progress branch summarization.
	 */
	abortBranchSummary(): void {
		this.#branchSummaryAbortController?.abort();
	}

	/**
	 * Cancel in-progress handoff generation.
	 */
	abortHandoff(): void {
		this.#handoffAbortController?.abort();
	}

	/**
	 * Check if handoff generation is in progress.
	 */
	get isGeneratingHandoff(): boolean {
		return this.#handoffAbortController !== undefined;
	}

	/**
	 * Generate a handoff document by asking the agent, then start a new session with it.
	 *
	 * This prompts the current agent to write a comprehensive handoff document,
	 * waits for completion, then starts a fresh session with the handoff as context.
	 *
	 * @param customInstructions Optional focus for the handoff document
	 * @returns The handoff document text, or undefined if cancelled/failed
	 */
	async handoff(customInstructions?: string): Promise<HandoffResult | undefined> {
		const entries = this.sessionManager.getBranch();
		const messageCount = entries.filter(e => e.type === "message").length;

		if (messageCount < 2) {
			throw new Error("Nothing to hand off (no messages yet)");
		}

		this.#skipPostTurnMaintenanceAssistantTimestamp = undefined;

		this.#handoffAbortController = new AbortController();

		// Build the handoff prompt
		let handoffPrompt = `Write a comprehensive handoff document that will allow another instance of yourself to seamlessly continue this work. The document should capture everything needed to resume without access to this conversation.

Use this format:

## Goal
[What the user is trying to accomplish]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned]

## Progress
### Done
- [x] [Completed tasks with specifics]

### In Progress
- [ ] [Current work if any]

### Pending
- [ ] [Tasks mentioned but not started]

## Key Decisions
- **[Decision]**: [Rationale]

## Critical Context
- [Code snippets, file paths, error messages, or data essential to continue]
- [Repository state if relevant]

## Next Steps
1. [What should happen next]

Be thorough - include exact file paths, function names, error messages, and technical details. Output ONLY the handoff document, no other text.`;

		if (customInstructions) {
			handoffPrompt += `\n\nAdditional focus: ${customInstructions}`;
		}

		// Create a promise that resolves when the agent completes
		let handoffText: string | undefined;
		const completionPromise = new Promise<void>((resolve, reject) => {
			const unsubscribe = this.subscribe(event => {
				if (this.#handoffAbortController?.signal.aborted) {
					unsubscribe();
					reject(new Error("Handoff cancelled"));
					return;
				}

				if (event.type === "agent_end") {
					unsubscribe();
					// Extract text from the last assistant message
					const messages = this.agent.state.messages;
					for (let i = messages.length - 1; i >= 0; i--) {
						const msg = messages[i];
						if (msg.role === "assistant") {
							const content = (msg as AssistantMessage).content;
							const textParts = content
								.filter((c): c is { type: "text"; text: string } => c.type === "text")
								.map(c => c.text);
							if (textParts.length > 0) {
								handoffText = textParts.join("\n");
								break;
							}
						}
					}
					resolve();
				}
			});
		});

		try {
			// Send the prompt and wait for completion
			await this.prompt(handoffPrompt, { expandPromptTemplates: false, synthetic: true });
			await completionPromise;

			if (!handoffText || this.#handoffAbortController.signal.aborted) {
				return undefined;
			}

			// Start a new session
			await this.sessionManager.flush();
			this.#asyncJobManager?.cancelAll();
			await this.sessionManager.newSession();
			this.agent.reset();
			this.agent.sessionId = this.sessionManager.getSessionId();
			this.#steeringMessages = [];
			this.#followUpMessages = [];
			this.#pendingNextTurnMessages = [];
			this.#todoReminderCount = 0;

			// Inject the handoff document as a custom message
			const handoffContent = `<handoff-context>\n${handoffText}\n</handoff-context>\n\nThe above is a handoff document from a previous session. Use this context to continue the work seamlessly.`;
			this.sessionManager.appendCustomMessageEntry("handoff", handoffContent, true);

			// Rebuild agent messages from session
			const sessionContext = this.sessionManager.buildSessionContext();
			this.agent.replaceMessages(sessionContext.messages);
			this.#syncTodoPhasesFromBranch();

			return { document: handoffText };
		} finally {
			this.#handoffAbortController = undefined;
		}
	}

	/**
	 * Check if compaction or context promotion is needed and run it.
	 * Called after agent_end and before prompt submission.
	 *
	 * Three cases (in order):
	 * 1. Overflow + promotion: promote to larger model, retry without compacting
	 * 2. Overflow + no promotion target: compact, auto-retry on same model
	 * 3. Threshold: Context over threshold, compact, NO auto-retry (user continues manually)
	 *
	 * @param assistantMessage The assistant message to check
	 * @param skipAbortedCheck If false, include aborted messages (for pre-prompt check). Default: true
	 */
	async #checkCompaction(assistantMessage: AssistantMessage, skipAbortedCheck = true): Promise<void> {
		// Skip if message was aborted (user cancelled) - unless skipAbortedCheck is false
		if (skipAbortedCheck && assistantMessage.stopReason === "aborted") return;
		const contextWindow = this.model?.contextWindow ?? 0;
		const generation = this.#promptGeneration;
		// Skip overflow check if the message came from a different model.
		// This handles the case where user switched from a smaller-context model (e.g. opus)
		// to a larger-context model (e.g. codex) - the overflow error from the old model
		// shouldn't trigger compaction for the new model.
		const sameModel =
			this.model && assistantMessage.provider === this.model.provider && assistantMessage.model === this.model.id;
		// This handles the case where an error was kept after compaction (in the "kept" region).
		// The error shouldn't trigger another compaction since we already compacted.
		// Example: opus fails -> switch to codex -> compact -> switch back to opus -> opus error
		// is still in context but shouldn't trigger compaction again.
		const compactionEntry = getLatestCompactionEntry(this.sessionManager.getBranch());
		const errorIsFromBeforeCompaction =
			compactionEntry !== null && assistantMessage.timestamp < new Date(compactionEntry.timestamp).getTime();
		if (sameModel && !errorIsFromBeforeCompaction && isContextOverflow(assistantMessage, contextWindow)) {
			// Remove the error message from agent state (it IS saved to session for history,
			// but we don't want it in context for the retry)
			const messages = this.agent.state.messages;
			if (messages.length > 0 && messages[messages.length - 1].role === "assistant") {
				this.agent.replaceMessages(messages.slice(0, -1));
			}

			// Try context promotion first - switch to a larger model and retry without compacting
			const promoted = await this.#tryContextPromotion(assistantMessage);
			if (promoted) {
				// Retry on the promoted (larger) model without compacting
				this.#scheduleAgentContinue({ delayMs: 100, generation });
				return;
			}

			// No promotion target available fall through to compaction
			const compactionSettings = this.settings.getGroup("compaction");
			if (compactionSettings.enabled) {
				await this.#runAutoCompaction("overflow", true);
			}
			return;
		}
		const compactionSettings = this.settings.getGroup("compaction");
		if (!compactionSettings.enabled) return;

		// Case 2: Threshold - turn succeeded but context is getting large
		// Skip if this was an error (non-overflow errors don't have usage data)
		if (assistantMessage.stopReason === "error") return;
		const pruneResult = await this.#pruneToolOutputs();
		let contextTokens = calculateContextTokens(assistantMessage.usage);
		if (pruneResult) {
			contextTokens = Math.max(0, contextTokens - pruneResult.tokensSaved);
		}
		if (shouldCompact(contextTokens, contextWindow, compactionSettings)) {
			// Try promotion first — if a larger model is available, switch instead of compacting
			const promoted = await this.#tryContextPromotion(assistantMessage);
			if (!promoted) {
				await this.#runAutoCompaction("threshold", false);
			}
		}
	}
	/**
	 * Check if agent stopped with incomplete todos and prompt to continue.
	 */
	async #checkTodoCompletion(): Promise<void> {
		const remindersEnabled = this.settings.get("todo.reminders");
		const todosEnabled = this.settings.get("todo.enabled");
		if (!remindersEnabled || !todosEnabled) {
			this.#todoReminderCount = 0;
			return;
		}

		const remindersMax = this.settings.get("todo.reminders.max");
		if (this.#todoReminderCount >= remindersMax) {
			logger.debug("Todo completion: max reminders reached", { count: this.#todoReminderCount });
			return;
		}

		const phases = this.getTodoPhases();
		if (phases.length === 0) {
			this.#todoReminderCount = 0;
			return;
		}

		const incompleteByPhase = phases
			.map(phase => ({
				name: phase.name,
				tasks: phase.tasks
					.filter(
						(task): task is TodoItem & { status: "pending" | "in_progress" } =>
							task.status === "pending" || task.status === "in_progress",
					)
					.map(task => ({ id: task.id, content: task.content, status: task.status })),
			}))
			.filter(phase => phase.tasks.length > 0);
		const incomplete = incompleteByPhase.flatMap(phase => phase.tasks);
		if (incomplete.length === 0) {
			this.#todoReminderCount = 0;
			return;
		}

		// Build reminder message
		this.#todoReminderCount++;
		const todoList = incompleteByPhase
			.map(phase => `- ${phase.name}\n${phase.tasks.map(task => `  - ${task.content}`).join("\n")}`)
			.join("\n");
		const reminder =
			`<system-reminder>\n` +
			`You stopped with ${incomplete.length} incomplete todo item(s):\n${todoList}\n\n` +
			`Please continue working on these tasks or mark them complete if finished.\n` +
			`(Reminder ${this.#todoReminderCount}/${remindersMax})\n` +
			`</system-reminder>`;

		logger.debug("Todo completion: sending reminder", {
			incomplete: incomplete.length,
			attempt: this.#todoReminderCount,
		});

		// Emit event for UI to render notification
		await this.#emitSessionEvent({
			type: "todo_reminder",
			todos: incomplete,
			attempt: this.#todoReminderCount,
			maxAttempts: remindersMax,
		});

		// Inject reminder and continue the conversation
		this.agent.appendMessage({
			role: "developer",
			content: [{ type: "text", text: reminder }],
			timestamp: Date.now(),
		});
		this.#scheduleAgentContinue({ generation: this.#promptGeneration });
	}

	/**
	 * Attempt context promotion to a larger model.
	 * Returns true if promotion succeeded (caller should retry without compacting).
	 */
	async #tryContextPromotion(assistantMessage: AssistantMessage): Promise<boolean> {
		const promotionSettings = this.settings.getGroup("contextPromotion");
		if (!promotionSettings.enabled) return false;
		const currentModel = this.model;
		if (!currentModel) return false;
		if (assistantMessage.provider !== currentModel.provider || assistantMessage.model !== currentModel.id)
			return false;
		const contextWindow = currentModel.contextWindow ?? 0;
		if (contextWindow <= 0) return false;
		const targetModel = await this.#resolveContextPromotionTarget(currentModel, contextWindow);
		if (!targetModel) return false;

		try {
			await this.setModelTemporary(targetModel);
			logger.debug("Context promotion switched model on overflow", {
				from: `${currentModel.provider}/${currentModel.id}`,
				to: `${targetModel.provider}/${targetModel.id}`,
			});
			return true;
		} catch (error) {
			logger.warn("Context promotion failed", {
				from: `${currentModel.provider}/${currentModel.id}`,
				to: `${targetModel.provider}/${targetModel.id}`,
				error: String(error),
			});
			return false;
		}
	}

	async #resolveContextPromotionTarget(currentModel: Model, contextWindow: number): Promise<Model | undefined> {
		const availableModels = this.#modelRegistry.getAvailable();
		if (availableModels.length === 0) return undefined;

		const candidates: Model[] = [];
		const seen = new Set<string>();
		const addCandidate = (candidate: Model | undefined): void => {
			if (!candidate) return;
			const key = this.#getModelKey(candidate);
			if (seen.has(key)) return;
			seen.add(key);
			candidates.push(candidate);
		};

		addCandidate(this.#resolveContextPromotionConfiguredTarget(currentModel, availableModels));

		const sameProviderLarger = [...availableModels]
			.filter(
				m => m.provider === currentModel.provider && m.api === currentModel.api && m.contextWindow > contextWindow,
			)
			.sort((a, b) => a.contextWindow - b.contextWindow);
		addCandidate(sameProviderLarger[0]);
		for (const candidate of candidates) {
			if (modelsAreEqual(candidate, currentModel)) continue;
			if (candidate.contextWindow <= contextWindow) continue;
			const apiKey = await this.#modelRegistry.getApiKey(candidate, this.sessionId);
			if (!apiKey) continue;
			return candidate;
		}

		return undefined;
	}

	#setModelWithProviderSessionReset(model: Model): void {
		const currentModel = this.model;
		if (currentModel) {
			this.#closeProviderSessionsForModelSwitch(currentModel, model);
		}
		this.agent.setModel(this.#applySessionModelOverrides(model));
	}

	#closeCodexProviderSessionsForHistoryRewrite(): void {
		const currentModel = this.model;
		if (!currentModel || currentModel.api !== "openai-codex-responses") return;
		this.#closeProviderSessionsForModelSwitch(currentModel, currentModel);
	}

	#closeProviderSessionsForModelSwitch(currentModel: Model, nextModel: Model): void {
		if (currentModel.api !== "openai-codex-responses" && nextModel.api !== "openai-codex-responses") return;

		const providerKey = "openai-codex-responses";
		const state = this.#providerSessionState.get(providerKey);
		if (!state) return;

		try {
			state.close();
		} catch (error) {
			logger.warn("Failed to close provider session state during model switch", {
				providerKey,
				error: String(error),
			});
		}

		this.#providerSessionState.delete(providerKey);
	}

	#getModelKey(model: Model): string {
		return `${model.provider}/${model.id}`;
	}

	#resolveContextPromotionConfiguredTarget(currentModel: Model, availableModels: Model[]): Model | undefined {
		const configuredTarget = currentModel.contextPromotionTarget?.trim();
		if (!configuredTarget) return undefined;

		const parsed = parseModelString(configuredTarget);
		if (parsed) {
			const explicitModel = availableModels.find(m => m.provider === parsed.provider && m.id === parsed.id);
			if (explicitModel) return explicitModel;
		}

		return availableModels.find(m => m.provider === currentModel.provider && m.id === configuredTarget);
	}

	#resolveRoleModel(role: ModelRole, availableModels: Model[], currentModel: Model | undefined): Model | undefined {
		const roleModelStr =
			role === "default"
				? (this.settings.getModelRole("default") ??
					(currentModel ? `${currentModel.provider}/${currentModel.id}` : undefined))
				: this.settings.getModelRole(role);

		if (!roleModelStr) return undefined;

		const parsed = parseModelString(roleModelStr);
		if (parsed) {
			return availableModels.find(m => m.provider === parsed.provider && m.id === parsed.id);
		}
		const roleLower = roleModelStr.toLowerCase();
		return availableModels.find(m => m.id.toLowerCase() === roleLower);
	}

	#getCompactionModelCandidates(availableModels: Model[]): Model[] {
		const candidates: Model[] = [];
		const seen = new Set<string>();

		const addCandidate = (model: Model | undefined): void => {
			if (!model) return;
			const key = this.#getModelKey(model);
			if (seen.has(key)) return;
			seen.add(key);
			candidates.push(model);
		};

		const currentModel = this.model;
		for (const role of MODEL_ROLE_IDS) {
			addCandidate(this.#resolveRoleModel(role, availableModels, currentModel));
		}

		const sortedByContext = [...availableModels].sort((a, b) => b.contextWindow - a.contextWindow);
		for (const model of sortedByContext) {
			if (!seen.has(this.#getModelKey(model))) {
				addCandidate(model);
				break;
			}
		}

		return candidates;
	}

	/**
	 * Internal: Run auto-compaction with events.
	 */
	async #runAutoCompaction(reason: "overflow" | "threshold", willRetry: boolean): Promise<void> {
		const compactionSettings = this.settings.getGroup("compaction");

		const generation = this.#promptGeneration;
		await this.#emitSessionEvent({ type: "auto_compaction_start", reason });
		// Properly abort and null existing controller before replacing
		if (this.#autoCompactionAbortController) {
			this.#autoCompactionAbortController.abort();
		}
		this.#autoCompactionAbortController = new AbortController();

		try {
			if (!this.model) {
				await this.#emitSessionEvent({
					type: "auto_compaction_end",
					result: undefined,
					aborted: false,
					willRetry: false,
				});
				return;
			}

			const availableModels = this.#modelRegistry.getAvailable();
			if (availableModels.length === 0) {
				await this.#emitSessionEvent({
					type: "auto_compaction_end",
					result: undefined,
					aborted: false,
					willRetry: false,
				});
				return;
			}

			const pathEntries = this.sessionManager.getBranch();

			const preparation = prepareCompaction(pathEntries, compactionSettings);
			if (!preparation) {
				await this.#emitSessionEvent({
					type: "auto_compaction_end",
					result: undefined,
					aborted: false,
					willRetry: false,
				});
				return;
			}

			let hookCompaction: CompactionResult | undefined;
			let fromExtension = false;
			let hookContext: string[] | undefined;
			let hookPrompt: string | undefined;
			let preserveData: Record<string, unknown> | undefined;

			if (this.#extensionRunner?.hasHandlers("session_before_compact")) {
				const hookResult = (await this.#extensionRunner.emit({
					type: "session_before_compact",
					preparation,
					branchEntries: pathEntries,
					customInstructions: undefined,
					signal: this.#autoCompactionAbortController.signal,
				})) as SessionBeforeCompactResult | undefined;

				if (hookResult?.cancel) {
					await this.#emitSessionEvent({
						type: "auto_compaction_end",
						result: undefined,
						aborted: true,
						willRetry: false,
					});
					return;
				}

				if (hookResult?.compaction) {
					hookCompaction = hookResult.compaction;
					fromExtension = true;
				}
			}

			if (!hookCompaction && this.#extensionRunner?.hasHandlers("session.compacting")) {
				const compactMessages = preparation.messagesToSummarize.concat(preparation.turnPrefixMessages);
				const result = (await this.#extensionRunner.emit({
					type: "session.compacting",
					sessionId: this.sessionId,
					messages: compactMessages,
				})) as { context?: string[]; prompt?: string; preserveData?: Record<string, unknown> } | undefined;

				hookContext = result?.context;
				hookPrompt = result?.prompt;
				preserveData = result?.preserveData;
			}

			let summary: string;
			let shortSummary: string | undefined;
			let firstKeptEntryId: string;
			let tokensBefore: number;
			let details: unknown;

			if (hookCompaction) {
				// Extension provided compaction content
				summary = hookCompaction.summary;
				shortSummary = hookCompaction.shortSummary;
				firstKeptEntryId = hookCompaction.firstKeptEntryId;
				tokensBefore = hookCompaction.tokensBefore;
				details = hookCompaction.details;
				preserveData ??= hookCompaction.preserveData;
			} else {
				const candidates = this.#getCompactionModelCandidates(availableModels);
				const retrySettings = this.settings.getGroup("retry");
				let compactResult: CompactionResult | undefined;
				let lastError: unknown;

				for (const candidate of candidates) {
					const apiKey = await this.#modelRegistry.getApiKey(candidate, this.sessionId);
					if (!apiKey) continue;

					let attempt = 0;
					while (true) {
						try {
							compactResult = await compact(
								preparation,
								candidate,
								apiKey,
								undefined,
								this.#autoCompactionAbortController.signal,
								{ promptOverride: hookPrompt, extraContext: hookContext },
							);
							break;
						} catch (error) {
							if (this.#autoCompactionAbortController.signal.aborted) {
								throw error;
							}

							const message = error instanceof Error ? error.message : String(error);
							const retryAfterMs = this.#parseRetryAfterMsFromError(message);
							const shouldRetry =
								retrySettings.enabled &&
								attempt < retrySettings.maxRetries &&
								(retryAfterMs !== undefined || this.#isRetryableErrorMessage(message));
							if (!shouldRetry) {
								lastError = error;
								break;
							}

							const baseDelayMs = retrySettings.baseDelayMs * 2 ** attempt;
							const delayMs = retryAfterMs !== undefined ? Math.max(baseDelayMs, retryAfterMs) : baseDelayMs;

							// If retry delay is too long (>30s), try next candidate instead of waiting
							const maxAcceptableDelayMs = 30_000;
							if (delayMs > maxAcceptableDelayMs) {
								const hasMoreCandidates = candidates.indexOf(candidate) < candidates.length - 1;
								if (hasMoreCandidates) {
									logger.warn("Auto-compaction retry delay too long, trying next model", {
										delayMs,
										retryAfterMs,
										error: message,
										model: `${candidate.provider}/${candidate.id}`,
									});
									lastError = error;
									break; // Exit retry loop, continue to next candidate
								}
								// No more candidates - we have to wait
							}

							attempt++;
							logger.warn("Auto-compaction failed, retrying", {
								attempt,
								maxRetries: retrySettings.maxRetries,
								delayMs,
								retryAfterMs,
								error: message,
								model: `${candidate.provider}/${candidate.id}`,
							});
							await abortableSleep(delayMs, this.#autoCompactionAbortController.signal);
						}
					}

					if (compactResult) {
						break;
					}
				}

				if (!compactResult) {
					if (lastError) {
						throw lastError;
					}
					throw new Error("Compaction failed: no available model");
				}

				summary = compactResult.summary;
				shortSummary = compactResult.shortSummary;
				firstKeptEntryId = compactResult.firstKeptEntryId;
				tokensBefore = compactResult.tokensBefore;
				details = compactResult.details;
			}

			if (this.#autoCompactionAbortController.signal.aborted) {
				await this.#emitSessionEvent({
					type: "auto_compaction_end",
					result: undefined,
					aborted: true,
					willRetry: false,
				});
				return;
			}

			this.sessionManager.appendCompaction(
				summary,
				shortSummary,
				firstKeptEntryId,
				tokensBefore,
				details,
				fromExtension,
				preserveData,
			);
			const newEntries = this.sessionManager.getEntries();
			const sessionContext = this.sessionManager.buildSessionContext();
			this.agent.replaceMessages(sessionContext.messages);
			this.#syncTodoPhasesFromBranch();
			this.#closeCodexProviderSessionsForHistoryRewrite();

			// Get the saved compaction entry for the hook
			const savedCompactionEntry = newEntries.find(e => e.type === "compaction" && e.summary === summary) as
				| CompactionEntry
				| undefined;

			if (this.#extensionRunner && savedCompactionEntry) {
				await this.#extensionRunner.emit({
					type: "session_compact",
					compactionEntry: savedCompactionEntry,
					fromExtension,
				});
			}

			const result: CompactionResult = {
				summary,
				shortSummary,
				firstKeptEntryId,
				tokensBefore,
				details,
				preserveData,
			};
			await this.#emitSessionEvent({ type: "auto_compaction_end", result, aborted: false, willRetry });

			if (!willRetry && compactionSettings.autoContinue !== false) {
				await this.#promptWithMessage(
					{
						role: "developer",
						content: [{ type: "text", text: "Continue if you have next steps." }],
						timestamp: Date.now(),
					},
					"Continue if you have next steps.",
					{ skipPostPromptRecoveryWait: true },
				);
			}

			if (willRetry) {
				const messages = this.agent.state.messages;
				const lastMsg = messages[messages.length - 1];
				if (lastMsg?.role === "assistant" && (lastMsg as AssistantMessage).stopReason === "error") {
					this.agent.replaceMessages(messages.slice(0, -1));
				}

				this.#scheduleAgentContinue({ delayMs: 100, generation });
			} else if (this.agent.hasQueuedMessages()) {
				// Auto-compaction can complete while follow-up/steering/custom messages are waiting.
				// Kick the loop so queued messages are actually delivered.
				this.#scheduleAgentContinue({
					delayMs: 100,
					generation,
					shouldContinue: () => this.agent.hasQueuedMessages(),
				});
			}
		} catch (error) {
			if (this.#autoCompactionAbortController?.signal.aborted) {
				await this.#emitSessionEvent({
					type: "auto_compaction_end",
					result: undefined,
					aborted: true,
					willRetry: false,
				});
				return;
			}
			const errorMessage = error instanceof Error ? error.message : "compaction failed";
			await this.#emitSessionEvent({
				type: "auto_compaction_end",
				result: undefined,
				aborted: false,
				willRetry: false,
				errorMessage:
					reason === "overflow"
						? `Context overflow recovery failed: ${errorMessage}`
						: `Auto-compaction failed: ${errorMessage}`,
			});
		} finally {
			this.#autoCompactionAbortController = undefined;
		}
	}

	/**
	 * Toggle auto-compaction setting.
	 */
	setAutoCompactionEnabled(enabled: boolean): void {
		this.settings.set("compaction.enabled", enabled);
	}

	/** Whether auto-compaction is enabled */
	get autoCompactionEnabled(): boolean {
		return this.settings.get("compaction.enabled");
	}

	// =========================================================================
	// Auto-Retry
	// =========================================================================

	/**
	 * Check if an error is retryable (overloaded, rate limit, server errors).
	 * Context overflow errors are NOT retryable (handled by compaction instead).
	 */
	#isRetryableError(message: AssistantMessage): boolean {
		if (message.stopReason !== "error" || !message.errorMessage) return false;

		// Context overflow is handled by compaction, not retry
		const contextWindow = this.model?.contextWindow ?? 0;
		if (isContextOverflow(message, contextWindow)) return false;

		const err = message.errorMessage;
		return this.#isRetryableErrorMessage(err);
	}

	#isRetryableErrorMessage(errorMessage: string): boolean {
		// Match: overloaded_error, rate limit, usage limit, 429, 500, 502, 503, 504, service unavailable, connection error, fetch failed, retry delay exceeded
		return /overloaded|rate.?limit|usage.?limit|too many requests|429|500|502|503|504|service.?unavailable|server error|internal error|connection.?error|unable to connect|fetch failed|retry delay/i.test(
			errorMessage,
		);
	}

	#isUsageLimitErrorMessage(errorMessage: string): boolean {
		return /usage.?limit|usage_limit_reached|limit_reached/i.test(errorMessage);
	}

	#parseRetryAfterMsFromError(errorMessage: string): number | undefined {
		const now = Date.now();
		const retryAfterMsMatch = /retry-after-ms\s*[:=]\s*(\d+)/i.exec(errorMessage);
		if (retryAfterMsMatch) {
			return Math.max(0, Number(retryAfterMsMatch[1]));
		}

		const retryAfterMatch = /retry-after\s*[:=]\s*([^\s,;]+)/i.exec(errorMessage);
		if (retryAfterMatch) {
			const value = retryAfterMatch[1];
			const seconds = Number(value);
			if (!Number.isNaN(seconds)) {
				return Math.max(0, seconds * 1000);
			}
			const dateMs = Date.parse(value);
			if (!Number.isNaN(dateMs)) {
				return Math.max(0, dateMs - now);
			}
		}

		const resetMsMatch = /x-ratelimit-reset-ms\s*[:=]\s*(\d+)/i.exec(errorMessage);
		if (resetMsMatch) {
			const resetMs = Number(resetMsMatch[1]);
			if (!Number.isNaN(resetMs)) {
				if (resetMs > 1_000_000_000_000) {
					return Math.max(0, resetMs - now);
				}
				return Math.max(0, resetMs);
			}
		}

		const resetMatch = /x-ratelimit-reset\s*[:=]\s*(\d+)/i.exec(errorMessage);
		if (resetMatch) {
			const resetSeconds = Number(resetMatch[1]);
			if (!Number.isNaN(resetSeconds)) {
				if (resetSeconds > 1_000_000_000) {
					return Math.max(0, resetSeconds * 1000 - now);
				}
				return Math.max(0, resetSeconds * 1000);
			}
		}

		return undefined;
	}

	/**
	 * Handle retryable errors with exponential backoff.
	 * @returns true if retry was initiated, false if max retries exceeded or disabled
	 */
	async #handleRetryableError(message: AssistantMessage): Promise<boolean> {
		const retrySettings = this.settings.getGroup("retry");
		if (!retrySettings.enabled) return false;

		const generation = this.#promptGeneration;
		this.#retryAttempt++;

		// Create retry promise on first attempt so waitForRetry() can await it
		// Ensure only one promise exists (avoid orphaned promises from concurrent calls)
		if (!this.#retryPromise) {
			const { promise, resolve } = Promise.withResolvers<void>();
			this.#retryPromise = promise;
			this.#retryResolve = resolve;
		}

		if (this.#retryAttempt > retrySettings.maxRetries) {
			// Max retries exceeded, emit final failure and reset
			await this.#emitSessionEvent({
				type: "auto_retry_end",
				success: false,
				attempt: this.#retryAttempt - 1,
				finalError: message.errorMessage,
			});
			this.#retryAttempt = 0;
			this.#resolveRetry(); // Resolve so waitForRetry() completes
			return false;
		}

		const errorMessage = message.errorMessage || "Unknown error";
		let delayMs = retrySettings.baseDelayMs * 2 ** (this.#retryAttempt - 1);

		if (this.model && this.#isUsageLimitErrorMessage(errorMessage)) {
			const retryAfterMs = this.#parseRetryAfterMsFromError(errorMessage);
			const switched = await this.#modelRegistry.authStorage.markUsageLimitReached(
				this.model.provider,
				this.sessionId,
				{
					retryAfterMs,
					baseUrl: this.model.baseUrl,
				},
			);
			if (switched) {
				delayMs = 0;
			}
		}

		await this.#emitSessionEvent({
			type: "auto_retry_start",
			attempt: this.#retryAttempt,
			maxAttempts: retrySettings.maxRetries,
			delayMs,
			errorMessage,
		});

		// Remove error message from agent state (keep in session for history)
		const messages = this.agent.state.messages;
		if (messages.length > 0 && messages[messages.length - 1].role === "assistant") {
			this.agent.replaceMessages(messages.slice(0, -1));
		}

		// Wait with exponential backoff (abortable)
		// Properly abort and null existing controller before replacing
		if (this.#retryAbortController) {
			this.#retryAbortController.abort();
		}
		this.#retryAbortController = new AbortController();
		try {
			await abortableSleep(delayMs, this.#retryAbortController.signal);
		} catch {
			// Aborted during sleep - emit end event so UI can clean up
			const attempt = this.#retryAttempt;
			this.#retryAttempt = 0;
			this.#retryAbortController = undefined;
			await this.#emitSessionEvent({
				type: "auto_retry_end",
				success: false,
				attempt,
				finalError: "Retry cancelled",
			});
			this.#resolveRetry();
			return false;
		}
		this.#retryAbortController = undefined;

		// Retry via continue() outside the agent_end event callback chain.
		this.#scheduleAgentContinue({ delayMs: 1, generation });

		return true;
	}

	/**
	 * Cancel in-progress retry.
	 */
	abortRetry(): void {
		this.#retryAbortController?.abort();
		// Note: _retryAttempt is reset in the catch block of _autoRetry
		this.#resolveRetry();
	}

	async #promptAgentWithIdleRetry(messages: AgentMessage[], options?: { toolChoice?: ToolChoice }): Promise<void> {
		const deadline = Date.now() + 30_000;
		for (;;) {
			try {
				await this.agent.prompt(messages, options);
				return;
			} catch (err) {
				if (!(err instanceof AgentBusyError)) {
					throw err;
				}
				if (Date.now() >= deadline) {
					throw new Error("Timed out waiting for prior agent run to finish before prompting.");
				}
				await this.agent.waitForIdle();
			}
		}
	}

	/** Whether auto-retry is currently in progress */
	get isRetrying(): boolean {
		return this.#retryPromise !== undefined;
	}

	/** Whether auto-retry is enabled */
	get autoRetryEnabled(): boolean {
		return this.settings.get("retry.enabled") ?? true;
	}

	/**
	 * Toggle auto-retry setting.
	 */
	setAutoRetryEnabled(enabled: boolean): void {
		this.settings.set("retry.enabled", enabled);
	}

	// =========================================================================
	// Bash Execution
	// =========================================================================

	/**
	 * Execute a bash command.
	 * Adds result to agent context and session.
	 * @param command The bash command to execute
	 * @param onChunk Optional streaming callback for output
	 * @param options.excludeFromContext If true, command output won't be sent to LLM (!! prefix)
	 */
	async executeBash(
		command: string,
		onChunk?: (chunk: string) => void,
		options?: { excludeFromContext?: boolean },
	): Promise<BashResult> {
		const excludeFromContext = options?.excludeFromContext === true;
		const cwd = this.sessionManager.getCwd();

		if (this.#extensionRunner?.hasHandlers("user_bash")) {
			const hookResult = await this.#extensionRunner.emitUserBash({
				type: "user_bash",
				command,
				excludeFromContext,
				cwd,
			});
			if (hookResult?.result) {
				this.recordBashResult(command, hookResult.result, options);
				return hookResult.result;
			}
		}

		this.#bashAbortController = new AbortController();

		try {
			const result = await executeBashCommand(command, {
				onChunk,
				signal: this.#bashAbortController.signal,
				sessionKey: this.sessionId,
			});

			this.recordBashResult(command, result, options);
			return result;
		} finally {
			this.#bashAbortController = undefined;
		}
	}

	/**
	 * Record a bash execution result in session history.
	 * Used by executeBash and by extensions that handle bash execution themselves.
	 */
	recordBashResult(command: string, result: BashResult, options?: { excludeFromContext?: boolean }): void {
		const meta = outputMeta().truncationFromSummary(result, { direction: "tail" }).get();
		const bashMessage: BashExecutionMessage = {
			role: "bashExecution",
			command,
			output: result.output,
			exitCode: result.exitCode,
			cancelled: result.cancelled,
			truncated: result.truncated,
			meta,
			timestamp: Date.now(),
			excludeFromContext: options?.excludeFromContext,
		};

		// If agent is streaming, defer adding to avoid breaking tool_use/tool_result ordering
		if (this.isStreaming) {
			// Queue for later - will be flushed on agent_end
			this.#pendingBashMessages.push(bashMessage);
		} else {
			// Add to agent state immediately
			this.agent.appendMessage(bashMessage);

			// Save to session
			this.sessionManager.appendMessage(bashMessage);
		}
	}

	/**
	 * Cancel running bash command.
	 */
	abortBash(): void {
		this.#bashAbortController?.abort();
	}

	/** Whether a bash command is currently running */
	get isBashRunning(): boolean {
		return this.#bashAbortController !== undefined;
	}

	/** Whether there are pending bash messages waiting to be flushed */
	get hasPendingBashMessages(): boolean {
		return this.#pendingBashMessages.length > 0;
	}

	/**
	 * Flush pending bash messages to agent state and session.
	 * Called after agent turn completes to maintain proper message ordering.
	 */
	#flushPendingBashMessages(): void {
		if (this.#pendingBashMessages.length === 0) return;

		for (const bashMessage of this.#pendingBashMessages) {
			// Add to agent state
			this.agent.appendMessage(bashMessage);

			// Save to session
			this.sessionManager.appendMessage(bashMessage);
		}

		this.#pendingBashMessages = [];
	}

	// =========================================================================
	// User-Initiated Python Execution
	// =========================================================================

	/**
	 * Execute Python code in the shared kernel.
	 * Uses the same kernel session as the agent's Python tool, allowing collaborative editing.
	 * @param code The Python code to execute
	 * @param onChunk Optional streaming callback for output
	 * @param options.excludeFromContext If true, execution won't be sent to LLM ($$ prefix)
	 */
	async executePython(
		code: string,
		onChunk?: (chunk: string) => void,
		options?: { excludeFromContext?: boolean },
	): Promise<PythonResult> {
		const excludeFromContext = options?.excludeFromContext === true;
		const cwd = this.sessionManager.getCwd();

		if (this.#extensionRunner?.hasHandlers("user_python")) {
			const hookResult = await this.#extensionRunner.emitUserPython({
				type: "user_python",
				code,
				excludeFromContext,
				cwd,
			});
			if (hookResult?.result) {
				this.recordPythonResult(code, hookResult.result, options);
				return hookResult.result;
			}
		}

		this.#pythonAbortController = new AbortController();

		try {
			// Use the same session ID as the Python tool for kernel sharing
			const sessionFile = this.sessionManager.getSessionFile();
			const sessionId = sessionFile ? `session:${sessionFile}:cwd:${cwd}` : `cwd:${cwd}`;

			const result = await executePythonCommand(code, {
				cwd,
				sessionId,
				kernelMode: this.settings.get("python.kernelMode"),
				useSharedGateway: this.settings.get("python.sharedGateway"),
				onChunk,
				signal: this.#pythonAbortController.signal,
			});

			this.recordPythonResult(code, result, options);
			return result;
		} finally {
			this.#pythonAbortController = undefined;
		}
	}

	/**
	 * Record a Python execution result in session history.
	 */
	recordPythonResult(code: string, result: PythonResult, options?: { excludeFromContext?: boolean }): void {
		const meta = outputMeta().truncationFromSummary(result, { direction: "tail" }).get();
		const pythonMessage: PythonExecutionMessage = {
			role: "pythonExecution",
			code,
			output: result.output,
			exitCode: result.exitCode,
			cancelled: result.cancelled,
			truncated: result.truncated,
			meta,
			timestamp: Date.now(),
			excludeFromContext: options?.excludeFromContext,
		};

		// If agent is streaming, defer adding to avoid breaking tool_use/tool_result ordering
		if (this.isStreaming) {
			this.#pendingPythonMessages.push(pythonMessage);
		} else {
			this.agent.appendMessage(pythonMessage);
			this.sessionManager.appendMessage(pythonMessage);
		}
	}

	/**
	 * Cancel running Python execution.
	 */
	abortPython(): void {
		this.#pythonAbortController?.abort();
	}

	/** Whether a Python execution is currently running */
	get isPythonRunning(): boolean {
		return this.#pythonAbortController !== undefined;
	}

	/** Whether there are pending Python messages waiting to be flushed */
	get hasPendingPythonMessages(): boolean {
		return this.#pendingPythonMessages.length > 0;
	}

	/**
	 * Flush pending Python messages to agent state and session.
	 */
	#flushPendingPythonMessages(): void {
		if (this.#pendingPythonMessages.length === 0) return;

		for (const pythonMessage of this.#pendingPythonMessages) {
			this.agent.appendMessage(pythonMessage);
			this.sessionManager.appendMessage(pythonMessage);
		}

		this.#pendingPythonMessages = [];
	}

	// =========================================================================
	// Session Management
	// =========================================================================

	/**
	 * Reload the current session from disk.
	 *
	 * Intended for extension commands and headless modes to re-read the current session
	 * file and re-emit session_switch hooks.
	 */
	async reload(): Promise<void> {
		const sessionFile = this.sessionFile;
		if (!sessionFile) return;
		await this.switchSession(sessionFile);
	}

	/**
	 * Switch to a different session file.
	 * Aborts current operation, loads messages, restores model/thinking.
	 * Listeners are preserved and will continue receiving events.
	 * @returns true if switch completed, false if cancelled by hook
	 */
	async switchSession(sessionPath: string): Promise<boolean> {
		const previousSessionFile = this.sessionManager.getSessionFile();

		// Emit session_before_switch event (can be cancelled)
		if (this.#extensionRunner?.hasHandlers("session_before_switch")) {
			const result = (await this.#extensionRunner.emit({
				type: "session_before_switch",
				reason: "resume",
				targetSessionFile: sessionPath,
			})) as SessionBeforeSwitchResult | undefined;

			if (result?.cancel) {
				return false;
			}
		}

		this.#disconnectFromAgent();
		await this.abort();
		this.#steeringMessages = [];
		this.#followUpMessages = [];
		this.#pendingNextTurnMessages = [];

		// Flush pending writes before switching
		await this.sessionManager.flush();

		// Set new session
		await this.sessionManager.setSessionFile(sessionPath);
		this.agent.sessionId = this.sessionManager.getSessionId();

		// Reload messages
		const sessionContext = this.sessionManager.buildSessionContext();

		// Emit session_switch event to hooks
		if (this.#extensionRunner) {
			await this.#extensionRunner.emit({
				type: "session_switch",
				reason: "resume",
				previousSessionFile,
			});
		}

		this.agent.replaceMessages(sessionContext.messages);
		this.#syncTodoPhasesFromBranch();

		// Restore model if saved
		const defaultModelStr = sessionContext.models.default;
		if (defaultModelStr) {
			const slashIdx = defaultModelStr.indexOf("/");
			if (slashIdx > 0) {
				const provider = defaultModelStr.slice(0, slashIdx);
				const modelId = defaultModelStr.slice(slashIdx + 1);
				const availableModels = this.#modelRegistry.getAvailable();
				const match = availableModels.find(m => m.provider === provider && m.id === modelId);
				if (match) {
					this.#setModelWithProviderSessionReset(match);
				}
			}
		}

		const hasThinkingEntry = this.sessionManager.getBranch().some(entry => entry.type === "thinking_level_change");
		const defaultThinkingLevel = (this.settings.get("defaultThinkingLevel") ?? "off") as ThinkingLevel;

		if (hasThinkingEntry) {
			// Restore thinking level if saved (setThinkingLevel clamps to model capabilities)
			this.setThinkingLevel(sessionContext.thinkingLevel as ThinkingLevel);
		} else {
			const availableLevels = this.getAvailableThinkingLevels();
			const effectiveLevel = availableLevels.includes(defaultThinkingLevel)
				? defaultThinkingLevel
				: this.#clampThinkingLevel(defaultThinkingLevel, availableLevels);
			this.agent.setThinkingLevel(effectiveLevel);
			this.sessionManager.appendThinkingLevelChange(effectiveLevel);
		}

		this.#reconnectToAgent();
		return true;
	}

	/**
	 * Create a branch from a specific entry.
	 * Emits before_branch/branch session events to hooks.
	 *
	 * @param entryId ID of the entry to branch from
	 * @returns Object with:
	 *   - selectedText: The text of the selected user message (for editor pre-fill)
	 *   - cancelled: True if a hook cancelled the branch
	 */
	async branch(entryId: string): Promise<{ selectedText: string; cancelled: boolean }> {
		const previousSessionFile = this.sessionFile;
		const selectedEntry = this.sessionManager.getEntry(entryId);

		if (!selectedEntry || selectedEntry.type !== "message" || selectedEntry.message.role !== "user") {
			throw new Error("Invalid entry ID for branching");
		}

		const selectedText = this.#extractUserMessageText(selectedEntry.message.content);

		let skipConversationRestore = false;

		// Emit session_before_branch event (can be cancelled)
		if (this.#extensionRunner?.hasHandlers("session_before_branch")) {
			const result = (await this.#extensionRunner.emit({
				type: "session_before_branch",
				entryId,
			})) as SessionBeforeBranchResult | undefined;

			if (result?.cancel) {
				return { selectedText, cancelled: true };
			}
			skipConversationRestore = result?.skipConversationRestore ?? false;
		}

		// Clear pending messages (bound to old session state)
		this.#pendingNextTurnMessages = [];

		// Flush pending writes before branching
		await this.sessionManager.flush();
		this.#asyncJobManager?.cancelAll();

		if (!selectedEntry.parentId) {
			await this.sessionManager.newSession({ parentSession: previousSessionFile });
		} else {
			this.sessionManager.createBranchedSession(selectedEntry.parentId);
		}
		this.#syncTodoPhasesFromBranch();
		this.agent.sessionId = this.sessionManager.getSessionId();

		// Reload messages from entries (works for both file and in-memory mode)
		const sessionContext = this.sessionManager.buildSessionContext();

		// Emit session_branch event to hooks (after branch completes)
		if (this.#extensionRunner) {
			await this.#extensionRunner.emit({
				type: "session_branch",
				previousSessionFile,
			});
		}

		if (!skipConversationRestore) {
			this.agent.replaceMessages(sessionContext.messages);
		}

		return { selectedText, cancelled: false };
	}

	// =========================================================================
	// Tree Navigation
	// =========================================================================

	/**
	 * Navigate to a different node in the session tree.
	 * Unlike branch() which creates a new session file, this stays in the same file.
	 *
	 * @param targetId The entry ID to navigate to
	 * @param options.summarize Whether user wants to summarize abandoned branch
	 * @param options.customInstructions Custom instructions for summarizer
	 * @returns Result with editorText (if user message) and cancelled status
	 */
	async navigateTree(
		targetId: string,
		options: { summarize?: boolean; customInstructions?: string } = {},
	): Promise<{ editorText?: string; cancelled: boolean; aborted?: boolean; summaryEntry?: BranchSummaryEntry }> {
		const oldLeafId = this.sessionManager.getLeafId();

		// No-op if already at target
		if (targetId === oldLeafId) {
			return { cancelled: false };
		}

		// Model required for summarization
		if (options.summarize && !this.model) {
			throw new Error("No model available for summarization");
		}

		const targetEntry = this.sessionManager.getEntry(targetId);
		if (!targetEntry) {
			throw new Error(`Entry ${targetId} not found`);
		}

		// Collect entries to summarize (from old leaf to common ancestor)
		const { entries: entriesToSummarize, commonAncestorId } = collectEntriesForBranchSummary(
			this.sessionManager,
			oldLeafId,
			targetId,
		);

		// Prepare event data
		const preparation: TreePreparation = {
			targetId,
			oldLeafId,
			commonAncestorId,
			entriesToSummarize,
			userWantsSummary: options.summarize ?? false,
		};

		// Set up abort controller for summarization
		this.#branchSummaryAbortController = new AbortController();
		let hookSummary: { summary: string; details?: unknown } | undefined;
		let fromExtension = false;

		// Emit session_before_tree event
		if (this.#extensionRunner?.hasHandlers("session_before_tree")) {
			const result = (await this.#extensionRunner.emit({
				type: "session_before_tree",
				preparation,
				signal: this.#branchSummaryAbortController.signal,
			})) as SessionBeforeTreeResult | undefined;

			if (result?.cancel) {
				return { cancelled: true };
			}

			if (result?.summary && options.summarize) {
				hookSummary = result.summary;
				fromExtension = true;
			}
		}

		// Run default summarizer if needed
		let summaryText: string | undefined;
		let summaryDetails: unknown;
		if (options.summarize && entriesToSummarize.length > 0 && !hookSummary) {
			const model = this.model!;
			const apiKey = await this.#modelRegistry.getApiKey(model, this.sessionId);
			if (!apiKey) {
				throw new Error(`No API key for ${model.provider}`);
			}
			const branchSummarySettings = this.settings.getGroup("branchSummary");
			const result = await generateBranchSummary(entriesToSummarize, {
				model,
				apiKey,
				signal: this.#branchSummaryAbortController.signal,
				customInstructions: options.customInstructions,
				reserveTokens: branchSummarySettings.reserveTokens,
			});
			this.#branchSummaryAbortController = undefined;
			if (result.aborted) {
				return { cancelled: true, aborted: true };
			}
			if (result.error) {
				throw new Error(result.error);
			}
			summaryText = result.summary;
			summaryDetails = {
				readFiles: result.readFiles || [],
				modifiedFiles: result.modifiedFiles || [],
			};
		} else if (hookSummary) {
			summaryText = hookSummary.summary;
			summaryDetails = hookSummary.details;
		}

		// Determine the new leaf position based on target type
		let newLeafId: string | null;
		let editorText: string | undefined;

		if (targetEntry.type === "message" && targetEntry.message.role === "user") {
			// User message: leaf = parent (null if root), text goes to editor
			newLeafId = targetEntry.parentId;
			editorText = this.#extractUserMessageText(targetEntry.message.content);
		} else if (targetEntry.type === "custom_message") {
			// Custom message: leaf = parent (null if root), text goes to editor
			newLeafId = targetEntry.parentId;
			editorText =
				typeof targetEntry.content === "string"
					? targetEntry.content
					: targetEntry.content
							.filter((c): c is { type: "text"; text: string } => c.type === "text")
							.map(c => c.text)
							.join("");
		} else {
			// Non-user message: leaf = selected node
			newLeafId = targetId;
		}

		// Switch leaf (with or without summary)
		// Summary is attached at the navigation target position (newLeafId), not the old branch
		let summaryEntry: BranchSummaryEntry | undefined;
		if (summaryText) {
			// Create summary at target position (can be null for root)
			const summaryId = this.sessionManager.branchWithSummary(newLeafId, summaryText, summaryDetails, fromExtension);
			summaryEntry = this.sessionManager.getEntry(summaryId) as BranchSummaryEntry;
		} else if (newLeafId === null) {
			// No summary, navigating to root - reset leaf
			this.sessionManager.resetLeaf();
		} else {
			// No summary, navigating to non-root
			this.sessionManager.branch(newLeafId);
		}

		// Update agent state
		const sessionContext = this.sessionManager.buildSessionContext();
		this.agent.replaceMessages(sessionContext.messages);
		this.#syncTodoPhasesFromBranch();

		// Emit session_tree event
		if (this.#extensionRunner) {
			await this.#extensionRunner.emit({
				type: "session_tree",
				newLeafId: this.sessionManager.getLeafId(),
				oldLeafId,
				summaryEntry,
				fromExtension: summaryText ? fromExtension : undefined,
			});
		}

		this.#branchSummaryAbortController = undefined;
		return { editorText, cancelled: false, summaryEntry };
	}

	/**
	 * Get all user messages from session for branch selector.
	 */
	getUserMessagesForBranching(): Array<{ entryId: string; text: string }> {
		const entries = this.sessionManager.getEntries();
		const result: Array<{ entryId: string; text: string }> = [];

		for (const entry of entries) {
			if (entry.type !== "message") continue;
			if (entry.message.role !== "user") continue;

			const text = this.#extractUserMessageText(entry.message.content);
			if (text) {
				result.push({ entryId: entry.id, text });
			}
		}

		return result;
	}

	#extractUserMessageText(content: string | Array<{ type: string; text?: string }>): string {
		if (typeof content === "string") return content;
		if (Array.isArray(content)) {
			return content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map(c => c.text)
				.join("");
		}
		return "";
	}

	/**
	 * Get session statistics.
	 */
	getSessionStats(): SessionStats {
		const state = this.state;
		const userMessages = state.messages.filter(m => m.role === "user").length;
		const assistantMessages = state.messages.filter(m => m.role === "assistant").length;
		const toolResults = state.messages.filter(m => m.role === "toolResult").length;

		let toolCalls = 0;
		let totalInput = 0;
		let totalOutput = 0;
		let totalCacheRead = 0;
		let totalCacheWrite = 0;
		let totalCost = 0;

		const getTaskToolUsage = (details: unknown): Usage | undefined => {
			if (!details || typeof details !== "object") return undefined;
			const record = details as Record<string, unknown>;
			const usage = record.usage;
			if (!usage || typeof usage !== "object") return undefined;
			return usage as Usage;
		};

		for (const message of state.messages) {
			if (message.role === "assistant") {
				const assistantMsg = message as AssistantMessage;
				toolCalls += assistantMsg.content.filter(c => c.type === "toolCall").length;
				totalInput += assistantMsg.usage.input;
				totalOutput += assistantMsg.usage.output;
				totalCacheRead += assistantMsg.usage.cacheRead;
				totalCacheWrite += assistantMsg.usage.cacheWrite;
				totalCost += assistantMsg.usage.cost.total;
			}

			if (message.role === "toolResult" && message.toolName === "task") {
				const usage = getTaskToolUsage(message.details);
				if (usage) {
					totalInput += usage.input;
					totalOutput += usage.output;
					totalCacheRead += usage.cacheRead;
					totalCacheWrite += usage.cacheWrite;
					totalCost += usage.cost.total;
				}
			}
		}

		return {
			sessionFile: this.sessionFile,
			sessionId: this.sessionId,
			userMessages,
			assistantMessages,
			toolCalls,
			toolResults,
			totalMessages: state.messages.length,
			tokens: {
				input: totalInput,
				output: totalOutput,
				cacheRead: totalCacheRead,
				cacheWrite: totalCacheWrite,
				total: totalInput + totalOutput + totalCacheRead + totalCacheWrite,
			},
			cost: totalCost,
		};
	}

	/**
	 * Get current context usage statistics.
	 * Uses the last assistant message's usage data when available,
	 * otherwise estimates tokens for all messages.
	 */
	getContextUsage(): ContextUsage | undefined {
		const model = this.model;
		if (!model) return undefined;

		const contextWindow = model.contextWindow ?? 0;
		if (contextWindow <= 0) return undefined;

		// After compaction, the last assistant usage reflects pre-compaction context size.
		// We can only trust usage from an assistant that responded after the latest compaction.
		// If no such assistant exists, context token count is unknown until the next LLM response.
		const branchEntries = this.sessionManager.getBranch();
		const latestCompaction = getLatestCompactionEntry(branchEntries);

		if (latestCompaction) {
			// Check if there's a valid assistant usage after the compaction boundary
			const compactionIndex = branchEntries.lastIndexOf(latestCompaction);
			let hasPostCompactionUsage = false;
			for (let i = branchEntries.length - 1; i > compactionIndex; i--) {
				const entry = branchEntries[i];
				if (entry.type === "message" && entry.message.role === "assistant") {
					const assistant = entry.message;
					if (assistant.stopReason !== "aborted" && assistant.stopReason !== "error") {
						const contextTokens = calculateContextTokens(assistant.usage);
						if (contextTokens > 0) {
							hasPostCompactionUsage = true;
						}
						break;
					}
				}
			}

			if (!hasPostCompactionUsage) {
				return { tokens: null, contextWindow, percent: null };
			}
		}

		const estimate = this.#estimateContextTokens();
		const percent = (estimate.tokens / contextWindow) * 100;

		return {
			tokens: estimate.tokens,
			contextWindow,
			percent,
		};
	}

	async fetchUsageReports(): Promise<UsageReport[] | null> {
		const authStorage = this.#modelRegistry.authStorage;
		if (!authStorage.fetchUsageReports) return null;
		return authStorage.fetchUsageReports({
			baseUrlResolver: provider => this.#modelRegistry.getProviderBaseUrl?.(provider),
		});
	}

	/**
	 * Estimate context tokens from messages, using the last assistant usage when available.
	 */
	#estimateContextTokens(): {
		tokens: number;
	} {
		const messages = this.messages;

		// Find last assistant message with usage
		let lastUsageIndex: number | null = null;
		let lastUsage: Usage | undefined;
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i];
			if (msg.role === "assistant") {
				const assistantMsg = msg as AssistantMessage;
				if (assistantMsg.usage) {
					lastUsage = assistantMsg.usage;
					lastUsageIndex = i;
					break;
				}
			}
		}

		if (!lastUsage || lastUsageIndex === null) {
			// No usage data - estimate all messages
			let estimated = 0;
			for (const message of messages) {
				estimated += estimateTokens(message);
			}
			return {
				tokens: estimated,
			};
		}

		const usageTokens = calculateContextTokens(lastUsage);
		let trailingTokens = 0;
		for (let i = lastUsageIndex + 1; i < messages.length; i++) {
			trailingTokens += estimateTokens(messages[i]);
		}

		return {
			tokens: usageTokens + trailingTokens,
		};
	}

	/**
	 * Export session to HTML.
	 * @param outputPath Optional output path (defaults to session directory)
	 * @returns Path to exported file
	 */
	async exportToHtml(outputPath?: string): Promise<string> {
		const themeName = getCurrentThemeName();
		return exportSessionToHtml(this.sessionManager, this.state, { outputPath, themeName });
	}

	// =========================================================================
	// Utilities
	// =========================================================================

	/**
	 * Get text content of last assistant message.
	 * Useful for /copy command.
	 * @returns Text content, or undefined if no assistant message exists
	 */
	getLastAssistantText(): string | undefined {
		const lastAssistant = this.messages
			.slice()
			.reverse()
			.find(m => {
				if (m.role !== "assistant") return false;
				const msg = m as AssistantMessage;
				// Skip aborted messages with no content
				if (msg.stopReason === "aborted" && msg.content.length === 0) return false;
				return true;
			});

		if (!lastAssistant) return undefined;

		let text = "";
		for (const content of (lastAssistant as AssistantMessage).content) {
			if (content.type === "text") {
				text += content.text;
			}
		}

		return text.trim() || undefined;
	}

	/**
	 * Format the entire session as plain text for clipboard export.
	 * Includes user messages, assistant text, thinking blocks, tool calls, and tool results.
	 */
	formatSessionAsText(): string {
		const lines: string[] = [];

		/** Serialize an object as XML parameter elements, one per key. */
		function formatArgsAsXml(args: Record<string, unknown>, indent = "\t"): string {
			const parts: string[] = [];
			for (const [key, value] of Object.entries(args)) {
				if (key === INTENT_FIELD) continue;
				const text = typeof value === "string" ? value : JSON.stringify(value);
				parts.push(`${indent}<parameter name="${key}">${text}</parameter>`);
			}
			return parts.join("\n");
		}

		// Include system prompt at the beginning
		const systemPrompt = this.agent.state.systemPrompt;
		if (systemPrompt) {
			lines.push("## System Prompt\n");
			lines.push(systemPrompt);
			lines.push("\n");
		}

		// Include model and thinking level
		const model = this.agent.state.model;
		const thinkingLevel = this.agent.state.thinkingLevel;
		lines.push("## Configuration\n");
		lines.push(`Model: ${model.provider}/${model.id}`);
		lines.push(`Thinking Level: ${thinkingLevel}`);
		lines.push("\n");

		// Include available tools
		const tools = this.agent.state.tools;

		// Recursively strip all fields starting with 'TypeBox.' from an object
		function stripTypeBoxFields(obj: any): any {
			if (Array.isArray(obj)) {
				return obj.map(stripTypeBoxFields);
			}
			if (obj && typeof obj === "object") {
				const result: Record<string, any> = {};
				for (const [k, v] of Object.entries(obj)) {
					if (!k.startsWith("TypeBox.")) {
						result[k] = stripTypeBoxFields(v);
					}
				}
				return result;
			}
			return obj;
		}

		if (tools.length > 0) {
			lines.push("## Available Tools\n");
			for (const tool of tools) {
				lines.push(`<tool name="${tool.name}">`);
				lines.push(tool.description);
				const parametersClean = stripTypeBoxFields(tool.parameters);
				lines.push(`\nParameters:\n${formatArgsAsXml(parametersClean as Record<string, unknown>)}`);
				lines.push("<" + "/tool>\n");
			}
			lines.push("\n");
		}

		for (const msg of this.messages) {
			if (msg.role === "user") {
				lines.push("## User\n");
				if (typeof msg.content === "string") {
					lines.push(msg.content);
				} else {
					for (const c of msg.content) {
						if (c.type === "text") {
							lines.push(c.text);
						} else if (c.type === "image") {
							lines.push("[Image]");
						}
					}
				}
				lines.push("\n");
			} else if (msg.role === "assistant") {
				const assistantMsg = msg as AssistantMessage;
				lines.push("## Assistant\n");

				for (const c of assistantMsg.content) {
					if (c.type === "text") {
						lines.push(c.text);
					} else if (c.type === "thinking") {
						lines.push("<thinking>");
						lines.push(c.thinking);
						lines.push("</thinking>\n");
					} else if (c.type === "toolCall") {
						lines.push(`<invoke name="${c.name}">`);
						if (c.arguments && typeof c.arguments === "object") {
							lines.push(formatArgsAsXml(c.arguments as Record<string, unknown>));
						}
						lines.push("<" + "/invoke>\n");
					}
				}
				lines.push("");
			} else if (msg.role === "toolResult") {
				lines.push(`### Tool Result: ${msg.toolName}`);
				if (msg.isError) {
					lines.push("(error)");
				}
				for (const c of msg.content) {
					if (c.type === "text") {
						lines.push("```");
						lines.push(c.text);
						lines.push("```");
					} else if (c.type === "image") {
						lines.push("[Image output]");
					}
				}
				lines.push("");
			} else if (msg.role === "bashExecution") {
				const bashMsg = msg as BashExecutionMessage;
				if (!bashMsg.excludeFromContext) {
					lines.push("## Bash Execution\n");
					lines.push(bashExecutionToText(bashMsg));
					lines.push("\n");
				}
			} else if (msg.role === "pythonExecution") {
				const pythonMsg = msg as PythonExecutionMessage;
				if (!pythonMsg.excludeFromContext) {
					lines.push("## Python Execution\n");
					lines.push(pythonExecutionToText(pythonMsg));
					lines.push("\n");
				}
			} else if (msg.role === "custom" || msg.role === "hookMessage") {
				const customMsg = msg as CustomMessage | HookMessage;
				lines.push(`## ${customMsg.customType}\n`);
				if (typeof customMsg.content === "string") {
					lines.push(customMsg.content);
				} else {
					for (const c of customMsg.content) {
						if (c.type === "text") {
							lines.push(c.text);
						} else if (c.type === "image") {
							lines.push("[Image]");
						}
					}
				}
				lines.push("\n");
			} else if (msg.role === "branchSummary") {
				const branchMsg = msg as BranchSummaryMessage;
				lines.push("## Branch Summary\n");
				lines.push(`(from branch: ${branchMsg.fromId})\n`);
				lines.push(branchMsg.summary);
				lines.push("\n");
			} else if (msg.role === "compactionSummary") {
				const compactMsg = msg as CompactionSummaryMessage;
				lines.push("## Compaction Summary\n");
				lines.push(`(${compactMsg.tokensBefore} tokens before compaction)\n`);
				lines.push(compactMsg.summary);
				lines.push("\n");
			} else if (msg.role === "fileMention") {
				const fileMsg = msg as FileMentionMessage;
				lines.push("## File Mention\n");
				for (const file of fileMsg.files) {
					lines.push(`<file path="${file.path}">`);
					if (file.content) {
						lines.push(file.content);
					}
					if (file.image) {
						lines.push("[Image attached]");
					}
					lines.push("</file>\n");
				}
				lines.push("\n");
			}
		}

		return lines.join("\n").trim();
	}

	/**
	 * Format the conversation as compact context for subagents.
	 * Includes only user messages and assistant text responses.
	 * Excludes: system prompt, tool definitions, tool calls/results, thinking blocks.
	 */
	formatCompactContext(): string {
		const lines: string[] = [];
		lines.push("# Conversation Context");
		lines.push("");
		lines.push(
			"This is a summary of the parent conversation. Read this if you need additional context about what was discussed or decided.",
		);
		lines.push("");

		for (const msg of this.messages) {
			if (msg.role === "user") {
				lines.push("## User");
				lines.push("");
				if (typeof msg.content === "string") {
					lines.push(msg.content);
				} else {
					for (const c of msg.content) {
						if (c.type === "text") {
							lines.push(c.text);
						} else if (c.type === "image") {
							lines.push("[Image attached]");
						}
					}
				}
				lines.push("");
			} else if (msg.role === "assistant") {
				const assistantMsg = msg as AssistantMessage;
				// Only include text content, skip tool calls and thinking
				const textParts: string[] = [];
				for (const c of assistantMsg.content) {
					if (c.type === "text" && c.text.trim()) {
						textParts.push(c.text);
					}
				}
				if (textParts.length > 0) {
					lines.push("## Assistant");
					lines.push("");
					lines.push(textParts.join("\n\n"));
					lines.push("");
				}
			} else if (msg.role === "fileMention") {
				const fileMsg = msg as FileMentionMessage;
				const paths = fileMsg.files.map(f => f.path).join(", ");
				lines.push(`[Files referenced: ${paths}]`);
				lines.push("");
			} else if (msg.role === "compactionSummary") {
				const compactMsg = msg as CompactionSummaryMessage;
				lines.push("## Earlier Context (Summarized)");
				lines.push("");
				lines.push(compactMsg.summary);
				lines.push("");
			}
			// Skip: toolResult, bashExecution, pythonExecution, branchSummary, custom, hookMessage
		}

		return lines.join("\n").trim();
	}

	// =========================================================================
	// Extension System
	// =========================================================================

	/**
	 * Check if extensions have handlers for a specific event type.
	 */
	hasExtensionHandlers(eventType: string): boolean {
		return this.#extensionRunner?.hasHandlers(eventType) ?? false;
	}

	/**
	 * Get the extension runner (for setting UI context and error handlers).
	 */
	get extensionRunner(): ExtensionRunner | undefined {
		return this.#extensionRunner;
	}
}
