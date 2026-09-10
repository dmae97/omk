import type { Model, SimpleStreamOptions } from "../types.ts";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

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
		(value) => /opus-(?:4-[678]|5)(?:-|$)/.test(value) || value.includes("sonnet-4-6"),
	);
}

export function mapThinkingLevelToEffort(
	model: Model<"bedrock-converse-stream">,
	level: SimpleStreamOptions["reasoning"],
): Effort {
	if (
		level === "xhigh" &&
		getModelMatchCandidates(model.id, model.name).some((value) => /opus-(?:4-[78]|5)(?:-|$)/.test(value))
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
