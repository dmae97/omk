import type { TriggerSpec } from "./domain-types.ts";

/** Cap on how many times a single keyword phrase can contribute (prevents runaway). */
export const KEYWORD_OCCURRENCE_CAP = 3;

export interface CompiledTrigger {
	readonly spec: TriggerSpec;
	/** Pre-built tester for text (keyword/regex) or undefined for path-only. */
	readonly textMatcher?: (lowerText: string) => number;
}

export function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a counted keyword matcher. Returns the number of non-overlapping,
 * case-insensitive occurrences of the literal phrase (capped).
 */
function usesAsciiWordBoundaries(phrase: string): boolean {
	return /^[a-z0-9](?:[a-z0-9 -]*[a-z0-9])?$/.test(phrase);
}

export function keywordMatcher(phrase: string): (lowerText: string) => number {
	const lowerPhrase = phrase.toLowerCase();
	const escapedPhrase = escapeRegExp(lowerPhrase);
	const patternSource = usesAsciiWordBoundaries(lowerPhrase)
		? `(?<![A-Za-z0-9_])${escapedPhrase}(?![A-Za-z0-9_])`
		: escapedPhrase;
	const pattern = new RegExp(patternSource, "g");
	return (lowerText: string): number => {
		const matches = lowerText.match(pattern);
		if (!matches) return 0;
		return Math.min(matches.length, KEYWORD_OCCURRENCE_CAP);
	};
}

export function regexMatcher(source: string): (lowerText: string) => number {
	// Source is already a regex pattern; case-insensitive, tested once.
	const re = new RegExp(source, "i");
	return (lowerText: string): number => (re.test(lowerText) ? 1 : 0);
}

export function compileTrigger(spec: TriggerSpec): CompiledTrigger {
	if (spec.kind === "keyword") return { spec, textMatcher: keywordMatcher(spec.pattern) };
	if (spec.kind === "regex") return { spec, textMatcher: regexMatcher(spec.pattern) };
	return { spec };
}

export function describeTrigger(spec: TriggerSpec): string {
	switch (spec.kind) {
		case "keyword":
			return `keyword:"${spec.pattern}"`;
		case "regex":
			return `regex:/${spec.pattern}/`;
		case "extension":
			return `ext:${spec.pattern}`;
		case "path":
			return `path:${spec.pattern}`;
	}
}
