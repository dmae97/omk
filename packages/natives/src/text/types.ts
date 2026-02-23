/**
 * Types for ANSI-aware text utilities.
 */

/** Result of slicing a line by visible columns. */
export interface SliceWithWidthResult {
	/** UTF-16 slice containing the selected text. */
	text: string;
	/** Visible width of the slice in terminal cells. */
	width: number;
}

/** Result of extracting before/after overlay segments. */
export interface ExtractSegmentsResult {
	/** UTF-16 content before the overlay region. */
	before: string;
	/** Visible width of the `before` segment. */
	beforeWidth: number;
	/** UTF-16 content after the overlay region. */
	after: string;
	/** Visible width of the `after` segment. */
	afterWidth: number;
}

/** Ellipsis strategy for truncation. */
export const enum Ellipsis {
	/** Use a single Unicode ellipsis character ("…"). */
	Unicode = 0,
	/** Use three ASCII dots ("..."). */
	Ascii = 1,
	/** Omit ellipsis entirely. */
	Omit = 2,
}

declare module "../bindings" {
	interface NativeBindings {
		/**
		 * Truncate text to a visible width, optionally padding with spaces.
		 * @param text UTF-16 input text.
		 * @param maxWidth Maximum visible width in terminal cells.
		 * @param ellipsisKind Ellipsis strategy (see {@link Ellipsis}).
		 * @param pad Whether to pad the output to `maxWidth`.
		 */
		truncateToWidth(text: string, maxWidth: number, ellipsisKind: number, pad: boolean, tabWidth?: number): string;
		/**
		 * Sanitize text output: strip ANSI codes, remove binary garbage, normalize line endings.
		 */
		sanitizeText(text: string): string;

		/**
		 * Wrap text to a visible width, preserving ANSI codes across line breaks.
		 * @param text UTF-16 input text with optional ANSI escapes.
		 * @param width Maximum visible width per line.
		 */
		wrapTextWithAnsi(text: string, width: number, tabWidth?: number): string[];
		/**
		 * Slice a range of visible columns from a line.
		 * @param line UTF-16 input line with optional ANSI escapes.
		 * @param startCol Starting column in terminal cells.
		 * @param length Number of visible cells to include.
		 * @param strict Whether to drop graphemes that overflow the range.
		 */
		sliceWithWidth(
			line: string,
			startCol: number,
			length: number,
			strict: boolean,
			tabWidth?: number,
		): SliceWithWidthResult;
		/**
		 * Measure the visible width of text (excluding ANSI codes).
		 * @param text UTF-16 input text with optional ANSI escapes.
		 */
		visibleWidth(text: string, tabWidth?: number): number;
		/** Extract before/after segments around an overlay region.
		 * @param line UTF-16 input line with optional ANSI escapes.
		 * @param beforeEnd Column where the "before" segment ends.
		 * @param afterStart Column where the "after" segment starts.
		 * @param afterLen Visible width of the "after" segment.
		 * @param strictAfter Whether to drop graphemes that overflow `afterLen`.
		 */
		extractSegments(
			line: string,
			beforeEnd: number,
			afterStart: number,
			afterLen: number,
			strictAfter: boolean,
			tabWidth?: number,
		): ExtractSegmentsResult;
	}
}
