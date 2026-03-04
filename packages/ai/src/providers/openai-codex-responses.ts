import * as os from "node:os";
import { $env, abortableSleep, asRecord, readSseJson } from "@oh-my-pi/pi-utils";
import type {
	ResponseFunctionToolCall,
	ResponseInput,
	ResponseInputContent,
	ResponseInputImage,
	ResponseInputText,
	ResponseOutputMessage,
	ResponseReasoningItem,
} from "openai/resources/responses/responses";
import packageJson from "../../package.json" with { type: "json" };
import { calculateCost } from "../models";
import { getEnvApiKey } from "../stream";
import type {
	Api,
	AssistantMessage,
	Context,
	Model,
	ProviderSessionState,
	StopReason,
	StreamFunction,
	StreamOptions,
	TextContent,
	ThinkingContent,
	Tool,
	ToolCall,
	ToolChoice,
} from "../types";
import { normalizeResponsesToolCallId } from "../utils";
import { AssistantMessageEventStream } from "../utils/event-stream";
import { finalizeErrorMessage, type RawHttpRequestDump } from "../utils/http-inspector";
import { parseStreamingJson } from "../utils/json-parse";
import { adaptSchemaForStrict, NO_STRICT } from "../utils/schema";
import {
	CODEX_BASE_URL,
	JWT_CLAIM_PATH,
	OPENAI_HEADER_VALUES,
	OPENAI_HEADERS,
	URL_PATHS,
} from "./openai-codex/constants";
import {
	type CodexRequestOptions,
	type InputItem,
	type RequestBody,
	transformRequestBody,
} from "./openai-codex/request-transformer";
import { parseCodexError } from "./openai-codex/response-handler";
import { transformMessages } from "./transform-messages";

export interface OpenAICodexResponsesOptions extends StreamOptions {
	reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
	reasoningSummary?: "auto" | "concise" | "detailed" | null;
	textVerbosity?: "low" | "medium" | "high";
	include?: string[];
	codexMode?: boolean;
	toolChoice?: ToolChoice;
	preferWebsockets?: boolean;
}

export const CODEX_INSTRUCTIONS = `You are an expert coding assistant operating inside pi, a coding agent harness.`;

export interface CodexSystemPrompt {
	instructions: string;
	developerMessages: string[];
}

export function buildCodexSystemPrompt(args: { userSystemPrompt?: string }): CodexSystemPrompt {
	const { userSystemPrompt } = args;
	const developerMessages: string[] = [];

	if (userSystemPrompt && userSystemPrompt.trim().length > 0) {
		developerMessages.push(userSystemPrompt.trim());
	}

	return {
		instructions: CODEX_INSTRUCTIONS,
		developerMessages,
	};
}

const CODEX_DEBUG = $env.PI_CODEX_DEBUG === "1" || $env.PI_CODEX_DEBUG === "true";
const CODEX_MAX_RETRIES = 5;
const CODEX_RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const CODEX_RETRY_DELAY_MS = 500;
const CODEX_WEBSOCKET_CONNECT_TIMEOUT_MS = 10000;
const CODEX_WEBSOCKET_IDLE_TIMEOUT_MS = 300000;
const CODEX_WEBSOCKET_RETRY_BUDGET = CODEX_MAX_RETRIES;
const CODEX_WEBSOCKET_TRANSPORT_ERROR_PREFIX = "Codex websocket transport error";

function parseCodexNonNegativeInteger(value: string | undefined, fallback: number): number {
	if (!value) return fallback;
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 0) return fallback;
	return Math.trunc(parsed);
}

function parseCodexPositiveInteger(value: string | undefined, fallback: number): number {
	if (!value) return fallback;
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
	return Math.trunc(parsed);
}

function isCodexWebSocketEnvEnabled(): boolean {
	return $env.PI_CODEX_WEBSOCKET === "1" || $env.PI_CODEX_WEBSOCKET === "true";
}

function isCodexWebSocketV2Enabled(): boolean {
	return $env.PI_CODEX_WEBSOCKET_V2 === "1" || $env.PI_CODEX_WEBSOCKET_V2 === "true";
}

function getCodexWebSocketRetryBudget(): number {
	return parseCodexNonNegativeInteger($env.PI_CODEX_WEBSOCKET_RETRY_BUDGET, CODEX_WEBSOCKET_RETRY_BUDGET);
}

function getCodexWebSocketRetryDelayMs(retry: number): number {
	const baseDelay = parseCodexPositiveInteger($env.PI_CODEX_WEBSOCKET_RETRY_DELAY_MS, CODEX_RETRY_DELAY_MS);
	return baseDelay * Math.max(1, retry);
}

function getCodexWebSocketIdleTimeoutMs(): number {
	return parseCodexPositiveInteger($env.PI_CODEX_WEBSOCKET_IDLE_TIMEOUT_MS, CODEX_WEBSOCKET_IDLE_TIMEOUT_MS);
}

type CodexWebSocketSessionState = {
	disableWebsocket: boolean;
	lastRequest?: RequestBody;
	lastResponseId?: string;
	canAppend: boolean;
	turnState?: string;
	modelsEtag?: string;
	reasoningIncluded?: boolean;
	connection?: CodexWebSocketConnection;
	lastTransport?: "sse" | "websocket";
	fallbackCount: number;
	lastFallbackAt?: number;
	prewarmed: boolean;
};

const CODEX_PROVIDER_SESSION_STATE_KEY = "openai-codex-responses";

interface CodexProviderSessionState extends ProviderSessionState {
	webSocketSessions: Map<string, CodexWebSocketSessionState>;
	webSocketPublicToPrivate: Map<string, string>;
}

function createCodexProviderSessionState(): CodexProviderSessionState {
	const state: CodexProviderSessionState = {
		webSocketSessions: new Map(),
		webSocketPublicToPrivate: new Map(),
		close: () => {
			for (const session of state.webSocketSessions.values()) {
				session.connection?.close("session_disposed");
			}
			state.webSocketSessions.clear();
			state.webSocketPublicToPrivate.clear();
		},
	};
	return state;
}

function getCodexProviderSessionState(
	providerSessionState: Map<string, ProviderSessionState> | undefined,
): CodexProviderSessionState | undefined {
	if (!providerSessionState) return undefined;
	const existing = providerSessionState.get(CODEX_PROVIDER_SESSION_STATE_KEY) as CodexProviderSessionState | undefined;
	if (existing) return existing;
	const created = createCodexProviderSessionState();
	providerSessionState.set(CODEX_PROVIDER_SESSION_STATE_KEY, created);
	return created;
}
const X_CODEX_TURN_STATE_HEADER = "x-codex-turn-state";
const X_MODELS_ETAG_HEADER = "x-models-etag";
const X_REASONING_INCLUDED_HEADER = "x-reasoning-included";

function createCodexWebSocketTransportError(message: string): Error {
	return new Error(`${CODEX_WEBSOCKET_TRANSPORT_ERROR_PREFIX}: ${message}`);
}

function isCodexWebSocketTransportError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	return error.message.startsWith(CODEX_WEBSOCKET_TRANSPORT_ERROR_PREFIX);
}

function isCodexWebSocketRetryableStreamError(error: unknown): boolean {
	if (!(error instanceof Error) || !isCodexWebSocketTransportError(error)) return false;
	const message = error.message.toLowerCase();
	return (
		message.includes("websocket closed (") ||
		message.includes("websocket closed before response completion") ||
		message.includes("websocket connection is unavailable")
	);
}

function toCodexHeaderRecord(value: unknown): Record<string, string> | null {
	if (!value || typeof value !== "object") return null;
	const headers: Record<string, string> = {};
	for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
		if (typeof entry === "string") {
			headers[key] = entry;
		} else if (Array.isArray(entry) && entry.every(item => typeof item === "string")) {
			headers[key] = entry.join(",");
		} else if (typeof entry === "number" || typeof entry === "boolean") {
			headers[key] = String(entry);
		}
	}
	return Object.keys(headers).length > 0 ? headers : null;
}

