import { randomUUID } from "node:crypto";
import type { AssistantMessage, ImageContent, Model } from "@earendil-works/pi-ai";
import { Agent } from "../agent.js";
import type { AgentEvent, AgentMessage, AgentTool, ThinkingLevel } from "../types.js";
import { collectEntriesForBranchSummary, generateBranchSummary } from "./compaction/branch-summarization.js";
import { compact, DEFAULT_COMPACTION_SETTINGS, prepareCompaction } from "./compaction/compaction.js";
import { formatPromptTemplateInvocation } from "./prompt-templates.js";
import { formatSkillInvocation } from "./skills.js";
import type {
	AbortResult,
	AgentHarnessContext,
	AgentHarnessConversationState,
	AgentHarnessEvent,
	AgentHarnessEventResultMap,
	AgentHarnessOperationState,
	AgentHarnessOptions,
	AgentHarnessOwnEvent,
	AgentHarnessResources,
	ExecutionEnv,
	NavigateTreeResult,
	Session,
} from "./types.js";

function createUserMessage(text: string, images?: ImageContent[]): AgentMessage {
	const content: Array<{ type: "text"; text: string } | ImageContent> = [{ type: "text", text }];
	if (images) content.push(...images);
	return { role: "user", content, timestamp: Date.now() };
}

export class AgentHarness {
	readonly agent: Agent;
	readonly env: ExecutionEnv;
	readonly conversation: AgentHarnessConversationState;
	readonly operation: AgentHarnessOperationState;

	private session: Session;
	private resourcesInput?: AgentHarnessOptions["resources"];
	private systemPrompt: AgentHarnessOptions["systemPrompt"];
	private requestAuth?: AgentHarnessOptions["requestAuth"];
	private toolRegistry = new Map<string, AgentTool>();
	private listeners = new Set<(event: AgentHarnessEvent, signal?: AbortSignal) => Promise<void> | void>();
	private hooks = new Map<
		keyof AgentHarnessEventResultMap,
		Set<(event: any, ctx: AgentHarnessContext) => Promise<any> | any>
	>();

	constructor(options: AgentHarnessOptions) {
		this.agent = new Agent({
			initialState: {
				model: options.model,
				thinkingLevel: options.thinkingLevel,
				tools: options.tools ?? [],
			},
		});
		this.env = options.env;
		this.session = options.session;
		this.resourcesInput = options.resources;
		this.systemPrompt = options.systemPrompt;
		this.requestAuth = options.requestAuth;
		for (const tool of this.agent.state.tools) {
			this.toolRegistry.set(tool.name, tool);
		}
		this.conversation = {
			session: options.session,
			model: options.model,
			thinkingLevel: options.thinkingLevel ?? this.agent.state.thinkingLevel,
			activeToolNames: options.activeToolNames ?? this.agent.state.tools.map((tool) => tool.name),
			nextTurnQueue: [],
		};
		this.agent.state.model = this.conversation.model;
		this.agent.state.thinkingLevel = this.conversation.thinkingLevel;
		this.agent.getApiKey = async (provider) => {
			const model = this.conversation.model;
			if (!this.requestAuth || model.provider !== provider) return undefined;
			return (await this.requestAuth(model))?.apiKey;
		};
		this.operation = {
			idle: true,
			abortRequested: false,
			steerQueue: [],
			followUpQueue: [],
			pendingMutations: {
				appendMessages: [],
			},
		};
		this.agent.transformContext = async (messages, signal) => {
			const result = await this.emitHook("context", { type: "context", messages: [...messages] }, signal);
			return result?.messages ?? messages;
		};
		this.agent.beforeToolCall = async ({ toolCall, args }, signal) => {
			const result = await this.emitHook(
				"tool_call",
				{
					type: "tool_call",
					toolCallId: toolCall.id,
					toolName: toolCall.name,
					input: args as Record<string, unknown>,
				},
				signal,
			);
			return result ? { block: result.block, reason: result.reason } : undefined;
		};
		this.agent.afterToolCall = async ({ toolCall, args, result, isError }, signal) => {
			const patch = await this.emitHook(
				"tool_result",
				{
					type: "tool_result",
					toolCallId: toolCall.id,
					toolName: toolCall.name,
					input: args as Record<string, unknown>,
					content: result.content,
					details: result.details,
					isError,
				},
				signal,
			);
			return patch
				? { content: patch.content, details: patch.details, isError: patch.isError, terminate: patch.terminate }
				: undefined;
		};
		this.agent.onPayload = async (payload) => {
			const result = await this.emitHook("before_provider_request", { type: "before_provider_request", payload });
			return result?.payload ?? payload;
		};
		this.agent.onResponse = async (response) => {
			const headers = { ...(response.headers as Record<string, string>) };
			await this.emitOwn({ type: "after_provider_response", status: response.status, headers }, this.agent.signal);
		};
		this.agent.subscribe(async (event, signal) => {
			await this.handleAgentEvent(event, signal);
		});
		void this.syncFromTree();
	}

