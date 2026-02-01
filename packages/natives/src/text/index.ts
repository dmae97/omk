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

export type TextInput = string | Uint8Array;

/**
 * Truncate a string to a visible width, preserving ANSI codes.
 */
export function truncateToWidth(text: TextInput, maxWidth: number, ellipsis: TextInput = "…", pad = false): string {
	return native.truncateToWidth(text, maxWidth, ellipsis, pad);
}

/**
 * Measure the visible width of text (excluding ANSI codes).
 */
export function visibleWidth(text: TextInput): number {
	return native.visibleWidth(text);
}

/**
 * Slice a range of visible columns from a line.
 */
export function sliceWithWidth(
	line: TextInput,
	startCol: number,
	length: number,
	strict = false,
): SliceWithWidthResult {
	return native.sliceWithWidth(line, startCol, length, strict);
}

/**
 * Extract before/after segments around an overlay region.
 */
export function extractSegments(
	line: TextInput,
	beforeEnd: number,
	afterStart: number,
	afterLen: number,
	strictAfter = false,
): ExtractSegmentsResult {
	return native.extractSegments(line, beforeEnd, afterStart, afterLen, strictAfter);
}
