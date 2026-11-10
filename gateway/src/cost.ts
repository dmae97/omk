import type { GatewayConfig, PriceNano } from "./config.ts";

export interface TokenCounts {
	hit: number;
	miss: number;
	out: number;
}

export function costNano(t: TokenCounts, row: PriceNano): number {
	return t.hit * row.hit + t.miss * row.miss + t.out * row.out;
}

/** User-billed cost is ALWAYS at the peak price; upstream cost follows the peak flag. */
export function costs(config: GatewayConfig, upstreamModel: string, t: TokenCounts, peak: boolean) {
	const e = config.prices.models[upstreamModel];
	if (!e) throw new Error(`no price entry for ${upstreamModel}`);
	return { billedNano: costNano(t, e.peak), upstreamNano: costNano(t, peak ? e.peak : e.offpeak) };
}
