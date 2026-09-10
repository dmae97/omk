import type { Model, OpenAICompletionsCompat } from "../src/types.ts";

export const DEEPSEEK_COMPLETIONS_COMPAT = {
	requiresReasoningContentOnAssistantMessages: true,
	thinkingFormat: "deepseek",
} as const satisfies OpenAICompletionsCompat;

/** Native IDs from https://api-docs.deepseek.com/quick_start/pricing (2026-09-10).
 * Static cost uses peak rates; the numeric model schema cannot express time windows.
 */
export function deepSeekNativeModels(): Model<"openai-completions">[] {
	const flash: Model<"openai-completions"> = {
		id: "deepseek-flash",
		name: "DeepSeek V4.1 Flash",
		api: "openai-completions",
		baseUrl: "https://api.deepseek.com",
		provider: "deepseek",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0 },
		contextWindow: 1000000,
		maxTokens: 384000,
		compat: { ...DEEPSEEK_COMPLETIONS_COMPAT, maxTokensField: "max_tokens" },
	};
	return [
		flash,
		{
			...flash,
			id: "deepseek-v4-flash",
			name: "DeepSeek V4.1 Flash (legacy alias)",
			cost: { ...flash.cost },
			compat: { ...flash.compat },
		},
		{
			id: "deepseek-v4-pro",
			name: "DeepSeek V4 Pro",
			api: "openai-completions",
			baseUrl: "https://api.deepseek.com",
			provider: "deepseek",
			reasoning: true,
			input: ["text"],
			cost: { input: 1.32, output: 3.96, cacheRead: 0.044, cacheWrite: 0 },
			contextWindow: 1000000,
			maxTokens: 384000,
			compat: { ...DEEPSEEK_COMPLETIONS_COMPAT },
		},
	];
}
