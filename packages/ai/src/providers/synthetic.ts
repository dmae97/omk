/**
 * Synthetic provider - wraps OpenAI or Anthropic API based on format setting.
 *
 * Synthetic offers both OpenAI-compatible and Anthropic-compatible APIs:
 * - OpenAI: https://api.synthetic.new/v1/chat/completions
 * - Anthropic: https://api.synthetic.new/v1/messages
 *
 * @see https://dev.synthetic.new/docs/api/overview
 */

import type { Api, Context, Model, SimpleStreamOptions } from "../types";
import { AssistantMessageEventStream } from "../utils/event-stream";
import { streamAnthropic } from "./anthropic";
import { streamOpenAICompletions } from "./openai-completions";

export type SyntheticApiFormat = "openai" | "anthropic";

const SYNTHETIC_NEW_BASE_URL = "https://api.synthetic.new/v1";
const SYNTHETIC_NEW_ANTHROPIC_BASE_URL = "https://api.synthetic.new";

// Default thinking budgets for Anthropic format (matches stream.ts)
const DEFAULT_THINKING_BUDGETS = {
	minimal: 1024,
	low: 4096,
	medium: 8192,
	high: 16384,
	xhigh: 32768,
} as const;

export interface SyntheticOptions extends SimpleStreamOptions {
	/** API format: "openai" or "anthropic". Default: "anthropic" */
	format?: SyntheticApiFormat;
}

/**
 * Stream from Synthetic, routing to either OpenAI or Anthropic API based on format.
 * Returns synchronously like other providers - async processing happens internally.
 */
export function streamSynthetic(
	model: Model<"openai-completions">,
	context: Context,
	options?: SyntheticOptions,
): AssistantMessageEventStream {
	const stream = new AssistantMessageEventStream();
	const format = options?.format ?? "anthropic";

	// Async IIFE to handle stream piping
	(async () => {
		try {
			const mergedHeaders = options?.headers ?? {};

			if (format === "anthropic") {
				// Create a synthetic Anthropic model pointing to Synthetic's endpoint
				const anthropicModel: Model<"anthropic-messages"> = {
					id: model.id,
					name: model.name,
					api: "anthropic-messages",
					provider: model.provider,
					baseUrl: SYNTHETIC_NEW_ANTHROPIC_BASE_URL,
					headers: mergedHeaders,
					contextWindow: model.contextWindow,
					maxTokens: model.maxTokens,
					reasoning: model.reasoning,
					input: model.input,
					cost: model.cost,
				};

				// Calculate thinking budget from reasoning level
				const reasoning = options?.reasoning;
				const thinkingEnabled = !!reasoning && model.reasoning;
				const thinkingBudget = reasoning
					? (options?.thinkingBudgets?.[reasoning] ?? DEFAULT_THINKING_BUDGETS[reasoning])
					: undefined;

				const innerStream = streamAnthropic(anthropicModel, context, {
					apiKey: options?.apiKey,
					temperature: options?.temperature,
					maxTokens: options?.maxTokens ?? Math.min(model.maxTokens, 32000),
					signal: options?.signal,
					headers: mergedHeaders,
					sessionId: options?.sessionId,
					onPayload: options?.onPayload,
					thinkingEnabled,
					thinkingBudgetTokens: thinkingBudget,
				});

				for await (const event of innerStream) {
					stream.push(event);
				}
			} else {
				// OpenAI format - use original model with Synthetic headers
				const syntheticModel: Model<"openai-completions"> = {
					...model,
					baseUrl: SYNTHETIC_NEW_BASE_URL,
					headers: mergedHeaders,
				};

				const innerStream = streamOpenAICompletions(syntheticModel, context, {
					apiKey: options?.apiKey,
					temperature: options?.temperature,
					maxTokens: options?.maxTokens ?? model.maxTokens,
					signal: options?.signal,
					headers: mergedHeaders,
					sessionId: options?.sessionId,
					onPayload: options?.onPayload,
					reasoningEffort: options?.reasoning,
				});

				for await (const event of innerStream) {
					stream.push(event);
				}
			}
		} catch (err) {
			stream.push({
				type: "error",
				reason: "error",
				error: createErrorMessage(model, err),
			});
		}
	})();

	return stream;
}

function createErrorMessage(model: Model<Api>, err: unknown) {
	return {
		role: "assistant" as const,
		content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }],
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
		stopReason: "error" as const,
		timestamp: Date.now(),
	};
}

/**
 * Check if a model is a Synthetic model.
 */
export function isSyntheticModel(model: Model<Api>): boolean {
	return model.provider === "synthetic";
}
