/**
 * ANSI-aware text utilities powered by native bindings.
 */

import { Ellipsis, type SliceWithWidthResult } from "@oh-my-pi/pi-natives";
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
): string {
	return native.truncateToWidth(text, maxWidth, ellipsis, pad);
}

/**
 * Slice a range of visible columns from a line.
 * @param line - The line to slice
 * @param startCol - The starting column
 * @param length - The length of the slice
 * @param strict - Whether to strictly enforce the length
 * @returns The sliced line
 */
export function sliceWithWidth(line: string, startCol: number, length: number, strict = false): SliceWithWidthResult {
	if (length <= 0) return { text: "", width: 0 };
	return native.sliceWithWidth(line, startCol, length, strict);
}

export const { wrapTextWithAnsi, visibleWidth, extractSegments, sanitizeText } = native;
