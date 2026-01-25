/**
 * Diff/patch parsing for the edit tool.
 *
 * Supports multiple input formats:
 * - Simple +/- diffs
 * - Unified diff format (@@ -X,Y +A,B @@)
 * - Codex-style wrapped patches (*** Begin Patch / *** End Patch)
 */
import type { DiffHunk } from "./types";
import { ApplyPatchError, ParseError } from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const EOF_MARKER = "*** End of File";
const CHANGE_CONTEXT_MARKER = "@@ ";
const EMPTY_CHANGE_CONTEXT_MARKER = "@@";

/** Regex to match unified diff hunk headers: @@ -OLD,COUNT +NEW,COUNT @@ optional-context */
const UNIFIED_HUNK_HEADER_REGEX = /^@@\s*-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s*@@(?:\s*(.*))?$/;

/** Regex to match @@ line/lines N or N-M pattern (model-generated line hints) */
const LINE_HINT_REGEX = /^lines?\s+(\d+)(?:\s*-\s*(\d+))?(?:\s*@@)?$/i;
const TOP_OF_FILE_REGEX = /^(top|start|beginning)\s+of\s+file$/i;

/**
 * Check if a line is a diff content line (context, addition, or removal).
 * These should never be treated as metadata even if their content looks like it.
 * Note: `--- ` and `+++ ` are metadata headers, not content lines.
 */
