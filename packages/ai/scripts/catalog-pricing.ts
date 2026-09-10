/** Convert per-token catalog prices; -1 is an unknown routed price, not a negative charge. */
export function catalogPricePerMillion(raw: string | undefined): number {
	const price = Number(raw ?? 0);
	if (price === -1) return 0;
	const perMillion = price * 1_000_000;
	if (!Number.isFinite(perMillion) || perMillion < 0) throw new TypeError("Invalid catalog token price");
	return perMillion;
}
