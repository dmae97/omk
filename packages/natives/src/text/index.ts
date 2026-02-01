/**
 * ANSI-aware text utilities powered by native bindings.
 */

import { native } from "../native";

export interface SliceWithWidthResult {
	text: string;
	width: number;
}

export interface ExtractSegmentsResult {
	before: string;
	beforeWidth: number;
	after: string;
	afterWidth: number;
}

export const enum Ellipsis {
	Unicode = 0, // "…"
	Ascii = 1, // "..."
	Omit = 2, // ""
}

/**
 * Truncate text to fit within a maximum visible width, adding ellipsis if needed.
 * Optionally pad with spaces to reach exactly maxWidth.
 * Properly handles ANSI escape codes (they don't count toward width).
 *
 * @param text - Text to truncate (may contain ANSI codes)
 * @param maxWidth - Maximum visible width
 * @param ellipsis - Ellipsis kind to append when truncating (default: Unicode "…")
 * @param pad - If true, pad result with spaces to exactly maxWidth (default: false)
 * @returns Truncated text, optionally padded to exactly maxWidth
 */
export function truncateToWidth(
	text: string,
	maxWidth: number,
	ellipsis: Ellipsis = Ellipsis.Unicode,
	pad = false,
): string {
	return native.truncateToWidth(text, maxWidth, ellipsis, pad);
}

/**
 * Measure the visible width of text (excluding ANSI codes).
 */
export function visibleWidth(text: string): number {
	return native.visibleWidth(text);
}

/**
 * Slice a range of visible columns from a line.
 */
export function sliceWithWidth(line: string, startCol: number, length: number, strict = false): SliceWithWidthResult {
	if (length <= 0) return { text: "", width: 0 };
	return native.sliceWithWidth(line, startCol, length, strict);
}

/**
 * Extract before/after segments around an overlay region.
 */
export function extractSegments(
	line: string,
	beforeEnd: number,
	afterStart: number,
	afterLen: number,
	strictAfter = false,
): ExtractSegmentsResult {
	return native.extractSegments(line, beforeEnd, afterStart, afterLen, strictAfter);
}