function toCodexHeaders(value: unknown): Headers | undefined {
	if (!value) return undefined;
	if (value instanceof Headers) return value;
	if (Array.isArray(value)) {
		try {
			return new Headers(value as Array<[string, string]>);
		} catch {
			return undefined;
		}
	}
	const record = toCodexHeaderRecord(value);
	if (!record) return undefined;
	return new Headers(record);
}

function updateCodexSessionMetadataFromHeaders(
	state: CodexWebSocketSessionState | undefined,
	headers: Headers | Record<string, string> | null | undefined,
): void {
	if (!state || !headers) return;
	const resolvedHeaders = headers instanceof Headers ? headers : new Headers(headers);
	const turnState = resolvedHeaders.get(X_CODEX_TURN_STATE_HEADER);
	if (turnState && turnState.length > 0) {
		state.turnState = turnState;
	}
	const modelsEtag = resolvedHeaders.get(X_MODELS_ETAG_HEADER);
	if (modelsEtag && modelsEtag.length > 0) {
		state.modelsEtag = modelsEtag;
	}
	const reasoningIncluded = resolvedHeaders.get(X_REASONING_INCLUDED_HEADER);
	if (reasoningIncluded !== null) {
		const normalized = reasoningIncluded.trim().toLowerCase();
		state.reasoningIncluded = normalized.length === 0 ? true : normalized !== "false";
	}
}

function extractCodexWebSocketHandshakeHeaders(socket: WebSocket, openEvent?: Event): Headers | undefined {
	const eventRecord = openEvent as Record<string, unknown> | undefined;
	const eventResponse = eventRecord?.response as Record<string, unknown> | undefined;
	const socketRecord = socket as unknown as Record<string, unknown>;
	const socketResponse = socketRecord.response as Record<string, unknown> | undefined;
	const socketHandshake = socketRecord.handshake as Record<string, unknown> | undefined;
	return (
		toCodexHeaders(eventRecord?.responseHeaders) ??
		toCodexHeaders(eventRecord?.headers) ??
		toCodexHeaders(eventResponse?.headers) ??
		toCodexHeaders(socketRecord.responseHeaders) ??
		toCodexHeaders(socketRecord.handshakeHeaders) ??
		toCodexHeaders(socketResponse?.headers) ??
		toCodexHeaders(socketHandshake?.headers)
	);
}

function normalizeCodexToolChoice(choice: ToolChoice | undefined): string | Record<string, unknown> | undefined {
	if (!choice) return undefined;
	if (typeof choice === "string") return choice;
	if (choice.type === "function") {
		if ("function" in choice && choice.function?.name) {
			return { type: "function", name: choice.function.name };
		}
		if ("name" in choice && choice.name) {
			return { type: "function", name: choice.name };
		}
	}
	if (choice.type === "tool" && choice.name) {
		return { type: "function", name: choice.name };
	}
	return undefined;
}

