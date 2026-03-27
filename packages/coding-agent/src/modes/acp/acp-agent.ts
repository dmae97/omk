import * as path from "node:path";
import {
	type Agent,
	type AgentSideConnection,
	type AuthenticateRequest,
	type AuthenticateResponse,
	type AvailableCommand,
	type InitializeRequest,
	type InitializeResponse,
	type ListSessionsRequest,
	type ListSessionsResponse,
	type LoadSessionRequest,
	type LoadSessionResponse,
	type McpServer,
	type NewSessionRequest,
	type NewSessionResponse,
	PROTOCOL_VERSION,
	type PromptRequest,
	type PromptResponse,
	type SessionConfigOption,
	type SessionInfo,
	type SessionModeState,
	type SessionNotification,
	type SessionUpdate,
	type SetSessionConfigOptionRequest,
	type SetSessionConfigOptionResponse,
	type SetSessionModeRequest,
	type SetSessionModeResponse,
} from "@agentclientprotocol/sdk";
import type { Model } from "@oh-my-pi/pi-ai";
import { logger, VERSION } from "@oh-my-pi/pi-utils";
import type { ExtensionUIContext } from "../../extensibility/extensions";
import { loadSlashCommands } from "../../extensibility/slash-commands";
import { MCPManager } from "../../mcp/manager";
import type { MCPServerConfig } from "../../mcp/types";
import { theme } from "../../modes/theme/theme";
import type { AgentSession, AgentSessionEvent } from "../../session/agent-session";
import { SessionManager, type SessionInfo as StoredSessionInfo } from "../../session/session-manager";
import { parseThinkingLevel } from "../../thinking";
import { mapAgentSessionEventToAcpSessionUpdates, mapToolKind } from "./acp-event-mapper";

const ACP_MODE_ID = "default";
const MODE_CONFIG_ID = "mode";
const MODEL_CONFIG_ID = "model";
const THINKING_CONFIG_ID = "thinking";
const THINKING_OFF = "off";
const SESSION_PAGE_SIZE = 50;

type AgentImageContent = {
	type: "image";
	data: string;
	mimeType: string;
};

type PromptTurnState = {
	messageId: string | null;
	cancelRequested: boolean;
	settled: boolean;
	unsubscribe: (() => void) | undefined;
	resolve: (value: PromptResponse) => void;
	reject: (reason?: unknown) => void;
};

type ReplayableMessage = {
	role: string;
	content?: unknown;
	errorMessage?: string;
	toolCallId?: string;
	toolName?: string;
	details?: unknown;
	isError?: boolean;
};

type MCPConfigMap = {
	[name: string]: MCPServerConfig;
};

type MCPSource = {
	provider: string;
	providerName: string;
	path: string;
	level: "project";
};

type MCPSourceMap = {
	[name: string]: MCPSource;
};

const acpExtensionUiContext: ExtensionUIContext = {
	select: async () => undefined,
	confirm: async () => false,
	input: async () => undefined,
	notify: (message, type) => {
		logger.debug("ACP extension notification", { message, type });
	},
	onTerminalInput: () => () => {},
	setStatus: () => {},
	setWorkingMessage: () => {},
	setWidget: () => {},
	setFooter: () => {},
	setHeader: () => {},
	setTitle: () => {},
	custom: async () => undefined as never,
	pasteToEditor: () => {},
	setEditorText: () => {},
	getEditorText: () => "",
	editor: async () => undefined,
	setEditorComponent: () => {},
	get theme() {
		return theme;
	},
	getAllThemes: async () => [],
	getTheme: async () => undefined,
	setTheme: async () => ({ success: false, error: "Theme changes are unavailable in ACP mode" }),
	getToolsExpanded: () => false,
	setToolsExpanded: () => {},
};

export class AcpAgent implements Agent {
	#connection: AgentSideConnection;
	#session: AgentSession;
	#mcpManager: MCPManager | undefined;
	#promptTurn: PromptTurnState | undefined;
	#hasOpenedSession = false;

	constructor(connection: AgentSideConnection, session: AgentSession) {
		this.#connection = connection;
		this.#session = session;
	}