function isDiffContentLine(line: string): boolean {
	const firstChar = line[0];
	if (firstChar === " ") return true;
	if (firstChar === "+") {
		// `+++ ` is metadata, single `+` followed by content is addition
		return !line.startsWith("+++ ");
	}
	if (firstChar === "-") {
		// `--- ` is metadata, single `-` followed by content is removal
		return !line.startsWith("--- ");
	}
	return false;
}

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

	// Strip trailing truly empty lines (not diff content lines like " " which represent blank context)
	while (lines.length > 0) {
		const lastLine = lines[lines.length - 1];
		// Only strip if line is completely empty (no characters) OR
		// if it's whitespace-only but NOT a diff content line (space prefix = context line)
		if (lastLine === "" || (lastLine?.trim() === "" && !isDiffContentLine(lastLine ?? ""))) {
			lines = lines.slice(0, -1);
		} else {
			break;
		}
	}

	// Layer 1: Strip *** Begin Patch / *** End Patch (may have only one or both)
	if (lines[0]?.trim().startsWith("*** Begin Patch")) {
		lines = lines.slice(1);
	}
	// Also strip bare *** at the beginning (model hallucination)
	if (lines[0]?.trim() === "***") {
		lines = lines.slice(1);
	}
	if (lines.length > 0 && lines[lines.length - 1]?.trim().startsWith("*** End Patch")) {
		lines = lines.slice(0, -1);
	}
	// Also strip bare *** terminator (model hallucination)
	if (lines.length > 0 && lines[lines.length - 1]?.trim() === "***") {
		lines = lines.slice(0, -1);
	}

	// Layer 2: Strip Codex-style file operation markers and unified diff metadata
	// NOTE: Do NOT strip "*** End of File" - that's a valid marker within hunks, not a wrapper
	// IMPORTANT: Only strip actual metadata lines, NOT diff content lines (starting with space, +, or -)
	lines = lines.filter(line => {
		// Preserve diff content lines even if their content looks like metadata
		// Note: `--- ` and `+++ ` are metadata, not content lines
		if (isDiffContentLine(line)) {
			return true;
		}

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
	const nonEmptyLines = lines.filter(l => l.length > 0);

	// Check if all non-empty lines start with "+ " or "+"
	if (nonEmptyLines.length > 0 && nonEmptyLines.every(l => l.startsWith("+ ") || l.startsWith("+"))) {
		return lines
			.map(l => {
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
 *
 * Handles several context formats:
 * - Empty: `@@` (no context, match from current position)
 * - Unified: `@@ -10,3 +10,3 @@` (line numbers as hints)
 * - Context: `@@ function foo` (search for context line)
 * - Line hint: `@@ line 125` (use line 125 as starting position)
 * - Nested: `@@ class Foo\n@@   method` (hierarchical context search)
 */
function parseOneHunk(lines: string[], lineNumber: number, allowMissingContext: boolean): ParseHunkResult {
	if (lines.length === 0) {
		throw new ParseError("Diff does not contain any lines", lineNumber);
	}

	const changeContexts: string[] = [];
	let oldStartLine: number | undefined;
	let newStartLine: number | undefined;
	let startIndex: number;

	const headerLine = lines[0];
	const headerTrimmed = headerLine.trimEnd();
	const isHeaderLine = headerLine.startsWith("@@");
	const unifiedHeader = isHeaderLine ? parseUnifiedHunkHeader(headerTrimmed) : undefined;
	const isEmptyContextMarker = /^@@\s*@@$/.test(headerTrimmed);

	// Check for context marker
	if (isHeaderLine && (headerTrimmed === EMPTY_CHANGE_CONTEXT_MARKER || isEmptyContextMarker)) {
		startIndex = 1;
	} else if (unifiedHeader) {
		if (unifiedHeader.oldStartLine < 1 || unifiedHeader.newStartLine < 1) {
			throw new ParseError("Line numbers in @@ header must be >= 1", lineNumber);
		}
		if (unifiedHeader.changeContext) {
			changeContexts.push(unifiedHeader.changeContext);
		}
		oldStartLine = unifiedHeader.oldStartLine;
		newStartLine = unifiedHeader.newStartLine;
		startIndex = 1;
	} else if (isHeaderLine && headerTrimmed.startsWith(CHANGE_CONTEXT_MARKER)) {
		const contextValue = headerTrimmed.slice(CHANGE_CONTEXT_MARKER.length);
		const trimmedContextValue = contextValue.trim();
		const normalizedContextValue = trimmedContextValue.replace(/^@@\s*/u, "");

		const lineHintMatch = normalizedContextValue.match(LINE_HINT_REGEX);
		if (lineHintMatch) {
			oldStartLine = Number(lineHintMatch[1]);
			newStartLine = oldStartLine;
			if (oldStartLine < 1) {
				throw new ParseError("Line hint must be >= 1", lineNumber);
			}
		} else if (TOP_OF_FILE_REGEX.test(normalizedContextValue)) {
			oldStartLine = 1;
			newStartLine = 1;
		} else if (trimmedContextValue.length > 0) {
			changeContexts.push(contextValue);
		}
		startIndex = 1;
	} else if (isHeaderLine) {
		const contextValue = headerTrimmed.slice(2).trim();
		if (contextValue.length > 0) {
			changeContexts.push(contextValue);
		}
		startIndex = 1;
	} else {
		if (!allowMissingContext) {
			throw new ParseError(`Expected hunk to start with @@ context marker, got: '${lines[0]}'`, lineNumber);
		}
		startIndex = 0;
	}

	if (oldStartLine !== undefined && oldStartLine < 1) {
		throw new ParseError(`Line numbers must be >= 1 (got ${oldStartLine})`, lineNumber);
	}
	if (newStartLine !== undefined && newStartLine < 1) {
		throw new ParseError(`Line numbers must be >= 1 (got ${newStartLine})`, lineNumber);
	}

	// Check for nested @@ anchors on subsequent lines
	// Format: @@ class Foo
	//         @@   method
	while (startIndex < lines.length) {
		const nextLine = lines[startIndex];
		if (!nextLine.startsWith("@@")) {
			break;
		}
		const trimmed = nextLine.trimEnd();

		// Check if it's another @@ line (nested anchor)
		if (trimmed.startsWith(CHANGE_CONTEXT_MARKER)) {
			const nestedContext = trimmed.slice(CHANGE_CONTEXT_MARKER.length);
			if (nestedContext.trim().length > 0) {
				changeContexts.push(nestedContext);
			}
			startIndex++;
		} else if (trimmed === EMPTY_CHANGE_CONTEXT_MARKER) {
			// Empty @@ as separator - skip it
			startIndex++;
		} else {
			// Not an @@ line, stop accumulating
			break;
		}
	}

	if (startIndex >= lines.length) {
		throw new ParseError("Hunk does not contain any lines", lineNumber + 1);
	}

	// Combine contexts: if multiple, join with newline for hierarchical matching
	const changeContext = changeContexts.length > 0 ? changeContexts.join("\n") : undefined;

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
		const trimmed = line.trim();
		const nextLine = lines[i + 1];

		if (line === "" && parsedLines > 0 && nextLine?.trimStart().startsWith("@@")) {
			break;
		}

		if (!isDiffContentLine(line) && line.trimEnd() === EOF_MARKER && line.startsWith(EOF_MARKER)) {
			if (parsedLines === 0) {
				throw new ParseError("Hunk does not contain any lines", lineNumber + 1);
			}
			hunk.isEndOfFile = true;
			parsedLines++;
			break;
		}

		if (trimmed === "..." || trimmed === "…") {
			hunk.hasContextLines = true;
			parsedLines++;
			continue;
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
		} else if (!line.startsWith("@@")) {
			// Implicit context line (model omitted leading space)
			hunk.hasContextLines = true;
			hunk.oldLines.push(line);
			hunk.newLines.push(line);
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

	stripLineNumberPrefixes(hunk);
	return { hunk, linesConsumed: parsedLines + startIndex };
}

function stripLineNumberPrefixes(hunk: DiffHunk): void {
	const allLines = [...hunk.oldLines, ...hunk.newLines].filter(line => line.trim().length > 0);
	if (allLines.length < 2) return;

	const numberMatches = allLines
		.map(line => line.match(/^\s*(\d{1,6})\s+(.+)$/u))
		.filter((match): match is RegExpMatchArray => match !== null);

	if (numberMatches.length < Math.max(2, Math.ceil(allLines.length * 0.6))) {
		return;
	}

	const numbers = numberMatches.map(match => Number(match[1]));
	let sequential = 0;
	for (let i = 1; i < numbers.length; i++) {
		if (numbers[i] === numbers[i - 1] + 1) {
			sequential++;
		}
	}

	if (numbers.length >= 3 && sequential < Math.max(1, numbers.length - 2)) {
		return;
	}

	const strip = (line: string): string => {
		const match = line.match(/^\s*\d{1,6}\s+(.+)$/u);
		return match ? match[1] : line;
	};

	hunk.oldLines = hunk.oldLines.map(strip);
	hunk.newLines = hunk.newLines.map(strip);
}

/** Multi-file patch markers that indicate this is not a single-file patch */
const MULTI_FILE_MARKERS = ["*** Update File:", "*** Add File:", "*** Delete File:", "diff --git "];

/**
 * Count multi-file markers in a diff.
 * Returns the count of file-level markers found.
 * Only counts lines that are actual metadata (not diff content lines).
 */
function countMultiFileMarkers(diff: string): number {
	const counts = new Map<string, number>();
	const paths = new Set<string>();
	const lines = diff.split("\n");
	for (const line of lines) {
		if (isDiffContentLine(line)) {
			continue;
		}
		const trimmed = line.trim();
		for (const marker of MULTI_FILE_MARKERS) {
			if (trimmed.startsWith(marker)) {
				const path = extractMarkerPath(trimmed);
				if (path) {
					paths.add(path);
				}
				counts.set(marker, (counts.get(marker) ?? 0) + 1);
				break;
			}
		}
	}
	if (paths.size > 0) {
		return paths.size;
	}
	let maxCount = 0;
	for (const count of counts.values()) {
		if (count > maxCount) {
			maxCount = count;
		}
	}
	return maxCount;
}

function extractMarkerPath(line: string): string | undefined {
	if (line.startsWith("diff --git ")) {
		const parts = line.split(/\s+/);
		const candidate = parts[3] ?? parts[2];
		if (!candidate) return undefined;
		return candidate.replace(/^(a|b)\//, "");
	}
	if (line.startsWith("*** Update File:")) {
		return line.slice("*** Update File:".length).trim();
	}
	if (line.startsWith("*** Add File:")) {
		return line.slice("*** Add File:".length).trim();
	}
	if (line.startsWith("*** Delete File:")) {
		return line.slice("*** Delete File:".length).trim();
	}
	return undefined;
}

/**
 * Parse all diff hunks from a diff string.
 */
export function parseHunks(diff: string): DiffHunk[] {
	const multiFileCount = countMultiFileMarkers(diff);
	if (multiFileCount > 1) {
		throw new ApplyPatchError(
			`Diff contains ${multiFileCount} file markers. Single-file patches cannot contain multi-file markers.`,
		);
	}

	const normalizedDiff = normalizeDiff(diff);
	const lines = normalizedDiff.split("\n");
	const hunks: DiffHunk[] = [];
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];
		const trimmed = line.trim();

		// Skip blank lines between hunks
		if (trimmed === "") {
			i++;
			continue;
		}

		// Skip unified diff metadata lines, but only if they're not diff content lines
		const firstChar = line[0];
		const isDiffContent = firstChar === " " || firstChar === "+" || firstChar === "-";
		if (!isDiffContent && isUnifiedDiffMetadataLine(trimmed)) {
			i++;
			continue;
		}

		if (trimmed.startsWith("@@") && lines.slice(i + 1).every(l => l.trim() === "")) {
			break;
		}

		const { hunk, linesConsumed } = parseOneHunk(lines.slice(i), i + 1, true);
		hunks.push(hunk);
		i += linesConsumed;
	}

	return hunks;
}
