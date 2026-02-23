import { sliceWithWidth } from "@oh-my-pi/pi-natives";
import { getDefaultTabWidth, getIndentation } from "@oh-my-pi/pi-utils";

export { Ellipsis, extractSegments, sliceWithWidth, truncateToWidth, wrapTextWithAnsi } from "@oh-my-pi/pi-natives";

// Pre-allocated space buffer for padding
const SPACE_BUFFER = " ".repeat(512);

/*
 * Replace tabs with configured spacing for consistent rendering.
 */
export function replaceTabs(text: string): string {
	return text.replaceAll("\t", getIndentation());
}

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

/**
 * Calculate the visible width of a string in terminal columns.
 */
export function visibleWidthRaw(str: string): number {
	if (!str) {
		return 0;
	}

	// Fast path: pure ASCII printable
	let isPureAscii = true;
	let tabLength = 0;
	const tabWidth = getDefaultTabWidth();
	for (let i = 0; i < str.length; i++) {
		const code = str.charCodeAt(i);
		if (code === 9) {
			tabLength += tabWidth;
		} else if (code < 0x20 || code > 0x7e) {
			isPureAscii = false;
		}
	}
	if (isPureAscii) {
		return str.length + tabLength;
	}
	return Bun.stringWidth(str) + tabLength;
}

/**
 * Calculate the visible width of a string in terminal columns.
 */
export function visibleWidth(str: string): number {
	if (!str) return 0;
	return visibleWidthRaw(str);
}

const makeBoolArray = (chars: string): ReadonlyArray<boolean> => {
	const table = Array.from({ length: 128 }, () => false);
	for (let i = 0; i < chars.length; i++) {
		const code = chars.charCodeAt(i);
		if (code < table.length) {
			table[code] = true;
		}
	}
	return table;
};

const ASCII_WHITESPACE = makeBoolArray("\x09\x0a\x0b\x0c\x0d\x20");

/**
 * Check if a character is whitespace.
 */
export function isWhitespaceChar(char: string): boolean {
	const code = char.codePointAt(0) || 0;
	return ASCII_WHITESPACE[code] ?? false;
}

const ASCII_PUNCTUATION = makeBoolArray("(){}[]<>.,;:'\"!?+-=*/\\|&%^$#@~`");

/**
 * Check if a character is punctuation.
 */
export function isPunctuationChar(char: string): boolean {
	const code = char.codePointAt(0) || 0;
	return ASCII_PUNCTUATION[code] ?? false;
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
 * Extract a range of visible columns from a line. Handles ANSI codes and wide chars.
 * @param strict - If true, exclude wide chars at boundary that would extend past the range
 */
export function sliceByColumn(line: string, startCol: number, length: number, strict = false): string {
	return sliceWithWidth(line, startCol, length, strict).text;
}
