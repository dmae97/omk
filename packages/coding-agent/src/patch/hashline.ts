/**
 * Hashline edit mode — a line-addressable edit format using content hashes.
 *
 * Each line in a file is identified by its 1-indexed line number and a 4-character
 * hex hash derived from the line content and the line number (xxHash64 with the
 * line number as seed, truncated to 4 hex chars).
 * The combined `LINE:HASH` reference acts as both an address and a staleness check:
 * if the file has changed since the caller last read it, hash mismatches are caught
 * before any mutation occurs.
 *
 * Displayed format: `LINENUM:HASH| CONTENT`
 * Reference format: `"LINENUM:HASH"` (e.g. `"5:a3f2"`)
 */

import type { HashlineEdit, HashMismatch } from "./types";

/** Coerce `string | string[]` to `string[]` */
function toArray(v: string | string[]): string[] {
	if (typeof v !== "string") return v;
	// Split comma-separated refs: "35:ab,36:cd" → ["35:ab", "36:cd"]
	if (v.includes(",")) {
		const parts = v.split(",").map(s => s.trim());
		if (parts.every(p => /^\d+:[0-9a-fA-F]/.test(p))) {
			return parts;
		}
	}
	return [v];
}

/** Pattern matching hashline display format: `LINE:HASH| CONTENT` */
const HASHLINE_PREFIX_RE = /^\d+:[0-9a-fA-F]{1,16}\| /;

/** Pattern matching a unified-diff `+` prefix (but not `++`) */
const DIFF_PLUS_RE = /^\+(?!\+)/;

/**
 * Compare two strings ignoring all whitespace differences.
 *
 * Returns true when the non-whitespace characters are identical — meaning
 * the only differences are in spaces, tabs, or other whitespace.
 */
function equalsIgnoringWhitespace(a: string, b: string): boolean {
	// Fast path: identical strings
	if (a === b) return true;
	// Compare with all whitespace removed
	return a.replace(/\s+/g, "") === b.replace(/\s+/g, "");
}

/**
 * For replace edits (N old → N new), preserve original content on lines where
 * the only difference is whitespace.
 *
 * Models frequently reformat code (e.g., removing spaces inside import braces)
 * when making targeted edits. This detects lines that changed only in
 * whitespace and keeps the original, preventing spurious formatting diffs.
 */
function preserveWhitespaceOnlyLines(oldLines: string[], newLines: string[]): string[] {
	if (oldLines.length !== newLines.length) return newLines;
	let anyPreserved = false;
	const result = new Array<string>(newLines.length);
	for (let i = 0; i < newLines.length; i++) {
		if (oldLines[i] !== newLines[i] && equalsIgnoringWhitespace(oldLines[i], newLines[i])) {
			result[i] = oldLines[i];
			anyPreserved = true;
		} else {
			result[i] = newLines[i];
		}
	}
	return anyPreserved ? result : newLines;
}

/**
 * Strip hashline display prefixes and diff `+` markers from replacement lines.
 *
 * Models frequently copy the `LINE:HASH| ` prefix from read output into their
 * replacement content, or include unified-diff `+` prefixes. Both corrupt the
 * output file. This strips them heuristically before application.
 */
function stripNewLinePrefixes(lines: string[]): string[] {
	// Detect whether the *majority* of non-empty lines carry a prefix —
	// if only one line out of many has a match it's likely real content.
	let hashPrefixCount = 0;
	let diffPlusCount = 0;
	let nonEmpty = 0;
	for (const l of lines) {
		if (l.length === 0) continue;
		nonEmpty++;
		if (HASHLINE_PREFIX_RE.test(l)) hashPrefixCount++;
		if (DIFF_PLUS_RE.test(l)) diffPlusCount++;
	}
	if (nonEmpty === 0) return lines;

	const stripHash = hashPrefixCount > 0 && hashPrefixCount >= nonEmpty * 0.5;
	const stripPlus = !stripHash && diffPlusCount > 0 && diffPlusCount >= nonEmpty * 0.5;

	if (!stripHash && !stripPlus) return lines;

	return lines.map(l => {
		if (stripHash) return l.replace(HASHLINE_PREFIX_RE, "");
		if (stripPlus) return l.replace(DIFF_PLUS_RE, "");
		return l;
	});
}

const HASH_LEN = 2;
const HASH_MASK = BigInt((1 << (HASH_LEN * 4)) - 1);

const HEX_DICT = Array.from({ length: Number(HASH_MASK) + 1 }, (_, i) => i.toString(16).padStart(HASH_LEN, "0"));

/**
 * Compute the 4-character hex hash of a single line.
 *
 * Uses xxHash64 truncated to the first 4 hex characters.
 * The line number is included as a seed so the same content on different lines
 * produces different hashes.
 * The line input should not include a trailing newline.
 */
export function computeLineHash(idx: number, line: string): string {
	if (line.endsWith("\r")) {
		line = line.slice(0, -1);
	}
	return HEX_DICT[Number(Bun.hash.xxHash64(line, BigInt(idx)) & HASH_MASK)];
}

