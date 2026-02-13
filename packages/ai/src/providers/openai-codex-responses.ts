import * as os from "node:os";
import { $env, abortableSleep, readSseJson } from "@oh-my-pi/pi-utils";
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
	StopReason,
	StreamFunction,
	StreamOptions,
	TextContent,
	ThinkingContent,
	Tool,
	ToolCall,
	ToolChoice,
} from "../types";
import { AssistantMessageEventStream } from "../utils/event-stream";
import { parseStreamingJson } from "../utils/json-parse";
import { formatErrorMessageWithRetryAfter } from "../utils/retry-after";
import { sanitizeSurrogates } from "../utils/sanitize-unicode";
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

function isCodexWebSocketEnvEnabled(): boolean {
	return $env.PI_CODEX_WEBSOCKET === "1" || $env.PI_CODEX_WEBSOCKET === "true";
}
const CODEX_WEBSOCKET_V2_ENABLED = $env.PI_CODEX_WEBSOCKET_V2 === "1" || $env.PI_CODEX_WEBSOCKET_V2 === "true";

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
const codexWebSocketSessions = new Map<string, CodexWebSocketSessionState>();
const codexWebSocketPublicToPrivate = new Map<string, string>();
const X_CODEX_TURN_STATE_HEADER = "x-codex-turn-state";
const X_MODELS_ETAG_HEADER = "x-models-etag";
const X_REASONING_INCLUDED_HEADER = "x-reasoning-included";
function normalizeResponsesToolCallId(id: string): { callId: string; itemId: string } {
	const [callId, itemId] = id.split("|");
	if (callId && itemId) {
		return { callId, itemId };
	}
	const hash = Bun.hash.xxHash64(id).toString(36);
	return { callId: `call_${hash}`, itemId: `item_${hash}` };
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
			const sessionKey = getCodexWebSocketSessionKey(options?.sessionId, model, accountId, baseUrl);
			const publicSessionKey = getCodexPublicSessionKey(options?.sessionId, model, baseUrl);
			if (sessionKey && publicSessionKey) {
				codexWebSocketPublicToPrivate.set(publicSessionKey, sessionKey);
			}
			const websocketState = sessionKey ? getCodexWebSocketSessionState(sessionKey) : undefined;
			let usingWebsocket = false;
			let requestBodyForState = cloneRequestBody(transformedBody);
			let eventStream: AsyncGenerator<Record<string, unknown>>;

			if (websocketState && shouldUseCodexWebSocket(model, websocketState, options?.preferWebsockets)) {
				const websocketHeaders = createCodexHeaders(
					requestHeaders,
					accountId,
					apiKey,
					options?.sessionId,
					"websocket",
					websocketState,
				);
				const websocketRequest = buildCodexWebSocketRequest(
					transformedBody,
					websocketState,
					CODEX_WEBSOCKET_V2_ENABLED,
				);
				requestBodyForState = cloneRequestBody(transformedBody);
				logCodexDebug("codex websocket request", {
					url: toWebSocketUrl(url),
					model: params.model,
					reasoningEffort,
					headers: redactHeaders(websocketHeaders),
					requestType: websocketRequest.type,
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
				} catch (error) {
					if (websocketState) {
						websocketState.disableWebsocket = true;
						websocketState.fallbackCount += 1;
						websocketState.lastFallbackAt = Date.now();
						websocketState.canAppend = false;
						websocketState.lastRequest = undefined;
						websocketState.lastResponseId = undefined;
						websocketState.connection?.close("fallback");
						websocketState.connection = undefined;
					}
					logCodexDebug("codex websocket fallback", {
						error: error instanceof Error ? error.message : String(error),
					});
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
			for await (const rawEvent of eventStream) {
				const eventType = typeof rawEvent.type === "string" ? rawEvent.type : "";
				if (!eventType) continue;

				if (eventType === "response.output_item.added") {
					if (!firstTokenTime) firstTokenTime = Date.now();
					const item = rawEvent.item as ResponseReasoningItem | ResponseOutputMessage | ResponseFunctionToolCall;
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
					const item = rawEvent.item as ResponseReasoningItem | ResponseOutputMessage | ResponseFunctionToolCall;
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
						currentBlock.text = item.content.map(c => (c.type === "output_text" ? c.text : c.refusal)).join("");
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
							arguments: JSON.parse(item.arguments),
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

			if (options?.signal?.aborted) {
				throw new Error("Request was aborted");
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
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = formatErrorMessageWithRetryAfter(error);
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
	options?: Pick<OpenAICodexResponsesOptions, "apiKey" | "headers" | "sessionId" | "signal" | "preferWebsockets">,
): Promise<void> {
	const apiKey = options?.apiKey || getEnvApiKey(model.provider) || "";
	if (!apiKey) return;
	const accountId = getAccountId(apiKey);
	const baseUrl = model.baseUrl || CODEX_BASE_URL;
	const baseWithSlash = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
	const url = rewriteUrlForCodex(new URL(URL_PATHS.RESPONSES.slice(1), baseWithSlash).toString());
	const sessionKey = getCodexWebSocketSessionKey(options?.sessionId, model, accountId, baseUrl);
	const publicSessionKey = getCodexPublicSessionKey(options?.sessionId, model, baseUrl);
	if (publicSessionKey && sessionKey) {
		codexWebSocketPublicToPrivate.set(publicSessionKey, sessionKey);
	}
	if (!sessionKey) return;
	const state = getCodexWebSocketSessionState(sessionKey);
	if (!shouldUseCodexWebSocket(model, state, options?.preferWebsockets)) return;
	const headers = createCodexHeaders(
		{ ...(model.headers ?? {}), ...(options?.headers ?? {}) },
		accountId,
		apiKey,
		options?.sessionId,
		"websocket",
		state,
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

function getCodexWebSocketSessionState(sessionKey: string): CodexWebSocketSessionState {
	const existing = codexWebSocketSessions.get(sessionKey);
	if (existing) return existing;
	const created: CodexWebSocketSessionState = { disableWebsocket: false, canAppend: false, fallbackCount: 0, prewarmed: false };
	codexWebSocketSessions.set(sessionKey, created);
	return created;
}

function shouldUseCodexWebSocket(
	model: Model<"openai-codex-responses">,
	state: CodexWebSocketSessionState | undefined,
	preferWebsockets?: boolean,
): boolean {
	if (!state || state.disableWebsocket) return false;
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
	options?: { sessionId?: string; baseUrl?: string; preferWebsockets?: boolean },
): OpenAICodexTransportDetails {
	const baseUrl = options?.baseUrl || model.baseUrl || CODEX_BASE_URL;
	const websocketPreferred = isCodexWebSocketEnvEnabled() || options?.preferWebsockets === true || model.preferWebsockets === true;
	const publicSessionKey = getCodexPublicSessionKey(options?.sessionId, model, baseUrl);
	const privateSessionKey = publicSessionKey ? codexWebSocketPublicToPrivate.get(publicSessionKey) : undefined;
	const state = privateSessionKey ? codexWebSocketSessions.get(privateSessionKey) : undefined;

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

class CodexWebSocketConnection {
	#url: string;
	#headers: Record<string, string>;
	#socket: WebSocket | null = null;
	#queue: Array<Record<string, unknown> | Error | null> = [];
	#waiters: Array<() => void> = [];
	#connectPromise?: Promise<void>;
	#activeRequest = false;

	constructor(url: string, headers: Record<string, string>) {
		this.#url = url;
		this.#headers = headers;
	}

	isOpen(): boolean {
		return this.#socket?.readyState === WebSocket.OPEN;
	}

	close(reason = "done"): void {
		if (this.#socket && (this.#socket.readyState === WebSocket.OPEN || this.#socket.readyState === WebSocket.CONNECTING)) {
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
				reject(new Error("Request was aborted"));
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
				reject(new Error("WebSocket connection timeout"));
			}
		}, 10000);

		socket.addEventListener("open", () => {
			if (!settled) {
				settled = true;
				clearPending();
				resolve();
			}
		});

		socket.addEventListener("error", event => {
			const error = new Error(`WebSocket error: ${String(event.type)}`);
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
				reject(new Error(`WebSocket closed before open (${event.code})`));
				return;
			}
			this.#push(new Error(`WebSocket closed (${event.code})`));
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
				this.#push(error instanceof Error ? error : new Error(String(error)));
			}
		});

		try {
			await promise;
		} finally {
			this.#connectPromise = undefined;
		}
	}

	async *streamRequest(request: Record<string, unknown>, signal?: AbortSignal): AsyncGenerator<Record<string, unknown>> {
		if (!this.#socket || this.#socket.readyState !== WebSocket.OPEN) {
			throw new Error("websocket connection is unavailable");
		}
		if (this.#activeRequest) {
			throw new Error("websocket request already in progress");
		}

		this.#activeRequest = true;
		const onAbort = () => {
			this.close("aborted");
			this.#push(new Error("Request was aborted"));
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
				const next = await this.#nextMessage();
				if (next instanceof Error) {
					throw next;
				}
				if (next === null) {
					throw new Error("websocket closed before response completion");
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

	#push(item: Record<string, unknown> | Error | null): void {
		this.#queue.push(item);
		const waiter = this.#waiters.shift();
		if (waiter) waiter();
	}

	async #nextMessage(): Promise<Record<string, unknown> | Error | null> {
		while (this.#queue.length === 0) {
			const { promise, resolve } = Promise.withResolvers<void>();
			this.#waiters.push(resolve);
			await promise;
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
	state.connection = new CodexWebSocketConnection(url, headersToRecord(headers));
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
	if (state) {
		state.turnState = response.headers.get(X_CODEX_TURN_STATE_HEADER) ?? state.turnState;
		state.modelsEtag = response.headers.get(X_MODELS_ETAG_HEADER) ?? state.modelsEtag;
		const reasoningIncluded = response.headers.get(X_REASONING_INCLUDED_HEADER);
		if (reasoningIncluded === "true" || reasoningIncluded === "false") {
			state.reasoningIncluded = reasoningIncluded === "true";
		}
	}
	if (!response.ok) {
		const info = await parseCodexError(response);
		const error = new Error(info.friendlyMessage || info.message);
		(error as { headers?: Headers }).headers = response.headers;
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
): Headers {
	const headers = new Headers(initHeaders ?? {});
	headers.delete("x-api-key");
	headers.set("Authorization", `Bearer ${accessToken}`);
	headers.set(OPENAI_HEADERS.ACCOUNT_ID, accountId);
	headers.set(
		OPENAI_HEADERS.BETA,
		transport === "websocket" ? OPENAI_HEADER_VALUES.BETA_RESPONSES_WEBSOCKETS : OPENAI_HEADER_VALUES.BETA_RESPONSES,
	);
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

function getRetryDelayMs(response: Response | null, attempt: number, errorBody?: string): number {
	const retryAfter = response?.headers?.get("retry-after") || null;
	if (retryAfter) {
		const seconds = Number(retryAfter);
		if (Number.isFinite(seconds)) {
			return Math.max(0, seconds * 1000);
		}
		const parsedDate = Date.parse(retryAfter);
		if (!Number.isNaN(parsedDate)) {
			return Math.max(0, parsedDate - Date.now());
		}
	}
	// Parse retry delay from error body (e.g., "Please try again in 225ms" or "Please try again in 1.5s")
	if (errorBody) {
		const msMatch = /try again in\s+(\d+(?:\.\d+)?)\s*ms/i.exec(errorBody);
		if (msMatch) {
			const ms = Number(msMatch[1]);
			if (Number.isFinite(ms)) return Math.max(ms, 100);
		}
		const sMatch = /try again in\s+(\d+(?:\.\d+)?)\s*s(?:ec)?/i.exec(errorBody);
		if (sMatch) {
			const s = Number(sMatch[1]);
			if (Number.isFinite(s)) return Math.max(s * 1000, 100);
		}
	}
	return CODEX_RETRY_DELAY_MS * (attempt + 1);
}
async function fetchWithRetry(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
	let attempt = 0;
	while (true) {
		try {
			const response = await fetch(url, { ...init, signal: signal ?? init.signal });
			if (!CODEX_RETRYABLE_STATUS.has(response.status) || attempt >= CODEX_MAX_RETRIES) {
				return response;
			}
			if (signal?.aborted) return response;
			// Read error body for retry delay parsing
			const errorBody = await response.text();
			const delay = getRetryDelayMs(response, attempt, errorBody);
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

	const transformedMessages = transformMessages(context.messages, model);

	let msgIndex = 0;
	for (const msg of transformedMessages) {
		if (msg.role === "user") {
			if (typeof msg.content === "string") {
				// Skip empty user messages
				if (!msg.content || msg.content.trim() === "") continue;
				messages.push({
					role: "user",
					content: [{ type: "input_text", text: sanitizeSurrogates(msg.content) }],
				});
			} else {
				const content: ResponseInputContent[] = msg.content.map((item): ResponseInputContent => {
					if (item.type === "text") {
						return {
							type: "input_text",
							text: sanitizeSurrogates(item.text),
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
						content: [{ type: "output_text", text: sanitizeSurrogates(textBlock.text), annotations: [] }],
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
				output: sanitizeSurrogates(hasText ? textResult : "(see attached image)"),
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

function convertTools(
	tools: Tool[],
): Array<{ type: "function"; name: string; description: string; parameters: Record<string, unknown>; strict: null }> {
	return tools.map(tool => ({
		type: "function",
		name: tool.name,
		description: tool.description,
		parameters: tool.parameters as unknown as Record<string, unknown>,
		strict: null,
	}));
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

function asRecord(value: unknown): Record<string, unknown> | null {
	if (value && typeof value === "object") {
		return value as Record<string, unknown>;
	}
	return null;
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
