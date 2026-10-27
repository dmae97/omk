/**
 * Shared cache-share arithmetic.
 *
 * Every adapter stores `Usage.input` as *uncached* input (cache reads and
 * writes excluded). Cache share is therefore
 * `cacheRead / (input + cacheRead + cacheWrite)`; cumulative shares are
 * computed from token sums, never as a mean of per-request percentages.
 */

export interface CacheShareTokens {
	readonly input: number;
	readonly cacheRead: number;
	readonly cacheWrite: number;
}

function count(value: number | undefined): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** Prompt-side tokens: uncached input plus cache reads plus cache writes. */
export function promptSideTokens(usage: CacheShareTokens): number {
	return count(usage.input) + count(usage.cacheRead) + count(usage.cacheWrite);
}

/** Cache-read share in [0, 1], or `undefined` when there is no prompt-side usage. */
export function cacheReadShare(usage: CacheShareTokens): number | undefined {
	const prompt = promptSideTokens(usage);
	return prompt === 0 ? undefined : count(usage.cacheRead) / prompt;
}

/** Cumulative share from token sums across requests. */
export function cumulativeCacheReadShare(usages: Iterable<CacheShareTokens>): number | undefined {
	let input = 0;
	let cacheRead = 0;
	let cacheWrite = 0;
	for (const usage of usages) {
		input += count(usage.input);
		cacheRead += count(usage.cacheRead);
		cacheWrite += count(usage.cacheWrite);
	}
	return cacheReadShare({ input, cacheRead, cacheWrite });
}

/**
 * Normalize a provider total that *includes* cache reads and writes (OpenAI
 * `input_tokens` / `prompt_tokens`) into uncached input.
 */
export function uncachedInputFromInclusiveTotal(total: number, cacheRead: number, cacheWrite: number): number {
	return Math.max(0, count(total) - count(cacheRead) - count(cacheWrite));
}

/**
 * Providers whose `Usage.input` semantics were checked against both adapter
 * code and the provider's own documentation. Anything else is reported as
 * unverified in usage coverage.
 */
export const VERIFIED_USAGE_INPUT_PROVIDERS: ReadonlySet<string> = new Set([
	"openai",
	"azure-openai-responses",
	"openai-codex",
	"anthropic",
	"google",
	"google-vertex",
]);

export function isUsageInputSemanticsVerified(provider: string | undefined): boolean {
	return provider !== undefined && VERIFIED_USAGE_INPUT_PROVIDERS.has(provider);
}
