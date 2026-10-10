/**
 * Checks the arithmetic of the comparisons a finish check reports, such as
 * `stone 74 >= 75`. omk does not re-measure or re-derive the limit; it only
 * refuses to accept a comparison the run wrote that does not hold (spec 035).
 */

const NUMBER = String.raw`-?\d+(?:,\d{3})*(?:\.\d+)?`;
const UNIT = String.raw`%|percent\b|[kmgt]i?b\b|b\b|bytes?\b|ms\b|sec(?:onds?)?\b|s\b|min(?:utes?)?\b|nt\b|bp\b|°c`;
// The right side is a lookahead so chained limits (`58 <= 61 <= 72`) yield two comparisons.
const COMPARISON = new RegExp(
	String.raw`(?<![\w.,])(${NUMBER})\s*(${UNIT})?\s*(>=|<=|==|≥|≤|>|<|=)\s*(?=(${NUMBER})\s*(${UNIT})?)`,
	"gi",
);

const UNIT_ALIASES: Record<string, string> = {
	percent: "%",
	byte: "b",
	bytes: "b",
	sec: "s",
	second: "s",
	seconds: "s",
	minute: "min",
	minutes: "min",
};

function normalizeUnit(unit: string | undefined): string {
	const lower = (unit ?? "").toLowerCase();
	return UNIT_ALIASES[lower] ?? lower;
}

function holds(left: number, op: string, right: number): boolean {
	switch (op) {
		case ">=":
		case "≥":
			return left >= right;
		case "<=":
		case "≤":
			return left <= right;
		case ">":
			return left > right;
		case "<":
			return left < right;
		default:
			return left === right;
	}
}

export interface ComparisonCheck {
	/** Comparisons whose two sides had the same unit (or none) and were evaluated. */
	readonly evaluated: number;
	/** The `;`-separated parts that contain a comparison that does not hold, trimmed. */
	readonly gaps: string[];
}

/** Evaluates every `<measured> <op> <limit>` in a reported value; mixed units are skipped, not guessed. */
export function checkComparisons(measured: string | undefined): ComparisonCheck {
	let evaluated = 0;
	const gaps: string[] = [];
	for (const part of (measured ?? "").split(";")) {
		let failed = false;
		for (const match of part.matchAll(COMPARISON)) {
			if (normalizeUnit(match[2]) !== normalizeUnit(match[5])) continue;
			evaluated += 1;
			const left = Number(match[1].replace(/,/g, ""));
			const right = Number(match[4].replace(/,/g, ""));
			if (!holds(left, match[3], right)) failed = true;
		}
		if (failed) gaps.push(part.trim());
	}
	return { evaluated, gaps };
}
