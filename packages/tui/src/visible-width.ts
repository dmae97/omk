import { eastAsianWidth } from "get-east-asian-width";
import { extractAnsiCode } from "./ansi-codes.ts";
import { leadingNonPrintingRegex, rgiEmojiRegex, zeroWidthRegex } from "./unicode-regex.ts";

/** Shared grapheme segmenter; `getGraphemeSegmenter()` in utils.ts returns this instance. */
export const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * Width cache for strings that need grapheme segmentation. Styled ASCII, Hangul and CJK
 * ideographs never reach it (see `simpleWidth`), so the entries go to emoji, combining
 * marks and other scripts. A render pass over a long transcript touches thousands of distinct lines;
 * 512 entries made such passes miss on every line (FIFO eviction under a cyclic scan).
 */
const WIDTH_CACHE_SIZE = 8192;
/** Longer strings are measured without caching so the cache cannot pin large text. */
const WIDTH_CACHE_MAX_KEY_LENGTH = 4096;
const widthCache = new Map<string, number>();

export function isPrintableAscii(str: string): boolean {
	for (let i = 0; i < str.length; i++) {
		const code = str.charCodeAt(i);
		if (code < 0x20 || code > 0x7e) {
			return false;
		}
	}
	return true;
}

/**
 * Check if a grapheme cluster (after segmentation) could possibly be an RGI emoji.
 * This is a fast heuristic to avoid the expensive rgiEmojiRegex test.
 * The tested Unicode blocks are deliberately broad to account for future
 * Unicode additions.
 */
function couldBeEmoji(segment: string): boolean {
	const cp = segment.codePointAt(0)!;
	return (
		(cp >= 0x1f000 && cp <= 0x1fbff) || // Emoji and Pictograph
		(cp >= 0x2300 && cp <= 0x23ff) || // Misc technical
		(cp >= 0x2600 && cp <= 0x27bf) || // Misc symbols, dingbats
		(cp >= 0x2b50 && cp <= 0x2b55) || // Specific stars/circles
		segment.includes("\uFE0F") || // Contains VS16 (emoji presentation selector)
		segment.length > 2 // Multi-codepoint sequences (ZWJ, skin tones, etc.)
	);
}

/**
 * Calculate the terminal width of a single grapheme cluster.
 * Based on code from the string-width library, but includes a possible-emoji
 * check to avoid running the RGI_Emoji regex unnecessarily.
 */
export function graphemeWidth(segment: string): number {
	if (segment === "\t") {
		return 3;
	}

	// Zero-width clusters
	if (zeroWidthRegex.test(segment)) {
		return 0;
	}

	// Emoji check with pre-filter
	if (couldBeEmoji(segment) && rgiEmojiRegex.test(segment)) {
		return 2;
	}

	// Get base visible codepoint
	const base = segment.replace(leadingNonPrintingRegex, "");
	const cp = base.codePointAt(0);
	if (cp === undefined) {
		return 0;
	}

	// Regional indicator symbols (U+1F1E6..U+1F1FF) are often rendered as
	// full-width emoji in terminals, even when isolated during streaming.
	// Keep width conservative (2) to avoid terminal auto-wrap drift artifacts.
	if (cp >= 0x1f1e6 && cp <= 0x1f1ff) {
		return 2;
	}

	let width = eastAsianWidth(cp);

	// Trailing halfwidth/fullwidth forms and AM vowels that segment with a base.
	if (segment.length > 1) {
		for (const char of segment.slice(1)) {
			const c = char.codePointAt(0)!;
			if (c >= 0xff00 && c <= 0xffef) {
				width += eastAsianWidth(c);
			} else if (c === 0x0e33 || c === 0x0eb3) {
				width += 1;
			}
		}
	}

	return width;
}

/**
 * Normalize for measuring: tabs become 3 spaces and supported ANSI/OSC/APC escape
 * sequences (CSI styling/cursor codes, OSC hyperlinks and prompt markers, APC sequences
 * like CURSOR_MARKER) are removed. An ESC that starts no complete sequence is kept.
 */
function stripForWidth(str: string): string {
	const clean = str.includes("\t") ? str.replace(/\t/g, "   ") : str;
	let esc = clean.indexOf("\x1b");
	if (esc === -1) return clean;
	let stripped = "";
	let copied = 0;
	while (esc !== -1) {
		const ansi = extractAnsiCode(clean, esc);
		if (ansi) {
			stripped += clean.slice(copied, esc);
			copied = esc + ansi.length;
		}
		esc = clean.indexOf("\x1b", ansi ? copied : esc + 1);
	}
	return stripped + clean.slice(copied);
}

/**
 * Width of text made only of printable ASCII (1 column), Hangul syllables and CJK unified
 * ideographs (2 columns each, UAX #11 Wide), or -1 when anything else appears. Each of these
 * code points is a grapheme cluster on its own: a Hangul syllable joins only trailing jamo
 * (U+1160..U+11FF) and an ideograph only variation selectors, both of which fall back here.
 */
function simpleWidth(clean: string): number {
	let width = 0;
	for (let i = 0; i < clean.length; i++) {
		const code = clean.charCodeAt(i);
		if (code >= 0x20 && code <= 0x7e) width += 1;
		else if ((code >= 0xac00 && code <= 0xd7a3) || (code >= 0x4e00 && code <= 0x9fff)) width += 2;
		else return -1;
	}
	return width;
}

/**
 * Calculate the visible width of a string in terminal columns.
 */
export function visibleWidth(str: string): number {
	if (str.length === 0) {
		return 0;
	}

	// Fast path: pure ASCII printable
	if (isPrintableAscii(str)) {
		return str.length;
	}

	// Styled ASCII, Hangul and CJK (the bulk of rendered lines): once escapes are
	// stripped, every character is its own cluster, so segmentation is unnecessary.
	const clean = stripForWidth(str);
	const simple = simpleWidth(clean);
	if (simple >= 0) {
		return simple;
	}

	const cached = widthCache.get(str);
	if (cached !== undefined) {
		return cached;
	}

	let width = 0;
	for (const { segment } of graphemeSegmenter.segment(clean)) {
		width += graphemeWidth(segment);
	}

	if (str.length <= WIDTH_CACHE_MAX_KEY_LENGTH) {
		if (widthCache.size >= WIDTH_CACHE_SIZE) {
			const firstKey = widthCache.keys().next().value;
			if (firstKey !== undefined) {
				widthCache.delete(firstKey);
			}
		}
		widthCache.set(str, width);
	}

	return width;
}
