/**
 * Diff/patch parsing for the edit tool.
 *
 * Supports multiple input formats:
 * - Simple +/- diffs
 * - Unified diff format (@@ -X,Y +A,B @@)
 * - Codex-style wrapped patches (*** Begin Patch / *** End Patch)
 */

import type { DiffHunk } from "./types";
import { ParseError } from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const EOF_MARKER = "*** End of File";
const CHANGE_CONTEXT_MARKER = "@@ ";
const EMPTY_CHANGE_CONTEXT_MARKER = "@@";

/** Regex to match unified diff hunk headers: @@ -OLD,COUNT +NEW,COUNT @@ optional-context */
const UNIFIED_HUNK_HEADER_REGEX = /^@@\s*-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s*@@(?:\s*(.*))?$/;

// ═══════════════════════════════════════════════════════════════════════════
// Normalization
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Normalize a diff by stripping various wrapper formats and metadata.
 *
 * Handles:
 * - `*** Begin Patch` / `*** End Patch` markers (partial or complete)
 * - Codex file markers: `*** Update File:`, `*** Add File:`, `*** Delete File:`, `*** End of File`
 * - Unified diff metadata: `diff --git`, `index`, `---`, `+++`, mode changes, rename markers
 */
export function normalizeDiff(diff: string): string {
	let lines = diff.split("\n");

	// Strip trailing empty lines first
	while (lines.length > 0 && lines[lines.length - 1]?.trim() === "") {
		lines = lines.slice(0, -1);
	}

	// Layer 1: Strip *** Begin Patch / *** End Patch (may have only one or both)
	if (lines[0]?.trim().startsWith("*** Begin Patch")) {
		lines = lines.slice(1);
	}
	if (lines.length > 0 && lines[lines.length - 1]?.trim().startsWith("*** End Patch")) {
		lines = lines.slice(0, -1);
	}

	// Layer 2: Strip Codex-style file operation markers and unified diff metadata
	// NOTE: Do NOT strip "*** End of File" - that's a valid marker within hunks, not a wrapper
	lines = lines.filter((line) => {
		const trimmed = line.trim();

		// Codex file operation markers (these wrap multiple file changes)
		if (trimmed.startsWith("*** Update File:")) return false;
		if (trimmed.startsWith("*** Add File:")) return false;
		if (trimmed.startsWith("*** Delete File:")) return false;

		// Unified diff metadata
		if (trimmed.startsWith("diff --git ")) return false;
		if (trimmed.startsWith("index ")) return false;
		if (trimmed.startsWith("--- ")) return false;
		if (trimmed.startsWith("+++ ")) return false;
		if (trimmed.startsWith("new file mode ")) return false;
		if (trimmed.startsWith("deleted file mode ")) return false;
		if (trimmed.startsWith("rename from ")) return false;
		if (trimmed.startsWith("rename to ")) return false;
		if (trimmed.startsWith("similarity index ")) return false;
		if (trimmed.startsWith("dissimilarity index ")) return false;
		if (trimmed.startsWith("old mode ")) return false;
		if (trimmed.startsWith("new mode ")) return false;

		return true;
	});

	return lines.join("\n");
}

/**
 * Strip `+ ` prefix from file creation content if all non-empty lines have it.
 * This handles diffs where file content is formatted as additions.
 */
export function normalizeCreateContent(content: string): string {
	const lines = content.split("\n");
	const nonEmptyLines = lines.filter((l) => l.length > 0);

	// Check if all non-empty lines start with "+ " or "+"
	if (nonEmptyLines.length > 0 && nonEmptyLines.every((l) => l.startsWith("+ ") || l.startsWith("+"))) {
		return lines
			.map((l) => {
				if (l.startsWith("+ ")) return l.slice(2);
				if (l.startsWith("+")) return l.slice(1);
				return l;
			})
			.join("\n");
	}

	return content;
}

// ═══════════════════════════════════════════════════════════════════════════
// Header Parsing
// ═══════════════════════════════════════════════════════════════════════════

interface UnifiedHunkHeader {
	oldStartLine: number;
	oldLineCount: number;
	newStartLine: number;
	newLineCount: number;
	changeContext?: string;
}

function parseUnifiedHunkHeader(line: string): UnifiedHunkHeader | undefined {
	const match = line.match(UNIFIED_HUNK_HEADER_REGEX);
	if (!match) return undefined;

	const oldStartLine = Number(match[1]);
	const oldLineCount = match[2] ? Number(match[2]) : 1;
	const newStartLine = Number(match[3]);
	const newLineCount = match[4] ? Number(match[4]) : 1;
	const changeContext = match[5]?.trim();

	return {
		oldStartLine,
		oldLineCount,
		newStartLine,
		newLineCount,
		changeContext: changeContext && changeContext.length > 0 ? changeContext : undefined,
	};
}

