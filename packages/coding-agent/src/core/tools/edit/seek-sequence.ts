/**
 * Sequence matching utilities for apply-patch.
 * Port of codex-rs/apply-patch/src/seek_sequence.rs with fuzzy matching extensions.
 *
 * Attempts to find a sequence of pattern lines within lines beginning at or after start.
 * Returns the starting index of the match or undefined if not found. Matches are attempted
 * with decreasing strictness: exact match, then ignoring trailing whitespace, then ignoring
 * leading and trailing whitespace, then normalizing unicode punctuation, and finally
 * fuzzy line-by-line similarity matching.
 *
 * When eof is true, we first try starting at the end-of-file (so that patterns intended
 * to match file endings are applied at the end), and fall back to searching from start if needed.
 */

/** Result of a sequence search */
export interface SeekSequenceResult {
	/** Starting index of the match, or undefined if not found */
	index: number | undefined;
	/** Confidence score (1.0 for exact match, lower for fuzzy matches) */
	confidence: number;
}

/**
 * Normalize common Unicode punctuation to ASCII equivalents.
 * This allows diffs authored with plain ASCII characters to match source files
 * containing typographic dashes/quotes, etc.
 */
function normalizeUnicode(s: string): string {
	return s
		.trim()
		.split("")
		.map((c) => {
			const code = c.charCodeAt(0);
			// Various dash/hyphen code-points → ASCII '-'
			if (
				code === 0x2010 || // HYPHEN
				code === 0x2011 || // NON-BREAKING HYPHEN
				code === 0x2012 || // FIGURE DASH
				code === 0x2013 || // EN DASH
				code === 0x2014 || // EM DASH
				code === 0x2015 || // HORIZONTAL BAR
				code === 0x2212 // MINUS SIGN
			) {
				return "-";
			}
			// Fancy single quotes → '
			if (
				code === 0x2018 || // LEFT SINGLE QUOTATION MARK
				code === 0x2019 || // RIGHT SINGLE QUOTATION MARK
				code === 0x201a || // SINGLE LOW-9 QUOTATION MARK
				code === 0x201b // SINGLE HIGH-REVERSED-9 QUOTATION MARK
			) {
				return "'";
			}
			// Fancy double quotes → "
			if (
				code === 0x201c || // LEFT DOUBLE QUOTATION MARK
				code === 0x201d || // RIGHT DOUBLE QUOTATION MARK
				code === 0x201e || // DOUBLE LOW-9 QUOTATION MARK
				code === 0x201f // DOUBLE HIGH-REVERSED-9 QUOTATION MARK
			) {
				return '"';
			}
			// Non-breaking space and other odd spaces → normal space
			if (
				code === 0x00a0 || // NO-BREAK SPACE
				code === 0x2002 || // EN SPACE
				code === 0x2003 || // EM SPACE
				code === 0x2004 || // THREE-PER-EM SPACE
				code === 0x2005 || // FOUR-PER-EM SPACE
				code === 0x2006 || // SIX-PER-EM SPACE
				code === 0x2007 || // FIGURE SPACE
				code === 0x2008 || // PUNCTUATION SPACE
				code === 0x2009 || // THIN SPACE
				code === 0x200a || // HAIR SPACE
				code === 0x202f || // NARROW NO-BREAK SPACE
				code === 0x205f || // MEDIUM MATHEMATICAL SPACE
				code === 0x3000 // IDEOGRAPHIC SPACE
			) {
				return " ";
			}
			return c;
		})
		.join("");
}

/**
 * Normalize fancy quotes and dashes to ASCII equivalents.
 */
