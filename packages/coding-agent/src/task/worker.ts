/**
 * Worker thread for subagent execution.
 *
 * This worker runs in a separate thread via Bun's Worker API. It creates a minimal
 * AgentSession and forwards events back to the parent thread.
 *
 * ## Event Flow
 *
 * 1. Parent sends { type: "start", payload } with task config
 * 2. Worker creates AgentSession and subscribes to events
 * 3. Worker forwards AgentEvent messages via postMessage
 * 4. Worker sends { type: "done", exitCode, ... } on completion
 * 5. Parent can send { type: "abort" } to request cancellation
 */
import type { AgentEvent, ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import type { Api, Model } from "@oh-my-pi/pi-ai";
import { setPreludeDocsCache } from "@oh-my-pi/pi-coding-agent/ipy/executor";
import { logger, postmortem, untilAborted } from "@oh-my-pi/pi-utils";
import type { TSchema } from "@sinclair/typebox";
import { ModelRegistry } from "../config/model-registry";
import { parseModelPattern, parseModelString } from "../config/model-resolver";
import { renderPromptTemplate } from "../config/prompt-templates";
import { SettingsManager } from "../config/settings-manager";
import type { CustomTool } from "../extensibility/custom-tools/types";
import { type LspToolDetails, lspSchema } from "../lsp/types";
import lspDescription from "../prompts/tools/lsp.md" with { type: "text" };
import { createAgentSession, discoverAuthStorage, discoverModels } from "../sdk";
import type { AgentSessionEvent } from "../session/agent-session";
import { AuthStorage } from "../session/auth-storage";
import { SessionManager } from "../session/session-manager";
import { getPythonToolDescription, type PythonToolDetails, type PythonToolParams, pythonSchema } from "../tools/python";
import { ToolAbortError } from "../tools/tool-errors";
import type {
	LspToolCallResponse,
	MCPToolCallResponse,
	MCPToolMetadata,
	PythonToolCallResponse,
	SubagentWorkerRequest,
	SubagentWorkerResponse,
	SubagentWorkerStartPayload,
} from "./worker-protocol";

type PostMessageFn = (message: SubagentWorkerResponse) => void;

const postMessageSafe: PostMessageFn = message => {
	try {
		(globalThis as typeof globalThis & { postMessage: PostMessageFn }).postMessage(message);
	} catch {
		// Parent may have terminated worker, nothing we can do
	}
};

interface PendingMCPCall {
	resolve: (result: MCPToolCallResponse["result"]) => void;
	reject: (error: Error) => void;
	timeoutId: ReturnType<typeof setTimeout>;
}

interface PendingPythonCall {
	resolve: (result: PythonToolCallResponse["result"]) => void;
	reject: (error: Error) => void;
	timeoutId?: ReturnType<typeof setTimeout>;
}

interface PendingLspCall {
	resolve: (result: LspToolCallResponse["result"]) => void;
	reject: (error: Error) => void;
	timeoutId?: ReturnType<typeof setTimeout>;
}

const pendingMCPCalls = new Map<string, PendingMCPCall>();
const pendingPythonCalls = new Map<string, PendingPythonCall>();
const pendingLspCalls = new Map<string, PendingLspCall>();
const MCP_CALL_TIMEOUT_MS = 60_000;
let mcpCallIdCounter = 0;
let pythonCallIdCounter = 0;
let lspCallIdCounter = 0;

function generateMCPCallId(): string {
	return `mcp_${Date.now()}_${++mcpCallIdCounter}`;
}

function generatePythonCallId(): string {
	return `python_${Date.now()}_${++pythonCallIdCounter}`;
}

function generateLspCallId(): string {
	return `lsp_${Date.now()}_${++lspCallIdCounter}`;
}

function callMCPToolViaParent(
	serverName: string,
	mcpToolName: string,
	params: Record<string, unknown>,
	signal?: AbortSignal,
	timeoutMs = MCP_CALL_TIMEOUT_MS,
): Promise<{ content: Array<{ type: string; text?: string; [key: string]: unknown }>; isError?: boolean }> {
	const { promise, resolve, reject } = Promise.withResolvers<{
		content: Array<{ type: string; text?: string; [key: string]: unknown }>;
		isError?: boolean;
	}>();
	const callId = generateMCPCallId();
	if (signal?.aborted) {
		reject(new ToolAbortError());
		return promise;
	}

	const timeoutId = setTimeout(() => {
		pendingMCPCalls.delete(callId);
		reject(new Error(`MCP call timed out after ${timeoutMs}ms`));
	}, timeoutMs);

	const cleanup = () => {
		clearTimeout(timeoutId);
		pendingMCPCalls.delete(callId);
	};

	if (typeof signal?.addEventListener === "function") {
		signal.addEventListener(
			"abort",
			() => {
				cleanup();
				reject(new ToolAbortError());
			},
			{ once: true },
		);
	}

	pendingMCPCalls.set(callId, {
		resolve: result => {
			cleanup();
			resolve(result ?? { content: [] });
		},
		reject: error => {
			cleanup();
			reject(error);
		},
		timeoutId,
	});

	postMessageSafe({
		type: "mcp_tool_call",
		callId,
		serverName,
		mcpToolName,
		params,
		timeoutMs,
	} as SubagentWorkerResponse);

	return promise;
}

function callPythonToolViaParent(
	params: PythonToolParams,
	signal?: AbortSignal,
	timeoutMs?: number,
): Promise<PythonToolCallResponse["result"]> {
	const { promise, resolve, reject } = Promise.withResolvers<PythonToolCallResponse["result"]>();
	const callId = generatePythonCallId();
	if (signal?.aborted) {
		reject(new ToolAbortError());
		return promise;
	}

	const sendCancel = (reason: string) => {
		postMessageSafe({ type: "python_tool_cancel", callId, reason } as SubagentWorkerResponse);
	};

	const timeoutId =
		typeof timeoutMs === "number" && Number.isFinite(timeoutMs)
			? setTimeout(() => {
					pendingPythonCalls.delete(callId);
					sendCancel(`Python call timed out after ${timeoutMs}ms`);
					reject(new Error(`Python call timed out after ${timeoutMs}ms`));
				}, timeoutMs)
			: undefined;

	const cleanup = () => {
		if (timeoutId) {
			clearTimeout(timeoutId);
		}
		pendingPythonCalls.delete(callId);
	};

	if (typeof signal?.addEventListener === "function") {
		signal.addEventListener(
			"abort",
			() => {
				cleanup();
				sendCancel("Aborted");
				reject(new ToolAbortError());
			},
			{ once: true },
		);
	}

	pendingPythonCalls.set(callId, {
		resolve: result => {
			cleanup();
			resolve(result ?? { content: [] });
		},
		reject: error => {
			cleanup();
			reject(error);
		},
		timeoutId,
	});

	postMessageSafe({
		type: "python_tool_call",
		callId,
		params,
		timeoutMs,
	} as SubagentWorkerResponse);

	return promise;
}

function callLspToolViaParent(
	params: Record<string, unknown>,
	signal?: AbortSignal,
	timeoutMs?: number,
): Promise<LspToolCallResponse["result"]> {
	const { promise, resolve, reject } = Promise.withResolvers<LspToolCallResponse["result"]>();
	const callId = generateLspCallId();
	if (signal?.aborted) {
		reject(new ToolAbortError());
		return promise;
	}

	const timeoutId =
		typeof timeoutMs === "number" && Number.isFinite(timeoutMs)
			? setTimeout(() => {
					pendingLspCalls.delete(callId);
					reject(new Error(`LSP call timed out after ${timeoutMs}ms`));
				}, timeoutMs)
			: undefined;

	const cleanup = () => {
		if (timeoutId) {
			clearTimeout(timeoutId);
		}
		pendingLspCalls.delete(callId);
	};

	if (typeof signal?.addEventListener === "function") {
		signal.addEventListener(
			"abort",
			() => {
				cleanup();
				reject(new ToolAbortError());
			},
			{ once: true },
		);
	}

	pendingLspCalls.set(callId, {
		resolve: result => {
			cleanup();
			resolve(result ?? { content: [] });
		},
		reject: error => {
			cleanup();
			reject(error);
		},
		timeoutId,
	});

	postMessageSafe({
		type: "lsp_tool_call",
		callId,
		params,
		timeoutMs,
	} as SubagentWorkerResponse);

	return promise;
}

function handleMCPToolResult(response: MCPToolCallResponse): void {
	const pending = pendingMCPCalls.get(response.callId);
	if (!pending) return;
	if (response.error) {
		pending.reject(new Error(response.error));
	} else {
		pending.resolve(response.result);
	}
}

function handlePythonToolResult(response: PythonToolCallResponse): void {
	const pending = pendingPythonCalls.get(response.callId);
	if (!pending) return;
	if (response.error) {
		pending.reject(new Error(response.error));
	} else {
		pending.resolve(response.result);
	}
}

function handleLspToolResult(response: LspToolCallResponse): void {
	const pending = pendingLspCalls.get(response.callId);
	if (!pending) return;
	if (response.error) {
		pending.reject(new Error(response.error));
	} else {
		pending.resolve(response.result);
	}
}

function rejectPendingCalls(reason: string): void {
	const error = new Error(reason);
	const mcpCalls = Array.from(pendingMCPCalls.values());
	const pythonCalls = Array.from(pendingPythonCalls.values());
	const lspCalls = Array.from(pendingLspCalls.values());
	pendingMCPCalls.clear();
	pendingPythonCalls.clear();
	pendingLspCalls.clear();
	for (const pending of mcpCalls) {
		clearTimeout(pending.timeoutId);
		pending.reject(error);
	}
	for (const pending of pythonCalls) {
		clearTimeout(pending.timeoutId);
		pending.reject(error);
	}
	for (const pending of lspCalls) {
		clearTimeout(pending.timeoutId);
		pending.reject(error);
	}
}

function createMCPProxyTool(metadata: MCPToolMetadata): CustomTool<TSchema> {
	return {
		name: metadata.name,
		label: metadata.label,
		description: metadata.description,
		parameters: metadata.parameters as TSchema,
		execute: async (_toolCallId, params, _onUpdate, _ctx, signal) => {
			try {
				const result = await callMCPToolViaParent(
					metadata.serverName,
					metadata.mcpToolName,
					params as Record<string, unknown>,
					signal,
					metadata.timeoutMs,
				);
				return {
					content: result.content.map(c =>
						c.type === "text"
							? { type: "text" as const, text: c.text ?? "" }
							: { type: "text" as const, text: JSON.stringify(c) },
					),
					details: { serverName: metadata.serverName, mcpToolName: metadata.mcpToolName, isError: result.isError },
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text" as const,
							text: `MCP error: ${error instanceof Error ? error.message : String(error)}`,
						},
					],
					details: { serverName: metadata.serverName, mcpToolName: metadata.mcpToolName, isError: true },
				};
			}
		},
	};
}

