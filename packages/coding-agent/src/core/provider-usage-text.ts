/** Small value helpers shared by the subscription-usage parsers. */

/** Strip control/format characters and collapse whitespace in server-supplied text. */
export function usageText(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	const safe = value
		.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g, "")
		.replace(/\s+/g, " ")
		.trim();
	return safe ? safe.slice(0, 40) : undefined;
}

export function clampPercent(value: number): number {
	return Number(Math.max(0, Math.min(100, value)).toFixed(2));
}