	private createContext(signal?: AbortSignal): AgentHarnessContext {
		return {
			env: this.env,
			conversation: this.conversation,
			operation: this.operation,
			abortSignal: signal,
		};
	}

	private async resolveResources(signal?: AbortSignal): Promise<AgentHarnessResources> {
		return typeof this.resourcesInput === "function"
			? await this.resourcesInput(this.createContext(signal))
			: (this.resourcesInput ?? {});
	}

	private getActiveTools(): AgentTool[] {
		return this.conversation.activeToolNames
			.map((name) => this.toolRegistry.get(name))
			.filter((tool): tool is AgentTool => tool !== undefined);
	}

	private async resolveSystemPrompt(resources: AgentHarnessResources): Promise<string> {
		if (!this.systemPrompt) return "You are a helpful assistant.";
		if (typeof this.systemPrompt === "string") return this.systemPrompt;
		return await this.systemPrompt({
			env: this.env,
			session: this.session,
			model: this.conversation.model,
			thinkingLevel: this.conversation.thinkingLevel,
			activeTools: this.getActiveTools(),
			resources,
		});
	}

	private async emitOwn(event: AgentHarnessOwnEvent, signal?: AbortSignal): Promise<void> {
		for (const listener of this.listeners) {
			await listener(event, signal);
		}
	}

	private async emitAny(event: AgentHarnessEvent, signal?: AbortSignal): Promise<void> {
		for (const listener of this.listeners) {
			await listener(event, signal);
		}
	}

	private async emitHook<TType extends keyof AgentHarnessEventResultMap>(
		type: TType,
		event: Extract<AgentHarnessOwnEvent, { type: TType }>,
		signal?: AbortSignal,
	): Promise<AgentHarnessEventResultMap[TType] | undefined> {
		const handlers = this.hooks.get(type);
		if (!handlers || handlers.size === 0) return undefined;
		let lastResult: AgentHarnessEventResultMap[TType] | undefined;
		for (const handler of handlers) {
			const result = await handler(event, this.createContext(signal));
			if (result !== undefined) {
				lastResult = result;
			}
		}
		return lastResult;
	}

	private async emitQueueUpdate(): Promise<void> {
		await this.emitOwn({
			type: "queue_update",
			steer: [...this.operation.steerQueue],
			followUp: [...this.operation.followUpQueue],
			nextTurn: [...this.conversation.nextTurnQueue],
		});
	}

	private async syncFromTree(): Promise<void> {
		const context = await this.session.buildContext();
		this.agent.state.messages = context.messages;
		if (context.model && this.conversation.model) {
			// leave active model untouched; harness-level model is source of truth
		}
		this.agent.state.systemPrompt = await this.resolveSystemPrompt(await this.resolveResources());
	}

	private async applyPendingMutations(): Promise<void> {
		for (const message of this.operation.pendingMutations.appendMessages) {
			await this.session.appendMessage(message);
		}
		this.operation.pendingMutations.appendMessages = [];

		if (this.operation.pendingMutations.model) {
			const model = this.operation.pendingMutations.model;
			const previousModel = this.conversation.model;
			this.conversation.model = model;
			this.agent.state.model = model;
			await this.session.appendModelChange(model.provider, model.id);
			await this.emitOwn({ type: "model_select", model, previousModel, source: "set" });
			this.operation.pendingMutations.model = undefined;
		}

		if (this.operation.pendingMutations.thinkingLevel !== undefined) {
			const level = this.operation.pendingMutations.thinkingLevel;
			const previousLevel = this.conversation.thinkingLevel;
			this.conversation.thinkingLevel = level;
			this.agent.state.thinkingLevel = level;
			await this.session.appendThinkingLevelChange(level);
			await this.emitOwn({ type: "thinking_level_select", level, previousLevel });
			this.operation.pendingMutations.thinkingLevel = undefined;
		}

		if (this.operation.pendingMutations.activeToolNames) {
			this.conversation.activeToolNames = [...this.operation.pendingMutations.activeToolNames];
			this.agent.state.tools = this.conversation.activeToolNames
				.map((name) => this.toolRegistry.get(name))
				.filter((tool): tool is (typeof this.agent.state.tools)[number] => tool !== undefined);
			this.operation.pendingMutations.activeToolNames = undefined;
		}

		await this.syncFromTree();
	}