export const streamOpenAICodexResponses: StreamFunction<"openai-codex-responses"> = (
	model: Model<"openai-codex-responses">,
	context: Context,
	options?: OpenAICodexResponsesOptions,
): AssistantMessageEventStream => {
	const stream = new AssistantMessageEventStream();

	(async () => {
		const startTime = Date.now();
		let firstTokenTime: number | undefined;

		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: "openai-codex-responses" as Api,
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
			stopReason: "stop",
			timestamp: Date.now(),
		};
		let websocketState: CodexWebSocketSessionState | undefined;
		let usingWebsocket = false;
		let rawRequestDump: RawHttpRequestDump | undefined;

		try {
			const apiKey = options?.apiKey || getEnvApiKey(model.provider) || "";
			if (!apiKey) {
				throw new Error(`No API key for provider: ${model.provider}`);
			}

			const accountId = getAccountId(apiKey);
			const baseUrl = model.baseUrl || CODEX_BASE_URL;
			const baseWithSlash = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
			const url = rewriteUrlForCodex(new URL(URL_PATHS.RESPONSES.slice(1), baseWithSlash).toString());

			const messages = convertMessages(model, context);
			const params: RequestBody = {
				model: model.id,
				input: messages,
				stream: true,
				prompt_cache_key: options?.sessionId,
			};

			if (options?.maxTokens) {
				params.max_output_tokens = options.maxTokens;
			}

			if (options?.temperature !== undefined) {
				params.temperature = options.temperature;
			}
			if (options?.topP !== undefined) {
				params.top_p = options.topP;
			}
			if (options?.topK !== undefined) {
				params.top_k = options.topK;
			}
			if (options?.minP !== undefined) {
				params.min_p = options.minP;
			}
			if (options?.presencePenalty !== undefined) {
				params.presence_penalty = options.presencePenalty;
			}
			if (options?.repetitionPenalty !== undefined) {
				params.repetition_penalty = options.repetitionPenalty;
			}

			if (context.tools && context.tools.length > 0) {
				params.tools = convertTools(context.tools);
				if (options?.toolChoice) {
					const toolChoice = normalizeCodexToolChoice(options.toolChoice);
					if (toolChoice) {
						params.tool_choice = toolChoice;
					}
				}
			}

			const systemPrompt = buildCodexSystemPrompt({
				userSystemPrompt: context.systemPrompt,
			});

			params.instructions = systemPrompt.instructions;

			const codexOptions: CodexRequestOptions = {
				reasoningEffort: options?.reasoningEffort,
				reasoningSummary: options?.reasoningSummary ?? "auto",
				textVerbosity: options?.textVerbosity,
				include: options?.include,
			};

			const transformedBody = await transformRequestBody(params, codexOptions, systemPrompt);
			options?.onPayload?.(transformedBody);

			const reasoningEffort = transformedBody.reasoning?.effort ?? null;
			const requestHeaders = { ...(model.headers ?? {}), ...(options?.headers ?? {}) };
			rawRequestDump = {
				provider: model.provider,
				api: output.api,
				model: model.id,
				method: "POST",
				url,
				body: transformedBody,
			};
			const providerSessionState = getCodexProviderSessionState(options?.providerSessionState);
			const sessionKey = getCodexWebSocketSessionKey(options?.sessionId, model, accountId, baseUrl);
			const publicSessionKey = getCodexPublicSessionKey(options?.sessionId, model, baseUrl);
			if (sessionKey && publicSessionKey) {
				providerSessionState?.webSocketPublicToPrivate.set(publicSessionKey, sessionKey);
			}
			websocketState =
				sessionKey && providerSessionState
					? getCodexWebSocketSessionState(sessionKey, providerSessionState)
					: undefined;
			usingWebsocket = false;
			let requestBodyForState = cloneRequestBody(transformedBody);
			let eventStream: AsyncGenerator<Record<string, unknown>>;

			if (websocketState && shouldUseCodexWebSocket(model, websocketState, options?.preferWebsockets)) {
				const websocketRetryBudget = getCodexWebSocketRetryBudget();
				const websocketV2Enabled = isCodexWebSocketV2Enabled();
				let websocketRetries = 0;
				while (true) {
					const websocketRequest = buildCodexWebSocketRequest(transformedBody, websocketState, websocketV2Enabled);
					const websocketHeaders = createCodexHeaders(
						requestHeaders,
						accountId,
						apiKey,
						options?.sessionId,
						"websocket",
						websocketState,
						websocketV2Enabled,
					);
					requestBodyForState = cloneRequestBody(transformedBody);
					logCodexDebug("codex websocket request", {
						url: toWebSocketUrl(url),
						model: params.model,
						reasoningEffort,
						headers: redactHeaders(websocketHeaders),
						sentTurnStateHeader: websocketHeaders.has(X_CODEX_TURN_STATE_HEADER),
						sentModelsEtagHeader: websocketHeaders.has(X_MODELS_ETAG_HEADER),
						requestType: websocketRequest.type,
						retry: websocketRetries,
						retryBudget: websocketRetryBudget,
					});
					try {
						eventStream = await openCodexWebSocketEventStream(
							toWebSocketUrl(url),
							websocketHeaders,
							websocketRequest,
							websocketState,
							options?.signal,
						);
						usingWebsocket = true;
						break;
					} catch (error) {
						const websocketError = error instanceof Error ? error : new Error(String(error));
						const activateFallback = websocketRetries >= websocketRetryBudget;
						recordCodexWebSocketFailure(websocketState, activateFallback);
						logCodexDebug("codex websocket fallback", {
							error: websocketError.message,
							retry: websocketRetries,
							retryBudget: websocketRetryBudget,
							activated: activateFallback,
						});
						if (!activateFallback) {
							websocketRetries += 1;
							await abortableSleep(getCodexWebSocketRetryDelayMs(websocketRetries), options?.signal);
							continue;
						}
						eventStream = await openCodexSseEventStream(
							url,
							requestHeaders,
							accountId,
							apiKey,
							options?.sessionId,
							transformedBody,
							websocketState,
							options?.signal,
						);
						break;
					}
				}
			} else {
				eventStream = await openCodexSseEventStream(
					url,
					requestHeaders,
					accountId,
					apiKey,
					options?.sessionId,
					transformedBody,
					websocketState,
					options?.signal,
				);
			}
			if (websocketState) {
				websocketState.lastTransport = usingWebsocket ? "websocket" : "sse";
			}

			stream.push({ type: "start", partial: output });
			let currentItem: ResponseReasoningItem | ResponseOutputMessage | ResponseFunctionToolCall | null = null;
			let currentBlock: ThinkingContent | TextContent | (ToolCall & { partialJson: string }) | null = null;
			const blocks = output.content;
			const blockIndex = () => blocks.length - 1;
			let websocketStreamRetries = 0;
			let sawTerminalEvent = false;
			while (true) {
				try {
					for await (const rawEvent of eventStream) {
						const eventType = typeof rawEvent.type === "string" ? rawEvent.type : "";
						if (!eventType) continue;

						if (eventType === "response.output_item.added") {
							if (!firstTokenTime) firstTokenTime = Date.now();
							const item = rawEvent.item as
								| ResponseReasoningItem
								| ResponseOutputMessage
								| ResponseFunctionToolCall;
							if (item.type === "reasoning") {
								currentItem = item;
								currentBlock = { type: "thinking", thinking: "" };
								output.content.push(currentBlock);
								stream.push({ type: "thinking_start", contentIndex: blockIndex(), partial: output });
							} else if (item.type === "message") {
								currentItem = item;
								currentBlock = { type: "text", text: "" };
								output.content.push(currentBlock);
								stream.push({ type: "text_start", contentIndex: blockIndex(), partial: output });
							} else if (item.type === "function_call") {
								currentItem = item;
								currentBlock = {
									type: "toolCall",
									id: `${item.call_id}|${item.id}`,
									name: item.name,
									arguments: {},
									partialJson: item.arguments || "",
								};
								output.content.push(currentBlock);
								stream.push({ type: "toolcall_start", contentIndex: blockIndex(), partial: output });
							}
						} else if (eventType === "response.reasoning_summary_part.added") {
							if (currentItem && currentItem.type === "reasoning") {
								currentItem.summary = currentItem.summary || [];
								currentItem.summary.push((rawEvent as { part: ResponseReasoningItem["summary"][number] }).part);
							}
						} else if (eventType === "response.reasoning_summary_text.delta") {
							if (currentItem && currentItem.type === "reasoning" && currentBlock?.type === "thinking") {
								currentItem.summary = currentItem.summary || [];
								const lastPart = currentItem.summary[currentItem.summary.length - 1];
								if (lastPart) {
									const delta = (rawEvent as { delta?: string }).delta || "";
									currentBlock.thinking += delta;
									lastPart.text += delta;
									stream.push({
										type: "thinking_delta",
										contentIndex: blockIndex(),
										delta,
										partial: output,
									});
								}
							}
						} else if (eventType === "response.reasoning_summary_part.done") {
							if (currentItem && currentItem.type === "reasoning" && currentBlock?.type === "thinking") {
								currentItem.summary = currentItem.summary || [];
								const lastPart = currentItem.summary[currentItem.summary.length - 1];
								if (lastPart) {
									currentBlock.thinking += "\n\n";
									lastPart.text += "\n\n";
									stream.push({
										type: "thinking_delta",
										contentIndex: blockIndex(),
										delta: "\n\n",
										partial: output,
									});
								}
							}
						} else if (eventType === "response.content_part.added") {
							if (currentItem && currentItem.type === "message") {
								currentItem.content = currentItem.content || [];
								const part = (rawEvent as { part?: ResponseOutputMessage["content"][number] }).part;
								if (part && (part.type === "output_text" || part.type === "refusal")) {
									currentItem.content.push(part);
								}
							}
						} else if (eventType === "response.output_text.delta") {
							if (currentItem && currentItem.type === "message" && currentBlock?.type === "text") {
								if (!currentItem.content || currentItem.content.length === 0) {
									continue;
								}
								const lastPart = currentItem.content[currentItem.content.length - 1];
								if (lastPart && lastPart.type === "output_text") {
									const delta = (rawEvent as { delta?: string }).delta || "";
									currentBlock.text += delta;
									lastPart.text += delta;
									stream.push({
										type: "text_delta",
										contentIndex: blockIndex(),
										delta,
										partial: output,
									});
								}
							}
						} else if (eventType === "response.refusal.delta") {
							if (currentItem && currentItem.type === "message" && currentBlock?.type === "text") {
								if (!currentItem.content || currentItem.content.length === 0) {
									continue;
								}
								const lastPart = currentItem.content[currentItem.content.length - 1];
								if (lastPart && lastPart.type === "refusal") {
									const delta = (rawEvent as { delta?: string }).delta || "";
									currentBlock.text += delta;
									lastPart.refusal += delta;
									stream.push({
										type: "text_delta",
										contentIndex: blockIndex(),
										delta,
										partial: output,
									});
								}
							}
						} else if (eventType === "response.function_call_arguments.delta") {
							if (currentItem && currentItem.type === "function_call" && currentBlock?.type === "toolCall") {
								const delta = (rawEvent as { delta?: string }).delta || "";
								currentBlock.partialJson += delta;
								currentBlock.arguments = parseStreamingJson(currentBlock.partialJson);
								stream.push({
									type: "toolcall_delta",
									contentIndex: blockIndex(),
									delta,
									partial: output,
								});
							}
						} else if (eventType === "response.function_call_arguments.done") {
							if (currentItem?.type === "function_call" && currentBlock?.type === "toolCall") {
								const args = (rawEvent as { arguments?: string }).arguments;
								if (typeof args === "string") {
									currentBlock.partialJson = args;
									currentBlock.arguments = parseStreamingJson(currentBlock.partialJson);
								}
							}
						} else if (eventType === "response.output_item.done") {
							const item = rawEvent.item as
								| ResponseReasoningItem
								| ResponseOutputMessage
								| ResponseFunctionToolCall;
							if (item.type === "reasoning" && currentBlock?.type === "thinking") {
								currentBlock.thinking = item.summary?.map(s => s.text).join("\n\n") || "";
								currentBlock.thinkingSignature = JSON.stringify(item);
								stream.push({
									type: "thinking_end",
									contentIndex: blockIndex(),
									content: currentBlock.thinking,
									partial: output,
								});
								currentBlock = null;
							} else if (item.type === "message" && currentBlock?.type === "text") {
								currentBlock.text = item.content
									.map(c => (c.type === "output_text" ? c.text : c.refusal))
									.join("");
								currentBlock.textSignature = item.id;
								stream.push({
									type: "text_end",
									contentIndex: blockIndex(),
									content: currentBlock.text,
									partial: output,
								});
								currentBlock = null;
							} else if (item.type === "function_call") {
								const toolCall: ToolCall = {
									type: "toolCall",
									id: `${item.call_id}|${item.id}`,
									name: item.name,
									arguments: parseStreamingJson(item.arguments || "{}"),
								};
								stream.push({ type: "toolcall_end", contentIndex: blockIndex(), toolCall, partial: output });
							}
						} else if (eventType === "response.created") {
							if (usingWebsocket && websocketState) {
								const createdResponse = (rawEvent as { response?: { id?: string } }).response;
								if (typeof createdResponse?.id === "string" && createdResponse.id.length > 0) {
									websocketState.lastResponseId = createdResponse.id;
								}
							}
						} else if (eventType === "response.completed" || eventType === "response.done") {
							sawTerminalEvent = true;
							const response = (
								rawEvent as {
									response?: {
										id?: string;
										usage?: {
											input_tokens?: number;
											output_tokens?: number;
											total_tokens?: number;
											input_tokens_details?: { cached_tokens?: number };
										};
										status?: string;
									};
								}
							).response;
							if (response?.usage) {
								const cachedTokens = response.usage.input_tokens_details?.cached_tokens || 0;
								output.usage = {
									input: (response.usage.input_tokens || 0) - cachedTokens,
									output: response.usage.output_tokens || 0,
									cacheRead: cachedTokens,
									cacheWrite: 0,
									totalTokens: response.usage.total_tokens || 0,
									cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
								};
							}
							if (usingWebsocket && websocketState) {
								websocketState.lastRequest = cloneRequestBody(requestBodyForState);
								if (typeof response?.id === "string" && response.id.length > 0) {
									websocketState.lastResponseId = response.id;
								}
								websocketState.canAppend = eventType === "response.done";
							}
							calculateCost(model, output.usage);
							output.stopReason = mapStopReason(response?.status);
							if (output.content.some(b => b.type === "toolCall") && output.stopReason === "stop") {
								output.stopReason = "toolUse";
							}
						} else if (eventType === "error") {
							const code = (rawEvent as { code?: string }).code || "";
							const message = (rawEvent as { message?: string }).message || "";
							throw new Error(formatCodexErrorEvent(rawEvent, code, message));
						} else if (eventType === "response.failed") {
							throw new Error(formatCodexFailure(rawEvent) ?? "Codex response failed");
						}
					}

					break;
				} catch (error) {
					if (
						usingWebsocket &&
						websocketState &&
						isCodexWebSocketRetryableStreamError(error) &&
						output.content.length === 0 &&
						!options?.signal?.aborted
					) {
						const activateFallback = websocketStreamRetries >= getCodexWebSocketRetryBudget();
						recordCodexWebSocketFailure(websocketState, activateFallback);
						logCodexDebug("codex websocket stream fallback", {
							error: error instanceof Error ? error.message : String(error),
							retry: websocketStreamRetries,
							retryBudget: getCodexWebSocketRetryBudget(),
							activated: activateFallback,
						});
						if (!activateFallback) {
							websocketStreamRetries += 1;
							await abortableSleep(getCodexWebSocketRetryDelayMs(websocketStreamRetries), options?.signal);
							const websocketV2Enabled = isCodexWebSocketV2Enabled();
							const websocketRequest = buildCodexWebSocketRequest(
								transformedBody,
								websocketState,
								websocketV2Enabled,
							);
							const websocketHeaders = createCodexHeaders(
								requestHeaders,
								accountId,
								apiKey,
								options?.sessionId,
								"websocket",
								websocketState,
								websocketV2Enabled,
							);
							requestBodyForState = cloneRequestBody(transformedBody);
							eventStream = await openCodexWebSocketEventStream(
								toWebSocketUrl(url),
								websocketHeaders,
								websocketRequest,
								websocketState,
								options?.signal,
							);
							usingWebsocket = true;
							websocketState.lastTransport = "websocket";
							continue;
						}
						eventStream = await openCodexSseEventStream(
							url,
							requestHeaders,
							accountId,
							apiKey,
							options?.sessionId,
							transformedBody,
							websocketState,
							options?.signal,
						);
						usingWebsocket = false;
						websocketState.lastTransport = "sse";
						requestBodyForState = cloneRequestBody(transformedBody);
						continue;
					}
					throw error;
				}
			}

			if (options?.signal?.aborted) {
				throw new Error("Request was aborted");
			}

			if (!sawTerminalEvent) {
				if (usingWebsocket && websocketState) {
					resetCodexWebSocketAppendState(websocketState);
					resetCodexSessionMetadata(websocketState);
				}
				logCodexDebug("codex stream ended unexpectedly", {
					transport: usingWebsocket ? "websocket" : "sse",
					terminalEventSeen: sawTerminalEvent,
					unexpectedStreamEnd: true,
					sentTurnStateHeader: Boolean(websocketState?.turnState),
					sentModelsEtagHeader: Boolean(websocketState?.modelsEtag),
				});
				throw new Error("Codex stream ended before terminal completion event");
			}

			if (output.stopReason === "aborted" || output.stopReason === "error") {
				throw new Error("Codex response failed");
			}

			output.duration = Date.now() - startTime;
			if (firstTokenTime) output.ttft = firstTokenTime - startTime;
			stream.push({ type: "done", reason: output.stopReason, message: output });
			stream.end();
		} catch (error) {
			for (const block of output.content) delete (block as { index?: number }).index;
			if (usingWebsocket && websocketState) {
				resetCodexWebSocketAppendState(websocketState);
				resetCodexSessionMetadata(websocketState);
			}
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = await finalizeErrorMessage(error, rawRequestDump);
			output.duration = Date.now() - startTime;
			if (firstTokenTime) output.ttft = firstTokenTime - startTime;
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
};

export async function prewarmOpenAICodexResponses(
	model: Model<"openai-codex-responses">,
	options?: Pick<
		OpenAICodexResponsesOptions,
		"apiKey" | "headers" | "sessionId" | "signal" | "preferWebsockets" | "providerSessionState"
	>,
): Promise<void> {
	const apiKey = options?.apiKey || getEnvApiKey(model.provider) || "";
	if (!apiKey) return;
	const accountId = getAccountId(apiKey);
	const baseUrl = model.baseUrl || CODEX_BASE_URL;
	const baseWithSlash = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
	const url = rewriteUrlForCodex(new URL(URL_PATHS.RESPONSES.slice(1), baseWithSlash).toString());
	const providerSessionState = getCodexProviderSessionState(options?.providerSessionState);
	const sessionKey = getCodexWebSocketSessionKey(options?.sessionId, model, accountId, baseUrl);
	const publicSessionKey = getCodexPublicSessionKey(options?.sessionId, model, baseUrl);
	if (publicSessionKey && sessionKey) {
		providerSessionState?.webSocketPublicToPrivate.set(publicSessionKey, sessionKey);
	}
	if (!sessionKey || !providerSessionState) return;
	const state = getCodexWebSocketSessionState(sessionKey, providerSessionState);
	if (!shouldUseCodexWebSocket(model, state, options?.preferWebsockets)) return;
	const headers = createCodexHeaders(
		{ ...(model.headers ?? {}), ...(options?.headers ?? {}) },
		accountId,
		apiKey,
		options?.sessionId,
		"websocket",
		state,
		isCodexWebSocketV2Enabled(),
	);
	await getOrCreateCodexWebSocketConnection(state, toWebSocketUrl(url), headers, options?.signal);
	state.prewarmed = true;
}

function cloneRequestBody(body: RequestBody): RequestBody {
	return JSON.parse(JSON.stringify(body)) as RequestBody;
}

function getCodexWebSocketSessionKey(
	sessionId: string | undefined,
	model: Model<"openai-codex-responses">,
	accountId: string,
	baseUrl: string,
): string | undefined {
	if (!sessionId || sessionId.length === 0) return undefined;
	return `${accountId}:${baseUrl}:${model.id}:${sessionId}`;
}

function getCodexPublicSessionKey(
	sessionId: string | undefined,
	model: Model<"openai-codex-responses">,
	baseUrl: string,
): string | undefined {
	if (!sessionId || sessionId.length === 0) return undefined;
	return `${baseUrl}:${model.id}:${sessionId}`;
}

function getCodexWebSocketSessionState(
	sessionKey: string,
	providerSessionState: CodexProviderSessionState,
): CodexWebSocketSessionState {
	const existing = providerSessionState.webSocketSessions.get(sessionKey);
	if (existing) return existing;
	const created: CodexWebSocketSessionState = {
		disableWebsocket: false,
		canAppend: false,
		fallbackCount: 0,
		prewarmed: false,
	};
	providerSessionState.webSocketSessions.set(sessionKey, created);
	return created;
}

function resetCodexWebSocketAppendState(state: CodexWebSocketSessionState): void {
	state.canAppend = false;
	state.lastRequest = undefined;
	state.lastResponseId = undefined;
}

function resetCodexSessionMetadata(state: CodexWebSocketSessionState): void {
	state.turnState = undefined;
	state.modelsEtag = undefined;
	state.reasoningIncluded = undefined;
}

function recordCodexWebSocketFailure(state: CodexWebSocketSessionState, activateFallback: boolean): void {
	resetCodexWebSocketAppendState(state);
	state.connection?.close("fallback");
	state.connection = undefined;
	state.lastFallbackAt = Date.now();
	if (activateFallback && !state.disableWebsocket) {
		state.disableWebsocket = true;
		state.fallbackCount += 1;
	}
}

function shouldUseCodexWebSocket(
	model: Model<"openai-codex-responses">,
	state: CodexWebSocketSessionState | undefined,
	preferWebsockets?: boolean,
): boolean {
	if (!state || state.disableWebsocket) return false;
	if (preferWebsockets === false) return false;
	return isCodexWebSocketEnvEnabled() || preferWebsockets === true || model.preferWebsockets === true;
}

export interface OpenAICodexTransportDetails {
	websocketPreferred: boolean;
	lastTransport?: "sse" | "websocket";
	websocketDisabled: boolean;
	websocketConnected: boolean;
	fallbackCount: number;
	canAppend: boolean;
	prewarmed: boolean;
	hasSessionState: boolean;
	lastFallbackAt?: number;
}

export function getOpenAICodexTransportDetails(
	model: Model<"openai-codex-responses">,
	options?: {
		sessionId?: string;
		baseUrl?: string;
		preferWebsockets?: boolean;
		providerSessionState?: Map<string, ProviderSessionState>;
	},
): OpenAICodexTransportDetails {
	const baseUrl = options?.baseUrl || model.baseUrl || CODEX_BASE_URL;
	const websocketPreferred =
		options?.preferWebsockets === false
			? false
			: isCodexWebSocketEnvEnabled() || options?.preferWebsockets === true || model.preferWebsockets === true;
	const providerSessionState = getCodexProviderSessionState(options?.providerSessionState);
	const publicSessionKey = getCodexPublicSessionKey(options?.sessionId, model, baseUrl);
	const privateSessionKey = publicSessionKey
		? providerSessionState?.webSocketPublicToPrivate.get(publicSessionKey)
		: undefined;
	const state = privateSessionKey ? providerSessionState?.webSocketSessions.get(privateSessionKey) : undefined;

	return {
		websocketPreferred,
		lastTransport: state?.lastTransport,
		websocketDisabled: state?.disableWebsocket ?? false,
		websocketConnected: state?.connection?.isOpen() ?? false,
		fallbackCount: state?.fallbackCount ?? 0,
		canAppend: state?.canAppend ?? false,
		prewarmed: state?.prewarmed ?? false,
		hasSessionState: state !== undefined,
		lastFallbackAt: state?.lastFallbackAt,
	};
}

function buildAppendInput(previous: RequestBody | undefined, current: RequestBody): InputItem[] | null {
	if (!previous) return null;
	if (!Array.isArray(previous.input) || !Array.isArray(current.input)) return null;
	if (current.input.length <= previous.input.length) return null;
	const previousWithoutInput = { ...previous, input: undefined };
	const currentWithoutInput = { ...current, input: undefined };
	if (JSON.stringify(previousWithoutInput) !== JSON.stringify(currentWithoutInput)) {
		return null;
	}
	for (let index = 0; index < previous.input.length; index += 1) {
		if (JSON.stringify(previous.input[index]) !== JSON.stringify(current.input[index])) {
			return null;
		}
	}
	return current.input.slice(previous.input.length) as InputItem[];
}

function buildCodexWebSocketRequest(
	requestBody: RequestBody,
	state: CodexWebSocketSessionState | undefined,
	v2Enabled: boolean,
): Record<string, unknown> {
	const appendInput = state?.canAppend ? buildAppendInput(state.lastRequest, requestBody) : null;
	if (appendInput && appendInput.length > 0) {
		if (v2Enabled && state?.lastResponseId) {
			return {
				type: "response.create",
				...requestBody,
				previous_response_id: state.lastResponseId,
				input: appendInput,
			};
		}
		return {
			type: "response.append",
			input: appendInput,
		};
	}
	if (state?.canAppend) {
		logCodexDebug("codex websocket append reset", {
			hadTurnStateHeader: Boolean(state.turnState),
			hadModelsEtagHeader: Boolean(state.modelsEtag),
		});
		resetCodexWebSocketAppendState(state);
		resetCodexSessionMetadata(state);
	}
	return {
		type: "response.create",
		...requestBody,
	};
}

function toWebSocketUrl(url: string): string {
	const parsed = new URL(url);
	if (parsed.protocol === "https:") {
		parsed.protocol = "wss:";
	} else if (parsed.protocol === "http:") {
		parsed.protocol = "ws:";
	}
	return parsed.toString();
}

function headersToRecord(headers: Headers): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [key, value] of headers.entries()) {
		result[key] = value;
	}
	return result;
}

