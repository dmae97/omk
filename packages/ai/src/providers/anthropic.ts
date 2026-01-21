import Anthropic from "@anthropic-ai/sdk";
import type {
	ContentBlockParam,
	MessageCreateParamsStreaming,
	MessageParam,
} from "@anthropic-ai/sdk/resources/messages";
import { calculateCost } from "../models";
import { getEnvApiKey, OUTPUT_FALLBACK_BUFFER } from "../stream";
import type {
	Api,
	AssistantMessage,
	Context,
	ImageContent,
	Message,
	Model,
	StopReason,
	StreamFunction,
	StreamOptions,
	TextContent,
	ThinkingContent,
	Tool,
	ToolCall,
	ToolResultMessage,
} from "../types";
import { AssistantMessageEventStream } from "../utils/event-stream";
import { parseStreamingJson } from "../utils/json-parse";
import { formatErrorMessageWithRetryAfter } from "../utils/retry-after";
import { sanitizeSurrogates } from "../utils/sanitize-unicode";

import { transformMessages } from "./transform-messages";

// Stealth mode: Mimic Claude Code headers and tool prefixing.
export const claudeCodeVersion = "1.0.83";
export const claudeToolPrefix = "proxy_";
export const claudeCodeSystemInstruction = "You are Claude Code, Anthropic's official CLI for Claude.";
export const claudeCodeHeaders = {
	"X-Stainless-Helper-Method": "stream",
	"X-Stainless-Retry-Count": "0",
	"X-Stainless-Runtime-Version": "v24.3.0",
	"X-Stainless-Package-Version": "0.55.1",
	"X-Stainless-Runtime": "node",
	"X-Stainless-Lang": "js",
	"X-Stainless-Arch": "arm64",
	"X-Stainless-Os": "MacOS",
	"X-Stainless-Timeout": "60",
} as const;

export const applyClaudeToolPrefix = (name: string) => {
	if (!claudeToolPrefix) return name;
	const prefix = claudeToolPrefix.toLowerCase();
	if (name.toLowerCase().startsWith(prefix)) return name;
	return `${claudeToolPrefix}${name}`;
};

export const stripClaudeToolPrefix = (name: string) => {
	if (!claudeToolPrefix) return name;
	const prefix = claudeToolPrefix.toLowerCase();
	if (!name.toLowerCase().startsWith(prefix)) return name;
	return name.slice(claudeToolPrefix.length);
};

const claudeCodeBetaDefaults = [
	"claude-code-20250219",
	"oauth-2025-04-20",
	"interleaved-thinking-2025-05-14",
	"fine-grained-tool-streaming-2025-05-14",
];

// Prefix tool names for OAuth traffic.
const toClaudeCodeName = (name: string) => applyClaudeToolPrefix(name);

