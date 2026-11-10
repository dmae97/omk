import { getModels } from "../models.ts";
import type { AnthropicMessagesCompat, Api, Model } from "../types.ts";

export const SERVER_SIDE_FALLBACK_BETA = "server-side-fallback-2026-07-01";
const SERVER_SIDE_FALLBACK_MODEL = /^claude-(?:fable-5(?:-[12])?|opus-5(?:-5)?|sonnet-5-5)$/;

export function supportsServerSideFallback(model: Model<"anthropic-messages">): boolean {
	if (model.provider !== "anthropic" || !SERVER_SIDE_FALLBACK_MODEL.test(model.id)) return false;
	try {
		return new URL(model.baseUrl).origin === "https://api.anthropic.com";
	} catch {
		return false;
	}
}

export function getAnthropicCompat(
	model: Model<"anthropic-messages">,
): Required<Omit<AnthropicMessagesCompat, "forceAdaptiveThinking">> {
	// Fable and Opus 5.5 reject `thinking.type.disabled`; every other Anthropic model accepts it.
	const rejectsDisabledThinking = /(^|[/.])claude-(?:fable-|opus-5(?:\.5|-5)(?:[^\d]|$))/.test(model.id);
	const isFireworks = model.provider === "fireworks";
	const isCloudflareAiGatewayAnthropic =
		model.provider === "cloudflare-ai-gateway" && model.baseUrl.includes("anthropic");
	return {
		supportsEagerToolInputStreaming: model.compat?.supportsEagerToolInputStreaming ?? !isFireworks,
		supportsLongCacheRetention: model.compat?.supportsLongCacheRetention ?? !isFireworks,
		sendSessionAffinityHeaders:
			model.compat?.sendSessionAffinityHeaders ?? !!(isFireworks || isCloudflareAiGatewayAnthropic),
		supportsCacheControlOnTools: model.compat?.supportsCacheControlOnTools ?? !isFireworks,
		supportsTemperature: model.compat?.supportsTemperature ?? true,
		supportsDisabledThinking: model.compat?.supportsDisabledThinking ?? !rejectsDisabledThinking,
		allowEmptySignature: model.compat?.allowEmptySignature ?? false,
	};
}

export function resolveAnthropicResponseModel(model: Model<"anthropic-messages">, responseModelId: string): Model<Api> {
	if (model.provider !== "anthropic") return model;
	return getModels("anthropic").find((candidate) => candidate.id === responseModelId) ?? model;
}

export function readAnthropicStopCategory(delta: unknown): string | undefined {
	if (!delta || typeof delta !== "object" || !("stop_details" in delta)) return undefined;
	const stopDetails = delta.stop_details;
	if (!stopDetails || typeof stopDetails !== "object" || !("category" in stopDetails)) return undefined;
	return typeof stopDetails.category === "string" ? stopDetails.category : undefined;
}