interface CodexWebSocketConnectionOptions {
	idleTimeoutMs: number;
	onHandshakeHeaders?: (headers: Headers) => void;
}
class CodexWebSocketConnection {
	#url: string;
	#headers: Record<string, string>;
	#idleTimeoutMs: number;
	#onHandshakeHeaders?: (headers: Headers) => void;
	#socket: WebSocket | null = null;
	#queue: Array<Record<string, unknown> | Error | null> = [];
	#waiters: Array<() => void> = [];
	#connectPromise?: Promise<void>;
	#activeRequest = false;
	constructor(url: string, headers: Record<string, string>, options: CodexWebSocketConnectionOptions) {
		this.#url = url;
		this.#headers = headers;
		this.#idleTimeoutMs = options.idleTimeoutMs;
		this.#onHandshakeHeaders = options.onHandshakeHeaders;
	}
	isOpen(): boolean {
		return this.#socket?.readyState === WebSocket.OPEN;
	}
	close(reason = "done"): void {
		if (
			this.#socket &&
			(this.#socket.readyState === WebSocket.OPEN || this.#socket.readyState === WebSocket.CONNECTING)
		) {
			this.#socket.close(1000, reason);
		}
		this.#socket = null;
	}
	async connect(signal?: AbortSignal): Promise<void> {
		if (this.isOpen()) return;
		if (this.#connectPromise) {
			await this.#connectPromise;
			return;
		}
		const WebSocketWithHeaders = WebSocket as unknown as {
			new (url: string, options?: { headers?: Record<string, string> }): WebSocket;
		};
		const { promise, resolve, reject } = Promise.withResolvers<void>();
		this.#connectPromise = promise;
		const socket = new WebSocketWithHeaders(this.#url, { headers: this.#headers });
		this.#socket = socket;
		let settled = false;
		let timeout: NodeJS.Timeout | undefined;
		const onAbort = () => {
			socket.close(1000, "aborted");
			if (!settled) {
				settled = true;
				reject(createCodexWebSocketTransportError("request was aborted"));
			}
		};
		if (signal) {
			if (signal.aborted) {
				onAbort();
			} else {
				signal.addEventListener("abort", onAbort, { once: true });
			}
		}
		const clearPending = () => {
			if (timeout) clearTimeout(timeout);
			if (signal) signal.removeEventListener("abort", onAbort);
		};
		timeout = setTimeout(() => {
			socket.close(1000, "connect-timeout");
			if (!settled) {
				settled = true;
				reject(createCodexWebSocketTransportError("connection timeout"));
			}
		}, CODEX_WEBSOCKET_CONNECT_TIMEOUT_MS);

		socket.addEventListener("open", event => {
			if (!settled) {
				settled = true;
				clearPending();
				this.#captureHandshakeHeaders(socket, event);
				resolve();
			}
		});
		socket.addEventListener("error", event => {
			const error = createCodexWebSocketTransportError(`websocket error: ${String(event.type)}`);
			if (!settled) {
				settled = true;
				clearPending();
				reject(error);
				return;
			}
			this.#push(error);
		});
		socket.addEventListener("close", event => {
			this.#socket = null;
			if (!settled) {
				settled = true;
				clearPending();
				reject(createCodexWebSocketTransportError(`websocket closed before open (${event.code})`));
				return;
			}
			this.#push(createCodexWebSocketTransportError(`websocket closed (${event.code})`));
			this.#push(null);
		});
		socket.addEventListener("message", event => {
			if (typeof event.data !== "string") return;
			try {
				const parsed = JSON.parse(event.data) as Record<string, unknown>;
				if (parsed.type === "error" && typeof parsed.error === "object" && parsed.error) {
					const inner = parsed.error as Record<string, unknown>;
					if (typeof parsed.code !== "string" && typeof inner.code === "string") {
						parsed.code = inner.code;
					}
					if (typeof parsed.message !== "string" && typeof inner.message === "string") {
						parsed.message = inner.message;
					}
				}
				this.#push(parsed);
			} catch (error) {
				this.#push(createCodexWebSocketTransportError(String(error)));
			}
		});

		try {
			await promise;
		} finally {
			this.#connectPromise = undefined;
		}
	}
	async *streamRequest(
		request: Record<string, unknown>,
		signal?: AbortSignal,
	): AsyncGenerator<Record<string, unknown>> {
		if (!this.#socket || this.#socket.readyState !== WebSocket.OPEN) {
			throw createCodexWebSocketTransportError("websocket connection is unavailable");
		}
		if (this.#activeRequest) {
			throw createCodexWebSocketTransportError("websocket request already in progress");
		}
		this.#activeRequest = true;
		const onAbort = () => {
			this.close("aborted");
			this.#push(createCodexWebSocketTransportError("request was aborted"));
		};
		if (signal) {
			if (signal.aborted) {
				onAbort();
			} else {
				signal.addEventListener("abort", onAbort, { once: true });
			}
		}

		try {
			this.#socket.send(JSON.stringify(request));
			while (true) {
				const next = await this.#nextMessage(this.#idleTimeoutMs);
				if (next instanceof Error) {
					throw next;
				}
				if (next === null) {
					throw createCodexWebSocketTransportError("websocket closed before response completion");
				}
				yield next;
				const eventType = typeof next.type === "string" ? next.type : "";
				if (
					eventType === "response.completed" ||
					eventType === "response.done" ||
					eventType === "response.failed" ||
					eventType === "error"
				) {
					break;
				}
			}
		} finally {
			this.#activeRequest = false;
			if (signal) {
				signal.removeEventListener("abort", onAbort);
			}
		}
	}

	#captureHandshakeHeaders(socket: WebSocket, openEvent?: Event): void {
		if (!this.#onHandshakeHeaders) return;
		const headers = extractCodexWebSocketHandshakeHeaders(socket, openEvent);
		if (!headers) return;
		this.#onHandshakeHeaders(headers);
	}
	#push(item: Record<string, unknown> | Error | null): void {
		this.#queue.push(item);
		const waiter = this.#waiters.shift();
		if (waiter) waiter();
	}

	async #nextMessage(timeoutMs: number): Promise<Record<string, unknown> | Error | null> {
		while (this.#queue.length === 0) {
			const { promise, resolve } = Promise.withResolvers<void>();
			this.#waiters.push(resolve);
			let timedOut = false;
			let timeout: NodeJS.Timeout | undefined;
			if (timeoutMs > 0) {
				timeout = setTimeout(() => {
					timedOut = true;
					const waiterIndex = this.#waiters.indexOf(resolve);
					if (waiterIndex >= 0) {
						this.#waiters.splice(waiterIndex, 1);
					}
					resolve();
				}, timeoutMs);
			}
			await promise;
			if (timeout) clearTimeout(timeout);
			if (timedOut && this.#queue.length === 0) {
				return createCodexWebSocketTransportError("idle timeout waiting for websocket");
			}
		}
		return this.#queue.shift() ?? null;
	}
}
async function getOrCreateCodexWebSocketConnection(
	state: CodexWebSocketSessionState,
	url: string,
	headers: Headers,
	signal?: AbortSignal,
): Promise<CodexWebSocketConnection> {
	if (state.connection?.isOpen()) {
		return state.connection;
	}
	state.connection?.close("reconnect");
	resetCodexWebSocketAppendState(state);
	state.connection = new CodexWebSocketConnection(url, headersToRecord(headers), {
		idleTimeoutMs: getCodexWebSocketIdleTimeoutMs(),
		onHandshakeHeaders: handshakeHeaders => {
			updateCodexSessionMetadataFromHeaders(state, handshakeHeaders);
		},
	});
	await state.connection.connect(signal);
	return state.connection;
}
async function openCodexSseEventStream(
	url: string,
	requestHeaders: Record<string, string> | undefined,
	accountId: string,
	apiKey: string,
	sessionId: string | undefined,
	body: RequestBody,
	state: CodexWebSocketSessionState | undefined,
	signal?: AbortSignal,
): Promise<AsyncGenerator<Record<string, unknown>>> {
	const headers = createCodexHeaders(requestHeaders, accountId, apiKey, sessionId, "sse", state);
	logCodexDebug("codex request", {
		url,
		model: body.model,
		headers: redactHeaders(headers),
		sentTurnStateHeader: headers.has(X_CODEX_TURN_STATE_HEADER),
		sentModelsEtagHeader: headers.has(X_MODELS_ETAG_HEADER),
	});
	const response = await fetchWithRetry(
		url,
		{
			method: "POST",
			headers,
			body: JSON.stringify(body),
		},
		signal,
	);
	logCodexDebug("codex response", {
		url: response.url,
		status: response.status,
		statusText: response.statusText,
		contentType: response.headers.get("content-type") || null,
		cfRay: response.headers.get("cf-ray") || null,
	});
	updateCodexSessionMetadataFromHeaders(state, response.headers);
	if (!response.ok) {
		const info = await parseCodexError(response);
		const error = new Error(info.friendlyMessage || info.message);
		(error as { headers?: Headers; status?: number }).headers = response.headers;
		(error as { headers?: Headers; status?: number }).status = response.status;
		throw error;
	}
	if (!response.body) {
		throw new Error("No response body");
	}
	return readSseJson<Record<string, unknown>>(response.body, signal);
}
async function openCodexWebSocketEventStream(
	url: string,
	headers: Headers,
	request: Record<string, unknown>,
	state: CodexWebSocketSessionState,
	signal?: AbortSignal,
): Promise<AsyncGenerator<Record<string, unknown>>> {
	const connection = await getOrCreateCodexWebSocketConnection(state, url, headers, signal);
	return connection.streamRequest(request, signal);
}
function createCodexHeaders(
	initHeaders: Record<string, string> | undefined,
	accountId: string,
	accessToken: string,
	promptCacheKey?: string,
	transport: "sse" | "websocket" = "sse",
	state?: CodexWebSocketSessionState,
	websocketV2Enabled = false,
): Headers {
	const headers = new Headers(initHeaders ?? {});
	headers.delete("x-api-key");
	headers.set("Authorization", `Bearer ${accessToken}`);
	headers.set(OPENAI_HEADERS.ACCOUNT_ID, accountId);
	const betaHeader =
		transport === "websocket"
			? websocketV2Enabled
				? OPENAI_HEADER_VALUES.BETA_RESPONSES_WEBSOCKETS_V2
				: OPENAI_HEADER_VALUES.BETA_RESPONSES_WEBSOCKETS
			: OPENAI_HEADER_VALUES.BETA_RESPONSES;
	headers.set(OPENAI_HEADERS.BETA, betaHeader);
	headers.set(OPENAI_HEADERS.ORIGINATOR, OPENAI_HEADER_VALUES.ORIGINATOR_CODEX);
	headers.set("User-Agent", `pi/${packageJson.version} (${os.platform()} ${os.release()}; ${os.arch()})`);
	if (promptCacheKey) {
		headers.set(OPENAI_HEADERS.CONVERSATION_ID, promptCacheKey);
		headers.set(OPENAI_HEADERS.SESSION_ID, promptCacheKey);
	} else {
		headers.delete(OPENAI_HEADERS.CONVERSATION_ID);
		headers.delete(OPENAI_HEADERS.SESSION_ID);
	}
	if (state?.turnState) {
		headers.set(X_CODEX_TURN_STATE_HEADER, state.turnState);
	} else {
		headers.delete(X_CODEX_TURN_STATE_HEADER);
	}
	if (state?.modelsEtag) {
		headers.set(X_MODELS_ETAG_HEADER, state.modelsEtag);
	} else {
		headers.delete(X_MODELS_ETAG_HEADER);
	}
	if (transport === "sse") {
		headers.set("accept", "text/event-stream");
	} else {
		headers.delete("accept");
	}
	headers.set("content-type", "application/json");
	return headers;
}

