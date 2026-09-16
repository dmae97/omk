import type { Api, Model, ModelThinkingLevel } from "../src/types.ts";

type ThinkingMap = NonNullable<Model<Api>["thinkingLevelMap"]>;
const LEVELS: readonly ModelThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];

/** OpenRouter's own per-route vocabulary wins over model-family guesses. */
export function openRouterThinkingMap(value: unknown): ThinkingMap | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "object" || Array.isArray(value)) throw new TypeError("Invalid OpenRouter reasoning metadata");
	const mandatory = "mandatory" in value ? value.mandatory : undefined;
	if (mandatory !== undefined && typeof mandatory !== "boolean")
		throw new TypeError("Invalid reasoning mandatory flag");
	const efforts = "supported_efforts" in value ? value.supported_efforts : undefined;
	if (efforts === undefined) return mandatory === true ? { off: null } : undefined;
	if (!Array.isArray(efforts) || efforts.length === 0 || !efforts.every((effort) => typeof effort === "string")) {
		throw new TypeError("Invalid OpenRouter supported efforts");
	}
	const result: ThinkingMap = {};
	for (const level of LEVELS) {
		const wireValue = level === "off" ? "none" : level;
		result[level] = efforts.includes(wireValue) && !(level === "off" && mandatory) ? wireValue : null;
	}
	if (mandatory === false) result.off = "none";
	if (!Object.values(result).some((level) => typeof level === "string")) {
		throw new TypeError("No supported OpenRouter effort can be represented");
	}
	return result;
}

const GPT6_ASTRA_ID = /(^|\/)gpt-6-astra(?:-pro)?(?::batch)?$/;
const GPT6_ASTRA_APIS = ["openai-responses", "azure-openai-responses", "openai-completions"] as const;

/** OMK `ultra` is a selector alias for Astra's documented ceiling, `max`. */
export function applyGpt6AstraUltraAlias(model: Model<Api>): void {
	if (!model.reasoning) return;
	if (!GPT6_ASTRA_ID.test(model.id)) return;
	if (!(GPT6_ASTRA_APIS as readonly string[]).includes(model.api)) return;
	model.thinkingLevelMap = { ...model.thinkingLevelMap, ultra: "max" };
}

/** New documented families not covered by the legacy generator's version checks. */
export function applyCurrentThinkingMetadata(model: Model<Api>): void {
	if (!model.reasoning) return;
	if (model.provider === "vercel-ai-gateway" && model.id === "deepseek/deepseek-v4.1-flash" && model.api === "anthropic-messages") {
		model.thinkingLevelMap = { minimal: null, low: "low", medium: null, high: "high", xhigh: null, max: "max" };
		// Messages effort is separate from a token budget; do not collapse max through clampReasoning().
		model.compat = { ...model.compat, forceAdaptiveThinking: true };
	}
	if (
		(model.provider === "deepseek" || model.provider === "opencode-go") &&
		model.id === "deepseek-flash" && model.api === "openai-completions"
	) {
		model.thinkingLevelMap = { minimal: null, low: "low", medium: null, high: "high", xhigh: null, max: "max" };
		model.compat = {
			...model.compat, thinkingFormat: "deepseek", supportsReasoningEffort: true,
			requiresReasoningContentOnAssistantMessages: true, maxTokensField: "max_tokens",
		};
	}
	if (model.provider === "deepseek" && model.id.startsWith("deepseek-v4-")) {
		model.thinkingLevelMap = { ...model.thinkingLevelMap, low: "low", max: "max" };
	}
	if (GPT6_ASTRA_ID.test(model.id) && (GPT6_ASTRA_APIS as readonly string[]).includes(model.api)) {
		model.thinkingLevelMap = {
			off: null,
			minimal: null,
			low: "low",
			medium: "medium",
			high: "high",
			xhigh: "xhigh",
			max: "max",
			ultra: "max",
		};
	}
	if (/(?:^|[/.])claude-opus-5(?:[.@:-]|$)/.test(model.id)) {
		model.thinkingLevelMap = {
			off: undefined,
			minimal: null,
			low: "low",
			medium: "medium",
			high: "high",
			xhigh: "xhigh",
			max: "max",
		};
		if (model.api === "anthropic-messages") model.compat = { ...model.compat, forceAdaptiveThinking: true };
	}
	if (
		(model.api === "google-generative-ai" || model.api === "google-vertex") &&
		/^gemini-3\.[78]-flash(?:-|$)/.test(model.id)
	) {
		model.thinkingLevelMap = { off: null, minimal: null, low: "LOW", medium: "MEDIUM", high: "HIGH" };
	}
}
