import type { Model, SimpleStreamOptions } from "../types.ts";

export type MistralReasoningEffort = "none" | "high";

export function usesReasoningEffort(model: Model<"mistral-conversations">): boolean {
	return [
		"mistral-small-2603",
		"mistral-small-latest",
		"mistral-medium-3.5",
		"mistral-large-4",
		"mistral-large-4-0",
	].includes(model.id);
}

export function usesPromptModeReasoning(model: Model<"mistral-conversations">): boolean {
	return model.reasoning && !usesReasoningEffort(model);
}

export function mapReasoningEffort(
	model: Model<"mistral-conversations">,
	level: Exclude<SimpleStreamOptions["reasoning"], undefined>,
): MistralReasoningEffort {
	return (model.thinkingLevelMap?.[level] ?? "high") as MistralReasoningEffort;
}