function logCodexDebug(message: string, details?: Record<string, unknown>): void {
	if (!CODEX_DEBUG) return;
	if (details) {
		console.error(`[codex] ${message}`, details);
		return;
	}
	console.error(`[codex] ${message}`);
}

function getRetryDelayMs(
	response: Response | null,
	attempt: number,
	errorBody?: string,
): { delay: number; serverProvided: boolean } {
	const retryAfter = response?.headers?.get("retry-after") || null;
	if (retryAfter) {
		const seconds = Number(retryAfter);
		if (Number.isFinite(seconds)) {
			return { delay: Math.max(0, seconds * 1000), serverProvided: true };
		}
		const parsedDate = Date.parse(retryAfter);
		if (!Number.isNaN(parsedDate)) {
			return { delay: Math.max(0, parsedDate - Date.now()), serverProvided: true };
		}
	}
	// Parse retry delay from error body (e.g., "Please try again in 225ms" or "Please try again in 1.5s")
	if (errorBody) {
		const msMatch = /try again in\s+(\d+(?:\.\d+)?)\s*ms/i.exec(errorBody);
		if (msMatch) {
			const ms = Number(msMatch[1]);
			if (Number.isFinite(ms)) return { delay: Math.max(ms, 100), serverProvided: true };
		}
		const sMatch = /try again in\s+(\d+(?:\.\d+)?)\s*s(?:ec)?/i.exec(errorBody);
		if (sMatch) {
			const s = Number(sMatch[1]);
			if (Number.isFinite(s)) return { delay: Math.max(s * 1000, 100), serverProvided: true };
		}
	}
	return { delay: CODEX_RETRY_DELAY_MS * (attempt + 1), serverProvided: false };
}
/** Max total time to spend retrying 429s with server-provided delays (5 minutes). */
const CODEX_RATE_LIMIT_BUDGET_MS = 5 * 60 * 1000;