function getPythonCallTimeoutMs(params: PythonToolParams): number | undefined {
	const timeout = params.timeout;
	if (typeof timeout === "number" && Number.isFinite(timeout) && timeout > 0) {
		return Math.max(1000, Math.round(timeout * 1000) + 1000);
	}
	return undefined;
}

function createPythonProxyTool(): CustomTool<typeof pythonSchema> {
	return {
		name: "python",
		label: "Python",
		description: getPythonToolDescription(),
		parameters: pythonSchema,
		execute: async (_toolCallId, params, _onUpdate, _ctx, signal) => {
			try {
				const timeoutMs = getPythonCallTimeoutMs(params as PythonToolParams);
				const result = await callPythonToolViaParent(params as PythonToolParams, signal, timeoutMs);
				return {
					content:
						result?.content?.map(c =>
							c.type === "text"
								? { type: "text" as const, text: c.text ?? "" }
								: { type: "text" as const, text: JSON.stringify(c) },
						) ?? [],
					details: result?.details as PythonToolDetails | undefined,
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Python error: ${error instanceof Error ? error.message : String(error)}`,
						},
					],
					details: { isError: true } as PythonToolDetails,
				};
			}
		},
	};
}

function createLspProxyTool(): CustomTool<typeof lspSchema> {
	return {
		name: "lsp",
		label: "LSP",
		description: renderPromptTemplate(lspDescription),
		parameters: lspSchema,
		execute: async (_toolCallId, params, _onUpdate, _ctx, signal) => {
			try {
				const result = await callLspToolViaParent(params as Record<string, unknown>, signal);
				return {
					content:
						result?.content?.map(c =>
							c.type === "text"
								? { type: "text" as const, text: c.text ?? "" }
								: { type: "text" as const, text: JSON.stringify(c) },
						) ?? [],
					details: result?.details as LspToolDetails | undefined,
				};
			} catch (error) {
				const { action } = params;
				return {
					content: [
						{
							type: "text" as const,
							text: `LSP error: ${error instanceof Error ? error.message : String(error)}`,
						},
					],
					details: { action, success: false } as LspToolDetails,
				};
			}
		},
	};
}

interface WorkerMessageEvent<T> {
	data: T;
}

/** Agent event types to forward to parent (excludes session-only events like compaction) */
const agentEventTypes = new Set<AgentEvent["type"]>([
	"agent_start",
	"agent_end",
	"turn_start",
	"turn_end",
	"message_start",
	"message_update",
	"message_end",
	"tool_execution_start",
	"tool_execution_update",
	"tool_execution_end",
]);

const isAgentEvent = (event: AgentSessionEvent): event is AgentEvent => {
	return agentEventTypes.has(event.type as AgentEvent["type"]);
};

class RunState {
	abortController = new AbortController();
	startTime = Date.now();
	session: { abort: () => Promise<void>; dispose: () => Promise<void> } | null = null;
	unsubscribe: (() => void) | null = null;

	private doneSent = false;

	sendDoneOnce(message: Extract<SubagentWorkerResponse, { type: "done" }>): void {
		if (this.doneSent) return;
		this.doneSent = true;
		postMessageSafe(message);
	}
}

let activeRun: RunState | null = null;
let pendingAbort = false;

/**
 * Resolve model string to Model object with optional thinking level.
 * Supports both exact "provider/id" format and fuzzy matching ("sonnet", "opus").
 */
function resolveModelOverride(
	override: string | undefined,
	modelRegistry: { getAvailable: () => Model<Api>[]; find: (provider: string, id: string) => Model<Api> | undefined },
): { model?: Model<Api>; thinkingLevel?: ThinkingLevel } {
	if (!override) return {};

	// Try exact "provider/id" format first
	const parsed = parseModelString(override);
	if (parsed) {
		return { model: modelRegistry.find(parsed.provider, parsed.id) };
	}

	// Fall back to fuzzy pattern matching
	const result = parseModelPattern(override, modelRegistry.getAvailable());
	return {
		model: result.model,
		thinkingLevel: result.thinkingLevel !== "off" ? result.thinkingLevel : undefined,
	};
}

/**
 * Main task execution function.
 *
 * Equivalent to CLI flow:
 * 1. omp --mode json --non-interactive
 * 2. --append-system-prompt <agent.systemPrompt>
 * 3. --tools <toolNames> (if specified)
 * 4. --model <model> (if specified)
 * 5. --session <sessionFile> OR --no-session
 * 6. --prompt <task>
 *
 * Environment equivalent:
 * - OMP_BLOCKED_AGENT: payload.blockedAgent (prevents same-agent recursion)
 * - OMP_SPAWNS: payload.spawnsEnv (controls nested spawn permissions)
 */
async function runTask(runState: RunState, payload: SubagentWorkerStartPayload): Promise<void> {
	const { signal } = runState.abortController;
	const startTime = runState.startTime;
	let exitCode = 0;
	let error: string | undefined;
	let aborted = false;
	const sessionAbortController = new AbortController();
	if (payload.pythonPreludeDocs && payload.pythonPreludeDocs.length > 0) {
		setPreludeDocsCache(payload.pythonPreludeDocs);
	}

	// Helper to check abort status - throws if aborted to exit early
	const checkAbort = (): void => {
		if (signal.aborted) {
			aborted = true;
			exitCode = 1;
			throw new ToolAbortError();
		}
	};

	try {
		// Check for pre-start abort
		checkAbort();

		// Use serialized auth/models if provided, otherwise discover from disk
		let authStorage: AuthStorage;
		let modelRegistry: ModelRegistry;

		if (payload.serializedAuth && payload.serializedModels) {
			authStorage = await AuthStorage.fromSerialized(payload.serializedAuth);
			modelRegistry = ModelRegistry.fromSerialized(payload.serializedModels, authStorage);
		} else {
			authStorage = await discoverAuthStorage();
			checkAbort();
			modelRegistry = await discoverModels(authStorage);
			checkAbort();
		}

		// Create MCP/python/LSP proxy tools if provided
		const mcpProxyTools: CustomTool<TSchema>[] = payload.mcpTools?.map(createMCPProxyTool) ?? [];
		const pythonProxyTools: CustomTool<TSchema>[] = payload.pythonToolProxy
			? [createPythonProxyTool() as unknown as CustomTool<TSchema>]
			: [];
		const lspProxyTools: CustomTool<TSchema>[] = payload.lspToolProxy
			? [createLspProxyTool() as unknown as CustomTool<TSchema>]
			: [];
		const proxyTools = [...mcpProxyTools, ...pythonProxyTools, ...lspProxyTools];
		const enableLsp = payload.enableLsp ?? true;
		const lspProxyEnabled = payload.lspToolProxy ?? false;

		// Resolve model override (equivalent to CLI's parseModelPattern with --model)
		const { model, thinkingLevel: modelThinkingLevel } = resolveModelOverride(payload.model, modelRegistry);
		const thinkingLevel = modelThinkingLevel ?? payload.thinkingLevel;

		// Create session manager (equivalent to CLI's --session or --no-session)
		const sessionManager = payload.sessionFile
			? await SessionManager.open(payload.sessionFile)
			: SessionManager.inMemory(payload.worktree ?? payload.cwd);
		checkAbort();

		// Use serialized settings if provided, otherwise use empty in-memory settings
		// This avoids opening the SQLite database in worker threads
		const settingsManager = SettingsManager.inMemory(payload.serializedSettings ?? {});

		// Create agent session (equivalent to CLI's createAgentSession)
		// Note: hasUI: false disables interactive features
		const completionInstruction =
			"When finished, call the complete tool exactly once. Do not end with a plain-text final answer.";
		const worktreeNotice = payload.worktree
			? `You will work under this working tree: ${payload.worktree}. CRITICAL: Do not touch the original repository; only make changes inside this worktree.`
			: "";

		const skipPythonPreflight =
			payload.pythonToolProxy === true ||
			(Array.isArray(payload.toolNames) && !payload.toolNames.includes("python"));
		const { session } = await createAgentSession({
			cwd: payload.worktree ?? payload.cwd,
			authStorage,
			modelRegistry,
			settingsManager,
			model,
			thinkingLevel,
			toolNames: payload.toolNames,
			outputSchema: payload.outputSchema,
			requireCompleteTool: true,
			contextFiles: payload.contextFiles,
			skills: payload.skills,
			promptTemplates: payload.promptTemplates,
			// Append system prompt (equivalent to CLI's --append-system-prompt)
			systemPrompt: defaultPrompt =>
				`${defaultPrompt}\n\n${payload.systemPrompt}\n\n${worktreeNotice}\n\n${completionInstruction}`,
			sessionManager,
			hasUI: false,
			// Pass spawn restrictions to nested tasks
			spawns: payload.spawnsEnv,
			enableLsp: enableLsp && !lspProxyEnabled,
			skipPythonPreflight,
			// Disable local MCP discovery if using proxy tools
			enableMCP: !payload.mcpTools,
			// Add proxy tools
			customTools: proxyTools.length > 0 ? proxyTools : undefined,
		});

		runState.session = session;
		checkAbort();

		signal.addEventListener(
			"abort",
			() => {
				void session.abort();
			},
			{ once: true, signal: sessionAbortController.signal },
		);

		// Initialize extensions (equivalent to CLI's extension initialization)
		// Note: Does not support --extension CLI flag or extension CLI flags
		const extensionRunner = session.extensionRunner;
		if (extensionRunner) {
			extensionRunner.initialize(
				// ExtensionActions
				{
					sendMessage: (message, options) => {
						session.sendCustomMessage(message, options).catch(e => {
							logger.error("Extension sendMessage failed", {
								error: e instanceof Error ? e.message : String(e),
							});
						});
					},
					sendUserMessage: (content, options) => {
						session.sendUserMessage(content, options).catch(e => {
							logger.error("Extension sendUserMessage failed", {
								error: e instanceof Error ? e.message : String(e),
							});
						});
					},
					appendEntry: (customType, data) => {
						session.sessionManager.appendCustomEntry(customType, data);
					},
					setLabel: (targetId, label) => {
						session.sessionManager.appendLabelChange(targetId, label);
					},
					getActiveTools: () => session.getActiveToolNames(),
					getAllTools: () => session.getAllToolNames(),
					setActiveTools: (toolNames: string[]) => session.setActiveToolsByName(toolNames),
					setModel: async model => {
						const key = await session.modelRegistry.getApiKey(model);
						if (!key) return false;
						await session.setModel(model);
						return true;
					},
					getThinkingLevel: () => session.thinkingLevel,
					setThinkingLevel: level => session.setThinkingLevel(level),
				},
				// ExtensionContextActions
				{
					getModel: () => session.model,
					isIdle: () => !session.isStreaming,
					abort: () => session.abort(),
					hasPendingMessages: () => session.queuedMessageCount > 0,
					shutdown: () => {},
					getContextUsage: () => session.getContextUsage(),
					compact: async instructionsOrOptions => {
						const instructions = typeof instructionsOrOptions === "string" ? instructionsOrOptions : undefined;
						const options =
							instructionsOrOptions && typeof instructionsOrOptions === "object"
								? instructionsOrOptions
								: undefined;
						await session.compact(instructions, options);
					},
				},
			);
			extensionRunner.onError(err => {
				logger.error("Extension error", { path: err.extensionPath, error: err.error });
			});
			await extensionRunner.emit({ type: "session_start" });
		}

		// Track complete tool calls
		const MAX_COMPLETE_RETRIES = 3;
		let completeCalled = false;

		// Subscribe to events and forward to parent (equivalent to --mode json output)
		runState.unsubscribe = session.subscribe((event: AgentSessionEvent) => {
			if (isAgentEvent(event)) {
				postMessageSafe({ type: "event", event });
				// Track when complete tool is called
				if (event.type === "tool_execution_end" && event.toolName === "complete") {
					completeCalled = true;
				}
			}
		});

		// Run the prompt (equivalent to --prompt flag)
		await session.prompt(payload.task);

		// Retry loop if complete was not called
		let retryCount = 0;
		while (!completeCalled && retryCount < MAX_COMPLETE_RETRIES && !signal.aborted) {
			retryCount++;
			const reminder = `<system-reminder>
CRITICAL: You stopped without calling the complete tool. This is reminder ${retryCount} of ${MAX_COMPLETE_RETRIES}.

You MUST call the complete tool to finish your task. Options:
1. Call complete with your result data if you have completed the task
2. Call complete with status="aborted" and an error message if you cannot complete the task

Failure to call complete after ${MAX_COMPLETE_RETRIES} reminders will result in task failure.
</system-reminder>

Call complete now.`;

			await session.prompt(reminder);
		}

		// Check if aborted during execution
		const lastMessage = session.state.messages[session.state.messages.length - 1];
		if (lastMessage?.role === "assistant" && lastMessage.stopReason === "aborted") {
			aborted = true;
			exitCode = 1;
		}
	} catch (err) {
		exitCode = 1;
		// Don't record abort as error - it's handled via the aborted flag
		if (!signal.aborted) {
			error = err instanceof Error ? err.stack || err.message : String(err);
		}
	} finally {
		// Handle abort requested during execution
		if (signal.aborted) {
			aborted = true;
			if (exitCode === 0) exitCode = 1;
		}

		sessionAbortController.abort();
		rejectPendingCalls("Worker finished");

		if (runState.unsubscribe) {
			try {
				runState.unsubscribe();
			} catch {
				// Ignore unsubscribe errors
			}
			runState.unsubscribe = null;
		}

		// Cleanup session with timeout to prevent hanging
		if (runState.session) {
			const session = runState.session;
			runState.session = null;
			try {
				await untilAborted(AbortSignal.timeout(5000), () => session.dispose());
			} catch {
				// Ignore cleanup errors
			}
		}

		if (activeRun === runState) {
			activeRun = null;
		}

		// Send completion message to parent (only once)
		runState.sendDoneOnce({
			type: "done",
			exitCode,
			durationMs: Date.now() - startTime,
			error,
			aborted,
		});
	}
}

/** Handle abort request from parent */
function handleAbort(): void {
	const runState = activeRun;
	if (!runState) {
		pendingAbort = true;
		rejectPendingCalls("Aborted");
		return;
	}
	rejectPendingCalls("Aborted");
	runState.abortController.abort();
	if (runState.session) {
		void runState.session.abort();
	}
}

const reportFatal = async (message: string): Promise<void> => {
	// Run postmortem cleanup first to ensure child processes are killed
	try {
		await postmortem.cleanup();
	} catch {
		// Ignore cleanup errors
	}
	const error = new Error(message);

	const runState = activeRun;
	if (runState) {
		runState.abortController.abort(error);
		if (runState.session) {
			void runState.session.abort();
		}
		runState.sendDoneOnce({
			type: "done",
			exitCode: 1,
			durationMs: Date.now() - runState.startTime,
			error: message,
			aborted: false,
		});
		return;
	}

	postMessageSafe({
		type: "done",
		exitCode: 1,
		durationMs: 0,
		error: message,
		aborted: false,
	});
};

// Global error handlers to ensure we always send a done message
// Using self instead of globalThis for proper worker scope typing
declare const self: {
	addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
	addEventListener(type: "unhandledrejection", listener: (event: { reason: unknown }) => void): void;
	addEventListener(type: "messageerror", listener: (event: MessageEvent) => void): void;
};

self.addEventListener("error", event => {
	reportFatal(`Uncaught error: ${event.message || "Unknown error"}`);
});

self.addEventListener("unhandledrejection", event => {
	const reason = event.reason;
	const message = reason instanceof Error ? reason.stack || reason.message : String(reason);

	// Avoid terminating active runs on tool-level errors that bubble as rejections.
	if (activeRun) {
		logger.error("Unhandled rejection in subagent worker", { error: message });
		if ("preventDefault" in event && typeof event.preventDefault === "function") {
			event.preventDefault();
		}
		return;
	}

	reportFatal(`Unhandled rejection: ${message}`);
});

self.addEventListener("messageerror", () => {
	reportFatal("Failed to deserialize parent message");
});

// Message handler - receives start/abort/tool_result commands from parent
globalThis.addEventListener("message", (event: WorkerMessageEvent<SubagentWorkerRequest>) => {
	const message = event.data;
	if (!message) return;

	if (message.type === "abort") {
		handleAbort();
		return;
	}

	if (message.type === "mcp_tool_result") {
		handleMCPToolResult(message);
		return;
	}

	if (message.type === "python_tool_result") {
		handlePythonToolResult(message);
		return;
	}

	if (message.type === "lsp_tool_result") {
		handleLspToolResult(message);
		return;
	}

	if (message.type === "start") {
		// Only allow one task per worker
		if (activeRun) return;
		const runState = new RunState();
		if (pendingAbort) {
			pendingAbort = false;
			runState.abortController.abort();
		}
		activeRun = runState;
		void runTask(runState, message.payload);
	}
});