	private async handleAgentEvent(event: AgentEvent, signal?: AbortSignal): Promise<void> {
		await this.emitAny(event, signal);
		if (event.type === "message_start") {
			const steerIndex = this.operation.steerQueue.indexOf(event.message);
			if (steerIndex !== -1) {
				this.operation.steerQueue.splice(steerIndex, 1);
				await this.emitQueueUpdate();
			} else {
				const followUpIndex = this.operation.followUpQueue.indexOf(event.message);
				if (followUpIndex !== -1) {
					this.operation.followUpQueue.splice(followUpIndex, 1);
					await this.emitQueueUpdate();
				}
			}
		}
		if (event.type === "message_end") {
			await this.session.appendMessage(event.message);
		}
		if (event.type === "turn_end") {
			const hadPendingMutations =
				this.operation.pendingMutations.appendMessages.length > 0 ||
				this.operation.pendingMutations.model !== undefined ||
				this.operation.pendingMutations.thinkingLevel !== undefined ||
				this.operation.pendingMutations.activeToolNames !== undefined;
			await this.emitOwn(
				{ type: "save_point", liveOperationId: this.operation.liveOperationId ?? "unknown", hadPendingMutations },
				signal,
			);
			if (hadPendingMutations) {
				await this.applyPendingMutations();
			}
		}
		if (event.type === "agent_end") {
			this.operation.idle = true;
			this.operation.liveOperationId = undefined;
			this.operation.abortRequested = false;
			await this.syncFromTree();
			await this.emitOwn({ type: "settled", nextTurnCount: this.conversation.nextTurnQueue.length }, signal);
		}
	}

	async prompt(text: string, options?: { images?: ImageContent[] }): Promise<AssistantMessage> {
		if (!this.operation.idle) throw new Error("AgentHarness is busy");
		const beforeLength = this.agent.state.messages.length;
		this.operation.idle = false;
		this.operation.liveOperationId = randomUUID();
		const resources = await this.resolveResources(this.agent.signal);
		let messages: AgentMessage[] = [createUserMessage(text, options?.images)];
		if (this.conversation.nextTurnQueue.length > 0) {
			messages = [messages[0]!, ...this.conversation.nextTurnQueue];
			this.conversation.nextTurnQueue = [];
			await this.emitQueueUpdate();
		}
		this.agent.state.systemPrompt = await this.resolveSystemPrompt(resources);
		const beforeResult = await this.emitHook(
			"before_agent_start",
			{
				type: "before_agent_start",
				prompt: text,
				images: options?.images,
				systemPrompt: this.agent.state.systemPrompt,
				resources,
			},
			this.agent.signal,
		);
		if (beforeResult?.messages) messages = [...beforeResult.messages, ...messages];
		if (beforeResult?.systemPrompt) this.agent.state.systemPrompt = beforeResult.systemPrompt;
		await this.agent.prompt(messages);
		let response: AssistantMessage | undefined;
		const newMessages = this.agent.state.messages.slice(beforeLength);
		for (let i = newMessages.length - 1; i >= 0; i--) {
			const message = newMessages[i]!;
			if (message.role === "assistant") {
				response = message;
				break;
			}
		}
		if (!response) throw new Error("AgentHarness prompt completed without an assistant message");
		return response;
	}

	async skill(name: string, additionalInstructions?: string): Promise<AssistantMessage> {
		const resources = await this.resolveResources();
		const skill = (resources.skills ?? []).find((candidate) => candidate.name === name);
		if (!skill) throw new Error(`Unknown skill: ${name}`);
		return await this.prompt(formatSkillInvocation(skill, additionalInstructions));
	}

	async promptFromTemplate(name: string, args: string[] = []): Promise<AssistantMessage> {
		const resources = await this.resolveResources();
		const template = (resources.promptTemplates ?? []).find((candidate) => candidate.name === name);
		if (!template) throw new Error(`Unknown prompt template: ${name}`);
		return await this.prompt(formatPromptTemplateInvocation(template, args));
	}

