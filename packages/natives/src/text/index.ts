/**
 * ANSI-aware text utilities powered by WASM.
 */

import * as wasm from "../../wasm/pi_natives";

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

type WasmTextExports = typeof wasm & {
	visible_width: (text: string) => number;
	truncate_to_width: (text: string, maxWidth: number, ellipsis: string, pad: boolean) => string;
	slice_with_width: (line: string, startCol: number, length: number, strict: boolean) => SliceWithWidthResult;
	extract_segments: (
		line: string,
		beforeEnd: number,
		afterStart: number,
		afterLen: number,
		strictAfter: boolean,
	) => ExtractSegmentsResult;
};

const wasmText = wasm as WasmTextExports;

/** Compute the visible width of a string, ignoring ANSI codes. */
export function visibleWidth(text: string): number {
	return wasmText.visible_width(text);
}

/**
 * Truncate a string to a visible width, preserving ANSI codes.
 */
export function truncateToWidth(text: string, maxWidth: number, ellipsis = "…", pad = false): string {
	return wasmText.truncate_to_width(text, maxWidth, ellipsis, pad);
}

/**
 * Slice a range of visible columns from a line.
 */
export function sliceWithWidth(line: string, startCol: number, length: number, strict = false): SliceWithWidthResult {
	return wasmText.slice_with_width(line, startCol, length, strict);
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
	return wasmText.extract_segments(line, beforeEnd, afterStart, afterLen, strictAfter);
}
