import type { Model, OpenAICompat } from "../types";

type OpenAIReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

export type ResolvedOpenAICompat = Required<
	Omit<OpenAICompat, "openRouterRouting" | "vercelGatewayRouting" | "extraBody">
> & {
	openRouterRouting?: OpenAICompat["openRouterRouting"];
	vercelGatewayRouting?: OpenAICompat["vercelGatewayRouting"];
	extraBody?: OpenAICompat["extraBody"];
};

function detectStrictModeSupport(provider: string, baseUrl: string): boolean {
	if (
		provider === "openai" ||
		provider === "cerebras" ||
		provider === "together" ||
		provider === "github-copilot" ||
		provider === "zenmux"
	) {
		return true;
	}

	const normalizedBaseUrl = baseUrl.toLowerCase();
	return (
		normalizedBaseUrl.includes("api.openai.com") ||
		normalizedBaseUrl.includes(".openai.azure.com") ||
		normalizedBaseUrl.includes("models.inference.ai.azure.com") ||
		normalizedBaseUrl.includes("api.cerebras.ai") ||
		normalizedBaseUrl.includes("api.together.xyz") ||
		normalizedBaseUrl.includes("api.deepseek.com") ||
		normalizedBaseUrl.includes("deepseek.com")
	);
}

/**
 * Detect compatibility settings from provider and baseUrl for known providers.
 * Provider takes precedence over URL-based detection since it's explicitly configured.
 */
export function detectOpenAICompat(model: Model<"openai-completions">): ResolvedOpenAICompat {
	const provider = model.provider;
	const baseUrl = model.baseUrl;

	const isCerebras = provider === "cerebras" || baseUrl.includes("cerebras.ai");
	const isZai = provider === "zai" || baseUrl.includes("api.z.ai");
	const isOpenRouterKimi = provider === "openrouter" && model.id.includes("moonshotai/kimi");
	const isAlibaba = provider === "alibaba-coding-plan" || baseUrl.includes("dashscope");
	const isQwen = model.id.toLowerCase().includes("qwen");

	const isNonStandard =
		isCerebras ||
		provider === "xai" ||
		baseUrl.includes("api.x.ai") ||
		provider === "mistral" ||
		baseUrl.includes("mistral.ai") ||
		baseUrl.includes("chutes.ai") ||
		baseUrl.includes("deepseek.com") ||
		isAlibaba ||
		isZai ||
		isQwen ||
		provider === "opencode-zen" ||
		provider === "opencode-go" ||
		baseUrl.includes("opencode.ai");

	const useMaxTokens = provider === "mistral" || baseUrl.includes("mistral.ai") || baseUrl.includes("chutes.ai");
	const isGrok = provider === "xai" || baseUrl.includes("api.x.ai");
	const isMistral = provider === "mistral" || baseUrl.includes("mistral.ai");

	const reasoningEffortMap: NonNullable<OpenAICompat["reasoningEffortMap"]> =
		provider === "groq" && model.id === "qwen/qwen3-32b"
			? ({
					minimal: "default",
					low: "default",
					medium: "default",
					high: "default",
					xhigh: "default",
				} satisfies Partial<Record<OpenAIReasoningEffort, string>>)
			: {};

	return {
		supportsStore: !isNonStandard,
		supportsDeveloperRole: !isNonStandard,
		supportsReasoningEffort: !isGrok && !isZai,
		reasoningEffortMap,
		supportsUsageInStreaming: !isCerebras,
		supportsToolChoice: true,
		maxTokensField: useMaxTokens ? "max_tokens" : "max_completion_tokens",
		requiresToolResultName: isMistral,
		requiresAssistantAfterToolResult: false,
		requiresThinkingAsText: isMistral,
		requiresMistralToolIds: isMistral,
		thinkingFormat: isZai ? "zai" : isAlibaba || isQwen ? "qwen" : "openai",
		reasoningContentField: "reasoning_content",
		requiresReasoningContentForToolCalls: isOpenRouterKimi,
		requiresAssistantContentForToolCalls: isOpenRouterKimi,
		openRouterRouting: undefined,
		vercelGatewayRouting: undefined,
		supportsStrictMode: detectStrictModeSupport(provider, baseUrl),
		extraBody: undefined,
	};
}

/**
 * Resolve compatibility settings by layering explicit model.compat overrides onto
 * the detected defaults. This is the canonical compat view for both metadata and transport.
 */
export function resolveOpenAICompat(model: Model<"openai-completions">): ResolvedOpenAICompat {
	const detected = detectOpenAICompat(model);
	if (!model.compat) {
		return detected;
	}

	return {
		supportsStore: model.compat.supportsStore ?? detected.supportsStore,
		supportsDeveloperRole: model.compat.supportsDeveloperRole ?? detected.supportsDeveloperRole,
		supportsReasoningEffort: model.compat.supportsReasoningEffort ?? detected.supportsReasoningEffort,
		reasoningEffortMap: model.compat.reasoningEffortMap ?? detected.reasoningEffortMap,
		supportsUsageInStreaming: model.compat.supportsUsageInStreaming ?? detected.supportsUsageInStreaming,
		supportsToolChoice: model.compat.supportsToolChoice ?? detected.supportsToolChoice,
		maxTokensField: model.compat.maxTokensField ?? detected.maxTokensField,
		requiresToolResultName: model.compat.requiresToolResultName ?? detected.requiresToolResultName,
		requiresAssistantAfterToolResult:
			model.compat.requiresAssistantAfterToolResult ?? detected.requiresAssistantAfterToolResult,
		requiresThinkingAsText: model.compat.requiresThinkingAsText ?? detected.requiresThinkingAsText,
		requiresMistralToolIds: model.compat.requiresMistralToolIds ?? detected.requiresMistralToolIds,
		thinkingFormat: model.compat.thinkingFormat ?? detected.thinkingFormat,
		reasoningContentField: model.compat.reasoningContentField ?? detected.reasoningContentField,
		requiresReasoningContentForToolCalls:
			model.compat.requiresReasoningContentForToolCalls ?? detected.requiresReasoningContentForToolCalls,
		requiresAssistantContentForToolCalls:
			model.compat.requiresAssistantContentForToolCalls ?? detected.requiresAssistantContentForToolCalls,
		openRouterRouting: model.compat.openRouterRouting ?? detected.openRouterRouting,
		vercelGatewayRouting: model.compat.vercelGatewayRouting ?? detected.vercelGatewayRouting,
		supportsStrictMode: model.compat.supportsStrictMode ?? detected.supportsStrictMode,
		extraBody: model.compat.extraBody,
	};
}