	steer(message: AgentMessage): void {
		if (this.operation.idle) throw new Error("Cannot steer while idle");
		this.operation.steerQueue.push(message);
		this.agent.steer(message);
		void this.emitQueueUpdate();
	}

	followUp(message: AgentMessage): void {
		if (this.operation.idle) throw new Error("Cannot follow up while idle");
		this.operation.followUpQueue.push(message);
		this.agent.followUp(message);
		void this.emitQueueUpdate();
	}

	nextTurn(message: AgentMessage): void {
		this.conversation.nextTurnQueue.push(message);
		void this.emitQueueUpdate();
	}

	async appendMessage(message: AgentMessage): Promise<void> {
		if (this.operation.idle) {
			await this.session.appendMessage(message);
			await this.syncFromTree();
		} else {
			this.operation.pendingMutations.appendMessages.push(message);
		}
	}

	async shell(
		command: string,
		options?: {
			cwd?: string;
			env?: Record<string, string>;
			timeout?: number;
			signal?: AbortSignal;
			onStdout?: (chunk: string) => void;
			onStderr?: (chunk: string) => void;
		},
	): Promise<{ stdout: string; stderr: string; exitCode: number }> {
		return await this.env.exec(command, options);
	}

	async compact(
		customInstructions?: string,
	): Promise<{ summary: string; firstKeptEntryId: string; tokensBefore: number; details?: unknown }> {
		if (!this.operation.idle) throw new Error("compact() requires idle harness");
		const model = this.conversation.model;
		if (!model) throw new Error("No model set for compaction");
		const auth = await this.requestAuth?.(model);
		if (!auth) throw new Error("No auth available for compaction");
		const branchEntries = await this.session.getBranch();
		const preparation = prepareCompaction(branchEntries, DEFAULT_COMPACTION_SETTINGS);
		if (!preparation) throw new Error("Nothing to compact");
		const hookResult = await this.emitHook("session_before_compact", {
			type: "session_before_compact",
			preparation,
			branchEntries,
			customInstructions,
			signal: new AbortController().signal,
		});
		if (hookResult?.cancel) throw new Error("Compaction cancelled");
		const provided = hookResult?.compaction;
		const result =
			provided ??
			(await compact(
				preparation,
				model,
				auth.apiKey,
				auth.headers,
				customInstructions,
				undefined,
				this.conversation.thinkingLevel,
			));
		const entryId = await this.session.appendCompaction(
			result.summary,
			result.firstKeptEntryId,
			result.tokensBefore,
			result.details,
			provided !== undefined,
		);
		const entry = await this.session.getEntry(entryId);
		await this.syncFromTree();
		if (entry?.type === "compaction") {
			await this.emitOwn({ type: "session_compact", compactionEntry: entry, fromHook: provided !== undefined });
		}
		return result;
	}