function isUnifiedDiffMetadataLine(line: string): boolean {
	return (
		line.startsWith("diff --git ") ||
		line.startsWith("index ") ||
		line.startsWith("--- ") ||
		line.startsWith("+++ ") ||
		line.startsWith("new file mode ") ||
		line.startsWith("deleted file mode ") ||
		line.startsWith("rename from ") ||
		line.startsWith("rename to ") ||
		line.startsWith("similarity index ") ||
		line.startsWith("dissimilarity index ") ||
		line.startsWith("old mode ") ||
		line.startsWith("new mode ")
	);
}

// ═══════════════════════════════════════════════════════════════════════════
// Hunk Parsing
// ═══════════════════════════════════════════════════════════════════════════

interface ParseHunkResult {
	hunk: DiffHunk;
	linesConsumed: number;
}

/**
 * Parse a single hunk from lines starting at the current position.
 */
function parseOneHunk(lines: string[], lineNumber: number, allowMissingContext: boolean): ParseHunkResult {
	if (lines.length === 0) {
		throw new ParseError("Diff does not contain any lines", lineNumber);
	}

	let changeContext: string | undefined;
	let oldStartLine: number | undefined;
	let newStartLine: number | undefined;
	let startIndex: number;

	const headerLine = lines[0].trim();
	const unifiedHeader = parseUnifiedHunkHeader(headerLine);

	// Check for context marker
	if (headerLine === EMPTY_CHANGE_CONTEXT_MARKER) {
		changeContext = undefined;
		startIndex = 1;
	} else if (unifiedHeader) {
		changeContext = unifiedHeader.changeContext;
		oldStartLine = unifiedHeader.oldStartLine;
		newStartLine = unifiedHeader.newStartLine;
		startIndex = 1;
	} else if (headerLine.startsWith(CHANGE_CONTEXT_MARKER)) {
		changeContext = headerLine.slice(CHANGE_CONTEXT_MARKER.length);
		startIndex = 1;
	} else {
		if (!allowMissingContext) {
			throw new ParseError(`Expected hunk to start with @@ context marker, got: '${lines[0]}'`, lineNumber);
		}
		changeContext = undefined;
		startIndex = 0;
	}

	if (startIndex >= lines.length) {
		throw new ParseError("Hunk does not contain any lines", lineNumber + 1);
	}

	const hunk: DiffHunk = {
		changeContext,
		oldStartLine,
		newStartLine,
		hasContextLines: false,
		oldLines: [],
		newLines: [],
		isEndOfFile: false,
	};

	let parsedLines = 0;

	for (let i = startIndex; i < lines.length; i++) {
		const line = lines[i];

		if (line === EOF_MARKER) {
			if (parsedLines === 0) {
				throw new ParseError("Hunk does not contain any lines", lineNumber + 1);
			}
			hunk.isEndOfFile = true;
			parsedLines++;
			break;
		}

		const firstChar = line[0];

		if (firstChar === undefined || firstChar === "") {
			// Empty line - treat as context
			hunk.hasContextLines = true;
			hunk.oldLines.push("");
			hunk.newLines.push("");
		} else if (firstChar === " ") {
			// Context line
			hunk.hasContextLines = true;
			hunk.oldLines.push(line.slice(1));
			hunk.newLines.push(line.slice(1));
		} else if (firstChar === "+") {
			// Added line
			hunk.newLines.push(line.slice(1));
		} else if (firstChar === "-") {
			// Removed line
			hunk.oldLines.push(line.slice(1));
		} else {
			if (parsedLines === 0) {
				throw new ParseError(
					`Unexpected line in hunk: '${line}'. Lines must start with ' ' (context), '+' (add), or '-' (remove)`,
					lineNumber + 1,
				);
			}
			// Assume start of next hunk
			break;
		}
		parsedLines++;
	}

	if (parsedLines === 0) {
		throw new ParseError("Hunk does not contain any lines", lineNumber + startIndex);
	}

	return { hunk, linesConsumed: parsedLines + startIndex };
}

/**
 * Parse all diff hunks from a diff string.
 */
export function parseHunks(diff: string): DiffHunk[] {
	const normalizedDiff = normalizeDiff(diff);
	const lines = normalizedDiff.split("\n");
	const hunks: DiffHunk[] = [];
	let i = 0;

	while (i < lines.length) {
		// Skip blank lines between hunks
		const trimmed = lines[i].trim();
		if (trimmed === "") {
			i++;
			continue;
		}

		// Skip unified diff metadata lines
		if (isUnifiedDiffMetadataLine(trimmed)) {
			i++;
			continue;
		}

		const { hunk, linesConsumed } = parseOneHunk(lines.slice(i), i + 1, hunks.length === 0);
		hunks.push(hunk);
		i += linesConsumed;
	}

	return hunks;
}
