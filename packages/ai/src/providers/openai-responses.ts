import { $env } from "@oh-my-pi/pi-utils";
import OpenAI from "openai";
import type {
	Tool as OpenAITool,
	ResponseCreateParamsStreaming,
	ResponseInput,
} from "openai/resources/responses/responses";
import { getEnvApiKey } from "../stream";
import {
	type Api,
	type AssistantMessage,
	type CacheRetention,
	type Context,
	isSpecialServiceTier,
	type MessageAttribution,
	type Model,
	type ServiceTier,
	type StreamFunction,
	type StreamOptions,
	type Tool,
	type ToolChoice,
} from "../types";
import {
	createOpenAIResponsesHistoryPayload,
	getOpenAIResponsesHistoryItems,
	getOpenAIResponsesHistoryPayload,
	resolveCacheRetention,
} from "../utils";
import { AssistantMessageEventStream } from "../utils/event-stream";
import { finalizeErrorMessage, type RawHttpRequestDump } from "../utils/http-inspector";
import { getOpenAIStreamIdleTimeoutMs, iterateWithIdleTimeout } from "../utils/idle-iterator";
import { adaptSchemaForStrict, NO_STRICT } from "../utils/schema";
import { mapToOpenAIResponsesToolChoice } from "../utils/tool-choice";
import {
	buildCopilotDynamicHeaders,
	hasCopilotVisionInput,
	resolveGitHubCopilotBaseUrl,
} from "./github-copilot-headers";
import {
	appendResponsesToolResultMessages,
	collectKnownCallIds,
	convertResponsesAssistantMessage,
	convertResponsesInputContent,
	normalizeResponsesToolCallIdForTransform,
	processResponsesStream,
} from "./openai-responses-shared";
import { transformMessages } from "./transform-messages";

/**
 * Get prompt cache retention based on cacheRetention and base URL.
 * Only applies to direct OpenAI API calls (api.openai.com).
 */
function getPromptCacheRetention(baseUrl: string, cacheRetention: CacheRetention): "24h" | undefined {
	if (cacheRetention !== "long") {
		return undefined;
	}
	if (baseUrl.includes("api.openai.com")) {
		return "24h";
	}
	return undefined;
}

// OpenAI Responses-specific options
export interface OpenAIResponsesOptions extends StreamOptions {
	reasoning?: "minimal" | "low" | "medium" | "high" | "xhigh";
	reasoningSummary?: "auto" | "detailed" | "concise" | null;
	serviceTier?: ServiceTier;
	toolChoice?: ToolChoice;
	/**
	 * Enforce strict tool call/result pairing when building Responses API inputs.
	 * Azure OpenAI and GitHub Copilot Responses paths require tool results to match prior tool calls.
	 */
	strictResponsesPairing?: boolean;
}

type OpenAIResponsesSamplingParams = ResponseCreateParamsStreaming & {
	top_p?: number;
	top_k?: number;
	min_p?: number;
	presence_penalty?: number;
	repetition_penalty?: number;
};

/**
 * Generate function for OpenAI Responses API
 */
