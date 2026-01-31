import {
	extractSegments as nativeExtractSegments,
	sliceWithWidth as nativeSliceWithWidth,
	truncateToWidth as nativeTruncateToWidth,
	visibleWidth as nativeVisibleWidth,
} from "@oh-my-pi/pi-natives";

// Pre-allocated space buffer for padding
const SPACE_BUFFER = " ".repeat(512);

/**
 * Returns a string of n spaces. Uses a pre-allocated buffer for efficiency.
 */
export function padding(n: number): string {
	if (n <= 0) return "";
	if (n <= 512) return SPACE_BUFFER.slice(0, n);
	return " ".repeat(n);
}

// Grapheme segmenter (shared instance)
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * Get the shared grapheme segmenter instance.
 */
export function getSegmenter(): Intl.Segmenter {
	return segmenter;
}

// Cache for non-ASCII strings
const WIDTH_CACHE_SIZE = 512;
const widthCache = new Map<string, number>();
const NATIVE_WIDTH_THRESHOLD = 256;

/**
 * Calculate the visible width of a string in terminal columns.
 */
export function visibleWidth(str: string): number {
	if (str.length === 0) {
		return 0;
	}

	// Fast path: pure ASCII printable
	let isPureAscii = true;
	for (let i = 0; i < str.length; i++) {
		const code = str.charCodeAt(i);
		if (code < 0x20 || code > 0x7e) {
			isPureAscii = false;
			break;
		}
	}
	if (isPureAscii) {
		return str.length;
	}

	// Check cache
	const cached = widthCache.get(str);
	if (cached !== undefined) {
		return cached;
	}

	let width: number;
	if (str.length <= NATIVE_WIDTH_THRESHOLD) {
		// Normalize: tabs to 3 spaces, strip ANSI escape codes
		let clean = str;
		if (str.includes("\t")) {
			clean = clean.replace(/\t/g, "   ");
		}
		if (clean.includes("\x1b")) {
			// Strip SGR codes (\x1b[...m) and cursor codes (\x1b[...G/K/H/J)
			clean = clean.replace(/\x1b\[[0-9;]*[mGKHJ]/g, "");
			// Strip OSC 8 hyperlinks: \x1b]8;;URL\x07 and \x1b]8;;\x07
			clean = clean.replace(/\x1b\]8;;[^\x07]*\x07/g, "");
		}
		width = Bun.stringWidth(clean);
	} else {
		width = nativeVisibleWidth(str);
	}

	// Cache result
	if (widthCache.size >= WIDTH_CACHE_SIZE) {
		const firstKey = widthCache.keys().next().value;
		if (firstKey !== undefined) {
			widthCache.delete(firstKey);
		}
	}
	widthCache.set(str, width);

	return width;
}

/**
 * Extract ANSI escape sequences from a string at the given position.
 */
export function extractAnsiCode(str: string, pos: number): { code: string; length: number } | null {
	if (pos >= str.length || str[pos] !== "\x1b") return null;

	const next = str[pos + 1];

	// CSI sequence: ESC [ ... m/G/K/H/J
	if (next === "[") {
		let j = pos + 2;
		while (j < str.length && !/[mGKHJ]/.test(str[j]!)) j++;
		if (j < str.length) return { code: str.substring(pos, j + 1), length: j + 1 - pos };
		return null;
	}

	// OSC sequence: ESC ] ... BEL or ESC ] ... ST (ESC \)
	// Used for hyperlinks (OSC 8), window titles, etc.
	if (next === "]") {
		let j = pos + 2;
		while (j < str.length) {
			if (str[j] === "\x07") return { code: str.substring(pos, j + 1), length: j + 1 - pos };
			if (str[j] === "\x1b" && str[j + 1] === "\\") {
				return { code: str.substring(pos, j + 2), length: j + 2 - pos };
			}
			j++;
		}
		return null;
	}

	return null;
}

const WRAP_OPTIONS = { wordWrap: true, hard: true, trim: false } as const;

/**
 * Wrap text with ANSI codes preserved.
 *
 * ONLY does word wrapping - NO padding, NO background colors.
 * Returns lines where each line is <= width visible chars.
 * Active ANSI codes are preserved across line breaks.
 *
 * @param text - Text to wrap (may contain ANSI codes and newlines)
 * @param width - Maximum visible width per line
 * @returns Array of wrapped lines (NOT padded to width)
 */
export function wrapTextWithAnsi(text: string, width: number): string[] {
	return Bun.wrapAnsi(text, width, WRAP_OPTIONS).split("\n");
}

const PUNCTUATION_REGEX = /[(){}[\]<>.,;:'"!?+\-=*/\\|&%^$#@~`]/;

/**
 * Check if a character is whitespace.
 */
export function isWhitespaceChar(char: string): boolean {
	return /\s/.test(char);
}

/**
 * Check if a character is punctuation.
 */
export function isPunctuationChar(char: string): boolean {
	return PUNCTUATION_REGEX.test(char);
}

/**
 * Apply background color to a line, padding to full width.
 *
 * @param line - Line of text (may contain ANSI codes)
 * @param width - Total width to pad to
 * @param bgFn - Background color function
 * @returns Line with background applied and padded to width
 */
export function applyBackgroundToLine(line: string, width: number, bgFn: (text: string) => string): string {
	// Calculate padding needed
	const visibleLen = visibleWidth(line);
	const paddingNeeded = Math.max(0, width - visibleLen);

	// Apply background to content + padding
	const withPadding = line + padding(paddingNeeded);
	return bgFn(withPadding);
}

/**
 * Truncate text to fit within a maximum visible width, adding ellipsis if needed.
 * Optionally pad with spaces to reach exactly maxWidth.
 * Properly handles ANSI escape codes (they don't count toward width).
 *
 * @param text - Text to truncate (may contain ANSI codes)
 * @param maxWidth - Maximum visible width
 * @param ellipsis - Ellipsis string to append when truncating (default: "…")
 * @param pad - If true, pad result with spaces to exactly maxWidth (default: false)
 * @returns Truncated text, optionally padded to exactly maxWidth
 */
export function truncateToWidth(text: string, maxWidth: number, ellipsis: string = "…", pad: boolean = false): string {
	return nativeTruncateToWidth(text, maxWidth, ellipsis, pad);
}

/**
 * Extract a range of visible columns from a line. Handles ANSI codes and wide chars.
 * @param strict - If true, exclude wide chars at boundary that would extend past the range
 */
export function sliceByColumn(line: string, startCol: number, length: number, strict = false): string {
	return sliceWithWidth(line, startCol, length, strict).text;
}

/** Like sliceByColumn but also returns the actual visible width of the result. */
export function sliceWithWidth(
	line: string,
	startCol: number,
	length: number,
	strict = false,
): { text: string; width: number } {
	if (length <= 0) return { text: "", width: 0 };
	return nativeSliceWithWidth(line, startCol, length, strict);
}

/**
 * Extract "before" and "after" segments from a line in a single pass.
 * Used for overlay compositing where we need content before and after the overlay region.
 * Preserves styling from before the overlay that should affect content after it.
 */
export function extractSegments(
	line: string,
	beforeEnd: number,
	afterStart: number,
	afterLen: number,
	strictAfter = false,
): { before: string; beforeWidth: number; after: string; afterWidth: number } {
	return nativeExtractSegments(line, beforeEnd, afterStart, afterLen, strictAfter);
}