function normalizeFuzzyText(text: string): string {
	return text
		.replace(/[""„‟«»]/g, '"')
		.replace(/[''‚‛`´]/g, "'")
		.replace(/[‐‑‒–—−]/g, "-");
}

/**
 * Compute Levenshtein distance between two strings.
 */
function levenshteinDistance(a: string, b: string): number {
	if (a === b) return 0;
	const aLen = a.length;
	const bLen = b.length;
	if (aLen === 0) return bLen;
	if (bLen === 0) return aLen;

	let prev = new Array<number>(bLen + 1);
	let curr = new Array<number>(bLen + 1);
	for (let j = 0; j <= bLen; j++) {
		prev[j] = j;
	}

	for (let i = 1; i <= aLen; i++) {
		curr[0] = i;
		const aCode = a.charCodeAt(i - 1);
		for (let j = 1; j <= bLen; j++) {
			const cost = aCode === b.charCodeAt(j - 1) ? 0 : 1;
			const deletion = prev[j] + 1;
			const insertion = curr[j - 1] + 1;
			const substitution = prev[j - 1] + cost;
			curr[j] = Math.min(deletion, insertion, substitution);
		}
		const tmp = prev;
		prev = curr;
		curr = tmp;
	}

	return prev[bLen];
}

/**
 * Compute similarity score between two strings (0 to 1).
 */
function similarityScore(a: string, b: string): number {
	if (a.length === 0 && b.length === 0) return 1;
	const maxLen = Math.max(a.length, b.length);
	if (maxLen === 0) return 1;
	const distance = levenshteinDistance(a, b);
	return 1 - distance / maxLen;
}

/**
 * Normalize a line for fuzzy matching: trim, collapse whitespace, normalize quotes/dashes.
 */
function normalizeLineForFuzzy(line: string): string {
	const trimmed = line.trim();
	if (trimmed.length === 0) return "";
	const normalized = normalizeFuzzyText(trimmed);
	return normalized.replace(/[ \t]+/g, " ");
}

/** Fuzzy matching threshold - must exceed this to be considered a match */
const FUZZY_THRESHOLD = 0.92;

/**
 * Check if pattern matches lines starting at index i using the given comparison function.
 */
function matchesAt(lines: string[], pattern: string[], i: number, compare: (a: string, b: string) => boolean): boolean {
	for (let j = 0; j < pattern.length; j++) {
		if (!compare(lines[i + j], pattern[j])) {
			return false;
		}
	}
	return true;
}

/**
 * Compute average similarity score for pattern at position i.
 */
function fuzzyScoreAt(lines: string[], pattern: string[], i: number): number {
	let totalScore = 0;
	for (let j = 0; j < pattern.length; j++) {
		const lineNorm = normalizeLineForFuzzy(lines[i + j]);
		const patternNorm = normalizeLineForFuzzy(pattern[j]);
		totalScore += similarityScore(lineNorm, patternNorm);
	}
	return totalScore / pattern.length;
}

/**
 * Attempt to find the sequence of pattern lines within lines beginning at or after start.
 * Returns the starting index and confidence of the match, or undefined index if not found.
 *
 * @param lines - The lines of the file content
 * @param pattern - The lines to search for
 * @param start - Starting index for the search
 * @param eof - If true, prefer matching at end of file first
 */
export function seekSequence(lines: string[], pattern: string[], start: number, eof: boolean): SeekSequenceResult {
	// Empty pattern matches immediately
	if (pattern.length === 0) {
		return { index: start, confidence: 1.0 };
	}

	// Pattern longer than available input cannot match
	if (pattern.length > lines.length) {
		return { index: undefined, confidence: 0 };
	}

	// Determine search start position
	const searchStart = eof && lines.length >= pattern.length ? lines.length - pattern.length : start;
	const maxStart = lines.length - pattern.length;

	// Pass 1: Exact match
	for (let i = searchStart; i <= maxStart; i++) {
		if (matchesAt(lines, pattern, i, (a, b) => a === b)) {
			return { index: i, confidence: 1.0 };
		}
	}

	// Pass 2: Trailing whitespace stripped
	for (let i = searchStart; i <= maxStart; i++) {
		if (matchesAt(lines, pattern, i, (a, b) => a.trimEnd() === b.trimEnd())) {
			return { index: i, confidence: 0.99 };
		}
	}

	// Pass 3: Both leading and trailing whitespace stripped
	for (let i = searchStart; i <= maxStart; i++) {
		if (matchesAt(lines, pattern, i, (a, b) => a.trim() === b.trim())) {
			return { index: i, confidence: 0.98 };
		}
	}

	// Pass 4: Normalize unicode punctuation
	for (let i = searchStart; i <= maxStart; i++) {
		if (matchesAt(lines, pattern, i, (a, b) => normalizeUnicode(a) === normalizeUnicode(b))) {
			return { index: i, confidence: 0.97 };
		}
	}

	// Pass 5: Fuzzy matching - find best match above threshold
	let bestIndex: number | undefined;
	let bestScore = 0;

	for (let i = searchStart; i <= maxStart; i++) {
		const score = fuzzyScoreAt(lines, pattern, i);
		if (score > bestScore) {
			bestScore = score;
			bestIndex = i;
		}
	}

	// Also search from start if eof mode started from end
	if (eof && searchStart > start) {
		for (let i = start; i < searchStart; i++) {
			const score = fuzzyScoreAt(lines, pattern, i);
			if (score > bestScore) {
				bestScore = score;
				bestIndex = i;
			}
		}
	}

	if (bestIndex !== undefined && bestScore >= FUZZY_THRESHOLD) {
		return { index: bestIndex, confidence: bestScore };
	}

	return { index: undefined, confidence: bestScore };
}