	async initialize(_params: InitializeRequest): Promise<InitializeResponse> {
		return {
			protocolVersion: PROTOCOL_VERSION,
			agentInfo: {
				name: "oh-my-pi",
				title: "Oh My Pi",
				version: VERSION,
			},
			authMethods: [
				{
					id: "agent",
					name: "Agent-managed authentication",
					description: "Oh My Pi uses its existing local authentication and provider configuration.",
				},
			],
			agentCapabilities: {
				loadSession: true,
				mcpCapabilities: {
					http: true,
					sse: true,
				},
				promptCapabilities: {
					embeddedContext: true,
					image: true,
				},
				sessionCapabilities: {
					list: {},
				},
			},
		};
	}

	async authenticate(_params: AuthenticateRequest): Promise<AuthenticateResponse> {
		return {};
	}

	async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
		this.#assertAbsoluteCwd(params.cwd);
		await this.#session.sessionManager.flush();
		await this.#session.sessionManager.moveTo(params.cwd);
		if (this.#hasOpenedSession) {
			const success = await this.#session.newSession();
			if (!success) {
				throw new Error("ACP session creation was cancelled");
			}
		}
		this.#hasOpenedSession = true;
		await this.#session.sessionManager.ensureOnDisk();
		await this.#configureExtensions();
		await this.#configureMcpServers(params.mcpServers);
		const response: NewSessionResponse = {
			sessionId: this.#sessionId,
			configOptions: this.#buildConfigOptions(),
			modes: this.#buildModeState(),
		};
		this.#scheduleBootstrapUpdates(this.#sessionId);
		return response;
	}

	async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
		this.#assertAbsoluteCwd(params.cwd);
		await this.#session.sessionManager.flush();
		const storedSession = await this.#findStoredSession(params.sessionId, params.cwd);
		if (!storedSession) {
			throw new Error(`ACP session not found: ${params.sessionId}`);
		}
		const currentSessionFile = this.#session.sessionManager.getSessionFile();
		if (currentSessionFile !== storedSession.path) {
			const success = await this.#session.switchSession(storedSession.path);
			if (!success) {
				throw new Error(`ACP session load was cancelled: ${params.sessionId}`);
			}
		}
		this.#hasOpenedSession = true;
		await this.#configureExtensions();
		await this.#configureMcpServers(params.mcpServers);
		await this.#replaySessionHistory();
		const response: LoadSessionResponse = {
			configOptions: this.#buildConfigOptions(),
			modes: this.#buildModeState(),
		};
		this.#scheduleBootstrapUpdates(this.#sessionId);
		return response;
	}

	async listSessions(params: ListSessionsRequest): Promise<ListSessionsResponse> {
		if (params.cwd) {
			this.#assertAbsoluteCwd(params.cwd);
		}
		await this.#session.sessionManager.flush();
		const sessions = await this.#listStoredSessions(params.cwd ?? undefined);
		const offset = this.#parseCursor(params.cursor ?? undefined);
		const paged = sessions.slice(offset, offset + SESSION_PAGE_SIZE);
		const nextOffset = offset + paged.length;
		return {
			sessions: paged.map(session => this.#toSessionInfo(session)),
			nextCursor: nextOffset < sessions.length ? String(nextOffset) : undefined,
		};
	}

	async setSessionMode(params: SetSessionModeRequest): Promise<SetSessionModeResponse> {
		this.#assertSameSession(params.sessionId);
		if (params.modeId !== ACP_MODE_ID) {
			throw new Error(`Unsupported ACP mode: ${params.modeId}`);
		}
		await this.#connection.sessionUpdate({
			sessionId: this.#sessionId,
			update: this.#buildCurrentModeUpdate(),
		});
		return {};
	}

	async setSessionConfigOption(params: SetSessionConfigOptionRequest): Promise<SetSessionConfigOptionResponse> {
		this.#assertSameSession(params.sessionId);
		if (typeof params.value === "boolean") {
			throw new Error(`Unsupported boolean ACP config option: ${params.configId}`);
		}

		switch (params.configId) {
			case MODE_CONFIG_ID:
				if (params.value !== ACP_MODE_ID) {
					throw new Error(`Unsupported ACP mode config value: ${params.value}`);
				}
				break;
			case MODEL_CONFIG_ID:
				await this.#setModelById(params.value);
				break;
			case THINKING_CONFIG_ID:
				this.#setThinkingLevelById(params.value);
				break;
			default:
				throw new Error(`Unknown ACP config option: ${params.configId}`);
		}

		const configOptions = this.#buildConfigOptions();
		await this.#connection.sessionUpdate({
			sessionId: this.#sessionId,
			update: {
				sessionUpdate: "config_option_update",
				configOptions,
			},
		});
		return { configOptions };
	}

	async prompt(params: PromptRequest): Promise<PromptResponse> {
		this.#assertSameSession(params.sessionId);
		if (this.#promptTurn && !this.#promptTurn.settled) {
			throw new Error("ACP prompt already in progress for this session");
		}

		const converted = this.#convertPromptBlocks(params.prompt);
		const pendingPrompt = Promise.withResolvers<PromptResponse>();
		this.#promptTurn = {
			messageId: params.messageId ?? null,
			cancelRequested: false,
			settled: false,
			unsubscribe: undefined,
			resolve: pendingPrompt.resolve,
			reject: pendingPrompt.reject,
		};

		this.#promptTurn.unsubscribe = this.#session.subscribe(event => {
			void this.#handlePromptEvent(event);
		});

		this.#session.prompt(converted.text, { images: converted.images }).catch((error: unknown) => {
			this.#finishPrompt(undefined, error);
		});

		return await pendingPrompt.promise;
	}

	async cancel(params: { sessionId: string }): Promise<void> {
		this.#assertSameSession(params.sessionId);
		const promptTurn = this.#promptTurn;
		if (!promptTurn || promptTurn.settled) {
			return;
		}
		promptTurn.cancelRequested = true;
		try {
			await this.#session.abort();
			this.#finishPrompt({
				stopReason: "cancelled",
				userMessageId: promptTurn.messageId,
			});
		} catch (error: unknown) {
			this.#finishPrompt(undefined, error);
		}
	}

	async extMethod(_method: string, _params: { [key: string]: unknown }): Promise<{ [key: string]: unknown }> {
		throw new Error("ACP extension methods are not implemented");
	}

	async extNotification(_method: string, _params: { [key: string]: unknown }): Promise<void> {}

	get signal(): AbortSignal {
		return this.#connection.signal;
	}

	get closed(): Promise<void> {
		return this.#connection.closed;
	}

	get #sessionId(): string {
		return this.#session.sessionId;
	}

	async #handlePromptEvent(event: AgentSessionEvent): Promise<void> {
		const promptTurn = this.#promptTurn;
		if (!promptTurn || promptTurn.settled) {
			return;
		}

		for (const notification of mapAgentSessionEventToAcpSessionUpdates(event, this.#sessionId)) {
			await this.#connection.sessionUpdate(notification);
		}

		if (event.type === "agent_end") {
			await this.#emitEndOfTurnUpdates();
			this.#finishPrompt({
				stopReason: promptTurn.cancelRequested ? "cancelled" : "end_turn",
				userMessageId: promptTurn.messageId,
			});
		}
	}

	#finishPrompt(response?: PromptResponse, error?: unknown): void {
		const promptTurn = this.#promptTurn;
		if (!promptTurn || promptTurn.settled) {
			return;
		}
		promptTurn.settled = true;
		promptTurn.unsubscribe?.();
		this.#promptTurn = undefined;
		if (error !== undefined) {
			promptTurn.reject(error);
			return;
		}
		promptTurn.resolve(response ?? { stopReason: "end_turn" });
	}

	#assertSameSession(sessionId: string): void {
		if (sessionId !== this.#sessionId) {
			throw new Error(`Unsupported ACP session: ${sessionId}`);
		}
	}

	#assertAbsoluteCwd(cwd: string): void {
		if (!path.isAbsolute(cwd)) {
			throw new Error(`ACP cwd must be absolute: ${cwd}`);
		}
	}

	#convertPromptBlocks(blocks: PromptRequest["prompt"]): { text: string; images: AgentImageContent[] } {
		const textParts: string[] = [];
		const images: AgentImageContent[] = [];
		for (const block of blocks) {
			switch (block.type) {
				case "text":
					textParts.push(block.text);
					break;
				case "image":
					images.push({ type: "image", data: block.data, mimeType: block.mimeType });
					break;
				case "resource":
					if ("text" in block.resource) {
						textParts.push(block.resource.text);
					} else {
						textParts.push(`[embedded resource: ${block.resource.uri}]`);
					}
					break;
				case "resource_link":
					textParts.push(block.title ?? block.name ?? block.uri);
					break;
				case "audio":
					textParts.push("[audio omitted]");
					break;
			}
		}
		return {
			text: textParts.join("\n\n").trim(),
			images,
		};
	}

	#buildConfigOptions(): SessionConfigOption[] {
		const configOptions: SessionConfigOption[] = [
			{
				id: MODE_CONFIG_ID,
				name: "Mode",
				category: "mode",
				type: "select",
				currentValue: ACP_MODE_ID,
				options: [{ value: ACP_MODE_ID, name: "Default", description: "Standard ACP headless mode" }],
			},
		];

		const models = this.#session.getAvailableModels();
		const currentModel = this.#session.model;
		if (models.length > 0) {
			configOptions.push({
				id: MODEL_CONFIG_ID,
				name: "Model",
				category: "model",
				type: "select",
				currentValue: currentModel ? this.#toModelId(currentModel) : this.#toModelId(models[0]),
				options: models.map(model => ({
					value: this.#toModelId(model),
					name: model.name,
					description: `${model.provider}/${model.id}`,
				})),
			});
		}

		configOptions.push({
			id: THINKING_CONFIG_ID,
			name: "Thinking",
			category: "thought_level",
			type: "select",
			currentValue: this.#toThinkingConfigValue(this.#session.thinkingLevel),
			options: this.#buildThinkingOptions(),
		});
		return configOptions;
	}

	#buildThinkingOptions(): Array<{ value: string; name: string; description?: string }> {
		return [
			{ value: THINKING_OFF, name: "Off" },
			...this.#session.getAvailableThinkingLevels().map(level => ({
				value: level,
				name: level,
			})),
		];
	}

	#toThinkingConfigValue(value: string | undefined): string {
		return value && value !== "inherit" ? value : THINKING_OFF;
	}

	async #setModelById(modelId: string): Promise<void> {
		const model = this.#session.getAvailableModels().find(candidate => this.#toModelId(candidate) === modelId);
		if (!model) {
			throw new Error(`Unknown ACP model: ${modelId}`);
		}
		await this.#session.setModel(model);
	}

	#setThinkingLevelById(value: string): void {
		const thinkingLevel = parseThinkingLevel(value);
		if (!thinkingLevel) {
			throw new Error(`Unknown ACP thinking level: ${value}`);
		}
		this.#session.setThinkingLevel(thinkingLevel);
	}

	#toModelId(model: Model): string {
		return `${model.provider}/${model.id}`;
	}

	#buildModeState(): SessionModeState {
		return {
			availableModes: [{ id: ACP_MODE_ID, name: "Default", description: "Standard ACP headless mode" }],
			currentModeId: ACP_MODE_ID,
		};
	}

	#buildCurrentModeUpdate(): SessionUpdate {
		return {
			sessionUpdate: "current_mode_update",
			currentModeId: ACP_MODE_ID,
		};
	}

	async #buildAvailableCommands(): Promise<AvailableCommand[]> {
		const commands: AvailableCommand[] = [];
		const seenNames = new Set<string>();
		const appendCommand = (command: AvailableCommand): void => {
			if (seenNames.has(command.name)) {
				return;
			}
			seenNames.add(command.name);
			commands.push(command);
		};

		for (const command of this.#session.customCommands) {
			appendCommand({
				name: command.command.name,
				description: command.command.description,
				input: { hint: "arguments" },
			});
		}

		for (const command of await loadSlashCommands({ cwd: this.#session.sessionManager.getCwd() })) {
			appendCommand({
				name: command.name,
				description: command.description,
			});
		}

		return commands;
	}

	#toSessionInfo(session: StoredSessionInfo): SessionInfo {
		return {
			sessionId: session.id,
			cwd: session.cwd,
			title: session.title,
			updatedAt: session.modified.toISOString(),
		};
	}

	#scheduleBootstrapUpdates(sessionId: string): void {
		setTimeout(() => {
			if (sessionId !== this.#sessionId || this.#connection.signal.aborted) {
				return;
			}
			void this.#emitBootstrapUpdates(sessionId);
		}, 0);
	}

	async #emitBootstrapUpdates(sessionId: string): Promise<void> {
		if (sessionId !== this.#sessionId) {
			return;
		}
		await this.#connection.sessionUpdate({
			sessionId,
			update: {
				sessionUpdate: "available_commands_update",
				availableCommands: await this.#buildAvailableCommands(),
			},
		});
		await this.#connection.sessionUpdate({
			sessionId,
			update: {
				sessionUpdate: "session_info_update",
				title: this.#session.sessionName,
				updatedAt: this.#session.sessionManager.getHeader()?.timestamp,
			},
		});
	}

	async #emitEndOfTurnUpdates(): Promise<void> {
		const sessionId = this.#sessionId;

		// Emit usage update with context token counts
		const contextUsage = this.#session.getContextUsage();
		if (contextUsage) {
			const usageStats = this.#session.sessionManager.getUsageStatistics();
			await this.#connection.sessionUpdate({
				sessionId,
				update: {
					sessionUpdate: "usage_update",
					size: contextUsage.contextWindow,
					used: contextUsage.tokens ?? 0,
					cost: usageStats.cost > 0 ? { amount: usageStats.cost, currency: "USD" } : undefined,
				},
			});
		}

		// Push latest session title
		await this.#connection.sessionUpdate({
			sessionId,
			update: {
				sessionUpdate: "session_info_update",
				title: this.#session.sessionName,
				updatedAt: new Date().toISOString(),
			},
		});
	}

	async #listStoredSessions(cwd?: string): Promise<StoredSessionInfo[]> {
		const sessions = cwd ? await SessionManager.list(cwd) : await SessionManager.listAll();
		return sessions.sort((left, right) => right.modified.getTime() - left.modified.getTime());
	}

	async #findStoredSession(sessionId: string, cwd: string): Promise<StoredSessionInfo | undefined> {
		const sessions = await this.#listStoredSessions(cwd);
		return sessions.find(session => session.id === sessionId);
	}

	#parseCursor(cursor: string | undefined): number {
		if (!cursor) {
			return 0;
		}
		const parsed = Number.parseInt(cursor, 10);
		if (!Number.isFinite(parsed) || parsed < 0) {
			throw new Error(`Invalid ACP session cursor: ${cursor}`);
		}
		return parsed;
	}

	async #replaySessionHistory(): Promise<void> {
		for (const message of this.#session.sessionManager.buildSessionContext().messages as ReplayableMessage[]) {
			for (const notification of this.#messageToReplayNotifications(message)) {
				await this.#connection.sessionUpdate(notification);
			}
		}
	}

	#messageToReplayNotifications(message: ReplayableMessage): SessionNotification[] {
		if (message.role === "assistant") {
			return this.#replayAssistantMessage(message);
		}
		if (
			message.role === "user" ||
			message.role === "developer" ||
			message.role === "custom" ||
			message.role === "hookMessage"
		) {
			return this.#wrapReplayContent(this.#extractReplayContent(message.content, undefined), "user_message_chunk");
		}
		if (
			message.role === "toolResult" &&
			typeof message.toolCallId === "string" &&
			typeof message.toolName === "string"
		) {
			return this.#replayToolResult({ ...message, toolCallId: message.toolCallId, toolName: message.toolName });
		}
		if (
			message.role === "bashExecution" ||
			message.role === "pythonExecution" ||
			message.role === "compactionSummary"
		) {
			return this.#wrapReplayContent(this.#extractReplayContent(message.content, undefined), "user_message_chunk");
		}
		return [];
	}

	#replayAssistantMessage(message: ReplayableMessage): SessionNotification[] {
		const notifications: SessionNotification[] = [];
		const sessionId = this.#sessionId;
		if (Array.isArray(message.content)) {
			for (const item of message.content) {
				if (typeof item !== "object" || item === null || !("type" in item)) {
					continue;
				}
				if (item.type === "text" && "text" in item && typeof item.text === "string" && item.text.length > 0) {
					notifications.push({
						sessionId,
						update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: item.text } },
					});
					continue;
				}
				if (
					item.type === "thinking" &&
					"thinking" in item &&
					typeof item.thinking === "string" &&
					item.thinking.length > 0
				) {
					notifications.push({
						sessionId,
						update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: item.thinking } },
					});
					continue;
				}
				if (
					(item.type === "toolCall" || item.type === "tool_use") &&
					"id" in item &&
					typeof item.id === "string" &&
					"name" in item &&
					typeof item.name === "string"
				) {
					const update: SessionUpdate = {
						sessionUpdate: "tool_call",
						toolCallId: item.id,
						title: item.name,
						kind: mapToolKind(item.name),
						status: "completed",
					};
					if ("arguments" in item && typeof item.arguments === "string") {
						update.rawInput = item.arguments;
					}
					notifications.push({ sessionId, update });
				}
			}
		}
		if (notifications.length === 0 && message.errorMessage) {
			notifications.push({
				sessionId,
				update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: message.errorMessage } },
			});
		}
		return notifications;
	}

	#replayToolResult(
		message: Required<Pick<ReplayableMessage, "toolCallId" | "toolName">> & ReplayableMessage,
	): SessionNotification[] {
		const args = this.#buildReplayToolArgs(message.details);
		const startEvent: AgentSessionEvent = {
			type: "tool_execution_start",
			toolCallId: message.toolCallId,
			toolName: message.toolName,
			args,
		};
		const endEvent: AgentSessionEvent = {
			type: "tool_execution_end",
			toolCallId: message.toolCallId,
			toolName: message.toolName,
			isError: message.isError === true,
			result: {
				content: message.content,
				details: message.details,
				errorMessage: message.errorMessage,
			},
		};
		return [
			...mapAgentSessionEventToAcpSessionUpdates(startEvent, this.#sessionId),
			...mapAgentSessionEventToAcpSessionUpdates(endEvent, this.#sessionId),
		];
	}

	#buildReplayToolArgs(details: unknown): { path?: string } {
		if (typeof details !== "object" || details === null || !("path" in details)) {
			return {};
		}
		const value = (details as { path?: unknown }).path;
		return typeof value === "string" && value.length > 0 ? { path: value } : {};
	}

	#wrapReplayContent(
		content: PromptRequest["prompt"],
		kind: "agent_message_chunk" | "user_message_chunk",
	): SessionNotification[] {
		return content.map(block => ({
			sessionId: this.#sessionId,
			update: {
				sessionUpdate: kind,
				content: block,
			},
		}));
	}

	#extractReplayContent(content: unknown, errorMessage: string | undefined): PromptRequest["prompt"] {
		const replay: PromptRequest["prompt"] = [];
		if (Array.isArray(content)) {
			for (const item of content) {
				if (typeof item !== "object" || item === null || !("type" in item)) {
					continue;
				}
				if (item.type === "text" && "text" in item && typeof item.text === "string" && item.text.length > 0) {
					replay.push({ type: "text", text: item.text });
					continue;
				}
				if (
					item.type === "image" &&
					"data" in item &&
					"mimeType" in item &&
					typeof item.data === "string" &&
					typeof item.mimeType === "string"
				) {
					replay.push({ type: "image", data: item.data, mimeType: item.mimeType });
				}
			}
		}
		if (replay.length === 0 && errorMessage) {
			replay.push({ type: "text", text: errorMessage });
		}
		return replay;
	}

	async #configureExtensions(): Promise<void> {
		const extensionRunner = this.#session.extensionRunner;
		if (!extensionRunner) {
			return;
		}

		extensionRunner.initialize(
			{
				sendMessage: (message, options) => {
					this.#session.sendCustomMessage(message, options).catch((error: unknown) => {
						logger.warn("ACP extension sendMessage failed", { error });
					});
				},
				sendUserMessage: (content, options) => {
					this.#session.sendUserMessage(content, options).catch((error: unknown) => {
						logger.warn("ACP extension sendUserMessage failed", { error });
					});
				},
				appendEntry: (customType, data) => {
					this.#session.sessionManager.appendCustomEntry(customType, data);
				},
				setLabel: (targetId, label) => {
					this.#session.sessionManager.appendLabelChange(targetId, label);
				},
				getActiveTools: () => this.#session.getActiveToolNames(),
				getAllTools: () => this.#session.getAllToolNames(),
				setActiveTools: toolNames => this.#session.setActiveToolsByName(toolNames),
				getCommands: () => [],
				setModel: async model => {
					const apiKey = await this.#session.modelRegistry.getApiKey(model);
					if (!apiKey) {
						return false;
					}
					await this.#session.setModel(model);
					return true;
				},
				getThinkingLevel: () => this.#session.thinkingLevel,
				setThinkingLevel: level => this.#session.setThinkingLevel(level),
			},
			{
				getModel: () => this.#session.model,
				getSearchDb: () => this.#session.searchDb,
				isIdle: () => !this.#session.isStreaming,
				abort: () => {
					void this.#session.abort();
				},
				hasPendingMessages: () => this.#session.queuedMessageCount > 0,
				shutdown: () => {},
				getContextUsage: () => this.#session.getContextUsage(),
				getSystemPrompt: () => this.#session.systemPrompt,
				compact: async instructionsOrOptions => {
					const instructions = typeof instructionsOrOptions === "string" ? instructionsOrOptions : undefined;
					const options =
						instructionsOrOptions && typeof instructionsOrOptions === "object"
							? instructionsOrOptions
							: undefined;
					await this.#session.compact(instructions, options);
				},
			},
			{
				getContextUsage: () => this.#session.getContextUsage(),
				waitForIdle: () => this.#session.agent.waitForIdle(),
				newSession: async options => {
					const success = await this.#session.newSession({ parentSession: options?.parentSession });
					if (success && options?.setup) {
						await options.setup(this.#session.sessionManager);
					}
					return { cancelled: !success };
				},
				branch: async entryId => {
					const result = await this.#session.branch(entryId);
					return { cancelled: result.cancelled };
				},
				navigateTree: async (targetId, options) => {
					const result = await this.#session.navigateTree(targetId, { summarize: options?.summarize });
					return { cancelled: result.cancelled };
				},
				switchSession: async sessionPath => {
					const success = await this.#session.switchSession(sessionPath);
					return { cancelled: !success };
				},
				reload: async () => {
					await this.#session.reload();
				},
				compact: async instructionsOrOptions => {
					const instructions = typeof instructionsOrOptions === "string" ? instructionsOrOptions : undefined;
					const options =
						instructionsOrOptions && typeof instructionsOrOptions === "object"
							? instructionsOrOptions
							: undefined;
					await this.#session.compact(instructions, options);
				},
			},
			acpExtensionUiContext,
		);
		await extensionRunner.emit({ type: "session_start" });
	}

	async #configureMcpServers(servers: McpServer[]): Promise<void> {
		if (this.#mcpManager) {
			await this.#mcpManager.disconnectAll();
		}
		if (servers.length === 0) {
			this.#mcpManager = undefined;
			await this.#session.refreshMCPTools([]);
			return;
		}

		const manager = new MCPManager(this.#session.sessionManager.getCwd());
		const configs: MCPConfigMap = {};
		const sources: MCPSourceMap = {};
		for (const server of servers) {
			configs[server.name] = this.#toMcpConfig(server);
			sources[server.name] = {
				provider: "acp",
				providerName: "ACP Client",
				path: `acp://${server.name}`,
				level: "project",
			};
		}

		const result = await manager.connectServers(configs, sources);
		if (result.errors.size > 0) {
			throw new Error(
				Array.from(result.errors.entries())
					.map(([name, message]) => `${name}: ${message}`)
					.join("; "),
			);
		}

		this.#mcpManager = manager;
		await this.#session.refreshMCPTools(result.tools);
	}

	#toMcpConfig(server: McpServer): MCPServerConfig {
		if ("command" in server) {
			return {
				type: "stdio",
				command: server.command,
				args: server.args,
				env: this.#toNameValueMap(server.env),
			};
		}
		if (server.type === "http") {
			return {
				type: "http",
				url: server.url,
				headers: this.#toNameValueMap(server.headers),
			};
		}
		return {
			type: "sse",
			url: server.url,
			headers: this.#toNameValueMap(server.headers),
		};
	}

	#toNameValueMap(values: Array<{ name: string; value: string }>): { [name: string]: string } {
		const mapped: { [name: string]: string } = {};
		for (const value of values) {
			mapped[value.name] = value.value;
		}
		return mapped;
	}
}