export const streamOpenAIResponses: StreamFunction<"openai-responses"> = (
	model: Model<"openai-responses">,
	context: Context,
	options?: OpenAIResponsesOptions,
): AssistantMessageEventStream => {
	const stream = new AssistantMessageEventStream();

	// Start async processing
	(async () => {
		const startTime = Date.now();
		let firstTokenTime: number | undefined;

		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: "openai-responses" as Api,
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
			// Create OpenAI client
			const apiKey = options?.apiKey || getEnvApiKey(model.provider) || "";
			const { client, copilotPremiumRequests, baseUrl } = createClient(
				model,
				context,
				apiKey,
				options?.headers,
				options?.initiatorOverride,
			);
			const { params } = buildParams(model, context, options);
			const requestAbortController = new AbortController();
			const requestSignal = options?.signal
				? AbortSignal.any([options.signal, requestAbortController.signal])
				: requestAbortController.signal;
			options?.onPayload?.(params);
			rawRequestDump = {
				provider: model.provider,
				api: output.api,
				model: model.id,
				method: "POST",
				url: `${baseUrl ?? "https://api.openai.com/v1"}/responses`,
				body: params,
			};
			const openaiStream = await client.responses.create(params, { signal: requestSignal });
			if (copilotPremiumRequests !== undefined) output.usage.premiumRequests = copilotPremiumRequests;
			stream.push({ type: "start", partial: output });

			const nativeOutputItems: Array<Record<string, unknown>> = [];
			await processResponsesStream(
				iterateWithIdleTimeout(openaiStream, {
					idleTimeoutMs: getOpenAIStreamIdleTimeoutMs(),
					errorMessage: "OpenAI responses stream stalled while waiting for the next event",
					onIdle: () => requestAbortController.abort(),
				}),
				output,
				stream,
				model,
				{
					onFirstToken: () => {
						if (!firstTokenTime) firstTokenTime = Date.now();
					},
					onOutputItemDone: item => {
						nativeOutputItems.push(structuredClone(item as unknown as Record<string, unknown>));
					},
				},
			);
			if (copilotPremiumRequests !== undefined) output.usage.premiumRequests = copilotPremiumRequests;

			if (options?.signal?.aborted) {
				throw new Error("Request was aborted");
			}

			if (output.stopReason === "aborted" || output.stopReason === "error") {
				throw new Error("An unknown error occurred");
			}

			output.providerPayload = createOpenAIResponsesHistoryPayload(model.provider, nativeOutputItems);

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

function createClient(
	model: Model<"openai-responses">,
	context: Context,
	apiKey?: string,
	extraHeaders?: Record<string, string>,
	initiatorOverride?: MessageAttribution,
): {
	client: OpenAI;
	copilotPremiumRequests: number | undefined;
	baseUrl: string | undefined;
} {
	if (!apiKey) {
		if (!$env.OPENAI_API_KEY) {
			throw new Error(
				"OpenAI API key is required. Set OPENAI_API_KEY environment variable or pass it as an argument.",
			);
		}
		apiKey = $env.OPENAI_API_KEY;
	}

	const headers = { ...(model.headers ?? {}), ...(extraHeaders ?? {}) };
	let copilotPremiumRequests: number | undefined;

	let baseUrl = model.baseUrl;
	if (model.provider === "github-copilot") {
		const hasImages = hasCopilotVisionInput(context.messages);
		const copilot = buildCopilotDynamicHeaders({
			messages: context.messages,
			hasImages,
			premiumMultiplier: model.premiumMultiplier,
			headers,
			initiatorOverride,
		});
		Object.assign(headers, copilot.headers);
		copilotPremiumRequests = copilot.premiumRequests;
		baseUrl = resolveGitHubCopilotBaseUrl(model.baseUrl, apiKey) ?? model.baseUrl;
	}
	return {
		client: new OpenAI({
			apiKey,
			baseURL: baseUrl,
			dangerouslyAllowBrowser: true,
			maxRetries: 5,
			defaultHeaders: headers,
		}),
		copilotPremiumRequests,
		baseUrl,
	};
}

function buildParams(
	model: Model<"openai-responses">,
	context: Context,
	options?: OpenAIResponsesOptions,
): { conversationMessages: ResponseInput; params: OpenAIResponsesSamplingParams } {
	const strictResponsesPairing =
		options?.strictResponsesPairing ??
		(isAzureOpenAIBaseUrl(model.baseUrl ?? "") || model.provider === "github-copilot");
	const conversationMessages = convertConversationMessages(model, context, strictResponsesPairing);
	const messages: ResponseInput = [...conversationMessages];

	if (context.systemPrompt) {
		const role = model.reasoning ? "developer" : "system";
		messages.unshift({
			role,
			content: context.systemPrompt.toWellFormed(),
		});
	}

	const cacheRetention = resolveCacheRetention(options?.cacheRetention);
	const promptCacheKey = cacheRetention === "none" ? undefined : options?.sessionId;
	const params: OpenAIResponsesSamplingParams = {
		model: model.id,
		input: messages,
		stream: true,
		prompt_cache_key: promptCacheKey,
		prompt_cache_retention: promptCacheKey ? getPromptCacheRetention(model.baseUrl, cacheRetention) : undefined,
		store: false,
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
	if (isSpecialServiceTier(options?.serviceTier)) {
		params.service_tier = options.serviceTier;
	}

	if (context.tools) {
		params.tools = convertTools(context.tools, supportsStrictMode(model));
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

		if (options?.reasoning || options?.reasoningSummary) {
			params.reasoning = {
				effort: options?.reasoning || "medium",
				summary: options?.reasoningSummary || "auto",
			};
		} else if (model.name.startsWith("gpt-5")) {
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

	return { conversationMessages, params };
}

function isAzureOpenAIBaseUrl(baseUrl: string): boolean {
	return baseUrl.includes(".openai.azure.com") || baseUrl.includes("azure.com/openai");
}

function supportsStrictMode(model: Model<"openai-responses">): boolean {
	if (model.provider === "openai" || model.provider === "azure" || model.provider === "github-copilot") return true;

	const baseUrl = model.baseUrl.toLowerCase();
	return (
		baseUrl.includes("api.openai.com") ||
		baseUrl.includes(".openai.azure.com") ||
		baseUrl.includes("models.inference.ai.azure.com")
	);
}

function convertConversationMessages(
	model: Model<"openai-responses">,
	context: Context,
	strictResponsesPairing: boolean,
): ResponseInput {
	const messages: ResponseInput = [];
	let knownCallIds = new Set<string>();
	const transformedMessages = transformMessages(context.messages, model, normalizeResponsesToolCallIdForTransform);

	let msgIndex = 0;
	for (const msg of transformedMessages) {
		if (msg.role === "user" || msg.role === "developer") {
			const providerPayload = (msg as { providerPayload?: AssistantMessage["providerPayload"] }).providerPayload;
			const historyItems = getOpenAIResponsesHistoryItems(providerPayload, model.provider) as
				| Array<ResponseInput[number]>
				| undefined;
			if (historyItems) {
				messages.push(...historyItems);
				knownCallIds = collectKnownCallIds(messages);
				msgIndex++;
				continue;
			}
			const content = convertResponsesInputContent(msg.content, model.input.includes("image"));
			if (!content) continue;
			messages.push({ role: "user", content });
		} else if (msg.role === "assistant") {
			const assistantMsg = msg as AssistantMessage;
			const providerPayload = getOpenAIResponsesHistoryPayload(
				assistantMsg.providerPayload,
				model.provider,
				assistantMsg.provider,
			);
			const historyItems = providerPayload?.items as Array<ResponseInput[number]> | undefined;
			if (historyItems) {
				if (providerPayload?.dt) {
					messages.push(...historyItems);
				} else {
					messages.splice(0, messages.length, ...historyItems);
				}
				knownCallIds = collectKnownCallIds(messages);
				msgIndex++;
				continue;
			}

			const outputItems = convertResponsesAssistantMessage(assistantMsg, model, msgIndex, knownCallIds);
			if (outputItems.length === 0) continue;
			messages.push(...outputItems);
		} else if (msg.role === "toolResult") {
			appendResponsesToolResultMessages(messages, msg, model, strictResponsesPairing, knownCallIds);
		}
		msgIndex++;
	}

	return messages;
}

function convertTools(tools: Tool[], strictMode: boolean): OpenAITool[] {
	return tools.map(tool => {
		const strict = !NO_STRICT && strictMode && tool.strict !== false;
		const baseParameters = tool.parameters as unknown as Record<string, unknown>;
		const { schema: parameters, strict: effectiveStrict } = adaptSchemaForStrict(baseParameters, strict);
		return {
			type: "function",
			name: tool.name,
			description: tool.description || "",
			parameters,
			...(effectiveStrict && { strict: true }),
		} as OpenAITool;
	});
}
