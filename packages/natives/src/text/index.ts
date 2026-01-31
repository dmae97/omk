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

/** Compute the visible width of a string, ignoring ANSI codes. */
export function visibleWidth(text: string): number {
	return native.visibleWidth(text);
}

/**
 * Truncate a string to a visible width, preserving ANSI codes.
 */
export function truncateToWidth(text: string, maxWidth: number, ellipsis = "…", pad = false): string {
	return native.truncateToWidth(text, maxWidth, ellipsis, pad);
}

/**
 * Slice a range of visible columns from a line.
 */
export function sliceWithWidth(line: string, startCol: number, length: number, strict = false): SliceWithWidthResult {
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
