/** Per-request cost breakdown in USD, carried on `Usage.cost`. */
export interface UsageCost {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	total: number;
	/**
	 * Amount the provider reports it actually billed for this request, in USD.
	 * Only set when the provider returns it (xAI `cost_in_usd_ticks`); `total`
	 * stays the catalog-price estimate so its parts keep summing to it.
	 */
	billed?: number;
}
