/**
 * Worker execution for subagents.
 *
 * Runs each subagent in a Bun Worker and forwards AgentEvents for progress tracking.
 */
import path from "node:path";
import type { AgentEvent, ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import type { PromptTemplate } from "@oh-my-pi/pi-coding-agent/config/prompt-templates";
import type { Skill } from "@oh-my-pi/pi-coding-agent/extensibility/skills";
import { getPreludeDocs } from "@oh-my-pi/pi-coding-agent/ipy/executor";
import { checkPythonKernelAvailability } from "@oh-my-pi/pi-coding-agent/ipy/kernel";
import type { ContextFileEntry, ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import type { ModelRegistry } from "../config/model-registry";
import { formatModelString, parseModelPattern } from "../config/model-resolver";
import { LspTool } from "../lsp";
import type { LspParams } from "../lsp/types";
import { callTool } from "../mcp/client";
import type { MCPManager } from "../mcp/manager";
import type { AuthStorage } from "../session/auth-storage";
import { PythonTool, type PythonToolParams } from "../tools/python";
import type { EventBus } from "../utils/event-bus";
import { subprocessToolRegistry } from "./subprocess-tool-registry";
import {
	type AgentDefinition,
	type AgentProgress,
	MAX_OUTPUT_BYTES,
	MAX_OUTPUT_LINES,
	type ReviewFinding,
	type SingleResult,
	TASK_SUBAGENT_EVENT_CHANNEL,
	TASK_SUBAGENT_PROGRESS_CHANNEL,
} from "./types";
import type {
	LspToolCallRequest,
	MCPToolCallRequest,
	MCPToolMetadata,
	PythonToolCallCancel,
	PythonToolCallRequest,
	SubagentWorkerRequest,
	SubagentWorkerResponse,
} from "./worker-protocol";

const DEFAULT_MODEL_ALIASES = new Set(["default", "pi/default", "omp/default"]);

function normalizeModelPatterns(value: string | string[] | undefined): string[] {
	if (!value) return [];
	if (Array.isArray(value)) {
		return value.map(entry => entry.trim()).filter(Boolean);
	}
	return value
		.split(",")
		.map(entry => entry.trim())
		.filter(Boolean);
}

/** Options for worker execution */
export interface ExecutorOptions {
	cwd: string;
	worktree?: string;
	agent: AgentDefinition;
	task: string;
	description?: string;
	index: number;
	id: string;
	context?: string;
	modelOverride?: string | string[];
	thinkingLevel?: ThinkingLevel;
	outputSchema?: unknown;
	enableLsp?: boolean;
	signal?: AbortSignal;
	onProgress?: (progress: AgentProgress) => void;
	sessionFile?: string | null;
	persistArtifacts?: boolean;
	artifactsDir?: string;
	eventBus?: EventBus;
	contextFiles?: ContextFileEntry[];
	skills?: Skill[];
	promptTemplates?: PromptTemplate[];
	mcpManager?: MCPManager;
	authStorage?: AuthStorage;
	modelRegistry?: ModelRegistry;
	settingsManager?: {
		serialize: () => import("@oh-my-pi/pi-coding-agent/config/settings-manager").Settings;
		getPlansDirectory: (cwd?: string) => string;
		getPythonToolMode?: () => "ipy-only" | "bash-only" | "both";
		getPythonKernelMode?: () => "session" | "per-call";
		getPythonSharedGateway?: () => boolean;
	};
}

/**
 * Truncate output to byte and line limits.
 */
function truncateOutput(output: string): { text: string; truncated: boolean } {
	let truncated = false;
	let byteBudget = MAX_OUTPUT_BYTES;
	let lineBudget = MAX_OUTPUT_LINES;

	let i = 0;
	let lastNewlineIndex = -1;
	while (i < output.length) {
		const codePoint = output.codePointAt(i);
		if (codePoint === undefined) break;
		const codeUnitLength = codePoint > 0xffff ? 2 : 1;
		const byteLen = codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
		if (byteBudget - byteLen < 0) {
			truncated = true;
			break;
		}
		byteBudget -= byteLen;
		i += codeUnitLength;

		if (codePoint === 0x0a) {
			lineBudget--;
			lastNewlineIndex = i - 1;
			if (lineBudget <= 0) {
				truncated = true;
				break;
			}
		}
	}

	if (i < output.length) {
		truncated = true;
	}

	if (truncated && lineBudget <= 0 && lastNewlineIndex >= 0) {
		output = output.slice(0, lastNewlineIndex);
	} else {
		output = output.slice(0, i);
	}

	return { text: output, truncated };
}

/**
 * Extract a short preview from tool args for display.
 */
function extractToolArgsPreview(args: Record<string, unknown>): string {
	// Priority order for preview
	const previewKeys = ["command", "file_path", "path", "pattern", "query", "url", "task", "prompt"];

	for (const key of previewKeys) {
		if (args[key] && typeof args[key] === "string") {
			const value = args[key] as string;
			return value.length > 60 ? `${value.slice(0, 57)}...` : value;
		}
	}

	return "";
}

function getNumberField(record: Record<string, unknown>, key: string): number | undefined {
	if (!Object.hasOwn(record, key)) return undefined;
	const value = record[key];
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function firstNumberField(record: Record<string, unknown>, keys: string[]): number | undefined {
	for (const key of keys) {
		const value = getNumberField(record, key);
		if (value !== undefined) return value;
	}
	return undefined;
}

/**
 * Normalize usage objects from different event formats.
 */
function getUsageTokens(usage: unknown): number {
	if (!usage || typeof usage !== "object") return 0;
	const record = usage as Record<string, unknown>;

	const totalTokens = firstNumberField(record, ["totalTokens", "total_tokens"]);
	if (totalTokens !== undefined && totalTokens > 0) return totalTokens;

	const input = firstNumberField(record, ["input", "input_tokens", "inputTokens"]) ?? 0;
	const output = firstNumberField(record, ["output", "output_tokens", "outputTokens"]) ?? 0;
	const cacheRead = firstNumberField(record, ["cacheRead", "cache_read", "cacheReadTokens"]) ?? 0;
	const cacheWrite = firstNumberField(record, ["cacheWrite", "cache_write", "cacheWriteTokens"]) ?? 0;

	return input + output + cacheRead + cacheWrite;
}

/**
 * Extract MCP tool metadata from MCPManager for passing to worker.
 *
 * MCPTool and DeferredMCPTool expose mcpToolName (original MCP tool name)
 * and mcpServerName properties. We use these directly when available,
 * falling back to empty strings if not.
 */
function extractMCPToolMetadata(mcpManager: MCPManager): MCPToolMetadata[] {
	return mcpManager.getTools().map(tool => {
		// MCPTool and DeferredMCPTool have these properties
		const mcpTool = tool as { mcpToolName?: string; mcpServerName?: string };
		return {
			name: tool.name,
			label: tool.label ?? tool.name,
			description: tool.description ?? "",
			parameters: tool.parameters,
			serverName: mcpTool.mcpServerName ?? "",
			mcpToolName: mcpTool.mcpToolName ?? "",
		};
	});
}

/**
 * Run a single agent in a worker.
 */
export async function runSubprocess(options: ExecutorOptions): Promise<SingleResult> {
	const {
		cwd,
		agent,
		task,
		index,
		id,
		worktree,
		context,
		modelOverride,
		thinkingLevel,
		outputSchema,
		enableLsp,
		signal,
		onProgress,
	} = options;
	const startTime = Date.now();

	// Initialize progress
	const progress: AgentProgress = {
		index,
		id,
		agent: agent.name,
		agentSource: agent.source,
		status: "running",
		task,
		description: options.description,
		recentTools: [],
		recentOutput: [],
		toolCount: 0,
		tokens: 0,
		durationMs: 0,
		modelOverride,
	};

	// Check if already aborted
	if (signal?.aborted) {
		return {
			index,
			id,
			agent: agent.name,
			agentSource: agent.source,
			task,
			description: options.description,
			exitCode: 1,
			output: "",
			stderr: "Aborted before start",
			truncated: false,
			durationMs: 0,
			tokens: 0,
			modelOverride,
			error: "Aborted",
		};
	}

	// Build full task with context
	const fullTask = context ? `${context}\n\n${task}` : task;

	// Set up artifact paths and write input file upfront if artifacts dir provided
	let subtaskSessionFile: string | undefined;
	if (options.artifactsDir) {
		subtaskSessionFile = path.join(options.artifactsDir, `${id}.jsonl`);
	}

	// Add tools if specified
	let toolNames: string[] | undefined;
	if (agent.tools && agent.tools.length > 0) {
		toolNames = agent.tools;
		// Auto-include task tool if spawns defined but task not in tools
		if (agent.spawns !== undefined && !toolNames.includes("task")) {
			toolNames = [...toolNames, "task"];
		}
	}

	const pythonToolMode = options.settingsManager?.getPythonToolMode?.() ?? "ipy-only";
	if (toolNames?.includes("exec")) {
		const expanded = toolNames.filter(name => name !== "exec");
		if (pythonToolMode === "bash-only") {
			expanded.push("bash");
		} else if (pythonToolMode === "ipy-only") {
			expanded.push("python");
		} else {
			expanded.push("python", "bash");
		}
		toolNames = Array.from(new Set(expanded));
	}

	const serializedSettings = options.settingsManager?.serialize();
	const availableModels = options.modelRegistry?.getAvailable() ?? [];

	// Resolve model pattern list to provider/modelId string
	const modelPatterns = normalizeModelPatterns(modelOverride ?? agent.model);
	let resolvedModel: string | undefined;
	if (modelPatterns.length > 0) {
		const roles = serializedSettings?.modelRoles as Record<string, string> | undefined;
		for (const pattern of modelPatterns) {
			const normalized = pattern.trim().toLowerCase();
			if (!normalized || DEFAULT_MODEL_ALIASES.has(normalized)) {
				continue;
			}
			let effectivePattern = pattern;
			if (normalized.startsWith("omp/") || normalized.startsWith("pi/")) {
				const role = normalized.startsWith("omp/") ? pattern.slice(4) : pattern.slice(3);
				const configured = roles?.[role] ?? roles?.[role.toLowerCase()];
				if (configured) {
					effectivePattern = configured;
				}
			}
			const { model } = parseModelPattern(effectivePattern, availableModels);
			if (model) {
				resolvedModel = formatModelString(model);
				break;
			}
		}
	}
	const sessionFile = subtaskSessionFile ?? null;
	const spawnsEnv = agent.spawns === undefined ? "" : agent.spawns === "*" ? "*" : agent.spawns.join(",");

	const pythonToolRequested = toolNames === undefined || toolNames.includes("python");
	let pythonProxyEnabled = pythonToolRequested && pythonToolMode !== "bash-only";
	if (pythonProxyEnabled) {
		const availability = await checkPythonKernelAvailability(cwd);
		pythonProxyEnabled = availability.ok;
	}

	const lspEnabled = enableLsp ?? true;
	const lspToolRequested = lspEnabled && (toolNames === undefined || toolNames.includes("lsp"));
	const pythonPreludeDocs = getPreludeDocs();
	const pythonPreludeDocsPayload = pythonPreludeDocs.length > 0 ? pythonPreludeDocs : undefined;

	let worker: Worker;
	try {
		worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
	} catch (err) {
		return {
			index,
			id,
			agent: agent.name,
			agentSource: agent.source,
			task,
			description: options.description,
			exitCode: 1,
			output: "",
			stderr: `Failed to create worker: ${err instanceof Error ? err.message : String(err)}`,
			truncated: false,
			durationMs: Date.now() - startTime,
			tokens: 0,
			modelOverride,
			error: `Failed to create worker: ${err instanceof Error ? err.message : String(err)}`,
		};
	}

	const outputChunks: string[] = [];
	const finalOutputChunks: string[] = [];
	let stderr = "";
	let resolved = false;
	type AbortReason = "signal" | "terminate";
	let abortSent = false;
	let abortReason: AbortReason | undefined;
	let terminationScheduled = false;
	let terminated = false;
	let terminationTimeoutId: ReturnType<typeof setTimeout> | null = null;
	let pendingTerminationTimeoutId: ReturnType<typeof setTimeout> | null = null;
	let finalize: ((message: Extract<SubagentWorkerResponse, { type: "done" }>) => void) | null = null;
	const listenerController = new AbortController();
	const listenerSignal = listenerController.signal;
	const withTimeout = async <T>(promise: Promise<T>, timeoutMs?: number): Promise<T> => {
		if (timeoutMs === undefined) return promise;
		let timeoutId: ReturnType<typeof setTimeout> | undefined;
		try {
			return await Promise.race([
				promise,
				new Promise<T>((_resolve, reject) => {
					timeoutId = setTimeout(() => {
						reject(new Error(`Tool call timed out after ${timeoutMs}ms`));
					}, timeoutMs);
				}),
			]);
		} finally {
			if (timeoutId) clearTimeout(timeoutId);
		}
	};

	const combineSignals = (signals: Array<AbortSignal | undefined>): AbortSignal | undefined => {
		const filtered = signals.filter((value): value is AbortSignal => Boolean(value));
		if (filtered.length === 0) return undefined;
		if (filtered.length === 1) return filtered[0];
		return AbortSignal.any(filtered);
	};

	const createTimeoutSignal = (timeoutMs?: number): AbortSignal | undefined => {
		if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
			return undefined;
		}
		return AbortSignal.timeout(timeoutMs);
	};

	const pythonSessionFile = sessionFile ?? `subtask:${id}`;
	const pythonToolSession: ToolSession = {
		cwd,
		hasUI: false,
		enableLsp: false,
		getSessionFile: () => pythonSessionFile,
		getSessionSpawns: () => spawnsEnv,
		settings: options.settingsManager as ToolSession["settings"],
		settingsManager: options.settingsManager,
	};
	const pythonTool = pythonProxyEnabled ? new PythonTool(pythonToolSession) : null;
	const pythonCallControllers = new Map<string, AbortController>();

	const lspToolSession: ToolSession = {
		cwd,
		hasUI: false,
		enableLsp: lspEnabled,
		getSessionFile: () => pythonSessionFile,
		getSessionSpawns: () => spawnsEnv,
		settings: options.settingsManager as ToolSession["settings"],
		settingsManager: options.settingsManager,
	};
	const lspTool = lspToolRequested ? new LspTool(lspToolSession) : null;

	// Accumulate usage incrementally from message_end events (no memory for streaming events)
	const accumulatedUsage = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
	let hasUsage = false;

	const scheduleTermination = () => {
		if (terminationScheduled) return;
		terminationScheduled = true;
		terminationTimeoutId = setTimeout(() => {
			terminationTimeoutId = null;
			if (resolved || terminated) return;
			terminated = true;
			try {
				worker.terminate();
			} catch {
				// Ignore termination errors
			}
			if (finalize && !resolved) {
				finalize({
					type: "done",
					exitCode: 1,
					durationMs: Date.now() - startTime,
					error: abortReason === "signal" ? "Aborted" : "Worker terminated after tool completion",
					aborted: abortReason === "signal",
				});
			}
		}, 2000);
	};

	const requestAbort = (reason: AbortReason) => {
		if (abortSent) {
			if (reason === "signal" && abortReason !== "signal") {
				abortReason = "signal";
			}
			return;
		}
		if (resolved) return;
		abortSent = true;
		abortReason = reason;
		for (const controller of pythonCallControllers.values()) {
			controller.abort();
		}
		pythonCallControllers.clear();
		const abortMessage: SubagentWorkerRequest = { type: "abort" };
		try {
			worker.postMessage(abortMessage);
		} catch {
			// Worker already terminated, nothing to do
		}
		// Cancel pending termination if it exists
		cancelPendingTermination();
		scheduleTermination();
	};

	const schedulePendingTermination = () => {
		if (pendingTerminationTimeoutId || abortSent || terminationScheduled || resolved) return;
		pendingTerminationTimeoutId = setTimeout(() => {
			pendingTerminationTimeoutId = null;
			if (!resolved) {
				requestAbort("terminate");
			}
		}, 2000);
	};

	const cancelPendingTermination = () => {
		if (pendingTerminationTimeoutId) {
			clearTimeout(pendingTerminationTimeoutId);
			pendingTerminationTimeoutId = null;
		}
	};

	// Handle abort signal
	const onAbort = () => {
		if (!resolved) requestAbort("signal");
	};
	if (signal) {
		signal.addEventListener("abort", onAbort, { once: true, signal: listenerSignal });
	}

	const emitProgress = () => {
		progress.durationMs = Date.now() - startTime;
		onProgress?.({ ...progress });
		if (options.eventBus) {
			options.eventBus.emit(TASK_SUBAGENT_PROGRESS_CHANNEL, {
				index,
				agent: agent.name,
				agentSource: agent.source,
				task,
				progress: { ...progress },
			});
		}
	};

	const getMessageContent = (message: unknown): unknown => {
		if (message && typeof message === "object" && "content" in message) {
			return (message as { content?: unknown }).content;
		}
		return undefined;
	};

	const getMessageUsage = (message: unknown): unknown => {
		if (message && typeof message === "object" && "usage" in message) {
			return (message as { usage?: unknown }).usage;
		}
		return undefined;
	};

	const processEvent = (event: AgentEvent) => {
		if (resolved) return;

		if (options.eventBus) {
			options.eventBus.emit(TASK_SUBAGENT_EVENT_CHANNEL, {
				index,
				agent: agent.name,
				agentSource: agent.source,
				task,
				event,
			});
		}

		const now = Date.now();

		switch (event.type) {
			case "tool_execution_start":
				progress.toolCount++;
				progress.currentTool = event.toolName;
				progress.currentToolArgs = extractToolArgsPreview(
					(event as { toolArgs?: Record<string, unknown> }).toolArgs || event.args || {},
				);
				progress.currentToolStartMs = now;
				break;

			case "tool_execution_end": {
				if (progress.currentTool) {
					progress.recentTools.unshift({
						tool: progress.currentTool,
						args: progress.currentToolArgs || "",
						endMs: now,
					});
					// Keep only last 5
					if (progress.recentTools.length > 5) {
						progress.recentTools.pop();
					}
				}
				progress.currentTool = undefined;
				progress.currentToolArgs = undefined;
				progress.currentToolStartMs = undefined;

				// Check for registered subagent tool handler
				const handler = subprocessToolRegistry.getHandler(event.toolName);
				const eventArgs = (event as { args?: Record<string, unknown> }).args ?? {};
				if (handler) {
					// Extract data using handler
					if (handler.extractData) {
						const data = handler.extractData({
							toolName: event.toolName,
							toolCallId: event.toolCallId,
							args: eventArgs,
							result: event.result,
							isError: event.isError,
						});
						if (data !== undefined) {
							progress.extractedToolData = progress.extractedToolData || {};
							progress.extractedToolData[event.toolName] = progress.extractedToolData[event.toolName] || [];
							progress.extractedToolData[event.toolName].push(data);
						}
					}

					// Check if handler wants to terminate worker
					if (
						handler.shouldTerminate?.({
							toolName: event.toolName,
							toolCallId: event.toolCallId,
							args: eventArgs,
							result: event.result,
							isError: event.isError,
						})
					) {
						// Don't terminate immediately - wait for message_end to get token counts
						schedulePendingTermination();
					}
				}
				break;
			}

			case "message_update": {
				// Extract text for progress display only (replace, don't accumulate)
				const updateContent =
					getMessageContent(event.message) || (event as AgentEvent & { content?: unknown }).content;
				if (updateContent && Array.isArray(updateContent)) {
					const allText: string[] = [];
					for (const block of updateContent) {
						if (block.type === "text" && block.text) {
							const lines = block.text.split("\n").filter((l: string) => l.trim());
							allText.push(...lines);
						}
					}
					// Show last 8 lines from current state (not accumulated)
					progress.recentOutput = allText.slice(-8).reverse();
				}
				break;
			}

			case "message_end": {
				// Extract text from assistant and toolResult messages (not user prompts)
				const role = event.message?.role;
				if (role === "assistant") {
					const messageContent =
						getMessageContent(event.message) || (event as AgentEvent & { content?: unknown }).content;
					if (messageContent && Array.isArray(messageContent)) {
						for (const block of messageContent) {
							if (block.type === "text" && block.text) {
								outputChunks.push(block.text);
							}
						}
					}
				}
				// Extract and accumulate usage (prefer message.usage, fallback to event.usage)
				const messageUsage = getMessageUsage(event.message) || (event as AgentEvent & { usage?: unknown }).usage;
				if (messageUsage && typeof messageUsage === "object") {
					// Only count assistant messages (not tool results, etc.)
					if (role === "assistant") {
						const usageRecord = messageUsage as Record<string, unknown>;
						const costRecord = (messageUsage as { cost?: Record<string, unknown> }).cost;
						hasUsage = true;
						accumulatedUsage.input += getNumberField(usageRecord, "input") ?? 0;
						accumulatedUsage.output += getNumberField(usageRecord, "output") ?? 0;
						accumulatedUsage.cacheRead += getNumberField(usageRecord, "cacheRead") ?? 0;
						accumulatedUsage.cacheWrite += getNumberField(usageRecord, "cacheWrite") ?? 0;
						accumulatedUsage.totalTokens += getNumberField(usageRecord, "totalTokens") ?? 0;
						if (costRecord) {
							accumulatedUsage.cost.input += getNumberField(costRecord, "input") ?? 0;
							accumulatedUsage.cost.output += getNumberField(costRecord, "output") ?? 0;
							accumulatedUsage.cost.cacheRead += getNumberField(costRecord, "cacheRead") ?? 0;
							accumulatedUsage.cost.cacheWrite += getNumberField(costRecord, "cacheWrite") ?? 0;
							accumulatedUsage.cost.total += getNumberField(costRecord, "total") ?? 0;
						}
					}
					// Accumulate tokens for progress display
					progress.tokens += getUsageTokens(messageUsage);
				}
				// If pending termination, now we have tokens - terminate immediately
				if (pendingTerminationTimeoutId) {
					cancelPendingTermination();
					requestAbort("terminate");
				}
				break;
			}

			case "agent_end":
				// Extract final content from assistant messages only (not user prompts)
				if (event.messages && Array.isArray(event.messages)) {
					for (const msg of event.messages) {
						if ((msg as { role?: string })?.role !== "assistant") continue;
						const messageContent = getMessageContent(msg);
						if (messageContent && Array.isArray(messageContent)) {
							for (const block of messageContent) {
								if (block.type === "text" && block.text) {
									finalOutputChunks.push(block.text);
								}
							}
						}
					}
				}
				break;
		}

		emitProgress();
	};

	const startMessage: SubagentWorkerRequest = {
		type: "start",
		payload: {
			cwd,
			worktree,
			task: fullTask,
			systemPrompt: agent.systemPrompt,
			model: resolvedModel,
			thinkingLevel,
			toolNames,
			outputSchema,
			sessionFile,
			spawnsEnv,
			enableLsp: lspEnabled,
			serializedAuth: options.authStorage?.serialize(),
			serializedModels: options.modelRegistry?.serialize(),
			serializedSettings,
			pythonPreludeDocs: pythonPreludeDocsPayload,
			contextFiles: options.contextFiles,
			skills: options.skills,
			promptTemplates: options.promptTemplates,
			mcpTools: options.mcpManager ? extractMCPToolMetadata(options.mcpManager) : undefined,
			pythonToolProxy: pythonProxyEnabled,
			lspToolProxy: Boolean(lspTool),
		},
	};

	interface WorkerMessageEvent<T> {
		data: T;
	}
	interface WorkerErrorEvent {
		message: string;
	}

	const done = await new Promise<Extract<SubagentWorkerResponse, { type: "done" }>>(resolve => {
		const cleanup = () => {
			listenerController.abort();
		};
		finalize = message => {
			if (resolved) return;
			resolved = true;
			cleanup();
			resolve(message);
		};
		const postMessageSafe = (message: unknown) => {
			if (resolved || terminated) return;
			try {
				worker.postMessage(message);
			} catch {
				// Worker already terminated
			}
		};
		const handleMCPCall = async (request: MCPToolCallRequest) => {
			const mcpManager = options.mcpManager;
			if (!mcpManager) {
				postMessageSafe({
					type: "mcp_tool_result",
					callId: request.callId,
					error: "MCP not available",
				});
				return;
			}
			try {
				const result = await withTimeout(
					(async () => {
						const connection = await mcpManager.waitForConnection(request.serverName);
						return callTool(connection, request.mcpToolName, request.params);
					})(),
					request.timeoutMs,
				);
				postMessageSafe({
					type: "mcp_tool_result",
					callId: request.callId,
					result: { content: result.content ?? [], isError: result.isError },
				});
			} catch (error) {
				postMessageSafe({
					type: "mcp_tool_result",
					callId: request.callId,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		};

		const getPythonCallTimeoutMs = (params: { timeout?: number }): number | undefined => {
			const timeout = params.timeout;
			if (typeof timeout === "number" && Number.isFinite(timeout) && timeout > 0) {
				return Math.max(1000, Math.round(timeout * 1000) + 1000);
			}
			return undefined;
		};

		const handlePythonCall = async (request: PythonToolCallRequest) => {
			if (!pythonTool) {
				postMessageSafe({
					type: "python_tool_result",
					callId: request.callId,
					error: "Python proxy not available",
				});
				return;
			}
			const callController = new AbortController();
			pythonCallControllers.set(request.callId, callController);
			const timeoutMs = getPythonCallTimeoutMs(request.params as { timeout?: number });
			const timeoutSignal = createTimeoutSignal(timeoutMs);
			const combinedSignal = combineSignals([signal, callController.signal, timeoutSignal]);
			try {
				const result = await pythonTool.execute(request.callId, request.params as PythonToolParams, combinedSignal);
				postMessageSafe({
					type: "python_tool_result",
					callId: request.callId,
					result: { content: result.content ?? [], details: result.details },
				});
			} catch (error) {
				const message =
					timeoutSignal?.aborted && timeoutMs !== undefined
						? `Python tool call timed out after ${timeoutMs}ms`
						: error instanceof Error
							? error.message
							: String(error);
				postMessageSafe({
					type: "python_tool_result",
					callId: request.callId,
					error: message,
				});
			} finally {
				pythonCallControllers.delete(request.callId);
			}
		};

		const handlePythonCancel = (request: PythonToolCallCancel) => {
			const controller = pythonCallControllers.get(request.callId);
			if (controller) {
				controller.abort();
			}
		};

		const handleLspCall = async (request: LspToolCallRequest) => {
			if (!lspTool) {
				postMessageSafe({
					type: "lsp_tool_result",
					callId: request.callId,
					error: "LSP proxy not available",
				});
				return;
			}
			try {
				const result = await withTimeout(
					lspTool.execute(request.callId, request.params as LspParams, signal),
					request.timeoutMs,
				);
				postMessageSafe({
					type: "lsp_tool_result",
					callId: request.callId,
					result: { content: result.content ?? [], details: result.details },
				});
			} catch (error) {
				const message =
					request.timeoutMs !== undefined && error instanceof Error && error.message.includes("timed out")
						? `LSP tool call timed out after ${request.timeoutMs}ms`
						: error instanceof Error
							? error.message
							: String(error);
				postMessageSafe({
					type: "lsp_tool_result",
					callId: request.callId,
					error: message,
				});
			}
		};

		const onMessage = (event: WorkerMessageEvent<SubagentWorkerResponse>) => {
			const message = event.data;
			if (!message || resolved) return;
			if (message.type === "mcp_tool_call") {
				handleMCPCall(message as MCPToolCallRequest);
				return;
			}
			if (message.type === "python_tool_call") {
				handlePythonCall(message as PythonToolCallRequest);
				return;
			}
			if (message.type === "python_tool_cancel") {
				handlePythonCancel(message as PythonToolCallCancel);
				return;
			}
			if (message.type === "lsp_tool_call") {
				handleLspCall(message as LspToolCallRequest);
				return;
			}
			if (message.type === "event") {
				try {
					processEvent(message.event);
				} catch (err) {
					finalize?.({
						type: "done",
						exitCode: 1,
						durationMs: Date.now() - startTime,
						error: `Failed to process worker event: ${err instanceof Error ? err.message : String(err)}`,
					});
				}
				return;
			}
			if (message.type === "done") {
				// Worker is exiting - mark as terminated to prevent calling terminate() on dead worker
				terminated = true;
				finalize?.(message);
			}
		};
		const onError = (event: WorkerErrorEvent) => {
			// Worker error likely means it's dead or dying
			terminated = true;
			finalize?.({
				type: "done",
				exitCode: 1,
				durationMs: Date.now() - startTime,
				error: event.message,
			});
		};
		const onMessageError = () => {
			// Message error may indicate worker is in bad state
			terminated = true;
			finalize?.({
				type: "done",
				exitCode: 1,
				durationMs: Date.now() - startTime,
				error: "Worker message deserialization failed",
			});
		};
		const onClose = () => {
			// Worker terminated unexpectedly (crashed or was killed without sending done)
			// Mark as terminated since the worker is already dead - calling terminate() again would crash
			terminated = true;
			const abortMessage =
				abortSent && abortReason === "signal"
					? "Worker terminated after abort"
					: abortSent
						? "Worker terminated after tool completion"
						: "Worker terminated unexpectedly";
			finalize?.({
				type: "done",
				exitCode: 1,
				durationMs: Date.now() - startTime,
				error: abortMessage,
				aborted: abortReason === "signal",
			});
		};
		worker.addEventListener("message", onMessage, { signal: listenerSignal });
		worker.addEventListener("error", onError, { signal: listenerSignal });
		worker.addEventListener("close", onClose, { signal: listenerSignal });
		worker.addEventListener("messageerror", onMessageError, { signal: listenerSignal });
		try {
			worker.postMessage(startMessage);
		} catch (err) {
			finalize({
				type: "done",
				exitCode: 1,
				durationMs: Date.now() - startTime,
				error: `Failed to start worker: ${err instanceof Error ? err.message : String(err)}`,
			});
		}
	});

	// Cleanup - cancel any pending timeouts first
	if (terminationTimeoutId) {
		clearTimeout(terminationTimeoutId);
		terminationTimeoutId = null;
	}
	cancelPendingTermination();
	if (!terminated) {
		terminated = true;
		try {
			worker.terminate();
		} catch {
			// Ignore termination errors
		}
	}

	let exitCode = done.exitCode;
	if (done.error) {
		stderr = done.error;
	}

	// Use final output if available, otherwise accumulated output
	let rawOutput = finalOutputChunks.length > 0 ? finalOutputChunks.join("") : outputChunks.join("");
	let abortedViaComplete = false;
	const completeItems = progress.extractedToolData?.complete as
		| Array<{ data?: unknown; status?: "success" | "aborted"; error?: string }>
		| undefined;
	const hasComplete = Array.isArray(completeItems) && completeItems.length > 0;
	if (hasComplete) {
		const lastComplete = completeItems[completeItems.length - 1];
		if (lastComplete?.status === "aborted") {
			// Agent explicitly aborted via complete tool - clean exit with error info
			abortedViaComplete = true;
			exitCode = 0;
			stderr = lastComplete.error || "Subagent aborted task";
			try {
				rawOutput = JSON.stringify({ aborted: true, error: lastComplete.error }, null, 2);
			} catch {
				rawOutput = `{"aborted":true,"error":"${lastComplete.error || "Unknown error"}"}`;
			}
		} else {
			// Normal successful completion
			let completeData = lastComplete?.data ?? null;
			// Handle double-stringified JSON (subagent returned JSON string instead of object)
			if (typeof completeData === "string" && (completeData.startsWith("{") || completeData.startsWith("["))) {
				try {
					completeData = JSON.parse(completeData);
				} catch {
					// Not valid JSON, keep as string
				}
			}
			// Special case: merge report_finding data into review output for parent visibility
			const reportFindings = progress.extractedToolData?.report_finding as ReviewFinding[] | undefined;
			if (
				Array.isArray(reportFindings) &&
				reportFindings.length > 0 &&
				completeData &&
				typeof completeData === "object" &&
				!Array.isArray(completeData)
			) {
				const record = completeData as Record<string, unknown>;
				if (!("findings" in record)) {
					completeData = { ...record, findings: reportFindings };
				}
			}
			try {
				rawOutput = JSON.stringify(completeData, null, 2) ?? "null";
			} catch (err) {
				const errorMessage = err instanceof Error ? err.message : String(err);
				rawOutput = `{"error":"Failed to serialize complete data: ${errorMessage}"}`;
			}
			exitCode = 0;
			stderr = "";
		}
	} else {
		const warning = "SYSTEM WARNING: Subagent exited without calling complete tool after 3 reminders.";
		rawOutput = rawOutput ? `${warning}\n\n${rawOutput}` : warning;
	}
	const { text: truncatedOutput, truncated } = truncateOutput(rawOutput);

	// Write output artifact (input and jsonl already written in real-time)
	// Compute output metadata for agent:// URL integration
	let outputMeta: { lineCount: number; charCount: number } | undefined;
	let outputPath: string | undefined;
	if (options.artifactsDir) {
		outputPath = path.join(options.artifactsDir, `${id}.md`);
		try {
			await Bun.write(outputPath, rawOutput);
			outputMeta = {
				lineCount: rawOutput.split("\n").length,
				charCount: rawOutput.length,
			};
		} catch {
			// Non-fatal
		}
	}

	// Update final progress
	const wasAborted = abortedViaComplete || (!hasComplete && (done.aborted || signal?.aborted || false));
	progress.status = wasAborted ? "aborted" : exitCode === 0 ? "completed" : "failed";
	emitProgress();

	return {
		index,
		id,
		agent: agent.name,
		agentSource: agent.source,
		task,
		description: options.description,
		exitCode,
		output: truncatedOutput,
		stderr,
		truncated,
		durationMs: Date.now() - startTime,
		tokens: progress.tokens,
		modelOverride,
		error: exitCode !== 0 && stderr ? stderr : undefined,
		aborted: wasAborted,
		usage: hasUsage ? accumulatedUsage : undefined,
		outputPath,
		extractedToolData: progress.extractedToolData,
		outputMeta,
	};
}
