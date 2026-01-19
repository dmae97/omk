/**
 * Agent class that uses the agent-loop directly.
 * No transport abstraction - calls streamSimple via the loop.
 */

import {
	type AssistantMessage,
	type CursorExecHandlers,
	type CursorToolResultHandler,
	getModel,
	type ImageContent,
	type Message,
	type Model,
	streamSimple,
	type TextContent,
	type ThinkingBudgets,
	type ToolResultMessage,
} from "@oh-my-pi/pi-ai";
import { agentLoop, agentLoopContinue } from "./agent-loop";
import type {
	AgentContext,
	AgentEvent,
	AgentLoopConfig,
	AgentMessage,
	AgentState,
	AgentTool,
	AgentToolContext,
	StreamFn,
	ThinkingLevel,
	ToolCallContext,
} from "./types";

/**
 * Default convertToLlm: Keep only LLM-compatible messages, convert attachments.
 */
function defaultConvertToLlm(messages: AgentMessage[]): Message[] {
	return messages.filter((m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult");
}

export interface AgentOptions {
	initialState?: Partial<AgentState>;

	/**
	 * Converts AgentMessage[] to LLM-compatible Message[] before each LLM call.
	 * Default filters to user/assistant/toolResult and converts attachments.
	 */
	convertToLlm?: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;

	/**
	 * Optional transform applied to context before convertToLlm.
	 * Use for context pruning, injecting external context, etc.
	 */
	transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;

	/**
	 * Steering mode: "all" = send all steering messages at once, "one-at-a-time" = one per turn
	 */
	steeringMode?: "all" | "one-at-a-time";

	/**
	 * Follow-up mode: "all" = send all follow-up messages at once, "one-at-a-time" = one per turn
	 */
	followUpMode?: "all" | "one-at-a-time";

	/**
	 * When to interrupt tool execution for steering messages.
	 * - "immediate": check after each tool call (default)
	 * - "wait": defer steering until the current turn completes
	 */
	interruptMode?: "immediate" | "wait";

	/**
	 * Custom stream function (for proxy backends, etc.). Default uses streamSimple.
	 */
	streamFn?: StreamFn;

	/**
	 * Optional session identifier forwarded to LLM providers.
	 * Used by providers that support session-based caching (e.g., OpenAI Codex).
	 */
	sessionId?: string;

	/**
	 * Resolves an API key dynamically for each LLM call.
	 * Useful for expiring tokens (e.g., GitHub Copilot OAuth).
	 */
	getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;

	/**
	 * Custom token budgets for thinking levels (token-based providers only).
	 */
	thinkingBudgets?: ThinkingBudgets;

	/**
	 * Provides tool execution context, resolved per tool call.
	 * Use for late-bound UI or session state access.
	 */
	getToolContext?: (toolCall?: ToolCallContext) => AgentToolContext | undefined;

	/**
	 * Cursor exec handlers for local tool execution.
	 */
	cursorExecHandlers?: CursorExecHandlers;

	/**
	 * Cursor tool result callback for exec tool responses.
	 */
	cursorOnToolResult?: CursorToolResultHandler;
}

/** Buffered Cursor tool result with text position at time of call */
interface CursorToolResultEntry {
	toolResult: ToolResultMessage;
	textLengthAtCall: number;
}

export class Agent {
	private _state: AgentState = {
		systemPrompt: "",
		model: getModel("google", "gemini-2.5-flash-lite-preview-06-17"),
		thinkingLevel: "off",
		tools: [],
		messages: [],
		isStreaming: false,
		streamMessage: null,
		pendingToolCalls: new Set<string>(),
		error: undefined,
	};

	private listeners = new Set<(e: AgentEvent) => void>();
	private abortController?: AbortController;
	private convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
	private transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;
	private steeringQueue: AgentMessage[] = [];
	private followUpQueue: AgentMessage[] = [];
	private steeringMode: "all" | "one-at-a-time";
	private followUpMode: "all" | "one-at-a-time";
	private interruptMode: "immediate" | "wait";
	public streamFn: StreamFn;
	private _sessionId?: string;
	private _thinkingBudgets?: ThinkingBudgets;
	public getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
	private getToolContext?: (toolCall?: ToolCallContext) => AgentToolContext | undefined;
	private cursorExecHandlers?: CursorExecHandlers;
	private cursorOnToolResult?: CursorToolResultHandler;
	private runningPrompt?: Promise<void>;
	private resolveRunningPrompt?: () => void;

	/** Buffered Cursor tool results with text length at time of call (for correct ordering) */
	private _cursorToolResultBuffer: CursorToolResultEntry[] = [];

	constructor(opts: AgentOptions = {}) {
		this._state = { ...this._state, ...opts.initialState };
		this.convertToLlm = opts.convertToLlm || defaultConvertToLlm;
		this.transformContext = opts.transformContext;
		this.steeringMode = opts.steeringMode || "one-at-a-time";
		this.followUpMode = opts.followUpMode || "one-at-a-time";
		this.interruptMode = opts.interruptMode || "immediate";
		this.streamFn = opts.streamFn || streamSimple;
		this._sessionId = opts.sessionId;
		this._thinkingBudgets = opts.thinkingBudgets;
		this.getApiKey = opts.getApiKey;
		this.getToolContext = opts.getToolContext;
		this.cursorExecHandlers = opts.cursorExecHandlers;
		this.cursorOnToolResult = opts.cursorOnToolResult;
	}

	/**
	 * Get the current session ID used for provider caching.
	 */
	get sessionId(): string | undefined {
		return this._sessionId;
	}

	/**
	 * Set the session ID for provider caching.
	 * Call this when switching sessions (new session, branch, resume).
	 */
	set sessionId(value: string | undefined) {
		this._sessionId = value;
	}

	/**
	 * Get the current thinking budgets.
	 */
	get thinkingBudgets(): ThinkingBudgets | undefined {
		return this._thinkingBudgets;
	}

	/**
	 * Set custom thinking budgets for token-based providers.
	 */
	set thinkingBudgets(value: ThinkingBudgets | undefined) {
		this._thinkingBudgets = value;
	}

	get state(): AgentState {
		return this._state;
	}

	subscribe(fn: (e: AgentEvent) => void): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	emitExternalEvent(event: AgentEvent) {
		switch (event.type) {
			case "message_start":
			case "message_update":
				this._state.streamMessage = event.message;
				break;
			case "message_end":
				this._state.streamMessage = null;
				this.appendMessage(event.message);
				break;
			case "tool_execution_start": {
				const pending = new Set(this._state.pendingToolCalls);
				pending.add(event.toolCallId);
				this._state.pendingToolCalls = pending;
				break;
			}
			case "tool_execution_end": {
				const pending = new Set(this._state.pendingToolCalls);
				pending.delete(event.toolCallId);
				this._state.pendingToolCalls = pending;
				break;
			}
		}

		this.emit(event);
	}

	// State mutators
	setSystemPrompt(v: string) {
		this._state.systemPrompt = v;
	}

	setModel(m: Model<any>) {
		this._state.model = m;
	}

	setThinkingLevel(l: ThinkingLevel) {
		this._state.thinkingLevel = l;
	}

	setSteeringMode(mode: "all" | "one-at-a-time") {
		this.steeringMode = mode;
	}

	getSteeringMode(): "all" | "one-at-a-time" {
		return this.steeringMode;
	}

	setFollowUpMode(mode: "all" | "one-at-a-time") {
		this.followUpMode = mode;
	}

	getFollowUpMode(): "all" | "one-at-a-time" {
		return this.followUpMode;
	}

	setInterruptMode(mode: "immediate" | "wait") {
		this.interruptMode = mode;
	}

	getInterruptMode(): "immediate" | "wait" {
		return this.interruptMode;
	}

	setTools(t: AgentTool<any>[]) {
		this._state.tools = t;
	}

	replaceMessages(ms: AgentMessage[]) {
		this._state.messages = ms.slice();
	}

	appendMessage(m: AgentMessage) {
		this._state.messages = [...this._state.messages, m];
	}

	popMessage(): AgentMessage | undefined {
		const messages = this._state.messages.slice(0, -1);
		const removed = this._state.messages.at(-1);
		this._state.messages = messages;

		if (removed && this._state.streamMessage === removed) {
			this._state.streamMessage = null;
		}

		return removed;
	}

	/**
	 * Queue a steering message to interrupt the agent mid-run.
	 * Delivered after current tool execution, skips remaining tools.
	 */
	steer(m: AgentMessage) {
		this.steeringQueue.push(m);
	}

	/**
	 * Queue a follow-up message to be processed after the agent finishes.
	 * Delivered only when agent has no more tool calls or steering messages.
	 */
	followUp(m: AgentMessage) {
		this.followUpQueue.push(m);
	}

	clearSteeringQueue() {
		this.steeringQueue = [];
	}

	clearFollowUpQueue() {
		this.followUpQueue = [];
	}

	clearAllQueues() {
		this.steeringQueue = [];
		this.followUpQueue = [];
	}

	/**
	 * Remove and return the last steering message from the queue (LIFO).
	 * Used by dequeue keybinding.
	 */
	popLastSteer(): AgentMessage | undefined {
		return this.steeringQueue.pop();
	}

	/**
	 * Remove and return the last follow-up message from the queue (LIFO).
	 * Used by dequeue keybinding.
	 */
	popLastFollowUp(): AgentMessage | undefined {
		return this.followUpQueue.pop();
	}

	clearMessages() {
		this._state.messages = [];
	}

	abort() {
		this.abortController?.abort();
	}

	waitForIdle(): Promise<void> {
		return this.runningPrompt ?? Promise.resolve();
	}

	reset() {
		this._state.messages = [];
		this._state.isStreaming = false;
		this._state.streamMessage = null;
		this._state.pendingToolCalls = new Set<string>();
		this._state.error = undefined;
		this.steeringQueue = [];
		this.followUpQueue = [];
	}

	/** Send a prompt with an AgentMessage */
	async prompt(message: AgentMessage | AgentMessage[]): Promise<void>;
	async prompt(input: string, images?: ImageContent[]): Promise<void>;
	async prompt(input: string | AgentMessage | AgentMessage[], images?: ImageContent[]) {
		if (this._state.isStreaming) {
			throw new Error(
				"Agent is already processing a prompt. Use steer() or followUp() to queue messages, or wait for completion.",
			);
		}

		const model = this._state.model;
		if (!model) throw new Error("No model configured");

		let msgs: AgentMessage[];

		if (Array.isArray(input)) {
			msgs = input;
		} else if (typeof input === "string") {
			const content: Array<TextContent | ImageContent> = [{ type: "text", text: input }];
			if (images && images.length > 0) {
				content.push(...images);
			}
			msgs = [
				{
					role: "user",
					content,
					timestamp: Date.now(),
				},
			];
		} else {
			msgs = [input];
		}

		await this._runLoop(msgs);
	}

	/** Continue from current context (for retry after overflow) */
	async continue() {
		if (this._state.isStreaming) {
			throw new Error("Agent is already processing. Wait for completion before continuing.");
		}

		const messages = this._state.messages;
		if (messages.length === 0) {
			throw new Error("No messages to continue from");
		}
		if (messages[messages.length - 1].role === "assistant") {
			throw new Error("Cannot continue from message role: assistant");
		}

		await this._runLoop(undefined);
	}

	/**
	 * Run the agent loop.
	 * If messages are provided, starts a new conversation turn with those messages.
	 * Otherwise, continues from existing context.
	 */
	private async _runLoop(messages?: AgentMessage[]) {
		const model = this._state.model;
		if (!model) throw new Error("No model configured");

		this.runningPrompt = new Promise<void>((resolve) => {
			this.resolveRunningPrompt = resolve;
		});

		this.abortController = new AbortController();
		this._state.isStreaming = true;
		this._state.streamMessage = null;
		this._state.error = undefined;

		// Clear Cursor tool result buffer at start of each run
		this._cursorToolResultBuffer = [];

		const reasoning = this._state.thinkingLevel === "off" ? undefined : this._state.thinkingLevel;

		const context: AgentContext = {
			systemPrompt: this._state.systemPrompt,
			messages: this._state.messages.slice(),
			tools: this._state.tools,
		};

		const cursorOnToolResult =
			this.cursorExecHandlers || this.cursorOnToolResult
				? async (message: ToolResultMessage) => {
						let finalMessage = message;
						if (this.cursorOnToolResult) {
							try {
								const updated = await this.cursorOnToolResult(message);
								if (updated) {
									finalMessage = updated;
								}
							} catch {}
						}
						// Buffer tool result with current text length for correct ordering later.
						// Cursor executes tools server-side during streaming, so the assistant message
						// already incorporates results. We buffer here and emit in correct order
						// when the assistant message ends.
						const textLength = this._getAssistantTextLength(this._state.streamMessage);
						this._cursorToolResultBuffer.push({ toolResult: finalMessage, textLengthAtCall: textLength });
						return finalMessage;
					}
				: undefined;

		const config: AgentLoopConfig = {
			model,
			reasoning,
			interruptMode: this.interruptMode,
			sessionId: this._sessionId,
			thinkingBudgets: this._thinkingBudgets,
			convertToLlm: this.convertToLlm,
			transformContext: this.transformContext,
			getApiKey: this.getApiKey,
			getToolContext: this.getToolContext,
			cursorExecHandlers: this.cursorExecHandlers,
			cursorOnToolResult,
			getSteeringMessages: async () => {
				if (this.steeringMode === "one-at-a-time") {
					if (this.steeringQueue.length > 0) {
						const first = this.steeringQueue[0];
						this.steeringQueue = this.steeringQueue.slice(1);
						return [first];
					}
					return [];
				} else {
					const steering = this.steeringQueue.slice();
					this.steeringQueue = [];
					return steering;
				}
			},
			getFollowUpMessages: async () => {
				if (this.followUpMode === "one-at-a-time") {
					if (this.followUpQueue.length > 0) {
						const first = this.followUpQueue[0];
						this.followUpQueue = this.followUpQueue.slice(1);
						return [first];
					}
					return [];
				} else {
					const followUp = this.followUpQueue.slice();
					this.followUpQueue = [];
					return followUp;
				}
			},
		};

		let partial: AgentMessage | null = null;

		try {
			const stream = messages
				? agentLoop(messages, context, config, this.abortController.signal, this.streamFn)
				: agentLoopContinue(context, config, this.abortController.signal, this.streamFn);

			for await (const event of stream) {
				// Update internal state based on events
				switch (event.type) {
					case "message_start":
						partial = event.message;
						this._state.streamMessage = event.message;
						break;

					case "message_update":
						partial = event.message;
						this._state.streamMessage = event.message;
						break;

					case "message_end":
						partial = null;
						// Check if this is an assistant message with buffered Cursor tool results.
						// If so, split the message to emit tool results at the correct position.
						if (event.message.role === "assistant" && this._cursorToolResultBuffer.length > 0) {
							this._emitCursorSplitAssistantMessage(event.message as AssistantMessage);
							continue; // Skip default emit - split method handles everything
						}
						this._state.streamMessage = null;
						this.appendMessage(event.message);
						break;

					case "tool_execution_start": {
						const s = new Set(this._state.pendingToolCalls);
						s.add(event.toolCallId);
						this._state.pendingToolCalls = s;
						break;
					}

					case "tool_execution_end": {
						const s = new Set(this._state.pendingToolCalls);
						s.delete(event.toolCallId);
						this._state.pendingToolCalls = s;
						break;
					}

					case "turn_end":
						if (event.message.role === "assistant" && (event.message as any).errorMessage) {
							this._state.error = (event.message as any).errorMessage;
						}
						break;

					case "agent_end":
						this._state.isStreaming = false;
						this._state.streamMessage = null;
						break;
				}

				// Emit to listeners
				this.emit(event);
			}

			// Handle any remaining partial message
			if (partial && partial.role === "assistant" && partial.content.length > 0) {
				const onlyEmpty = !partial.content.some(
					(c) =>
						(c.type === "thinking" && c.thinking.trim().length > 0) ||
						(c.type === "text" && c.text.trim().length > 0) ||
						(c.type === "toolCall" && c.name.trim().length > 0),
				);
				if (!onlyEmpty) {
					this.appendMessage(partial);
				} else {
					if (this.abortController?.signal.aborted) {
						throw new Error("Request was aborted");
					}
				}
			}
		} catch (err: any) {
			const errorMsg: AgentMessage = {
				role: "assistant",
				content: [{ type: "text", text: "" }],
				api: model.api,
				provider: model.provider,
				model: model.id,
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: this.abortController?.signal.aborted ? "aborted" : "error",
				errorMessage: err?.message || String(err),
				timestamp: Date.now(),
			} as AgentMessage;

			this.appendMessage(errorMsg);
			this._state.error = err?.message || String(err);
			this.emit({ type: "agent_end", messages: [errorMsg] });
		} finally {
			this._state.isStreaming = false;
			this._state.streamMessage = null;
			this._state.pendingToolCalls = new Set<string>();
			this.abortController = undefined;
			this.resolveRunningPrompt?.();
			this.runningPrompt = undefined;
			this.resolveRunningPrompt = undefined;
		}
	}

	private emit(e: AgentEvent) {
		for (const listener of this.listeners) {
			listener(e);
		}
	}

	/** Calculate total text length from an assistant message's content blocks */
	private _getAssistantTextLength(message: AgentMessage | null): number {
		if (!message || message.role !== "assistant" || !Array.isArray(message.content)) {
			return 0;
		}
		let length = 0;
		for (const block of message.content) {
			if (block.type === "text") {
				length += (block as TextContent).text.length;
			}
		}
		return length;
	}

	/**
	 * Emit a Cursor assistant message split around tool results.
	 * This fixes the ordering issue where tool results appear after the full explanation.
	 *
	 * Output order: Assistant(preamble) -> ToolResults -> Assistant(continuation)
	 */
	private _emitCursorSplitAssistantMessage(assistantMessage: AssistantMessage): void {
		const buffer = this._cursorToolResultBuffer;
		this._cursorToolResultBuffer = [];

		if (buffer.length === 0) {
			// No tool results, emit normally
			this._state.streamMessage = null;
			this.appendMessage(assistantMessage);
			this.emit({ type: "message_end", message: assistantMessage });
			return;
		}

		// Find the split point: minimum text length at first tool call
		const splitPoint = Math.min(...buffer.map((r) => r.textLengthAtCall));

		// Extract text content from assistant message
		const content = assistantMessage.content;
		let fullText = "";
		for (const block of content) {
			if (block.type === "text") {
				fullText += block.text;
			}
		}

		// If no text or split point is 0 or at/past end, don't split
		if (fullText.length === 0 || splitPoint <= 0 || splitPoint >= fullText.length) {
			// Emit assistant message first, then tool results (original behavior but with buffered results)
			this._state.streamMessage = null;
			this.appendMessage(assistantMessage);
			this.emit({ type: "message_end", message: assistantMessage });

			// Emit buffered tool results
			for (const { toolResult } of buffer) {
				this.emit({ type: "message_start", message: toolResult });
				this.appendMessage(toolResult);
				this.emit({ type: "message_end", message: toolResult });
			}
			return;
		}

		// Split the text
		const preambleText = fullText.slice(0, splitPoint);
		const continuationText = fullText.slice(splitPoint);

		// Create preamble message (text before tools)
		const preambleContent = content.map((block) => {
			if (block.type === "text") {
				return { ...block, text: preambleText };
			}
			return block;
		});
		const preambleMessage: AssistantMessage = {
			...assistantMessage,
			content: preambleContent,
		};

		// Emit preamble
		this._state.streamMessage = null;
		this.appendMessage(preambleMessage);
		this.emit({ type: "message_end", message: preambleMessage });

		// Emit buffered tool results
		for (const { toolResult } of buffer) {
			this.emit({ type: "message_start", message: toolResult });
			this.appendMessage(toolResult);
			this.emit({ type: "message_end", message: toolResult });
		}

		// Emit continuation message (text after tools) if non-empty
		const trimmedContinuation = continuationText.trim();
		if (trimmedContinuation.length > 0) {
			// Create continuation message with only text content (no thinking/toolCalls)
			const continuationContent: TextContent[] = [{ type: "text", text: continuationText }];
			const continuationMessage: AssistantMessage = {
				...assistantMessage,
				content: continuationContent,
				// Zero out usage for continuation since it's part of same response
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
			};
			this.emit({ type: "message_start", message: continuationMessage });
			this.appendMessage(continuationMessage);
			this.emit({ type: "message_end", message: continuationMessage });
		}
	}
}
