import type { Usage } from "../types.ts";
import { uncachedInputFromInclusiveTotal } from "../usage-share.ts";

/** Raw Responses API usage, including the GPT-5.6+ cache-write count when present. */
export interface ResponsesRawUsage {
	input_tokens?: number;
	output_tokens?: number;
	total_tokens?: number;
	cache_write_tokens?: number;
	input_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number } | null;
}

/**
 * Map Responses usage to `Usage`. OpenAI `input_tokens` includes cache reads
 * and writes, so `input` is normalized to uncached input. Cache writes come
 * from `cache_write_tokens` (GPT-5.6+). A reported value (including 0) is kept;
 * an absent field is *not reported*, not "no write": `cacheWrite` is a 0
 * placeholder and `cacheWriteUnknown` is set — except for models where the
 * provider doc states there is no cache-write charge (see
 * `hasNoCacheWriteCharge`), where an absent field is a known 0.
 * Costs are filled later.
 */
export function parseResponsesUsage(raw: ResponsesRawUsage, model?: { provider: string; id: string }): Usage {
	const cacheRead = raw.input_tokens_details?.cached_tokens || 0;
	const reported =
		reportedCount(raw.input_tokens_details?.cache_write_tokens) ?? reportedCount(raw.cache_write_tokens);
	const cacheWrite = reported ?? 0;
	const unknown = reported === undefined && !(model && hasNoCacheWriteCharge(model.provider, model.id));
	return {
		input: uncachedInputFromInclusiveTotal(raw.input_tokens || 0, cacheRead, cacheWrite),
		output: raw.output_tokens || 0,
		cacheRead,
		cacheWrite,
		...(unknown ? { cacheWriteUnknown: true as const } : {}),
		totalTokens: raw.total_tokens || 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function reportedCount(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * OpenAI prompt-caching guide, "Summary of model differences", row "Cache write
 * charge": GPT-5.6 and later "1.25× for \"30m\"; 2.5× for \"12h\"", GPT-5.5 /
 * GPT-5.5 Pro and other earlier models "No additional cache-write charge"
 * (https://platform.openai.com/docs/guides/prompt-caching, checked 2026-10-21).
 *
 * Only the first-party `openai` provider is covered; Azure and Codex billing
 * are not documented there. Only ids that parse as an OpenAI model *before*
 * GPT-5.6 qualify (gpt-N[.M] with N.M < 5.6, gpt-4o*, o1/o3/o4*); anything
 * else, including unparseable ids, stays unknown. Anthropic is never zero-filled.
 */
export function hasNoCacheWriteCharge(provider: string, modelId: string): boolean {
	if (provider !== "openai") return false;
	const id = modelId.toLowerCase().replace(/^openai\//, "");
	if (/^o[134](?:$|[-.])/.test(id) || /^gpt-4o(?:$|-)/.test(id)) return true;
	const match = /^gpt-(\d+)(?:\.(\d+))?(?:$|-)/.exec(id);
	if (!match) return false;
	const major = Number(match[1]);
	const minor = match[2] === undefined ? 0 : Number(match[2]);
	return major < 5 || (major === 5 && minor < 6);
}