// Strip Claude Code tool prefix on response.
const fromClaudeCodeName = (name: string) => stripClaudeToolPrefix(name);

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
	const hasImages = content.some((c) => c.type === "image");
	if (!hasImages) {
		return sanitizeSurrogates(content.map((c) => (c as TextContent).text).join("\n"));
	}

	// If we have images, convert to content block array
	const blocks = content.map((block) => {
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
	const hasText = blocks.some((b) => b.type === "text");
	if (!hasText) {
		blocks.unshift({
			type: "text" as const,
			text: "(see attached image)",
		});
	}

	return blocks;
}

export interface AnthropicOptions extends StreamOptions {
	thinkingEnabled?: boolean;
	thinkingBudgetTokens?: number;
	interleavedThinking?: boolean;
	toolChoice?: "auto" | "any" | "none" | { type: "tool"; name: string };
	betas?: string[] | string;
}

export const streamAnthropic: StreamFunction<"anthropic-messages"> = (
	model: Model<"anthropic-messages">,
	context: Context,
	options?: AnthropicOptions,
): AssistantMessageEventStream => {
	const stream = new AssistantMessageEventStream();

	(async () => {
		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: "anthropic-messages" as Api,
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
			const apiKey = options?.apiKey ?? getEnvApiKey(model.provider) ?? "";
			const extraBetas = normalizeExtraBetas(options?.betas);
			const { client, isOAuthToken } = createClient(model, apiKey, extraBetas, true, options?.headers);
			const params = buildParams(model, context, isOAuthToken, options);
			options?.onPayload?.(params);
			const anthropicStream = client.messages.stream({ ...params, stream: true }, { signal: options?.signal });
			stream.push({ type: "start", partial: output });

			type Block = (ThinkingContent | TextContent | (ToolCall & { partialJson: string })) & { index: number };
			const blocks = output.content as Block[];

			for await (const event of anthropicStream) {
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
						stream.push({ type: "thinking_start", contentIndex: output.content.length - 1, partial: output });
					} else if (event.content_block.type === "tool_use") {
						const block: Block = {
							type: "toolCall",
							id: event.content_block.id,
							name: isOAuthToken ? fromClaudeCodeName(event.content_block.name) : event.content_block.name,
							arguments: event.content_block.input as Record<string, any>,
							partialJson: "",
							index: event.index,
						};
						output.content.push(block);
						stream.push({ type: "toolcall_start", contentIndex: output.content.length - 1, partial: output });
					}
				} else if (event.type === "content_block_delta") {
					if (event.delta.type === "text_delta") {
						const index = blocks.findIndex((b) => b.index === event.index);
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
						const index = blocks.findIndex((b) => b.index === event.index);
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
						const index = blocks.findIndex((b) => b.index === event.index);
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
						const index = blocks.findIndex((b) => b.index === event.index);
						const block = blocks[index];
						if (block && block.type === "thinking") {
							block.thinkingSignature = block.thinkingSignature || "";
							block.thinkingSignature += event.delta.signature;
						}
					}
				} else if (event.type === "content_block_stop") {
					const index = blocks.findIndex((b) => b.index === event.index);
					const block = blocks[index];
					if (block) {
						delete (block as any).index;
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
							delete (block as any).partialJson;
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
					output.usage.input = event.usage.input_tokens || 0;
					output.usage.output = event.usage.output_tokens || 0;
					output.usage.cacheRead = event.usage.cache_read_input_tokens || 0;
					output.usage.cacheWrite = event.usage.cache_creation_input_tokens || 0;
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
				throw new Error("An unkown error ocurred");
			}

			stream.push({ type: "done", reason: output.stopReason, message: output });
			stream.end();
		} catch (error) {
			for (const block of output.content) delete (block as any).index;
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = formatErrorMessageWithRetryAfter(error);
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
};

function isOAuthToken(apiKey: string): boolean {
	return apiKey.includes("sk-ant-oat");
}

function isAnthropicBaseUrl(baseUrl?: string): boolean {
	if (!baseUrl) return true;
	try {
		const url = new URL(baseUrl);
		return url.protocol === "https:" && url.hostname === "api.anthropic.com";
	} catch {
		return false;
	}
}

export function normalizeExtraBetas(betas?: string[] | string): string[] {
	if (!betas) return [];
	const raw = Array.isArray(betas) ? betas : betas.split(",");
	return raw.map((beta) => beta.trim()).filter((beta) => beta.length > 0);
}

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

export type AnthropicHeaderOptions = {
	apiKey: string;
	baseUrl?: string;
	isOAuth?: boolean;
	extraBetas?: string[];
	stream?: boolean;
	modelHeaders?: Record<string, string>;
};

export function buildAnthropicHeaders(options: AnthropicHeaderOptions): Record<string, string> {
	const oauthToken = options.isOAuth ?? isOAuthToken(options.apiKey);
	const extraBetas = options.extraBetas ?? [];
	const stream = options.stream ?? false;
	const betaHeader = buildBetaHeader(claudeCodeBetaDefaults, extraBetas);
	const acceptHeader = stream ? "text/event-stream" : "application/json";
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
		].map((key) => key.toLowerCase()),
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
		"User-Agent": `claude-cli/${claudeCodeVersion} (external, cli)`,
		"X-App": "cli",
	};

	if (oauthToken || !isAnthropicBaseUrl(options.baseUrl)) {
		headers.Authorization = `Bearer ${options.apiKey}`;
	} else {
		headers["X-Api-Key"] = options.apiKey;
	}

	return headers;
}

function createClient(
	model: Model<"anthropic-messages">,
	apiKey: string,
	extraBetas: string[],
	stream: boolean,
	extraHeaders?: Record<string, string>,
): { client: Anthropic; isOAuthToken: boolean } {
	const oauthToken = isOAuthToken(apiKey);

	const mergedBetas: string[] = [];
	const modelBeta = model.headers?.["anthropic-beta"];
	if (modelBeta) {
		mergedBetas.push(...normalizeExtraBetas(modelBeta));
	}
	if (extraBetas.length > 0) {
		mergedBetas.push(...extraBetas);
	}

	const defaultHeadersBase = buildAnthropicHeaders({
		apiKey,
		baseUrl: model.baseUrl,
		isOAuth: oauthToken,
		extraBetas: mergedBetas,
		stream,
		modelHeaders: { ...(model.headers ?? {}), ...(extraHeaders ?? {}) },
	});

	const clientOptions: ConstructorParameters<typeof Anthropic>[0] = {
		baseURL: model.baseUrl,
		dangerouslyAllowBrowser: true,
		defaultHeaders: defaultHeadersBase,
	};

	if (oauthToken || !isAnthropicBaseUrl(model.baseUrl)) {
		clientOptions.apiKey = null;
		clientOptions.authToken = apiKey;
	} else {
		clientOptions.apiKey = apiKey;
	}

	const client = new Anthropic(clientOptions);

	return { client, isOAuthToken: oauthToken };
}

export type AnthropicSystemBlock = {
	type: "text";
	text: string;
	cache_control?: { type: "ephemeral" };
};

type CacheControlBlock = {
	cache_control?: { type: "ephemeral" };
};

type CacheControlMode = "none" | "toolBlocks" | "userText";

const cacheControlEphemeral = { type: "ephemeral" as const };

type SystemBlockOptions = {
	includeClaudeCodeInstruction?: boolean;
	includeCacheControl?: boolean;
	extraInstructions?: string[];
};

export function buildAnthropicSystemBlocks(
	systemPrompt: string | undefined,
	options: SystemBlockOptions = {},
): AnthropicSystemBlock[] | undefined {
	const { includeClaudeCodeInstruction = false, includeCacheControl = true, extraInstructions = [] } = options;
	const blocks: AnthropicSystemBlock[] = [];
	const sanitizedPrompt = systemPrompt ? sanitizeSurrogates(systemPrompt) : "";
	const hasClaudeCodeInstruction = sanitizedPrompt.includes(claudeCodeSystemInstruction);
	const cacheControl = includeCacheControl ? { type: "ephemeral" as const } : undefined;

	if (includeClaudeCodeInstruction && !hasClaudeCodeInstruction) {
		blocks.push({
			type: "text",
			text: claudeCodeSystemInstruction,
			...(cacheControl ? { cache_control: cacheControl } : {}),
		});
	}

	for (const instruction of extraInstructions) {
		const trimmed = instruction.trim();
		if (!trimmed) continue;
		blocks.push({
			type: "text",
			text: trimmed,
			...(cacheControl ? { cache_control: cacheControl } : {}),
		});
	}

	if (systemPrompt) {
		blocks.push({
			type: "text",
			text: sanitizedPrompt,
			...(cacheControl ? { cache_control: cacheControl } : {}),
		});
	}

	return blocks.length > 0 ? blocks : undefined;
}

function disableThinkingIfToolChoiceForced(params: MessageCreateParamsStreaming): void {
	const toolChoice = params.tool_choice;
	if (!toolChoice) return;
	if (toolChoice.type === "any" || toolChoice.type === "tool") {
		delete params.thinking;
	}
}

function ensureMaxTokensForThinking(params: MessageCreateParamsStreaming, model: Model<"anthropic-messages">): void {
	const thinking = params.thinking;
	if (!thinking || thinking.type !== "enabled") return;

	const budgetTokens = thinking.budget_tokens ?? 0;
	if (budgetTokens <= 0) return;

	const maxTokens = params.max_tokens ?? 0;
	const requiredMaxTokens = model.maxTokens > 0 ? model.maxTokens : budgetTokens + OUTPUT_FALLBACK_BUFFER;
	if (maxTokens < requiredMaxTokens) {
		params.max_tokens = Math.min(requiredMaxTokens, model.maxTokens);
	}
}

function buildParams(
	model: Model<"anthropic-messages">,
	context: Context,
	isOAuthToken: boolean,
	options?: AnthropicOptions,
): MessageCreateParamsStreaming {
	const hasTools = Boolean(context.tools?.length);
	const cacheControlMode = resolveCacheControlMode(context.messages, hasTools && isOAuthToken);
	const params: MessageCreateParamsStreaming = {
		model: model.id,
		messages: convertMessages(context.messages, model, isOAuthToken, cacheControlMode),
		max_tokens: options?.maxTokens || (model.maxTokens / 3) | 0,
		stream: true,
	};

	const includeClaudeCodeSystem = !model.id.startsWith("claude-3-5-haiku");
	const systemBlocks = buildAnthropicSystemBlocks(context.systemPrompt, {
		includeClaudeCodeInstruction: includeClaudeCodeSystem,
		includeCacheControl: cacheControlMode !== "none",
	});
	if (systemBlocks) {
		params.system = systemBlocks;
	}

	if (options?.temperature !== undefined) {
		params.temperature = options.temperature;
	}

	if (context.tools) {
		params.tools = convertTools(context.tools, isOAuthToken);
	}

	if (options?.thinkingEnabled && model.reasoning) {
		params.thinking = {
			type: "enabled",
			budget_tokens: options.thinkingBudgetTokens || 1024,
		};
	}

	if (options?.toolChoice) {
		if (typeof options.toolChoice === "string") {
			params.tool_choice = { type: options.toolChoice };
		} else if (isOAuthToken && options.toolChoice.name) {
			// Prefix tool name in tool_choice for OAuth mode
			params.tool_choice = { ...options.toolChoice, name: applyClaudeToolPrefix(options.toolChoice.name) };
		} else {
			params.tool_choice = options.toolChoice;
		}
	}

	disableThinkingIfToolChoiceForced(params);

	if (!options?.interleavedThinking) {
		ensureMaxTokensForThinking(params, model);
	}

	return params;
}

// Sanitize tool call IDs to match Anthropic's required pattern: ^[a-zA-Z0-9_-]+$
function sanitizeToolCallId(id: string): string {
	// Replace any character that isn't alphanumeric, underscore, or hyphen with underscore
	return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function resolveCacheControlMode(messages: Message[], includeCacheControl: boolean): CacheControlMode {
	if (!includeCacheControl) return "none";

	for (const message of messages) {
		if (message.role === "toolResult") return "toolBlocks";
		if (message.role === "assistant") {
			const hasToolCall = message.content.some((block) => block.type === "toolCall");
			if (hasToolCall) return "toolBlocks";
		}
	}

	return "userText";
}

function convertMessages(
	messages: Message[],
	model: Model<"anthropic-messages">,
	isOAuthToken: boolean,
	cacheControlMode: CacheControlMode,
): MessageParam[] {
	const params: MessageParam[] = [];
	const applyToolCacheControl = cacheControlMode === "toolBlocks";
	const applyUserTextCacheControl = cacheControlMode === "userText";
	const withCacheControl = <T extends object>(block: T, enabled: boolean): T | (T & CacheControlBlock) => {
		if (!enabled) return block;
		return { ...block, cache_control: cacheControlEphemeral };
	};

	// Transform messages for cross-provider compatibility
	const transformedMessages = transformMessages(messages, model);

	for (let i = 0; i < transformedMessages.length; i++) {
		const msg = transformedMessages[i];

		if (msg.role === "user") {
			if (typeof msg.content === "string") {
				if (msg.content.trim().length > 0) {
					const text = sanitizeSurrogates(msg.content);
					if (applyUserTextCacheControl) {
						const blocks: Array<ContentBlockParam & CacheControlBlock> = [
							withCacheControl(
								{
									type: "text",
									text,
								},
								true,
							),
						];
						params.push({
							role: "user",
							content: blocks,
						});
					} else {
						params.push({
							role: "user",
							content: text,
						});
					}
				}
			} else {
				const blocks: Array<ContentBlockParam & CacheControlBlock> = msg.content.map((item) => {
					if (item.type === "text") {
						return withCacheControl(
							{
								type: "text",
								text: sanitizeSurrogates(item.text),
							},
							applyUserTextCacheControl,
						);
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
				let filteredBlocks = !model?.input.includes("image") ? blocks.filter((b) => b.type !== "image") : blocks;
				filteredBlocks = filteredBlocks.filter((b) => {
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
			const blocks: Array<ContentBlockParam & CacheControlBlock> = [];

			for (const block of msg.content) {
				if (block.type === "text") {
					if (block.text.trim().length === 0) continue;
					blocks.push({
						type: "text",
						text: sanitizeSurrogates(block.text),
					});
				} else if (block.type === "thinking") {
					if (block.thinking.trim().length === 0) continue;
					// If thinking signature is missing/empty (e.g., from aborted stream),
					// convert to plain text block without <thinking> tags to avoid API rejection
					// and prevent Claude from mimicking the tags in responses
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
					blocks.push(
						withCacheControl(
							{
								type: "tool_use",
								id: sanitizeToolCallId(block.id),
								name: isOAuthToken ? toClaudeCodeName(block.name) : block.name,
								input: block.arguments,
							},
							applyToolCacheControl,
						),
					);
				}
			}
			if (blocks.length === 0) continue;
			params.push({
				role: "assistant",
				content: blocks,
			});
		} else if (msg.role === "toolResult") {
			// Collect all consecutive toolResult messages, needed for z.ai Anthropic endpoint
			const toolResults: Array<ContentBlockParam & CacheControlBlock> = [];

			// Add the current tool result
			toolResults.push(
				withCacheControl(
					{
						type: "tool_result",
						tool_use_id: sanitizeToolCallId(msg.toolCallId),
						content: convertContentBlocks(msg.content),
						is_error: msg.isError,
					},
					applyToolCacheControl,
				),
			);

			// Look ahead for consecutive toolResult messages
			let j = i + 1;
			while (j < transformedMessages.length && transformedMessages[j].role === "toolResult") {
				const nextMsg = transformedMessages[j] as ToolResultMessage; // We know it's a toolResult
				toolResults.push(
					withCacheControl(
						{
							type: "tool_result",
							tool_use_id: sanitizeToolCallId(nextMsg.toolCallId),
							content: convertContentBlocks(nextMsg.content),
							is_error: nextMsg.isError,
						},
						applyToolCacheControl,
					),
				);
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

	return params;
}

function convertTools(tools: Tool[], isOAuthToken: boolean): Anthropic.Messages.Tool[] {
	if (!tools) return [];

	return tools.map((tool) => {
		const jsonSchema = tool.parameters as any; // TypeBox already generates JSON Schema

		return {
			name: isOAuthToken ? toClaudeCodeName(tool.name) : tool.name,
			description: tool.description,
			input_schema: {
				type: "object" as const,
				properties: jsonSchema.properties || {},
				required: jsonSchema.required || [],
			},
		};
	});
}

function mapStopReason(reason: Anthropic.Messages.StopReason): StopReason {
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
		default: {
			const _exhaustive: never = reason;
			throw new Error(`Unhandled stop reason: ${_exhaustive}`);
		}
	}
}