/**
 * Format file content with hashline prefixes for display.
 *
 * Each line becomes `LINENUM:HASH| CONTENT` where LINENUM is 1-indexed.
 *
 * @param content - Raw file content string
 * @param startLine - First line number (1-indexed, defaults to 1)
 * @returns Formatted string with one hashline-prefixed line per input line
 *
 * @example
 * ```
 * formatHashLines("function hi() {\n  return;\n}")
 * // "1:a3f2| function hi() {\n2:b1c0|   return;\n3:de45| }"
 * ```
 */
export function formatHashLines(content: string, startLine = 1): string {
	const lines = content.split("\n");
	return lines
		.map((line, i) => {
			const num = startLine + i;
			const hash = computeLineHash(num, line);
			return `${num}:${hash}| ${line}`;
		})
		.join("\n");
}

/**
 * Parse a line reference string like `"5:abcd"` into structured form.
 *
 * @throws Error if the format is invalid (not `NUMBER:HEXHASH`)
 */
export function parseLineRef(ref: string): { line: number; hash: string } {
	// Strip display-format suffix: "5:ab| some content" → "5:ab"
	// Models often copy the full display format from read output.
	const cleaned = ref.replace(/\|.*$/, "").trim();
	const match = cleaned.match(/^(\d+):([0-9a-fA-F]{1,16})$/);
	if (!match) {
		throw new Error(`Invalid line reference "${ref}". Expected format "LINE:HASH" (e.g. "5:a3f2").`);
	}
	const line = Number.parseInt(match[1], 10);
	if (line < 1) {
		throw new Error(`Line number must be >= 1, got ${line} in "${ref}".`);
	}
	return { line, hash: match[2] };
}

// ═══════════════════════════════════════════════════════════════════════════
// Hash Mismatch Error
// ═══════════════════════════════════════════════════════════════════════════

/** Number of context lines shown above/below each mismatched line */
const MISMATCH_CONTEXT = 2;

/**
 * Error thrown when one or more hashline references have stale hashes.
 *
 * Displays grep-style output with `>>>` markers on mismatched lines,
 * showing the correct `LINE:HASH` so the caller can fix all refs at once.
 */
export class HashlineMismatchError extends Error {
	constructor(
		public readonly mismatches: HashMismatch[],
		public readonly fileLines: string[],
	) {
		super(HashlineMismatchError.formatMessage(mismatches, fileLines));
		this.name = "HashlineMismatchError";
	}

	static formatMessage(mismatches: HashMismatch[], fileLines: string[]): string {
		const mismatchSet = new Map<number, HashMismatch>();
		for (const m of mismatches) {
			mismatchSet.set(m.line, m);
		}

		// Collect line ranges to display (mismatch lines + context)
		const displayLines = new Set<number>();
		for (const m of mismatches) {
			const lo = Math.max(1, m.line - MISMATCH_CONTEXT);
			const hi = Math.min(fileLines.length, m.line + MISMATCH_CONTEXT);
			for (let i = lo; i <= hi; i++) {
				displayLines.add(i);
			}
		}

		const sorted = [...displayLines].sort((a, b) => a - b);
		const lines: string[] = [];

		lines.push(
			`${mismatches.length} line${mismatches.length > 1 ? "s have" : " has"} changed since last read. Re-read the file.`,
		);
		lines.push("");

		let prevLine = -1;
		for (const lineNum of sorted) {
			// Gap separator between non-contiguous regions
			if (prevLine !== -1 && lineNum > prevLine + 1) {
				lines.push("    ...");
			}
			prevLine = lineNum;

			const content = fileLines[lineNum - 1];
			const hash = computeLineHash(lineNum, content);
			const prefix = `${lineNum}:${hash}`;

			if (mismatchSet.has(lineNum)) {
				lines.push(`>>> ${prefix}| ${content}`);
			} else {
				lines.push(`    ${prefix}| ${content}`);
			}
		}

		return lines.join("\n");
	}
}

/**
 * Validate that a line reference points to an existing line with a matching hash.
 *
 * @param ref - Parsed line reference (1-indexed line number + expected hash)
 * @param fileLines - Array of file lines (0-indexed)
 * @throws HashlineMismatchError if the hash doesn't match (includes correct hashes in context)
 * @throws Error if the line is out of range
 */
export function validateLineRef(ref: { line: number; hash: string }, fileLines: string[]): void {
	if (ref.line < 1 || ref.line > fileLines.length) {
		throw new Error(`Line ${ref.line} does not exist (file has ${fileLines.length} lines)`);
	}
	const actualHash = computeLineHash(ref.line, fileLines[ref.line - 1]);
	if (actualHash !== ref.hash.toLowerCase()) {
		throw new HashlineMismatchError([{ line: ref.line, expected: ref.hash, actual: actualHash }], fileLines);
	}
}