async function fetchWithRetry(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
	let attempt = 0;
	let rateLimitTimeSpent = 0;
	while (true) {
		try {
			const response = await fetch(url, { ...init, signal: signal ?? init.signal });
			if (!CODEX_RETRYABLE_STATUS.has(response.status)) {
				return response;
			}
			if (signal?.aborted) return response;
			// Read error body for retry delay parsing
			const errorBody = await response.clone().text();
			const { delay, serverProvided } = getRetryDelayMs(response, attempt, errorBody);
			// For 429s with a server-provided delay, use a time budget instead of attempt count
			if (response.status === 429 && serverProvided) {
				if (rateLimitTimeSpent + delay > CODEX_RATE_LIMIT_BUDGET_MS) {
					return response;
				}
				rateLimitTimeSpent += delay;
			} else if (attempt >= CODEX_MAX_RETRIES) {
				return response;
			}
			await abortableSleep(delay, signal);
		} catch (error) {
			if (attempt >= CODEX_MAX_RETRIES || signal?.aborted) {
				throw error;
			}
			const delay = CODEX_RETRY_DELAY_MS * (attempt + 1);
			await abortableSleep(delay, signal);
		}
		attempt += 1;
	}
}

function redactHeaders(headers: Headers): Record<string, string> {
	const redacted: Record<string, string> = {};
	for (const [key, value] of headers.entries()) {
		const lower = key.toLowerCase();
		if (lower === "authorization") {
			redacted[key] = "Bearer [redacted]";
			continue;
		}
		if (
			lower.includes("account") ||
			lower.includes("session") ||
			lower.includes("conversation") ||
			lower === "cookie"
		) {
			redacted[key] = "[redacted]";
			continue;
		}
		redacted[key] = value;
	}
	return redacted;
}

