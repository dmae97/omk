import type { Model, SimpleStreamOptions } from "../types.ts";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/**
 * Check if the model is an Anthropic Claude model on Bedrock.
 * Checks both model ID and model name to support application inference profiles
 * whose ARNs don't contain the model name.
 */
export function isAnthropicClaudeModel(model: Model<"bedrock-converse-stream">): boolean {
	const id = model.id.toLowerCase();
	const name = model.name?.toLowerCase() ?? "";
	return (
		id.includes("anthropic.claude") ||
		id.includes("anthropic/claude") ||
		name.includes("anthropic.claude") ||
		name.includes("anthropic/claude") ||
		name.includes("claude")
	);
}

/** Application inference profiles may identify their model by display name instead of ARN. */
export function getModelMatchCandidates(modelId: string, modelName?: string): string[] {
	const values = modelName ? [modelId, modelName] : [modelId];
	return values.flatMap((value) => {
		const lower = value.toLowerCase();
		return [lower, lower.replace(/[\s_.:]+/g, "-")];
	});
}

export function supportsAdaptiveThinking(modelId: string, modelName?: string): boolean {
	return getModelMatchCandidates(modelId, modelName).some(
		(value) => /opus-(?:4-[678]|5(?:-[56])?)(?:-|$)/.test(value) || value.includes("sonnet-4-6"),
	);
}

export function mapThinkingLevelToEffort(
	model: Model<"bedrock-converse-stream">,
	level: SimpleStreamOptions["reasoning"],
): Effort {
	if (
		level === "xhigh" &&
		getModelMatchCandidates(model.id, model.name).some((value) => /opus-(?:4-[78]|5(?:-[56])?)(?:-|$)/.test(value))
	)
		return "xhigh";
	const mapped = level ? model.thinkingLevelMap?.[level] : undefined;
	if (mapped === "low" || mapped === "medium" || mapped === "high" || mapped === "xhigh" || mapped === "max")
		return mapped;
	switch (level) {
		case "minimal":
		case "low":
			return "low";
		case "medium":
			return "medium";
		default:
			return "high";
	}
}