// ═══════════════════════════════════════════════════════════════════════════
// Edit Application
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Apply an array of hashline edits to file content.
 *
 * Edits are sorted bottom-up (highest line number first) before application
 * so that earlier edits don't invalidate line numbers for later ones.
 *
 * Supported operations:
 * - **Replace**: `old` has entries, `new` has entries — replace old lines with new
 * - **Delete**: `old` has entries, `new` is empty — delete the old lines
 * - **Insert**: `old` is empty, `new` has entries, `after` is set — insert after ref line
 *
 * @returns The modified content and the 1-indexed first changed line number
 */
export function applyHashlineEdits(
	content: string,
	edits: HashlineEdit[],
): { content: string; firstChangedLine: number | undefined } {
	if (edits.length === 0) {
		return { content, firstChangedLine: undefined };
	}

	const fileLines = content.split("\n");
	let firstChangedLine: number | undefined;

	// Normalize string → string[] for old/new fields
	const normalized = edits.map(e => ({
		old: toArray(e.old),
		new: stripNewLinePrefixes(toArray(e.new)),
		after: e.after,
	}));

	// Pre-validate all line refs and collect hash mismatches in one pass.
	// Structural errors (out of range, malformed, non-consecutive) still throw immediately.
	const mismatches: HashMismatch[] = [];

	for (const edit of normalized) {
		const refs: string[] = edit.old.length > 0 ? edit.old : edit.after ? [edit.after] : [];
		for (const refStr of refs) {
			const ref = parseLineRef(refStr);
			if (ref.line < 1 || ref.line > fileLines.length) {
				throw new Error(`Line ${ref.line} does not exist (file has ${fileLines.length} lines)`);
			}
			const actualHash = computeLineHash(ref.line, fileLines[ref.line - 1]);
			if (actualHash !== ref.hash.toLowerCase()) {
				mismatches.push({ line: ref.line, expected: ref.hash, actual: actualHash });
			}
		}
	}

	if (mismatches.length > 0) {
		throw new HashlineMismatchError(mismatches, fileLines);
	}

	// Classify and annotate edits with their effective line number for sorting.
	const annotated = normalized.map((edit, idx) => {
		const sortLine = getSortLine(edit, idx);
		return { edit, sortLine };
	});

	// Sort descending by line number so bottom edits apply first
	annotated.sort((a, b) => b.sortLine - a.sortLine);

	for (const { edit } of annotated) {
		const isInsert = edit.old.length === 0;

		if (isInsert) {
			// Insert after a referenced line
			if (!edit.after) {
				throw new Error("Insert edit (empty old) requires an 'after' line reference.");
			}
			const afterRef = parseLineRef(edit.after);
			validateLineRef(afterRef, fileLines);

			// Insert new lines after the referenced line (0-indexed splice position)
			const insertIdx = afterRef.line; // insert after this line = splice at this index
			fileLines.splice(insertIdx, 0, ...edit.new);

			trackFirstChanged(afterRef.line + 1);
		} else {
			// Replace or Delete
			const refs = edit.old.map(parseLineRef);

			// Validate all refs
			for (const ref of refs) {
				validateLineRef(ref, fileLines);
			}

			// Validate consecutiveness
			validateConsecutive(refs);

			const startLine = refs[0].line;
			const endLine = refs[refs.length - 1].line;
			const count = endLine - startLine + 1;

			// Splice: remove `count` lines starting at startLine-1, insert new
			const origLines = fileLines.slice(startLine - 1, startLine - 1 + count);
			const newLines = preserveWhitespaceOnlyLines(origLines, edit.new);
			fileLines.splice(startLine - 1, count, ...newLines);

			trackFirstChanged(startLine);
		}
	}

	return {
		content: fileLines.join("\n"),
		firstChangedLine,
	};

	function trackFirstChanged(line: number): void {
		if (firstChangedLine === undefined || line < firstChangedLine) {
			firstChangedLine = line;
		}
	}

	/**
	 * Determine the effective line number for sorting an edit (descending).
	 * For replace/delete: use the first old line.
	 * For insert: use the after line.
	 */
	function getSortLine(edit: { old: string[]; after?: string }, idx: number): number {
		if (edit.old.length > 0) {
			return parseLineRef(edit.old[0]).line;
		}
		if (edit.after) {
			return parseLineRef(edit.after).line;
		}
		// Shouldn't happen — invalid edit. Place it at the end for now; validation will catch it.
		return idx;
	}
}

/**
 * Validate that parsed line refs are consecutive (e.g. 5,6,7 — not 5,7,8).
 *
 * @throws Error if lines are not consecutive
 */
function validateConsecutive(refs: { line: number; hash: string }[]): void {
	for (let i = 1; i < refs.length; i++) {
		if (refs[i].line !== refs[i - 1].line + 1) {
			throw new Error(`Source lines must be consecutive. Got line ${refs[i - 1].line} followed by ${refs[i].line}.`);
		}
	}
}