function rewriteUrlForCodex(url: string): string {
	return url.replace(URL_PATHS.RESPONSES, URL_PATHS.CODEX_RESPONSES);
}

type JwtPayload = {
	[JWT_CLAIM_PATH]?: {
		chatgpt_account_id?: string;
	};
	[key: string]: unknown;
};

function decodeJwt(token: string): JwtPayload | null {
	try {
		const parts = token.split(".");
		if (parts.length !== 3) return null;
		const payload = parts[1] ?? "";
		const decoded = Buffer.from(payload, "base64").toString("utf-8");
		return JSON.parse(decoded) as JwtPayload;
	} catch {
		return null;
	}
}

function getAccountId(accessToken: string): string {
	const payload = decodeJwt(accessToken);
	const auth = payload?.[JWT_CLAIM_PATH];
	const accountId = auth?.chatgpt_account_id;
	if (!accountId) {
		throw new Error("Failed to extract accountId from token");
	}
	return accountId;
}

function convertMessages(model: Model<"openai-codex-responses">, context: Context): ResponseInput {
	const messages: ResponseInput = [];

	const normalizeToolCallId = (id: string): string => {
		if (!id.includes("|")) return id;
		const [callId, itemId] = id.split("|");
		const sanitizedCallId = callId.replace(/[^a-zA-Z0-9_-]/g, "_");
		let sanitizedItemId = itemId.replace(/[^a-zA-Z0-9_-]/g, "_");
		// OpenAI Responses API requires item id to start with "fc"
		if (!sanitizedItemId.startsWith("fc")) {
			sanitizedItemId = `fc_${sanitizedItemId}`;
		}
		// Truncate to 64 chars and strip trailing underscores (OpenAI Codex rejects them)
		let normalizedCallId = sanitizedCallId.length > 64 ? sanitizedCallId.slice(0, 64) : sanitizedCallId;
		let normalizedItemId = sanitizedItemId.length > 64 ? sanitizedItemId.slice(0, 64) : sanitizedItemId;
		normalizedCallId = normalizedCallId.replace(/_+$/, "");
		normalizedItemId = normalizedItemId.replace(/_+$/, "");
		return `${normalizedCallId}|${normalizedItemId}`;
	};
	const transformedMessages = transformMessages(context.messages, model, normalizeToolCallId);

	let msgIndex = 0;
	for (const msg of transformedMessages) {
		if (msg.role === "user") {
			if (typeof msg.content === "string") {
				// Skip empty user messages
				if (!msg.content || msg.content.trim() === "") continue;
				messages.push({
					role: "user",
					content: [{ type: "input_text", text: msg.content.toWellFormed() }],
				});
			} else {
				const content: ResponseInputContent[] = msg.content.map((item): ResponseInputContent => {
					if (item.type === "text") {
						return {
							type: "input_text",
							text: item.text.toWellFormed(),
						} satisfies ResponseInputText;
					}
					return {
						type: "input_image",
						detail: "auto",
						image_url: `data:${item.mimeType};base64,${item.data}`,
					} satisfies ResponseInputImage;
				});
				// Filter out images if model doesn't support them, and empty text blocks
				let filteredContent = !model.input.includes("image")
					? content.filter(c => c.type !== "input_image")
					: content;
				filteredContent = filteredContent.filter(c => {
					if (c.type === "input_text") {
						return c.text.trim().length > 0;
					}
					return true; // Keep non-text content (images)
				});
				if (filteredContent.length === 0) continue;
				messages.push({
					role: "user",
					content: filteredContent,
				});
			}
		} else if (msg.role === "developer") {
			if (typeof msg.content === "string") {
				if (!msg.content || msg.content.trim() === "") continue;
				messages.push({
					role: "developer",
					content: [{ type: "input_text", text: msg.content.toWellFormed() }],
				});
			} else {
				const content: ResponseInputContent[] = msg.content.map((item): ResponseInputContent => {
					if (item.type === "text") {
						return {
							type: "input_text",
							text: item.text.toWellFormed(),
						} satisfies ResponseInputText;
					}
					return {
						type: "input_image",
						detail: "auto",
						image_url: `data:${item.mimeType};base64,${item.data}`,
					} satisfies ResponseInputImage;
				});
				let filteredContent = !model.input.includes("image")
					? content.filter(c => c.type !== "input_image")
					: content;
				filteredContent = filteredContent.filter(c => {
					if (c.type === "input_text") {
						return c.text.trim().length > 0;
					}
					return true;
				});
				if (filteredContent.length === 0) continue;
				messages.push({
					role: "developer",
					content: filteredContent,
				});
			}
		} else if (msg.role === "assistant") {
			const output: ResponseInput = [];

			for (const block of msg.content) {
				if (block.type === "thinking" && msg.stopReason !== "error") {
					if (block.thinkingSignature) {
						const reasoningItem = JSON.parse(block.thinkingSignature) as ResponseReasoningItem;
						output.push(reasoningItem);
					}
				} else if (block.type === "text") {
					const textBlock = block as TextContent;
					let msgId = textBlock.textSignature;
					if (!msgId) {
						msgId = `msg_${msgIndex}`;
					} else if (msgId.length > 64) {
						msgId = `msg_${Bun.hash.xxHash64(msgId).toString(36)}`;
					}
					output.push({
						type: "message",
						role: "assistant",
						content: [{ type: "output_text", text: textBlock.text.toWellFormed(), annotations: [] }],
						status: "completed",
						id: msgId,
					} satisfies ResponseOutputMessage);
				} else if (block.type === "toolCall" && msg.stopReason !== "error") {
					const toolCall = block as ToolCall;
					const normalized = normalizeResponsesToolCallId(toolCall.id);
					output.push({
						type: "function_call",
						id: normalized.itemId,
						call_id: normalized.callId,
						name: toolCall.name,
						arguments: JSON.stringify(toolCall.arguments),
					});
				}
			}
			if (output.length === 0) continue;
			messages.push(...output);
		} else if (msg.role === "toolResult") {
			const textResult = msg.content
				.filter(c => c.type === "text")
				.map(c => (c as { text: string }).text)
				.join("\n");
			const hasImages = msg.content.some(c => c.type === "image");
			const normalized = normalizeResponsesToolCallId(msg.toolCallId);

			const hasText = textResult.length > 0;
			messages.push({
				type: "function_call_output",
				call_id: normalized.callId,
				output: (hasText ? textResult : "(see attached image)").toWellFormed(),
			});

			if (hasImages && model.input.includes("image")) {
				const contentParts: ResponseInputContent[] = [];
				contentParts.push({
					type: "input_text",
					text: "Attached image(s) from tool result:",
				} satisfies ResponseInputText);

				for (const block of msg.content) {
					if (block.type === "image") {
						contentParts.push({
							type: "input_image",
							detail: "auto",
							image_url: `data:${block.mimeType};base64,${block.data}`,
						} satisfies ResponseInputImage);
					}
				}

				messages.push({
					role: "user",
					content: contentParts,
				});
			}
		}
		msgIndex++;
	}

	return messages;
}

