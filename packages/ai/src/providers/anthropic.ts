import * as nodeCrypto from "node:crypto";
import * as tls from "node:tls";
import Anthropic, { type ClientOptions as AnthropicSdkClientOptions } from "@anthropic-ai/sdk";
import type {
	ContentBlockParam,
	MessageCreateParamsStreaming,
	MessageParam,
} from "@anthropic-ai/sdk/resources/messages";
import { abortableSleep } from "@oh-my-pi/pi-utils";
import { calculateCost } from "../models";
import { getEnvApiKey, OUTPUT_FALLBACK_BUFFER } from "../stream";
import type {
	Api,
	AssistantMessage,
	CacheRetention,
	Context,
	ImageContent,
	Message,
	Model,
	SimpleStreamOptions,
	StopReason,
	StreamFunction,
	StreamOptions,
	TextContent,
	ThinkingContent,
	Tool,
	ToolCall,
	ToolResultMessage,
} from "../types";
import { isAnthropicOAuthToken, normalizeToolCallId, resolveCacheRetention } from "../utils";
import { AssistantMessageEventStream } from "../utils/event-stream";
import { finalizeErrorMessage, type RawHttpRequestDump } from "../utils/http-inspector";
import { parseStreamingJson } from "../utils/json-parse";
import { sanitizeSurrogates } from "../utils/sanitize-unicode";
import {
	buildCopilotDynamicHeaders,
	getCopilotInitiatorOverride,
	hasCopilotVisionInput,
} from "./github-copilot-headers";
import { transformMessages } from "./transform-messages";

export type AnthropicHeaderOptions = {
	apiKey: string;
	baseUrl?: string;
	isOAuth?: boolean;
	extraBetas?: string[];
	stream?: boolean;
	modelHeaders?: Record<string, string>;
};

// Build deduplicated beta header string
export function buildBetaHeader(baseBetas: string[], extraBetas: string[]): string {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const beta of [...baseBetas, ...extraBetas]) {
		const trimmed = beta.trim();
		if (trimmed && !seen.has(trimmed)) {
			seen.add(trimmed);
			result.push(trimmed);
		}
	}
	return result.join(",");
}

const claudeCodeBetaDefaults = [
	"claude-code-20250219",
	"oauth-2025-04-20",
	"interleaved-thinking-2025-05-14",
	"context-management-2025-06-27",
	"prompt-caching-scope-2026-01-05",
];
function getHeaderCaseInsensitive(headers: Record<string, string> | undefined, headerName: string): string | undefined {
	if (!headers) return undefined;
	const normalizedName = headerName.toLowerCase();
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === normalizedName) return value;
	}
	return undefined;
}

function isClaudeCodeClientUserAgent(userAgent: string | undefined): userAgent is string {
	if (!userAgent) return false;
	return userAgent.toLowerCase().startsWith("claude-cli");
}

function isAnthropicApiBaseUrl(baseUrl?: string): boolean {
	if (!baseUrl) return true;
	try {
		const url = new URL(baseUrl);
		return url.protocol.toLowerCase() === "https:" && url.hostname.toLowerCase() === "api.anthropic.com";
	} catch {
		return false;
	}
}
export function buildAnthropicHeaders(options: AnthropicHeaderOptions): Record<string, string> {
	const oauthToken = options.isOAuth ?? isAnthropicOAuthToken(options.apiKey);
	const extraBetas = options.extraBetas ?? [];
	const stream = options.stream ?? false;
	const betaHeader = buildBetaHeader(claudeCodeBetaDefaults, extraBetas);
	const acceptHeader = stream ? "text/event-stream" : "application/json";
	const incomingUserAgent = getHeaderCaseInsensitive(options.modelHeaders, "User-Agent");
	const userAgent = isClaudeCodeClientUserAgent(incomingUserAgent)
		? incomingUserAgent
		: `claude-cli/${claudeCodeVersion} (external, cli)`;
	const enforcedHeaderKeys = new Set(
		[
			...Object.keys(claudeCodeHeaders),
			"Accept",
			"Accept-Encoding",
			"Connection",
			"Content-Type",
			"Anthropic-Version",
			"Anthropic-Dangerous-Direct-Browser-Access",
			"Anthropic-Beta",
			"User-Agent",
			"X-App",
			"Authorization",
			"X-Api-Key",
		].map(key => key.toLowerCase()),
	);
	const modelHeaders = Object.fromEntries(
		Object.entries(options.modelHeaders ?? {}).filter(([key]) => !enforcedHeaderKeys.has(key.toLowerCase())),
	);
	const headers: Record<string, string> = {
		...modelHeaders,
		...claudeCodeHeaders,
		Accept: acceptHeader,
		"Accept-Encoding": "gzip, deflate, br, zstd",
		Connection: "keep-alive",
		"Content-Type": "application/json",
		"Anthropic-Version": "2023-06-01",
		"Anthropic-Dangerous-Direct-Browser-Access": "true",
		"Anthropic-Beta": betaHeader,
		"User-Agent": userAgent,
		"X-App": "cli",
	};

	if (oauthToken || !isAnthropicApiBaseUrl(options.baseUrl)) {
		headers.Authorization = `Bearer ${options.apiKey}`;
	} else {
		headers["X-Api-Key"] = options.apiKey;
	}

	return headers;
}

