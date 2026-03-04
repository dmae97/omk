import { $env } from "@oh-my-pi/pi-utils";
import type OpenAI from "openai";
import { AzureOpenAI } from "openai";
import type {
	Tool as OpenAITool,
	ResponseCreateParamsStreaming,
	ResponseFunctionToolCall,
	ResponseInput,
	ResponseInputContent,
	ResponseInputImage,
	ResponseInputText,
	ResponseOutputMessage,
	ResponseReasoningItem,
} from "openai/resources/responses/responses";
import { calculateCost } from "../models";
import { getEnvApiKey } from "../stream";
import type {
	Api,
	AssistantMessage,
	Context,
	ImageContent,
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
import { normalizeResponsesToolCallId } from "../utils";
import { AssistantMessageEventStream } from "../utils/event-stream";
import { finalizeErrorMessage, type RawHttpRequestDump } from "../utils/http-inspector";
import { parseStreamingJson } from "../utils/json-parse";
import { mapToOpenAIResponsesToolChoice } from "../utils/tool-choice";
import { transformMessages } from "./transform-messages";

const DEFAULT_AZURE_API_VERSION = "v1";

function parseDeploymentNameMap(value: string | undefined): Map<string, string> {
	const map = new Map<string, string>();
	if (!value) return map;
	for (const entry of value.split(",")) {
		const trimmed = entry.trim();
		if (!trimmed) continue;
		const [modelId, deploymentName] = trimmed.split("=", 2);
		if (!modelId || !deploymentName) continue;
		map.set(modelId.trim(), deploymentName.trim());
	}
	return map;
}

function resolveDeploymentName(model: Model<"azure-openai-responses">, options?: AzureOpenAIResponsesOptions): string {
	if (options?.azureDeploymentName) {
		return options.azureDeploymentName;
	}
	const mappedDeployment = parseDeploymentNameMap($env.AZURE_OPENAI_DEPLOYMENT_NAME_MAP).get(model.id);
	return mappedDeployment ?? model.id;
}

// Azure OpenAI Responses-specific options
export interface AzureOpenAIResponsesOptions extends StreamOptions {
	reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
	reasoningSummary?: "auto" | "detailed" | "concise" | null;
	azureApiVersion?: string;
	azureResourceName?: string;
	azureBaseUrl?: string;
	azureDeploymentName?: string;
	toolChoice?: ToolChoice;
}

type AzureOpenAIResponsesSamplingParams = ResponseCreateParamsStreaming & {
	top_p?: number;
	top_k?: number;
	min_p?: number;
	presence_penalty?: number;
	repetition_penalty?: number;
};

/**
 * Generate function for Azure OpenAI Responses API
 */
export const streamAzureOpenAIResponses: StreamFunction<"azure-openai-responses"> = (
	model: Model<"azure-openai-responses">,
	context: Context,
	options?: AzureOpenAIResponsesOptions,
): AssistantMessageEventStream => {
	const stream = new AssistantMessageEventStream();

	// Start async processing
	(async () => {
		const startTime = Date.now();
		let firstTokenTime: number | undefined;
		const deploymentName = resolveDeploymentName(model, options);

		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: "azure-openai-responses" as Api,
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
			// Create Azure OpenAI client
			const apiKey = options?.apiKey || getEnvApiKey(model.provider) || "";
			const client = createClient(model, apiKey, options);
			const params = buildParams(model, context, options, deploymentName);
			options?.onPayload?.(params);
			rawRequestDump = {
				provider: model.provider,
				api: output.api,
				model: model.id,
				method: "POST",
				url: `${resolveAzureConfig(model, options).baseUrl}/responses`,
				body: params,
			};
			const openaiStream = await client.responses.create(
				params,
				options?.signal ? { signal: options.signal } : undefined,
			);
			stream.push({ type: "start", partial: output });

			let currentItem: ResponseReasoningItem | ResponseOutputMessage | ResponseFunctionToolCall | null = null;
			let currentBlock: ThinkingContent | TextContent | (ToolCall & { partialJson: string }) | null = null;
			const blocks = output.content;
			const blockIndex = () => blocks.length - 1;

			for await (const event of openaiStream) {
				// Handle output item start
				if (event.type === "response.output_item.added") {
					if (!firstTokenTime) firstTokenTime = Date.now();
					const item = event.item;
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
				}
				// Handle reasoning summary deltas
				else if (event.type === "response.reasoning_summary_part.added") {
					if (currentItem && currentItem.type === "reasoning") {
						currentItem.summary = currentItem.summary || [];
						currentItem.summary.push(event.part);
					}
				} else if (event.type === "response.reasoning_summary_text.delta") {
					if (
						currentItem &&
						currentItem.type === "reasoning" &&
						currentBlock &&
						currentBlock.type === "thinking"
					) {
						currentItem.summary = currentItem.summary || [];
						const lastPart = currentItem.summary[currentItem.summary.length - 1];
						if (lastPart) {
							currentBlock.thinking += event.delta;
							lastPart.text += event.delta;
							stream.push({
								type: "thinking_delta",
								contentIndex: blockIndex(),
								delta: event.delta,
								partial: output,
							});
						}
					}
				}
				// Add a new line between summary parts (hack...)
				else if (event.type === "response.reasoning_summary_part.done") {
					if (
						currentItem &&
						currentItem.type === "reasoning" &&
						currentBlock &&
						currentBlock.type === "thinking"
					) {
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
				}
				// Handle text output deltas
				else if (event.type === "response.content_part.added") {
					if (currentItem && currentItem.type === "message") {
						currentItem.content = currentItem.content || [];
						// Filter out ReasoningText, only accept output_text and refusal
						if (event.part.type === "output_text" || event.part.type === "refusal") {
							currentItem.content.push(event.part);
						}
					}
				} else if (event.type === "response.output_text.delta") {
					if (currentItem && currentItem.type === "message" && currentBlock && currentBlock.type === "text") {
						if (!currentItem.content || currentItem.content.length === 0) {
							continue;
						}
						const lastPart = currentItem.content[currentItem.content.length - 1];
						if (lastPart && lastPart.type === "output_text") {
							currentBlock.text += event.delta;
							lastPart.text += event.delta;
							stream.push({
								type: "text_delta",
								contentIndex: blockIndex(),
								delta: event.delta,
								partial: output,
							});
						}
					}
				} else if (event.type === "response.refusal.delta") {
					if (currentItem && currentItem.type === "message" && currentBlock && currentBlock.type === "text") {
						if (!currentItem.content || currentItem.content.length === 0) {
							continue;
						}
						const lastPart = currentItem.content[currentItem.content.length - 1];
						if (lastPart && lastPart.type === "refusal") {
							currentBlock.text += event.delta;
							lastPart.refusal += event.delta;
							stream.push({
								type: "text_delta",
								contentIndex: blockIndex(),
								delta: event.delta,
								partial: output,
							});
						}
					}
				}
				// Handle function call argument deltas
				else if (event.type === "response.function_call_arguments.delta") {
					if (
						currentItem &&
						currentItem.type === "function_call" &&
						currentBlock &&
						currentBlock.type === "toolCall"
					) {
						currentBlock.partialJson += event.delta;
						currentBlock.arguments = parseStreamingJson(currentBlock.partialJson);
						stream.push({
							type: "toolcall_delta",
							contentIndex: blockIndex(),
							delta: event.delta,
							partial: output,
						});
					}
				}
				// Handle function call arguments done (some providers send this instead of deltas)
				else if (event.type === "response.function_call_arguments.done") {
					if (currentItem?.type === "function_call" && currentBlock?.type === "toolCall") {
						currentBlock.partialJson = event.arguments;
						currentBlock.arguments = parseStreamingJson(currentBlock.partialJson);
					}
				}
				// Handle output item completion
				else if (event.type === "response.output_item.done") {
					const item = event.item;

					if (item.type === "reasoning" && currentBlock && currentBlock.type === "thinking") {
						currentBlock.thinking = item.summary?.map(s => s.text).join("\n\n") || "";
						currentBlock.thinkingSignature = JSON.stringify(item);
						stream.push({
							type: "thinking_end",
							contentIndex: blockIndex(),
							content: currentBlock.thinking,
							partial: output,
						});
						currentBlock = null;
					} else if (item.type === "message" && currentBlock && currentBlock.type === "text") {
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
						const args =
							currentBlock?.type === "toolCall" && currentBlock.partialJson
								? JSON.parse(currentBlock.partialJson)
								: JSON.parse(item.arguments);
						const toolCall: ToolCall = {
							type: "toolCall",
							id: `${item.call_id}|${item.id}`,
							name: item.name,
							arguments: args,
						};
						currentBlock = null;
						stream.push({ type: "toolcall_end", contentIndex: blockIndex(), toolCall, partial: output });
					}
				}
				// Handle completion
				else if (event.type === "response.completed") {
					const response = event.response;
					if (response?.usage) {
						const cachedTokens = response.usage.input_tokens_details?.cached_tokens || 0;
						output.usage = {
							// OpenAI includes cached tokens in input_tokens, so subtract to get non-cached input
							input: (response.usage.input_tokens || 0) - cachedTokens,
							output: response.usage.output_tokens || 0,
							cacheRead: cachedTokens,
							cacheWrite: 0,
							totalTokens: response.usage.total_tokens || 0,
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
						};
					}
					calculateCost(model, output.usage);
					// Map status to stop reason
					output.stopReason = mapStopReason(response?.status);
					if (output.content.some(b => b.type === "toolCall") && output.stopReason === "stop") {
						output.stopReason = "toolUse";
					}
				}
				// Handle errors
				else if (event.type === "error") {
					throw new Error(`Error Code ${event.code}: ${event.message}` || "Unknown error");
				} else if (event.type === "response.failed") {
					throw new Error("Unknown error");
				}
			}

			if (options?.signal?.aborted) {
				throw new Error("Request was aborted");
			}

			if (output.stopReason === "aborted" || output.stopReason === "error") {
				throw new Error("An unknown error occurred");
			}

			output.duration = Date.now() - startTime;
			if (firstTokenTime) output.ttft = firstTokenTime - startTime;
			stream.push({ type: "done", reason: output.stopReason, message: output });
			stream.end();
		} catch (error) {
			for (const block of output.content) delete (block as { index?: number }).index;
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

function normalizeAzureBaseUrl(baseUrl: string): string {
	return baseUrl.replace(/\/+$/, "");
}

function buildDefaultBaseUrl(resourceName: string): string {
	return `https://${resourceName}.openai.azure.com/openai/v1`;
}

function resolveAzureConfig(
	model: Model<"azure-openai-responses">,
	options?: AzureOpenAIResponsesOptions,
): { baseUrl: string; apiVersion: string } {
	const apiVersion = options?.azureApiVersion || $env.AZURE_OPENAI_API_VERSION || DEFAULT_AZURE_API_VERSION;

	const baseUrl = options?.azureBaseUrl?.trim() || $env.AZURE_OPENAI_BASE_URL?.trim() || undefined;
	const resourceName = options?.azureResourceName || $env.AZURE_OPENAI_RESOURCE_NAME;

	let resolvedBaseUrl = baseUrl;

	if (!resolvedBaseUrl && resourceName) {
		resolvedBaseUrl = buildDefaultBaseUrl(resourceName);
	}

	if (!resolvedBaseUrl && model.baseUrl) {
		resolvedBaseUrl = model.baseUrl;
	}

	if (!resolvedBaseUrl) {
		throw new Error(
			"Azure OpenAI base URL is required. Set AZURE_OPENAI_BASE_URL or AZURE_OPENAI_RESOURCE_NAME, or pass azureBaseUrl, azureResourceName, or model.baseUrl.",
		);
	}

	return {
		baseUrl: normalizeAzureBaseUrl(resolvedBaseUrl),
		apiVersion,
	};
}

function createClient(model: Model<"azure-openai-responses">, apiKey: string, options?: AzureOpenAIResponsesOptions) {
	if (!apiKey) {
		const envKey = $env.AZURE_OPENAI_API_KEY;
		if (!envKey) {
			throw new Error(
				"Azure OpenAI API key is required. Set AZURE_OPENAI_API_KEY environment variable or pass it as an argument.",
			);
		}
		apiKey = envKey;
	}

	const headers = { ...(model.headers ?? {}) };

	if (options?.headers) {
		Object.assign(headers, options.headers);
	}

	const { baseUrl, apiVersion } = resolveAzureConfig(model, options);

	return new AzureOpenAI({
		apiKey,
		apiVersion,
		dangerouslyAllowBrowser: true,
		maxRetries: 5,
		defaultHeaders: headers,
		baseURL: baseUrl,
	});
}

function buildParams(
	model: Model<"azure-openai-responses">,
	context: Context,
	options: AzureOpenAIResponsesOptions | undefined,
	deploymentName: string,
) {
	const messages = convertMessages(model, context, true);

	const params: AzureOpenAIResponsesSamplingParams = {
		model: deploymentName,
		input: messages,
		stream: true,
		prompt_cache_key: options?.sessionId,
	};

	if (options?.maxTokens) {
		params.max_output_tokens = options?.maxTokens;
	}

	if (options?.temperature !== undefined) {
		params.temperature = options?.temperature;
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

	if (context.tools) {
		params.tools = convertTools(context.tools);
		if (options?.toolChoice) {
			params.tool_choice = mapToOpenAIResponsesToolChoice(options.toolChoice);
		}
	}

	if (model.reasoning) {
		// Always request encrypted reasoning content so reasoning items can be
		// replayed in multi-turn conversations when store is false (items aren't
		// persisted server-side, so we must include the full content).
		// See: https://github.com/can1357/oh-my-pi/issues/41
		params.include = ["reasoning.encrypted_content"];

		if (options?.reasoningEffort || options?.reasoningSummary) {
			params.reasoning = {
				effort: options?.reasoningEffort || "medium",
				summary: options?.reasoningSummary || "auto",
			};
		} else {
			if (model.name.toLowerCase().startsWith("gpt-5")) {
				// Jesus Christ, see https://community.openai.com/t/need-reasoning-false-option-for-gpt-5/1351588/7
				messages.push({
					role: "developer",
					content: [
						{
							type: "input_text",
							text: "# Juice: 0 !important",
						},
					],
				});
			}
		}
	}

	return params;
}

function convertMessages(
	model: Model<"azure-openai-responses">,
	context: Context,
	strictResponsesPairing: boolean,
): ResponseInput {
	const messages: ResponseInput = [];
	const knownCallIds = new Set<string>();

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

	if (context.systemPrompt) {
		const role = model.reasoning ? "developer" : "system";
		messages.push({
			role,
			content: context.systemPrompt.toWellFormed(),
		});
	}

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
			const devRole = "user";
			if (typeof msg.content === "string") {
				if (!msg.content || msg.content.trim() === "") continue;
				messages.push({
					role: devRole,
					content: msg.content.toWellFormed(),
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
					role: devRole,
					content: filteredContent,
				});
			}
		} else if (msg.role === "assistant") {
			const output: ResponseInput = [];
			const assistantMsg = msg as AssistantMessage;

			// Check if this message is from a different model (same provider, different model ID).
			// For such messages, tool call IDs with fc_ prefix need to be stripped to avoid
			// OpenAI's reasoning/function_call pairing validation errors.
			const isDifferentModel =
				assistantMsg.model !== model.id &&
				assistantMsg.provider === model.provider &&
				assistantMsg.api === model.api;

			for (const block of msg.content) {
				// Do not submit thinking blocks if the completion had an error (i.e. abort)
				if (block.type === "thinking" && msg.stopReason !== "error") {
					if (block.thinkingSignature) {
						const reasoningItem = JSON.parse(block.thinkingSignature);
						output.push(reasoningItem);
					}
				} else if (block.type === "text") {
					const textBlock = block as TextContent;
					// OpenAI requires id to be max 64 characters
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
					// Do not submit toolcall blocks if the completion had an error (i.e. abort)
				} else if (block.type === "toolCall" && msg.stopReason !== "error") {
					const toolCall = block as ToolCall;
					const normalized = normalizeResponsesToolCallId(toolCall.id);
					const callId = normalized.callId;
					// For different-model messages, set id to undefined to avoid pairing validation.
					// OpenAI tracks which fc_xxx IDs were paired with rs_xxx reasoning items.
					// By omitting the id, we avoid triggering that validation (like cross-provider does).
					let itemId: string | undefined = normalized.itemId;
					if (isDifferentModel && itemId?.startsWith("fc_")) {
						itemId = undefined;
					}
					knownCallIds.add(normalized.callId);
					output.push({
						type: "function_call",
						id: itemId,
						call_id: callId,
						name: toolCall.name,
						arguments: JSON.stringify(toolCall.arguments),
					});
				}
			}
			if (output.length === 0) continue;
			messages.push(...output);
		} else if (msg.role === "toolResult") {
			// Extract text and image content
			const textResult = msg.content
				.filter(c => c.type === "text")
				.map(c => (c as { text: string }).text)
				.join("\n");
			const hasImages = msg.content.some(c => c.type === "image");
			const normalized = normalizeResponsesToolCallId(msg.toolCallId);
			if (strictResponsesPairing && !knownCallIds.has(normalized.callId)) {
				continue;
			}

			// Always send function_call_output with text (or placeholder if only images)
			const hasText = textResult.length > 0;
			messages.push({
				type: "function_call_output",
				call_id: normalized.callId,
				output: (hasText ? textResult : "(see attached image)").toWellFormed(),
			});

			// If there are images and model supports them, send a follow-up user message with images
			if (hasImages && model.input.includes("image")) {
				const contentParts: ResponseInputContent[] = [];

				// Add text prefix
				contentParts.push({
					type: "input_text",
					text: "Attached image(s) from tool result:",
				} satisfies ResponseInputText);

				// Add images
				for (const block of msg.content) {
					if (block.type === "image") {
						contentParts.push({
							type: "input_image",
							detail: "auto",
							image_url: `data:${(block as ImageContent).mimeType};base64,${(block as ImageContent).data}`,
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

function convertTools(tools: Tool[]): OpenAITool[] {
	return tools.map(tool => ({
		type: "function",
		name: tool.name,
		description: tool.description || "",
		parameters: tool.parameters as Record<string, unknown>,
		strict: false,
	}));
}

function mapStopReason(status: OpenAI.Responses.ResponseStatus | undefined): StopReason {
	if (!status) return "stop";
	switch (status) {
		case "completed":
			return "stop";
		case "incomplete":
			return "length";
		case "failed":
		case "cancelled":
			return "error";
		// These two are wonky ...
		case "in_progress":
		case "queued":
			return "stop";
		default: {
			const _exhaustive: never = status;
			throw new Error(`Unhandled stop reason: ${_exhaustive}`);
		}
	}
}
