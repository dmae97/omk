import { calculateCost } from "../models.ts";
import type { AssistantMessage, Model } from "../types.ts";

export interface OpenAICompletionsRawUsage {
	prompt_tokens?: number;
	completion_tokens?: number;
	prompt_cache_hit_tokens?: number;
	prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
	completion_tokens_details?: { reasoning_tokens?: number };
	/** xAI only: the amount actually billed for this request, in 1e-10 USD. */
	cost_in_usd_ticks?: number;
}

const USD_TICKS = 10_000_000_000;

function isXaiModel(model: Model<"openai-completions">): boolean {
	return model.provider === "xai" || model.baseUrl.includes("api.x.ai");
}

function count(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Map a Chat Completions `usage` object to our usage record.
 *
 * OpenAI counts reasoning tokens inside `completion_tokens`. xAI does not: it
 * reports them only in `completion_tokens_details.reasoning_tokens` (its
 * `total_tokens` is prompt + completion + reasoning) and bills them at the
 * output rate. Without adding them, Grok reasoning runs were under-counted and
 * under-costed, by a lot at high effort. xAI also returns the billed amount as
 * `cost_in_usd_ticks`, which is surfaced as `cost.billed`.
 */
export function parseChunkUsage(
	rawUsage: OpenAICompletionsRawUsage,
	model: Model<"openai-completions">,
): AssistantMessage["usage"] {
	const promptTokens = count(rawUsage.prompt_tokens);
	const cacheReadTokens = count(rawUsage.prompt_tokens_details?.cached_tokens ?? rawUsage.prompt_cache_hit_tokens);
	const cacheWriteTokens = count(rawUsage.prompt_tokens_details?.cache_write_tokens);

	// Follow documented OpenAI/OpenRouter semantics: cached_tokens is cache-read
	// tokens (hits). OpenAI does not document or emit cache_write_tokens, but
	// OpenRouter-compatible providers can include it as a separate write count.
	// OpenRouter's own provider/tests affirm the separate mapping:
	// https://github.com/OpenRouterTeam/ai-sdk-provider/pull/409
	// Do not subtract writes from cached_tokens, otherwise spec-compliant
	// providers are under-reported. DS4 mirrors this contract too:
	// https://github.com/antirez/ds4/pull/29
	const input = Math.max(0, promptTokens - cacheReadTokens - cacheWriteTokens);
	const xai = isXaiModel(model);
	// OpenAI completion_tokens already includes reasoning_tokens; xAI's does not.
	const reasoningTokens = xai ? count(rawUsage.completion_tokens_details?.reasoning_tokens) : 0;
	const outputTokens = count(rawUsage.completion_tokens) + reasoningTokens;
	const usage: AssistantMessage["usage"] = {
		input,
		output: outputTokens,
		cacheRead: cacheReadTokens,
		cacheWrite: cacheWriteTokens,
		totalTokens: input + outputTokens + cacheReadTokens + cacheWriteTokens,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
	calculateCost(model, usage);
	const ticks = rawUsage.cost_in_usd_ticks;
	if (xai && typeof ticks === "number" && Number.isFinite(ticks) && ticks >= 0) usage.cost.billed = ticks / USD_TICKS;
	return usage;
}
