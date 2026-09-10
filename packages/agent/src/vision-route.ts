import type { Api, Model } from "omk-ai";

export const VISION_ROUTE_MODEL = {
	provider: "openai-codex",
	id: "gpt-5.6-luna",
	name: "GPT-5.6 Luna",
	api: "openai-codex-responses",
	baseUrl: "https://chatgpt.com/backend-api",
	reasoning: true,
	input: ["text", "image"],
	contextWindow: 1_000_000,
	maxTokens: 128000,
} as const;

export function isVisionRouteModel(model: { provider?: string; id?: string } | undefined | null): boolean {
	return model?.provider === VISION_ROUTE_MODEL.provider && model?.id === VISION_ROUTE_MODEL.id;
}

/** Never carry source-provider headers into the automatic cross-provider route. */
export function getVisionRouteModel(model: Model<Api>): Model<Api> {
	return { ...model, ...VISION_ROUTE_MODEL, input: [...VISION_ROUTE_MODEL.input], headers: undefined };
}