type AnthropicCacheControl = { type: "ephemeral"; ttl?: "1h" | "5m" };

type AnthropicSamplingParams = MessageCreateParamsStreaming & {
	top_p?: number;
	top_k?: number;
};
function getCacheControl(
	baseUrl: string,
	cacheRetention?: CacheRetention,
): { retention: CacheRetention; cacheControl?: AnthropicCacheControl } {
	const retention = resolveCacheRetention(cacheRetention);
	if (retention === "none") {
		return { retention };
	}
	const ttl = retention === "long" && baseUrl.includes("api.anthropic.com") ? "1h" : undefined;
	return {
		retention,
		cacheControl: { type: "ephemeral", ...(ttl && { ttl }) },
	};
}

// Stealth mode: Mimic Claude Code headers and tool prefixing.
export const claudeCodeVersion = "2.1.63";
export const claudeToolPrefix: string = "proxy_";
export const claudeCodeSystemInstruction = "You are a Claude agent, built on Anthropic's Claude Agent SDK.";

export function mapStainlessOs(platform: string): "MacOS" | "Windows" | "Linux" | "FreeBSD" | `Other::${string}` {
	switch (platform.toLowerCase()) {
		case "darwin":
			return "MacOS";
		case "windows":
		case "win32":
			return "Windows";
		case "linux":
			return "Linux";
		case "freebsd":
			return "FreeBSD";
		default:
			return `Other::${platform.toLowerCase()}`;
	}
}

export function mapStainlessArch(arch: string): "x64" | "arm64" | "x86" | `other::${string}` {
	switch (arch.toLowerCase()) {
		case "amd64":
		case "x64":
			return "x64";
		case "arm64":
		case "aarch64":
			return "arm64";
		case "386":
		case "x86":
		case "ia32":
			return "x86";
		default:
			return `other::${arch.toLowerCase()}`;
	}
}

export const claudeCodeHeaders = {
	"X-Stainless-Retry-Count": "0",
	"X-Stainless-Runtime-Version": "v24.3.0",
	"X-Stainless-Package-Version": "0.74.0",
	"X-Stainless-Runtime": "node",
	"X-Stainless-Lang": "js",
	"X-Stainless-Arch": mapStainlessArch(process.arch),
	"X-Stainless-Os": mapStainlessOs(process.platform),
	"X-Stainless-Timeout": "600",
} as const;

const CLAUDE_BILLING_HEADER_PREFIX = "x-anthropic-billing-header:";

function createClaudeBillingHeader(payload: unknown): string {
	const payloadJson = JSON.stringify(payload) ?? "";
	const cch = nodeCrypto.createHash("sha256").update(payloadJson).digest("hex").slice(0, 5);
	const randomBytes = new Uint8Array(2);
	crypto.getRandomValues(randomBytes);
	const buildHash = Array.from(randomBytes, byte => byte.toString(16).padStart(2, "0"))
		.join("")
		.slice(0, 3);
	return `${CLAUDE_BILLING_HEADER_PREFIX} cc_version=${claudeCodeVersion}.${buildHash}; cc_entrypoint=cli; cch=${cch};`;
}

const CLAUDE_CLOAKING_USER_ID_REGEX =
	/^user_[0-9a-fA-F]{64}_account_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_session_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isClaudeCloakingUserId(userId: string): boolean {
	return CLAUDE_CLOAKING_USER_ID_REGEX.test(userId);
}

export function generateClaudeCloakingUserId(): string {
	const userHash = nodeCrypto.randomBytes(32).toString("hex");
	const accountId = nodeCrypto.randomUUID().toLowerCase();
	const sessionId = nodeCrypto.randomUUID().toLowerCase();
	return `user_${userHash}_account_${accountId}_session_${sessionId}`;
}

function resolveAnthropicMetadataUserId(userId: unknown, isOAuthToken: boolean): string | undefined {
	if (typeof userId === "string") {
		if (!isOAuthToken || isClaudeCloakingUserId(userId)) {
			return userId;
		}
	}

	if (!isOAuthToken) return undefined;
	return generateClaudeCloakingUserId();
}
const ANTHROPIC_BUILTIN_TOOL_NAMES = new Set(["web_search", "code_execution", "text_editor", "computer"]);
export const applyClaudeToolPrefix = (name: string, prefixOverride: string = claudeToolPrefix) => {
	if (!prefixOverride) return name;
	if (ANTHROPIC_BUILTIN_TOOL_NAMES.has(name.toLowerCase())) return name;
	const prefix = prefixOverride.toLowerCase();
	if (name.toLowerCase().startsWith(prefix)) return name;
	return `${prefixOverride}${name}`;
};

export const stripClaudeToolPrefix = (name: string, prefixOverride: string = claudeToolPrefix) => {
	if (!prefixOverride) return name;
	const prefix = prefixOverride.toLowerCase();
	if (!name.toLowerCase().startsWith(prefix)) return name;
	return name.slice(prefixOverride.length);
};

/**
 * Convert content blocks to Anthropic API format
 */