function convertTools(tools: Tool[]): Array<{
	type: "function";
	name: string;
	description: string;
	parameters: Record<string, unknown>;
	strict?: boolean;
}> {
	return tools.map(tool => {
		const strict = !!(!NO_STRICT && tool.strict);
		const baseParameters = tool.parameters as unknown as Record<string, unknown>;
		const { schema: parameters, strict: effectiveStrict } = adaptSchemaForStrict(baseParameters, strict);
		return {
			type: "function",
			name: tool.name,
			description: tool.description || "",
			parameters,
			// Only include strict if provider supports it. Some reject unknown fields.
			...(effectiveStrict && { strict: true }),
		};
	});
}

function mapStopReason(status: string | undefined): StopReason {
	if (!status) return "stop";
	switch (status) {
		case "completed":
			return "stop";
		case "incomplete":
			return "length";
		case "failed":
		case "cancelled":
			return "error";
		case "in_progress":
		case "queued":
			return "stop";
		default:
			return "stop";
	}
}

function getString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function truncate(text: string, limit: number): string {
	if (text.length <= limit) return text;
	return `${text.slice(0, limit)}…[truncated ${text.length - limit}]`;
}

function formatCodexFailure(rawEvent: Record<string, unknown>): string | null {
	const response = asRecord(rawEvent.response);
	const error = asRecord(rawEvent.error) ?? (response ? asRecord(response.error) : null);

	const message = getString(error?.message) ?? getString(rawEvent.message) ?? getString(response?.message);
	const code = getString(error?.code) ?? getString(error?.type) ?? getString(rawEvent.code);
	const status = getString(response?.status) ?? getString(rawEvent.status);

	const meta: string[] = [];
	if (code) meta.push(`code=${code}`);
	if (status) meta.push(`status=${status}`);

	if (message) {
		const metaText = meta.length ? ` (${meta.join(", ")})` : "";
		return `Codex response failed: ${message}${metaText}`;
	}

	if (meta.length) {
		return `Codex response failed (${meta.join(", ")})`;
	}

	try {
		return `Codex response failed: ${truncate(JSON.stringify(rawEvent), 800)}`;
	} catch {
		return "Codex response failed";
	}
}

function formatCodexErrorEvent(rawEvent: Record<string, unknown>, code: string, message: string): string {
	const detail = formatCodexFailure(rawEvent);
	if (detail) {
		return detail.replace("response failed", "error event");
	}

	const meta: string[] = [];
	if (code) meta.push(`code=${code}`);
	if (message) meta.push(`message=${message}`);

	if (meta.length > 0) {
		return `Codex error event (${meta.join(", ")})`;
	}

	try {
		return `Codex error event: ${truncate(JSON.stringify(rawEvent), 800)}`;
	} catch {
		return "Codex error event";
	}
}
