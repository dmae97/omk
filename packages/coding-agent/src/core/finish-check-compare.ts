/**
 * Checks the arithmetic of the comparisons a finish check reports, such as
 * `stone 74 >= 75`. omk does not re-measure or re-derive the limit; it only
 * refuses to accept a comparison the run wrote that does not hold (spec 035).
 */

// Decimals, thousands separators and e-notation (`1e-3`, review M2). A number followed by `.digit` is a
// version string such as 3.11.2 and does not match (review m3).
const NUMBER = String.raw`-?\d+(?:,\d{3})*(?:\.\d+)?(?:e[+-]?\d+)?(?!\.\d)`;
// Percent, sizes and times, plus nt, bp and °C because the benchmark's biology tasks state limits in them.
const UNIT = String.raw`%|percent\b|[kmgt]i?b\b|b\b|bytes?\b|ms\b|sec(?:onds?)?\b|s\b|min(?:utes?)?\b|nt\b|bp\b|°c`;
// `=>` and `=<` are read as `>=` and `<=`. The right side is a lookahead so chained limits
// (`58 <= 61 <= 72`) yield two comparisons. The look-behind keeps a match from starting inside a
// word, a number or an exponent (`v2`, `3.11`, `1e-3`).
const COMPARISON = new RegExp(
	String.raw`(?<![\w.,+-])(${NUMBER})\s*(${UNIT})?\s*(>=|<=|=>|=<|==|≥|≤|>|<|=)\s*(?=(${NUMBER})\s*(${UNIT})?)`,
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
		case "=>":
		case "≥":
			return left >= right;
		case "<=":
		case "=<":
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

/** The comparisons of a part that form its last chain: `58 <= 61 <= 72` is one chain of two. */
function lastChain(part: string): RegExpExecArray[] {
	let chain: RegExpExecArray[] = [];
	let chainEnd = -1;
	for (const match of part.matchAll(COMPARISON)) {
		// A link continues the chain when it starts where the previous right side began.
		chain = match.index === chainEnd ? [...chain, match] : [match];
		chainEnd = match.index + match[0].length;
	}
	return chain;
}

/**
 * Evaluates the `<measured> <op> <limit>` comparisons in a reported value, one `;`-separated part per
 * limit. Each part is judged by its last comparison chain, so context written before it ("was 80 > 90,
 * now 95 > 90") does not fail the item (review m2). Mixed units are skipped, not guessed.
 */
export function checkComparisons(measured: string | undefined): ComparisonCheck {
	let evaluated = 0;
	const gaps: string[] = [];
	// Models often write the unicode minus sign; read it as `-` (review m1).
	for (const part of (measured ?? "").replace(/\u2212/g, "-").split(";")) {
		let failed = false;
		for (const match of lastChain(part)) {
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