function convertContentBlocks(content: (TextContent | ImageContent)[]):
	| string
	| Array<
			| { type: "text"; text: string }
			| {
					type: "image";
					source: {
						type: "base64";
						media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
						data: string;
					};
			  }
	  > {
	// If only text blocks, return as concatenated string for simplicity
	const hasImages = content.some(c => c.type === "image");
	if (!hasImages) {
		return sanitizeSurrogates(content.map(c => (c as TextContent).text).join("\n"));
	}

	// If we have images, convert to content block array
	const blocks = content.map(block => {
		if (block.type === "text") {
			return {
				type: "text" as const,
				text: sanitizeSurrogates(block.text),
			};
		}
		return {
			type: "image" as const,
			source: {
				type: "base64" as const,
				media_type: block.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
				data: block.data,
			},
		};
	});

	// If only images (no text), add placeholder text block
	const hasText = blocks.some(b => b.type === "text");
	if (!hasText) {
		blocks.unshift({
			type: "text" as const,
			text: "(see attached image)",
		});
	}

	return blocks;
}

export type AnthropicEffort = "low" | "medium" | "high" | "max";

export interface AnthropicOptions extends StreamOptions {
	/**
	 * Enable extended thinking.
	 * For Opus 4.6+: uses adaptive thinking (Claude decides when/how much to think).
	 * For older models: uses budget-based thinking with thinkingBudgetTokens.
	 */
	thinkingEnabled?: boolean;
	/**
	 * Token budget for extended thinking (older models only).
	 * Ignored for Opus 4.6+ which uses adaptive thinking.
	 */
	thinkingBudgetTokens?: number;
	/**
	 * Effort level for adaptive thinking (Opus 4.6+ only).
	 * Controls how much thinking Claude allocates:
	 * - "max": Always thinks with no constraints
	 * - "high": Always thinks, deep reasoning (default)
	 * - "medium": Moderate thinking, may skip for simple queries
	 * - "low": Minimal thinking, skips for simple tasks
	 * Ignored for older models.
	 */
	effort?: AnthropicEffort;
	/**
	 * Optional reasoning level fallback for direct Anthropic provider usage.
	 * Converted to adaptive effort when effort is not explicitly provided.
	 */
	reasoning?: SimpleStreamOptions["reasoning"];
	interleavedThinking?: boolean;
	toolChoice?: "auto" | "any" | "none" | { type: "tool"; name: string };
	betas?: string[] | string;
	/** Force OAuth bearer auth mode for proxy tokens that don't match Anthropic token prefixes. */
	isOAuth?: boolean;
}

export type AnthropicClientOptionsArgs = {
	model: Model<"anthropic-messages">;
	apiKey: string;
	extraBetas?: string[];
	stream?: boolean;
	interleavedThinking?: boolean;
	headers?: Record<string, string>;
	dynamicHeaders?: Record<string, string>;
	isOAuth?: boolean;
};

export type AnthropicClientOptionsResult = {
	isOAuthToken: boolean;
	apiKey: string | null;
	authToken?: string;
	baseURL?: string;
	maxRetries: number;
	dangerouslyAllowBrowser: boolean;
	defaultHeaders: Record<string, string>;
	fetchOptions?: AnthropicSdkClientOptions["fetchOptions"];
};

const CLAUDE_CODE_TLS_CIPHERS = tls.DEFAULT_CIPHERS;

function buildClaudeCodeTlsFetchOptions(
	model: Model<"anthropic-messages">,
): AnthropicSdkClientOptions["fetchOptions"] | undefined {
	if (model.provider !== "anthropic") return undefined;
	if (!model.baseUrl) return undefined;

	let serverName: string;
	try {
		serverName = new URL(model.baseUrl).hostname;
	} catch {
		return undefined;
	}

	if (!serverName) return undefined;

	return {
		tls: {
			rejectUnauthorized: true,
			serverName,
			...(CLAUDE_CODE_TLS_CIPHERS ? { ciphers: CLAUDE_CODE_TLS_CIPHERS } : {}),
		},
	};
}
function mergeHeaders(...headerSources: (Record<string, string> | undefined)[]): Record<string, string> {
	const merged: Record<string, string> = {};
	for (const headers of headerSources) {
		if (headers) {
			Object.assign(merged, headers);
		}
	}
	return merged;
}

const PROVIDER_MAX_RETRIES = 3;
const PROVIDER_BASE_DELAY_MS = 2000;

/**
 * Check if an error from the Anthropic SDK is a rate-limit/transient error that
 * should be retried before any content has been emitted.
 *
 * Includes malformed JSON stream-envelope parse errors seen from some
 * Anthropic-compatible proxy endpoints.
 */
/** Transient stream corruption errors where the response was truncated mid-JSON. */
function isTransientStreamParseError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	return /json parse error|unterminated string|unexpected end of json input/i.test(error.message);
}

export function isProviderRetryableError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	const msg = error.message;
	return (
		/rate.?limit|too many requests|overloaded|service.?unavailable|1302/i.test(msg) ||
		isTransientStreamParseError(error)
	);
}

