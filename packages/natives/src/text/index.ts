/**
 * ANSI-aware text utilities powered by native bindings.
 */

import { Ellipsis, type ExtractSegmentsResult, type SliceWithWidthResult } from "@oh-my-pi/pi-natives";
import { getDefaultTabWidth } from "@oh-my-pi/pi-utils";
import { native } from "../native";

export type { ExtractSegmentsResult, SliceWithWidthResult } from "./types";
export { Ellipsis } from "./types";

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
	tabWidth = getDefaultTabWidth(),
): string {
	return native.truncateToWidth(text, maxWidth, ellipsis, pad, tabWidth);
}

/**
 * Slice a range of visible columns from a line.
 * @param line - The line to slice
 * @param startCol - The starting column
 * @param length - The length of the slice
 * @param strict - Whether to strictly enforce the length
 * @returns The sliced line
 */
export function sliceWithWidth(
	line: string,
	startCol: number,
	length: number,
	strict = false,
	tabWidth = getDefaultTabWidth(),
): SliceWithWidthResult {
	if (length <= 0) return { text: "", width: 0 };
	return native.sliceWithWidth(line, startCol, length, strict, tabWidth);
}

/**
 * Wrap text to a visible width while preserving ANSI color/style sequences.
 *
 * @param text - Input text, optionally containing ANSI escape codes
 * @param width - Maximum visible width per output line
 * @param tabWidth - Width used when measuring tab characters (default: configured tab width)
 * @returns Wrapped lines with ANSI state preserved across breaks
 */
export function wrapTextWithAnsi(text: string, width: number, tabWidth = getDefaultTabWidth()): string[] {
	return native.wrapTextWithAnsi(text, width, tabWidth);
}

/**
 * Measure visible terminal width of text, excluding ANSI escape sequences.
 *
 * @param text - Input text, optionally containing ANSI escape codes
 * @param tabWidth - Width used when measuring tab characters (default: configured tab width)
 * @returns Visible width in terminal cells
 */
export function visibleWidth(text: string, tabWidth = getDefaultTabWidth()): number {
	return native.visibleWidth(text, tabWidth);
}

/**
 * Extract before/after segments around an overlay range using visible-column boundaries.
 *
 * @param line - Input line, optionally containing ANSI escape codes
 * @param beforeEnd - Visible column where the `before` segment ends
 * @param afterStart - Visible column where the `after` segment starts
 * @param afterLen - Visible width to include in the `after` segment
 * @param strictAfter - When true, graphemes that overflow `afterLen` are dropped
 * @param tabWidth - Width used when measuring tab characters (default: configured tab width)
 * @returns Visible-width-aware before/after segments
 */
export function extractSegments(
	line: string,
	beforeEnd: number,
	afterStart: number,
	afterLen: number,
	strictAfter: boolean,
	tabWidth = getDefaultTabWidth(),
): ExtractSegmentsResult {
	return native.extractSegments(line, beforeEnd, afterStart, afterLen, strictAfter, tabWidth);
}

export const { sanitizeText } = native;