	async navigateTree(
		targetId: string,
		options?: { summarize?: boolean; customInstructions?: string; replaceInstructions?: boolean; label?: string },
	): Promise<NavigateTreeResult> {
		if (!this.operation.idle) throw new Error("navigateTree() requires idle harness");
		const oldLeafId = await this.session.getLeafId();
		if (oldLeafId === targetId) return { cancelled: false };
		const targetEntry = await this.session.getEntry(targetId);
		if (!targetEntry) throw new Error(`Entry ${targetId} not found`);
		const { entries, commonAncestorId } = await collectEntriesForBranchSummary(this.session, oldLeafId, targetId);
		const preparation = {
			targetId,
			oldLeafId,
			commonAncestorId,
			entriesToSummarize: entries,
			userWantsSummary: options?.summarize ?? false,
			customInstructions: options?.customInstructions,
			replaceInstructions: options?.replaceInstructions,
			label: options?.label,
		};
		const signal = new AbortController().signal;
		const hookResult = await this.emitHook("session_before_tree", {
			type: "session_before_tree",
			preparation,
			signal,
		});
		if (hookResult?.cancel) return { cancelled: true };
		let summaryEntry: any | undefined;
		let summaryText: string | undefined = hookResult?.summary?.summary;
		let summaryDetails: unknown = hookResult?.summary?.details;
		if (!summaryText && options?.summarize && entries.length > 0) {
			const model = this.conversation.model;
			if (!model) throw new Error("No model set for branch summary");
			const auth = await this.requestAuth?.(model);
			if (!auth) throw new Error("No auth available for branch summary");
			const branchSummary = await generateBranchSummary(entries, {
				model,
				apiKey: auth.apiKey,
				headers: auth.headers,
				signal: new AbortController().signal,
				customInstructions: hookResult?.customInstructions ?? options?.customInstructions,
				replaceInstructions: hookResult?.replaceInstructions ?? options?.replaceInstructions,
			});
			if (branchSummary.aborted) return { cancelled: true };
			if (branchSummary.error) throw new Error(branchSummary.error);
			summaryText = branchSummary.summary;
			summaryDetails = {
				readFiles: branchSummary.readFiles ?? [],
				modifiedFiles: branchSummary.modifiedFiles ?? [],
			};
		}
		let editorText: string | undefined;
		let newLeafId: string | null;
		if (targetEntry.type === "message" && targetEntry.message.role === "user") {
			newLeafId = targetEntry.parentId;
			const content = targetEntry.message.content;
			editorText =
				typeof content === "string"
					? content
					: content
							.filter((c): c is { readonly type: "text"; readonly text: string } => c.type === "text")
							.map((c) => c.text)
							.join("");
		} else if (targetEntry.type === "custom_message") {
			newLeafId = targetEntry.parentId;
			editorText =
				typeof targetEntry.content === "string"
					? targetEntry.content
					: targetEntry.content
							.filter((c): c is { readonly type: "text"; readonly text: string } => c.type === "text")
							.map((c) => c.text)
							.join("");
		} else {
			newLeafId = targetId;
		}
		const summaryId = await this.session.moveTo(
			newLeafId,
			summaryText
				? {
						summary: summaryText,
						details: summaryDetails,
						fromHook: hookResult?.summary !== undefined,
					}
				: undefined,
		);
		if (summaryId) {
			summaryEntry = await this.session.getEntry(summaryId);
		}
		await this.syncFromTree();
		await this.emitOwn({
			type: "session_tree",
			newLeafId: await this.session.getLeafId(),
			oldLeafId,
			summaryEntry,
			fromHook: hookResult?.summary !== undefined,
		});
		return { cancelled: false, editorText, summaryEntry };
	}

	async setModel(model: Model<any>): Promise<void> {
		if (this.operation.idle) {
			const previousModel = this.conversation.model;
			this.conversation.model = model;
			this.agent.state.model = model;
			await this.session.appendModelChange(model.provider, model.id);
			await this.emitOwn({ type: "model_select", model, previousModel, source: "set" });
		} else {
			this.operation.pendingMutations.model = model;
		}
	}

	async setThinkingLevel(level: ThinkingLevel): Promise<void> {
		if (this.operation.idle) {
			const previousLevel = this.conversation.thinkingLevel;
			this.conversation.thinkingLevel = level;
			this.agent.state.thinkingLevel = level;
			await this.session.appendThinkingLevelChange(level);
			await this.emitOwn({ type: "thinking_level_select", level, previousLevel });
		} else {
			this.operation.pendingMutations.thinkingLevel = level;
		}
	}

	async setActiveTools(toolNames: string[]): Promise<void> {
		if (this.operation.idle) {
			this.conversation.activeToolNames = [...toolNames];
			this.agent.state.tools = this.getActiveTools();
		} else {
			this.operation.pendingMutations.activeToolNames = [...toolNames];
		}
	}

	async abort(): Promise<AbortResult> {
		this.operation.abortRequested = true;
		const clearedSteer = [...this.operation.steerQueue];
		const clearedFollowUp = [...this.operation.followUpQueue];
		this.operation.steerQueue = [];
		this.operation.followUpQueue = [];
		this.agent.clearAllQueues();
		await this.emitQueueUpdate();
		this.agent.abort();
		await this.agent.waitForIdle();
		await this.emitOwn({ type: "abort", clearedSteer, clearedFollowUp });
		return { clearedSteer, clearedFollowUp };
	}

	async waitForIdle(): Promise<void> {
		await this.agent.waitForIdle();
	}

	subscribe(listener: (event: AgentHarnessEvent, signal?: AbortSignal) => Promise<void> | void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	on<TType extends keyof AgentHarnessEventResultMap>(
		type: TType,
		handler: (
			event: Extract<import("./types.js").AgentHarnessOwnEvent, { type: TType }>,
			ctx: AgentHarnessContext,
		) => Promise<AgentHarnessEventResultMap[TType]> | AgentHarnessEventResultMap[TType],
	): () => void {
		let handlers = this.hooks.get(type);
		if (!handlers) {
			handlers = new Set();
			this.hooks.set(type, handlers);
		}
		handlers.add(handler as any);
		return () => handlers!.delete(handler as any);
	}
}
