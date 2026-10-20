/** Spec 094/095 diagnostic data shapes. */

export interface DiagnosticWindow {
	/** 1-based line of the anchoring candidate, or undefined for a head/tail window. */
	readonly line?: number;
	readonly pattern: string;
	/** 1-based first line of the window. */
	readonly startLine: number;
	/** Sanitized bytes before the window. */
	readonly skippedBytes: number;
	/** Window lines from `startLine` (each at most ANCHOR_LINE_CHARS), not yet cut to the caps. */
	readonly lines: readonly string[];
}

export interface DiagnosticAnchor {
	/** Window 1 around the first candidate; absent when only a summary line matched. */
	readonly first?: DiagnosticWindow;
	/** Window 2 around the last candidate (or summary line), or the tail of the output. */
	readonly last: DiagnosticWindow;
	/** Head of the output, for the summary-only case (window 1 = head). */
	readonly head: DiagnosticWindow;
	readonly totalLines: number;
	/** Sanitized bytes, counting a newline after every line. */
	readonly totalBytes: number;
	/** First candidate pattern, or the summary pattern. */
	readonly pattern: string;
	/** Spec 097: set only when OMK_GOAL_DIAGNOSTICS_V3 scanned this output. */
	readonly v3?: true;
}

export interface DiagnosticOutput {
	/** Sanitized start of the output (at least the head budget, when long). */
	readonly head: string;
	/** Sanitized end of the output. */
	readonly tail: string;
	/** UTF-8 bytes of the whole sanitized output. */
	readonly totalBytes: number;
	/** `head` is the whole sanitized output. */
	readonly complete: boolean;
	/** Two-window anchors; absent when no candidate and no summary line matched. */
	readonly anchor?: DiagnosticAnchor;
}

export interface DiagnosticExcerpt {
	readonly text: string;
	readonly truncated: boolean;
	/** Window-1 pattern name (or the summary pattern), or "fallback" for the head/tail split. */
	readonly mode: string;
	/** 1-based sanitized line ranges [start, end] shown per window; absent for passthrough/fallback. */
	readonly windows?: readonly (readonly [number, number])[];
}