export const streamAnthropic: StreamFunction<"anthropic-messages"> = (
	model: Model<"anthropic-messages">,
	context: Context,
	options?: AnthropicOptions,
): AssistantMessageEventStream => {
	const stream = new AssistantMessageEventStream();

	(async () => {
		const startTime = Date.now();
		let firstTokenTime: number | undefined;

		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: model.api as Api,
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
		let rawRequestDump: RawHttpRequestDump | undefined;

		try {
			const apiKey = options?.apiKey ?? getEnvApiKey(model.provider) ?? "";

			let copilotDynamicHeaders: Record<string, string> | undefined;
			if (model.provider === "github-copilot") {
				const hasImages = hasCopilotVisionInput(context.messages);
				const initiatorOverride = getCopilotInitiatorOverride({
					...(model.headers ?? {}),
					...(options?.headers ?? {}),
				});
				copilotDynamicHeaders = buildCopilotDynamicHeaders({
					messages: context.messages,
					hasImages,
					initiatorOverride,
				});
			}

			const { client, isOAuthToken } = createClient(model, {
				model,
				apiKey,
				extraBetas: normalizeExtraBetas(options?.betas),
				stream: true,
				interleavedThinking: options?.interleavedThinking ?? true,
				headers: options?.headers,
				dynamicHeaders: copilotDynamicHeaders,
				isOAuth: options?.isOAuth,
			});
			const params = buildParams(model, context, isOAuthToken, options);
			options?.onPayload?.(params);
			rawRequestDump = {
				provider: model.provider,
				api: output.api,
				model: model.id,
				method: "POST",
				url: `${model.baseUrl ?? "https://api.anthropic.com"}/v1/messages`,
				body: params,
			};

			type Block = (ThinkingContent | TextContent | (ToolCall & { partialJson: string })) & { index: number };
			const blocks = output.content as Block[];
			stream.push({ type: "start", partial: output });
			// Retry loop for transient errors from the stream.
			// Rate-limit/overload: only before content starts (safe to restart).
			// Truncated JSON: also after content starts (partial response is unusable).
			let providerRetryAttempt = 0;
			let started = false;
			do {
				const anthropicStream = client.messages.stream({ ...params, stream: true }, { signal: options?.signal });

				try {
					for await (const event of anthropicStream) {
						started = true;
						if (event.type === "message_start") {
							// Capture initial token usage from message_start event
							// This ensures we have input token counts even if the stream is aborted early
							output.usage.input = event.message.usage.input_tokens || 0;
							output.usage.output = event.message.usage.output_tokens || 0;
							output.usage.cacheRead = event.message.usage.cache_read_input_tokens || 0;
							output.usage.cacheWrite = event.message.usage.cache_creation_input_tokens || 0;
							// Anthropic doesn't provide total_tokens, compute from components
							output.usage.totalTokens =
								output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite;
							calculateCost(model, output.usage);
						} else if (event.type === "content_block_start") {
							if (!firstTokenTime) firstTokenTime = Date.now();
							if (event.content_block.type === "text") {
								const block: Block = {
									type: "text",
									text: "",
									index: event.index,
								};
								output.content.push(block);
								stream.push({ type: "text_start", contentIndex: output.content.length - 1, partial: output });
							} else if (event.content_block.type === "thinking") {
								const block: Block = {
									type: "thinking",
									thinking: "",
									thinkingSignature: "",
									index: event.index,
								};
								output.content.push(block);
								stream.push({
									type: "thinking_start",
									contentIndex: output.content.length - 1,
									partial: output,
								});
							} else if (event.content_block.type === "tool_use") {
								const block: Block = {
									type: "toolCall",
									id: event.content_block.id,
									name: isOAuthToken
										? stripClaudeToolPrefix(event.content_block.name)
										: event.content_block.name,
									arguments: (event.content_block.input as Record<string, unknown>) ?? {},
									partialJson: "",
									index: event.index,
								};
								output.content.push(block);
								stream.push({
									type: "toolcall_start",
									contentIndex: output.content.length - 1,
									partial: output,
								});
							}
						} else if (event.type === "content_block_delta") {
							if (event.delta.type === "text_delta") {
								const index = blocks.findIndex(b => b.index === event.index);
								const block = blocks[index];
								if (block && block.type === "text") {
									block.text += event.delta.text;
									stream.push({
										type: "text_delta",
										contentIndex: index,
										delta: event.delta.text,
										partial: output,
									});
								}
							} else if (event.delta.type === "thinking_delta") {
								const index = blocks.findIndex(b => b.index === event.index);
								const block = blocks[index];
								if (block && block.type === "thinking") {
									block.thinking += event.delta.thinking;
									stream.push({
										type: "thinking_delta",
										contentIndex: index,
										delta: event.delta.thinking,
										partial: output,
									});
								}
							} else if (event.delta.type === "input_json_delta") {
								const index = blocks.findIndex(b => b.index === event.index);
								const block = blocks[index];
								if (block && block.type === "toolCall") {
									block.partialJson += event.delta.partial_json;
									block.arguments = parseStreamingJson(block.partialJson);
									stream.push({
										type: "toolcall_delta",
										contentIndex: index,
										delta: event.delta.partial_json,
										partial: output,
									});
								}
							} else if (event.delta.type === "signature_delta") {
								const index = blocks.findIndex(b => b.index === event.index);
								const block = blocks[index];
								if (block && block.type === "thinking") {
									block.thinkingSignature = block.thinkingSignature || "";
									block.thinkingSignature += event.delta.signature;
								}
							}
						} else if (event.type === "content_block_stop") {
							const index = blocks.findIndex(b => b.index === event.index);
							const block = blocks[index];
							if (block) {
								delete (block as { index?: number }).index;
								if (block.type === "text") {
									stream.push({
										type: "text_end",
										contentIndex: index,
										content: block.text,
										partial: output,
									});
								} else if (block.type === "thinking") {
									stream.push({
										type: "thinking_end",
										contentIndex: index,
										content: block.thinking,
										partial: output,
									});
								} else if (block.type === "toolCall") {
									block.arguments = parseStreamingJson(block.partialJson);
									delete (block as { partialJson?: string }).partialJson;
									stream.push({
										type: "toolcall_end",
										contentIndex: index,
										toolCall: block,
										partial: output,
									});
								}
							}
						} else if (event.type === "message_delta") {
							if (event.delta.stop_reason) {
								output.stopReason = mapStopReason(event.delta.stop_reason);
							}
							// Only update usage fields if present (not null).
							// Preserves input_tokens from message_start when proxies omit it in message_delta.
							if (event.usage.input_tokens != null) {
								output.usage.input = event.usage.input_tokens;
							}
							if (event.usage.output_tokens != null) {
								output.usage.output = event.usage.output_tokens;
							}
							if (event.usage.cache_read_input_tokens != null) {
								output.usage.cacheRead = event.usage.cache_read_input_tokens;
							}
							if (event.usage.cache_creation_input_tokens != null) {
								output.usage.cacheWrite = event.usage.cache_creation_input_tokens;
							}
							// Anthropic doesn't provide total_tokens, compute from components
							output.usage.totalTokens =
								output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite;
							calculateCost(model, output.usage);
						}
					}

					if (options?.signal?.aborted) {
						throw new Error("Request was aborted");
					}

					if (output.stopReason === "aborted" || output.stopReason === "error") {
						throw new Error("An unknown error occurred");
					}
					break; // Stream completed successfully
				} catch (streamError) {
					// Transient stream parse errors (truncated JSON) are retryable even after content
					// has started streaming, since the partial response is unusable anyway.
					// Rate-limit/overload errors are only retried before content starts.
					const isTransient = isTransientStreamParseError(streamError);
					if (
						options?.signal?.aborted ||
						providerRetryAttempt >= PROVIDER_MAX_RETRIES ||
						(!isTransient && firstTokenTime !== undefined) ||
						(!isTransient && !isProviderRetryableError(streamError))
					) {
						throw streamError;
					}
					providerRetryAttempt++;
					const delayMs = PROVIDER_BASE_DELAY_MS * 2 ** (providerRetryAttempt - 1);
					await abortableSleep(delayMs, options?.signal);
					// Reset output state for clean retry
					output.content.length = 0;
					output.stopReason = "stop";
					firstTokenTime = undefined;
					started = false;
				}
			} while (!started);

			output.duration = Date.now() - startTime;
			if (firstTokenTime) output.ttft = firstTokenTime - startTime;
			stream.push({ type: "done", reason: output.stopReason, message: output });
			stream.end();
		} catch (error) {
			for (const block of output.content) delete (block as any).index;
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

/**
 * Check if a model supports adaptive thinking (Opus 4.6+)
 */
function supportsAdaptiveThinking(modelId: string): boolean {
	// Opus/Sonnet 4.6 model IDs (with or without date suffix)
	return (
		modelId.includes("opus-4-6") ||
		modelId.includes("opus-4.6") ||
		modelId.includes("sonnet-4-6") ||
		modelId.includes("sonnet-4.6")
	);
}

export type AnthropicSystemBlock = {
	type: "text";
	text: string;
	cache_control?: AnthropicCacheControl;
};
type SystemBlockOptions = {
	includeClaudeCodeInstruction?: boolean;
	extraInstructions?: string[];
	billingPayload?: unknown;
};

export function buildAnthropicSystemBlocks(
	systemPrompt: string | undefined,
	options: SystemBlockOptions = {},
): AnthropicSystemBlock[] | undefined {
	const { includeClaudeCodeInstruction = false, extraInstructions = [], billingPayload } = options;
	const blocks: AnthropicSystemBlock[] = [];
	const sanitizedPrompt = systemPrompt ? sanitizeSurrogates(systemPrompt) : "";
	const trimmedInstructions = extraInstructions.map(instruction => instruction.trim()).filter(Boolean);
	const hasBillingHeader = sanitizedPrompt.includes(CLAUDE_BILLING_HEADER_PREFIX);
	const claudeCodeSystemCacheControl: AnthropicCacheControl = { type: "ephemeral", ttl: "1h" };

	if (includeClaudeCodeInstruction && !hasBillingHeader) {
		const payloadSeed = billingPayload ?? {
			system: sanitizedPrompt,
			extraInstructions: trimmedInstructions,
		};
		blocks.push(
			{ type: "text", text: createClaudeBillingHeader(payloadSeed) },
			{
				type: "text",
				text: claudeCodeSystemInstruction,
				cache_control: claudeCodeSystemCacheControl,
			},
		);
	}

	for (const instruction of trimmedInstructions) {
		blocks.push({
			type: "text",
			text: instruction,
			...(includeClaudeCodeInstruction ? { cache_control: claudeCodeSystemCacheControl } : {}),
		});
	}

	if (systemPrompt) {
		blocks.push({
			type: "text",
			text: sanitizedPrompt,
			...(includeClaudeCodeInstruction ? { cache_control: claudeCodeSystemCacheControl } : {}),
		});
	}

	return blocks.length > 0 ? blocks : undefined;
}

/**
 * Map ThinkingLevel to Anthropic effort levels for adaptive thinking
 */
function mapThinkingLevelToEffort(level: SimpleStreamOptions["reasoning"]): AnthropicEffort {
	switch (level) {
		case "minimal":
			return "low";
		case "low":
			return "low";
		case "medium":
			return "medium";
		case "high":
			return "high";
		case "xhigh":
			return "max";
		default:
			return "high";
	}
}

export function normalizeExtraBetas(betas?: string[] | string): string[] {
	if (!betas) return [];
	const raw = Array.isArray(betas) ? betas : betas.split(",");
	return raw.map(beta => beta.trim()).filter(beta => beta.length > 0);
}

export function buildAnthropicClientOptions(args: AnthropicClientOptionsArgs): AnthropicClientOptionsResult {
	const {
		model,
		apiKey,
		extraBetas = [],
		stream = true,
		interleavedThinking = true,
		headers,
		dynamicHeaders,
		isOAuth,
	} = args;
	const oauthToken = isOAuth ?? isAnthropicOAuthToken(apiKey);

	const tlsFetchOptions = buildClaudeCodeTlsFetchOptions(model);
	if (model.provider === "github-copilot") {
		const betaFeatures = [...extraBetas];
		if (interleavedThinking) {
			betaFeatures.push("interleaved-thinking-2025-05-14");
		}
		const defaultHeaders = mergeHeaders(
			{
				Accept: stream ? "text/event-stream" : "application/json",
				"Anthropic-Dangerous-Direct-Browser-Access": "true",
				Authorization: `Bearer ${apiKey}`,
				...(betaFeatures.length > 0 ? { "anthropic-beta": buildBetaHeader([], betaFeatures) } : {}),
			},
			model.headers,
			dynamicHeaders,
			headers,
		);

		return {
			isOAuthToken: false,
			apiKey: null,
			authToken: apiKey,
			baseURL: model.baseUrl,
			maxRetries: 5,
			dangerouslyAllowBrowser: true,
			defaultHeaders,
			...(tlsFetchOptions ? { fetchOptions: tlsFetchOptions } : {}),
		};
	}

	const betaFeatures = [...extraBetas];
	if (interleavedThinking) {
		betaFeatures.push("interleaved-thinking-2025-05-14");
	}

	const defaultHeaders = buildAnthropicHeaders({
		apiKey,
		baseUrl: model.baseUrl,
		isOAuth: oauthToken,
		extraBetas: betaFeatures,
		stream,
		modelHeaders: mergeHeaders(model.headers, headers, dynamicHeaders),
	});

	return {
		isOAuthToken: oauthToken,
		apiKey: oauthToken ? null : apiKey,
		authToken: oauthToken ? apiKey : undefined,
		baseURL: model.baseUrl,
		maxRetries: 5,
		dangerouslyAllowBrowser: true,
		defaultHeaders,
		...(tlsFetchOptions ? { fetchOptions: tlsFetchOptions } : {}),
	};
}

function createClient(
	model: Model<"anthropic-messages">,
	args: AnthropicClientOptionsArgs,
): { client: Anthropic; isOAuthToken: boolean } {
	const { isOAuthToken: oauthToken, ...clientOptions } = buildAnthropicClientOptions({ ...args, model });
	const client = new Anthropic(clientOptions);
	return { client, isOAuthToken: oauthToken };
}

function disableThinkingIfToolChoiceForced(params: MessageCreateParamsStreaming): void {
	const toolChoice = params.tool_choice;
	if (!toolChoice) return;
	if (toolChoice.type === "any" || toolChoice.type === "tool") {
		delete params.thinking;
		delete params.output_config;
	}
}

function ensureMaxTokensForThinking(params: MessageCreateParamsStreaming, model: Model<"anthropic-messages">): void {
	const thinking = params.thinking;
	if (!thinking || thinking.type !== "enabled") return;

	const budgetTokens = thinking.budget_tokens ?? 0;
	if (budgetTokens <= 0) return;

	const maxTokens = params.max_tokens ?? 0;
	const requiredMaxTokens = budgetTokens + OUTPUT_FALLBACK_BUFFER;
	if (maxTokens < requiredMaxTokens) {
		params.max_tokens = Math.min(requiredMaxTokens, model.maxTokens);
	}
}

type CacheControlBlock = {
	cache_control?: AnthropicCacheControl | null;
};

function hasCacheControlInBlocks<T extends CacheControlBlock>(blocks: T[]): boolean {
	return blocks.some(block => "cache_control" in block && block.cache_control != null);
}

function applyCacheControlToLastBlock<T extends CacheControlBlock>(
	blocks: T[],
	cacheControl: AnthropicCacheControl,
): void {
	if (blocks.length === 0) return;
	const lastIndex = blocks.length - 1;
	blocks[lastIndex] = { ...blocks[lastIndex], cache_control: cacheControl };
}

function applyCacheControlToLastTextBlock(
	blocks: Array<ContentBlockParam & CacheControlBlock>,
	cacheControl: AnthropicCacheControl,
): void {
	if (blocks.length === 0) return;
	for (let i = blocks.length - 1; i >= 0; i--) {
		if (blocks[i].type === "text") {
			blocks[i] = { ...blocks[i], cache_control: cacheControl };
			return;
		}
	}
	applyCacheControlToLastBlock(blocks, cacheControl);
}

function applyPromptCaching(params: MessageCreateParamsStreaming, cacheControl?: AnthropicCacheControl): void {
	if (!cacheControl) return;
	if (params.tools && hasCacheControlInBlocks(params.tools as Array<CacheControlBlock>)) return;
	if (params.system && Array.isArray(params.system) && hasCacheControlInBlocks(params.system)) return;
	for (const message of params.messages) {
		if (Array.isArray(message.content)) {
			if (hasCacheControlInBlocks(message.content as Array<ContentBlockParam & CacheControlBlock>)) return;
		}
	}

	const MAX_CACHE_BREAKPOINTS = 4;
	let cacheBreakpointsUsed = 0;

	if (params.tools && params.tools.length > 0) {
		applyCacheControlToLastBlock(params.tools as Array<CacheControlBlock>, cacheControl);
		cacheBreakpointsUsed++;
	}

	if (cacheBreakpointsUsed >= MAX_CACHE_BREAKPOINTS) return;

	if (params.system && Array.isArray(params.system) && params.system.length > 0) {
		applyCacheControlToLastBlock(params.system, cacheControl);
		cacheBreakpointsUsed++;
	}

	if (cacheBreakpointsUsed >= MAX_CACHE_BREAKPOINTS) return;

	const userIndexes = params.messages
		.map((message, index) => (message.role === "user" ? index : -1))
		.filter(index => index >= 0);

	if (userIndexes.length >= 2) {
		const penultimateUserIndex = userIndexes[userIndexes.length - 2];
		const penultimateUser = params.messages[penultimateUserIndex];
		if (penultimateUser) {
			if (typeof penultimateUser.content === "string") {
				penultimateUser.content = [
					{ type: "text", text: penultimateUser.content, cache_control: cacheControl },
				] as any;
				cacheBreakpointsUsed++;
			} else if (Array.isArray(penultimateUser.content) && penultimateUser.content.length > 0) {
				applyCacheControlToLastTextBlock(
					penultimateUser.content as Array<ContentBlockParam & CacheControlBlock>,
					cacheControl,
				);
				cacheBreakpointsUsed++;
			}
		}
	}

	if (cacheBreakpointsUsed >= MAX_CACHE_BREAKPOINTS) return;

	if (userIndexes.length >= 1) {
		const lastUserIndex = userIndexes[userIndexes.length - 1];
		const lastUser = params.messages[lastUserIndex];
		if (lastUser) {
			if (typeof lastUser.content === "string") {
				lastUser.content = [{ type: "text", text: lastUser.content, cache_control: cacheControl }] as any;
			} else if (Array.isArray(lastUser.content) && lastUser.content.length > 0) {
				applyCacheControlToLastTextBlock(
					lastUser.content as Array<ContentBlockParam & CacheControlBlock>,
					cacheControl,
				);
			}
		}
	}
}

function buildParams(
	model: Model<"anthropic-messages">,
	context: Context,
	isOAuthToken: boolean,
	options?: AnthropicOptions,
): MessageCreateParamsStreaming {
	const { cacheControl } = getCacheControl(model.baseUrl, options?.cacheRetention);
	const params: AnthropicSamplingParams = {
		model: model.id,
		messages: convertAnthropicMessages(context.messages, model, isOAuthToken),
		max_tokens: options?.maxTokens || (model.maxTokens / 3) | 0,
		stream: true,
	};

	if (options?.temperature !== undefined) {
		params.temperature = options.temperature;
	}
	if (options?.topP !== undefined) {
		params.top_p = options.topP;
	}
	if (options?.topK !== undefined) {
		params.top_k = options.topK;
	}

	if (context.tools) {
		params.tools = convertTools(context.tools, isOAuthToken);
	}

	if (options?.thinkingEnabled && model.reasoning) {
		if (supportsAdaptiveThinking(model.id)) {
			params.thinking = { type: "adaptive" };
			const effort = options.effort ?? mapThinkingLevelToEffort(options.reasoning);
			if (effort) {
				params.output_config = { effort };
			}
		} else {
			params.thinking = {
				type: "enabled",
				budget_tokens: options.thinkingBudgetTokens || 1024,
			};
			// Opus 4.5 supports effort alongside budget-based thinking
			if (model.id.includes("opus-4-5") || model.id.includes("opus-4.5")) {
				const effort = options.effort ?? mapThinkingLevelToEffort(options.reasoning);
				if (effort) {
					params.output_config = { effort };
				}
			}
		}
	}

	const metadataUserId = resolveAnthropicMetadataUserId(options?.metadata?.user_id, isOAuthToken);
	if (metadataUserId) {
		params.metadata = { user_id: metadataUserId };
	}

	if (options?.toolChoice) {
		if (typeof options.toolChoice === "string") {
			params.tool_choice = { type: options.toolChoice };
		} else if (isOAuthToken && options.toolChoice.name) {
			params.tool_choice = { ...options.toolChoice, name: applyClaudeToolPrefix(options.toolChoice.name) };
		} else {
			params.tool_choice = options.toolChoice;
		}
	}

	const shouldInjectClaudeCodeInstruction = isOAuthToken && !model.id.startsWith("claude-3-5-haiku");
	const billingPayload = shouldInjectClaudeCodeInstruction
		? {
				...params,
				...(context.systemPrompt ? { system: sanitizeSurrogates(context.systemPrompt) } : {}),
			}
		: undefined;
	const systemBlocks = buildAnthropicSystemBlocks(context.systemPrompt, {
		includeClaudeCodeInstruction: shouldInjectClaudeCodeInstruction,
		billingPayload,
	});
	if (systemBlocks) {
		params.system = systemBlocks;
	}
	disableThinkingIfToolChoiceForced(params);
	ensureMaxTokensForThinking(params, model);
	applyPromptCaching(params, cacheControl);

	return params;
}

export function convertAnthropicMessages(
	messages: Message[],
	model: Model<"anthropic-messages">,
	isOAuthToken: boolean,
): MessageParam[] {
	const params: MessageParam[] = [];

	const transformedMessages = transformMessages(messages, model, normalizeToolCallId);

	for (let i = 0; i < transformedMessages.length; i++) {
		const msg = transformedMessages[i];

		if (msg.role === "user" || msg.role === "developer") {
			if (!msg.content) continue;

			if (typeof msg.content === "string") {
				if (msg.content.trim().length > 0) {
					params.push({
						role: "user",
						content: sanitizeSurrogates(msg.content),
					});
				}
			} else {
				const blocks: ContentBlockParam[] = msg.content.map(item => {
					if (item.type === "text") {
						return {
							type: "text",
							text: sanitizeSurrogates(item.text),
						};
					}
					return {
						type: "image",
						source: {
							type: "base64",
							media_type: item.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
							data: item.data,
						},
					};
				});
				let filteredBlocks = !model?.input.includes("image") ? blocks.filter(b => b.type !== "image") : blocks;
				filteredBlocks = filteredBlocks.filter(b => {
					if (b.type === "text") {
						return b.text.trim().length > 0;
					}
					return true;
				});
				if (filteredBlocks.length === 0) continue;
				params.push({
					role: "user",
					content: filteredBlocks,
				});
			}
		} else if (msg.role === "assistant") {
			const blocks: ContentBlockParam[] = [];

			for (const block of msg.content) {
				if (block.type === "text") {
					if (block.text.trim().length === 0) continue;
					blocks.push({
						type: "text",
						text: sanitizeSurrogates(block.text),
					});
				} else if (block.type === "thinking") {
					if (block.thinking.trim().length === 0) continue;
					if (!block.thinkingSignature || block.thinkingSignature.trim().length === 0) {
						blocks.push({
							type: "text",
							text: sanitizeSurrogates(block.thinking),
						});
					} else {
						blocks.push({
							type: "thinking",
							thinking: sanitizeSurrogates(block.thinking),
							signature: block.thinkingSignature,
						});
					}
				} else if (block.type === "toolCall") {
					blocks.push({
						type: "tool_use",
						id: block.id,
						name: isOAuthToken ? applyClaudeToolPrefix(block.name) : block.name,
						input: block.arguments ?? {},
					});
				}
			}
			if (blocks.length === 0) continue;
			params.push({
				role: "assistant",
				content: blocks,
			});
		} else if (msg.role === "toolResult") {
			// Collect all consecutive toolResult messages, needed for z.ai Anthropic endpoint
			const toolResults: ContentBlockParam[] = [];

			// Add the current tool result
			toolResults.push({
				type: "tool_result",
				tool_use_id: msg.toolCallId,
				content: convertContentBlocks(msg.content),
				is_error: msg.isError,
			});

			// Look ahead for consecutive toolResult messages
			let j = i + 1;
			while (j < transformedMessages.length && transformedMessages[j].role === "toolResult") {
				const nextMsg = transformedMessages[j] as ToolResultMessage; // We know it's a toolResult
				toolResults.push({
					type: "tool_result",
					tool_use_id: nextMsg.toolCallId,
					content: convertContentBlocks(nextMsg.content),
					is_error: nextMsg.isError,
				});
				j++;
			}

			// Skip the messages we've already processed
			i = j - 1;

			// Add a single user message with all tool results
			params.push({
				role: "user",
				content: toolResults,
			});
		}
	}

	if (params.length > 0 && params[params.length - 1]?.role === "assistant") {
		params.push({ role: "user", content: "Continue." });
	}

	return params;
}

function convertTools(tools: Tool[], isOAuthToken: boolean): Anthropic.Messages.Tool[] {
	if (!tools) return [];

	return tools.map(tool => {
		const jsonSchema = tool.parameters as any; // TypeBox already generates JSON Schema

		return {
			name: isOAuthToken ? applyClaudeToolPrefix(tool.name) : tool.name,
			description: tool.description || "",
			input_schema: {
				type: "object" as const,
				properties: jsonSchema.properties || {},
				required: jsonSchema.required || [],
			},
		};
	});
}

function mapStopReason(reason: Anthropic.Messages.StopReason | string): StopReason {
	switch (reason) {
		case "end_turn":
			return "stop";
		case "max_tokens":
			return "length";
		case "tool_use":
			return "toolUse";
		case "refusal":
			return "error";
		case "pause_turn": // Stop is good enough -> resubmit
			return "stop";
		case "stop_sequence":
			return "stop"; // We don't supply stop sequences, so this should never happen
		case "sensitive": // Content flagged by safety filters (not yet in SDK types)
			return "error";
		default:
			// Handle unknown stop reasons gracefully (API may add new values)
			throw new Error(`Unhandled stop reason: ${reason}`);
	}
}
