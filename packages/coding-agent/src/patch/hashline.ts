/**
 * Hashline edit mode — a line-addressable edit format using text hashes.
 *
 * Each line in a file is identified by its 1-indexed line number and a short
 * hexadecimal hash derived from the normalized line text (xxHash32, truncated to 2
 * hex chars).
 * The combined `LINE#ID` reference acts as both an address and a staleness check:
 * if the file has changed since the caller last read it, hash mismatches are caught
 * before any mutation occurs.
 *
 * Displayed format: `LINENUM#HASH:TEXT`
 * Reference format: `"LINENUM#HASH"` (e.g. `"5#aa"`)
 */

import type { HashMismatch } from "./types";

export type Anchor = { line: number; hash: string };
export type HashlineEdit =
	| { op: "replace_line"; pos: Anchor; lines: string[] }
	| { op: "replace_range"; pos: Anchor; end: Anchor; lines: string[] }
	| { op: "append_at"; pos: Anchor; lines: string[] }
	| { op: "prepend_at"; pos: Anchor; lines: string[] }
	| { op: "append_file"; lines: string[] }
	| { op: "prepend_file"; lines: string[] };

const NIBBLE_STR = "ZPMQVRWSNKTXJBYH";

const DICT = Array.from({ length: 256 }, (_, i) => {
	const h = i >>> 4;
	const l = i & 0x0f;
	return `${NIBBLE_STR[h]}${NIBBLE_STR[l]}`;
});

const RE_SIGNIFICANT = /[\p{L}\p{N}]/u;

/**
 * Compute a short hexadecimal hash of a single line.
 *
 * Uses xxHash32 on a trailing-whitespace-trimmed, CR-stripped line, truncated to 2 chars from
 * {@link NIBBLE_STR}. For lines containing no alphanumeric characters (only
 * punctuation/symbols/whitespace), the line number is mixed in to reduce hash collisions.
 * The line input should not include a trailing newline.
 */
export function computeLineHash(idx: number, line: string): string {
	line = line.replace(/\r/g, "").trimEnd();

	let seed = 0;
	if (!RE_SIGNIFICANT.test(line)) {
		seed = idx;
	}
	return DICT[Bun.hash.xxHash32(line, seed) & 0xff];
}

/**
 * Formats a tag given the line number and text.
 */
export function formatLineTag(line: number, lines: string): string {
	return `${line}#${computeLineHash(line, lines)}`;
}

/**
 * Format file text with hashline prefixes for display.
 *
 * Each line becomes `LINENUM#HASH:TEXT` where LINENUM is 1-indexed.
 *
 * @param text - Raw file text string
 * @param startLine - First line number (1-indexed, defaults to 1)
 * @returns Formatted string with one hashline-prefixed line per input line
 *
 * @example
 * ```
 * formatHashLines("function hi() {\n  return;\n}")
 * // "1#HH:function hi() {\n2#HH:  return;\n3#HH:}"
 * ```
 */
export function formatHashLines(text: string, startLine = 1): string {
	const lines = text.split("\n");
	return lines
		.map((line, i) => {
			const num = startLine + i;
			return `${formatLineTag(num, line)}:${line}`;
		})
		.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════
// Hashline streaming formatter
// ═══════════════════════════════════════════════════════════════════════════

export interface HashlineStreamOptions {
	/** First line number to use when formatting (1-indexed). */
	startLine?: number;
	/** Maximum formatted lines per yielded chunk (default: 200). */
	maxChunkLines?: number;
	/** Maximum UTF-8 bytes per yielded chunk (default: 64 KiB). */
	maxChunkBytes?: number;
}

function isReadableStream(value: unknown): value is ReadableStream<Uint8Array> {
	return (
		typeof value === "object" &&
		value !== null &&
		"getReader" in value &&
		typeof (value as { getReader?: unknown }).getReader === "function"
	);
}

async function* bytesFromReadableStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
	const reader = stream.getReader();
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) return;
			if (value) yield value;
		}
	} finally {
		reader.releaseLock();
	}
}

/**
 * Stream hashline-formatted output from a UTF-8 byte source.
 *
 * This is intended for large files where callers want incremental output
 * (e.g. while reading from a file handle) rather than allocating a single
 * large string.
 */
export async function* streamHashLinesFromUtf8(
	source: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>,
	options: HashlineStreamOptions = {},
): AsyncGenerator<string> {
	const startLine = options.startLine ?? 1;
	const maxChunkLines = options.maxChunkLines ?? 200;
	const maxChunkBytes = options.maxChunkBytes ?? 64 * 1024;
	const decoder = new TextDecoder("utf-8");
	const chunks = isReadableStream(source) ? bytesFromReadableStream(source) : source;
	let lineNum = startLine;
	let pending = "";
	let sawAnyText = false;
	let endedWithNewline = false;
	let outLines: string[] = [];
	let outBytes = 0;

	const flush = (): string | undefined => {
		if (outLines.length === 0) return undefined;
		const chunk = outLines.join("\n");
		outLines = [];
		outBytes = 0;
		return chunk;
	};

	const pushLine = (line: string): string[] => {
		const formatted = `${lineNum}#${computeLineHash(lineNum, line)}:${line}`;
		lineNum++;

		const chunksToYield: string[] = [];
		const sepBytes = outLines.length === 0 ? 0 : 1; // "\n"
		const lineBytes = Buffer.byteLength(formatted, "utf-8");

		if (
			outLines.length > 0 &&
			(outLines.length >= maxChunkLines || outBytes + sepBytes + lineBytes > maxChunkBytes)
		) {
			const flushed = flush();
			if (flushed) chunksToYield.push(flushed);
		}

		outLines.push(formatted);
		outBytes += (outLines.length === 1 ? 0 : 1) + lineBytes;

		if (outLines.length >= maxChunkLines || outBytes >= maxChunkBytes) {
			const flushed = flush();
			if (flushed) chunksToYield.push(flushed);
		}

		return chunksToYield;
	};

	const consumeText = (text: string): string[] => {
		if (text.length === 0) return [];
		sawAnyText = true;
		pending += text;
		const chunksToYield: string[] = [];
		while (true) {
			const idx = pending.indexOf("\n");
			if (idx === -1) break;
			const line = pending.slice(0, idx);
			pending = pending.slice(idx + 1);
			endedWithNewline = true;
			chunksToYield.push(...pushLine(line));
		}
		if (pending.length > 0) endedWithNewline = false;
		return chunksToYield;
	};
	for await (const chunk of chunks) {
		for (const out of consumeText(decoder.decode(chunk, { stream: true }))) {
			yield out;
		}
	}

	for (const out of consumeText(decoder.decode())) {
		yield out;
	}
	if (!sawAnyText) {
		// Mirror `"".split("\n")` behavior: one empty line.
		for (const out of pushLine("")) {
			yield out;
		}
	} else if (pending.length > 0 || endedWithNewline) {
		// Emit the final line (may be empty if the file ended with a newline).
		for (const out of pushLine(pending)) {
			yield out;
		}
	}

	const last = flush();
	if (last) yield last;
}

/**
 * Stream hashline-formatted output from an (async) iterable of lines.
 *
 * Each yielded chunk is a `\n`-joined string of one or more formatted lines.
 */
export async function* streamHashLinesFromLines(
	lines: Iterable<string> | AsyncIterable<string>,
	options: HashlineStreamOptions = {},
): AsyncGenerator<string> {
	const startLine = options.startLine ?? 1;
	const maxChunkLines = options.maxChunkLines ?? 200;
	const maxChunkBytes = options.maxChunkBytes ?? 64 * 1024;

	let lineNum = startLine;
	let outLines: string[] = [];
	let outBytes = 0;
	let sawAnyLine = false;
	const flush = (): string | undefined => {
		if (outLines.length === 0) return undefined;
		const chunk = outLines.join("\n");
		outLines = [];
		outBytes = 0;
		return chunk;
	};

	const pushLine = (line: string): string[] => {
		sawAnyLine = true;
		const formatted = `${lineNum}#${computeLineHash(lineNum, line)}:${line}`;
		lineNum++;

		const chunksToYield: string[] = [];
		const sepBytes = outLines.length === 0 ? 0 : 1;
		const lineBytes = Buffer.byteLength(formatted, "utf-8");

		if (
			outLines.length > 0 &&
			(outLines.length >= maxChunkLines || outBytes + sepBytes + lineBytes > maxChunkBytes)
		) {
			const flushed = flush();
			if (flushed) chunksToYield.push(flushed);
		}

		outLines.push(formatted);
		outBytes += (outLines.length === 1 ? 0 : 1) + lineBytes;

		if (outLines.length >= maxChunkLines || outBytes >= maxChunkBytes) {
			const flushed = flush();
			if (flushed) chunksToYield.push(flushed);
		}

		return chunksToYield;
	};

	const asyncIterator = (lines as AsyncIterable<string>)[Symbol.asyncIterator];
	if (typeof asyncIterator === "function") {
		for await (const line of lines as AsyncIterable<string>) {
			for (const out of pushLine(line)) {
				yield out;
			}
		}
	} else {
		for (const line of lines as Iterable<string>) {
			for (const out of pushLine(line)) {
				yield out;
			}
		}
	}
	if (!sawAnyLine) {
		// Mirror `"".split("\n")` behavior: one empty line.
		for (const out of pushLine("")) {
			yield out;
		}
	}

	const last = flush();
	if (last) yield last;
}

/**
 * Parse a line reference string like `"5#abcd"` into structured form.
 *
 * @throws Error if the format is invalid (not `NUMBER#HEXHASH`)
 */
export function parseTag(ref: string): { line: number; hash: string } {
	// This regex captures:
	//  1. optional leading ">+" and whitespace
	//  2. line number (1+ digits)
	//  3. "#" with optional surrounding spaces
	//  4. hash (2 hex chars)
	//  5. optional trailing display suffix (":..." or "  ...")
	const match = ref.match(/^\s*[>+-]*\s*(\d+)\s*#\s*([ZPMQVRWSNKTXJBYH]{2})/);
	if (!match) {
		throw new Error(`Invalid line reference "${ref}". Expected format "LINE#ID" (e.g. "5#aa").`);
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
 * showing the correct `LINE#ID` so the caller can fix all refs at once.
 */
export class HashlineMismatchError extends Error {
	readonly remaps: ReadonlyMap<string, string>;
	constructor(
		public readonly mismatches: HashMismatch[],
		public readonly fileLines: string[],
	) {
		super(HashlineMismatchError.formatMessage(mismatches, fileLines));
		this.name = "HashlineMismatchError";
		const remaps = new Map<string, string>();
		for (const m of mismatches) {
			const actual = computeLineHash(m.line, fileLines[m.line - 1]);
			remaps.set(`${m.line}#${m.expected}`, `${m.line}#${actual}`);
		}
		this.remaps = remaps;
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
			`${mismatches.length} line${mismatches.length > 1 ? "s have" : " has"} changed since last read. Use the updated LINE#ID references shown below (>>> marks changed lines).`,
		);
		lines.push("");

		let prevLine = -1;
		for (const lineNum of sorted) {
			// Gap separator between non-contiguous regions
			if (prevLine !== -1 && lineNum > prevLine + 1) {
				lines.push("    ...");
			}
			prevLine = lineNum;

			const text = fileLines[lineNum - 1];
			const hash = computeLineHash(lineNum, text);
			const prefix = `${lineNum}#${hash}`;

			if (mismatchSet.has(lineNum)) {
				lines.push(`>>> ${prefix}:${text}`);
			} else {
				lines.push(`    ${prefix}:${text}`);
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
	if (actualHash !== ref.hash) {
		throw new HashlineMismatchError([{ line: ref.line, expected: ref.hash, actual: actualHash }], fileLines);
	}
}

function isEscapedTabAutocorrectEnabled(): boolean {
	switch (Bun.env.PI_HASHLINE_AUTOCORRECT_ESCAPED_TABS) {
		case "0":
			return false;
		case "1":
			return true;
		default:
			return true;
	}
}

function maybeAutocorrectEscapedTabIndentation(edits: HashlineEdit[], warnings: string[]): void {
	if (!isEscapedTabAutocorrectEnabled()) return;
	for (const edit of edits) {
		if (edit.lines.length === 0) continue;
		const hasEscapedTabs = edit.lines.some(line => line.includes("\\t"));
		if (!hasEscapedTabs) continue;
		const hasRealTabs = edit.lines.some(line => line.includes("\t"));
		if (hasRealTabs) continue;
		let correctedCount = 0;
		const corrected = edit.lines.map(line =>
			line.replace(/^((?:\\t)+)/, escaped => {
				correctedCount += escaped.length / 2;
				return "\t".repeat(escaped.length / 2);
			}),
		);
		if (correctedCount === 0) continue;
		edit.lines = corrected;
		warnings.push(
			`Auto-corrected escaped tab indentation in edit: converted leading \\t sequence(s) to real tab characters`,
		);
	}
}

function maybeWarnSuspiciousUnicodeEscapePlaceholder(edits: HashlineEdit[], warnings: string[]): void {
	for (const edit of edits) {
		if (edit.lines.length === 0) continue;
		if (!edit.lines.some(line => /\\uDDDD/i.test(line))) continue;
		warnings.push(
			`Detected literal \\uDDDD in edit content; no autocorrection applied. Verify whether this should be a real Unicode escape or plain text.`,
		);
	}
}
// ═══════════════════════════════════════════════════════════════════════════
// Edit Application
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Apply an array of hashline edits to file content.
 *
 * Each edit operation identifies target lines directly (`replace`,
 * `append`, `prepend`). Line references are resolved via {@link parseTag}
 * and hashes validated before any mutation.
 *
 * Edits are sorted bottom-up (highest effective line first) so earlier
 * splices don't invalidate later line numbers.
 *
 * @returns The modified content and the 1-indexed first changed line number
 */
export function applyHashlineEdits(
	text: string,
	edits: HashlineEdit[],
): {
	lines: string;
	firstChangedLine: number | undefined;
	warnings?: string[];
	noopEdits?: Array<{ editIndex: number; loc: string; current: string }>;
} {
	if (edits.length === 0) {
		return { lines: text, firstChangedLine: undefined };
	}

	const fileLines = text.split("\n");
	const originalFileLines = [...fileLines];
	let firstChangedLine: number | undefined;
	const noopEdits: Array<{ editIndex: number; loc: string; current: string }> = [];
	const warnings: string[] = [];

	// Pre-validate: collect all hash mismatches before mutating
	const mismatches: HashMismatch[] = [];
	function validateRef(ref: { line: number; hash: string }): boolean {
		if (ref.line < 1 || ref.line > fileLines.length) {
			throw new Error(`Line ${ref.line} does not exist (file has ${fileLines.length} lines)`);
		}
		const actualHash = computeLineHash(ref.line, fileLines[ref.line - 1]);
		if (actualHash === ref.hash) {
			return true;
		}
		mismatches.push({ line: ref.line, expected: ref.hash, actual: actualHash });
		return false;
	}
	for (const edit of edits) {
		switch (edit.op) {
			case "replace_line": {
				if (!validateRef(edit.pos)) continue;
				break;
			}
			case "replace_range": {
				const startValid = validateRef(edit.pos);
				const endValid = validateRef(edit.end);
				if (!startValid || !endValid) continue;
				if (edit.pos.line > edit.end.line) {
					throw new Error(`Range start line ${edit.pos.line} must be <= end line ${edit.end.line}`);
				}
				break;
			}
			case "append_at":
			case "prepend_at": {
				if (!validateRef(edit.pos)) continue;
				if (edit.lines.length === 0) {
					edit.lines = [""]; // insert an empty line
				}
				break;
			}
			case "append_file":
			case "prepend_file": {
				if (edit.lines.length === 0) {
					edit.lines = [""]; // insert an empty line
				}
				break;
			}
		}
	}
	if (mismatches.length > 0) {
		throw new HashlineMismatchError(mismatches, fileLines);
	}
	maybeAutocorrectEscapedTabIndentation(edits, warnings);
	maybeWarnSuspiciousUnicodeEscapePlaceholder(edits, warnings);

	// Warn when a replace_range/replace_line's last inserted line duplicates the next surviving line.
	// This catches the common boundary-overreach pattern where the agent includes a closing delimiter
	// in the replacement but sets `end` to the line before the delimiter, causing duplication.
	for (const edit of edits) {
		let endLine: number;
		switch (edit.op) {
			case "replace_line":
				endLine = edit.pos.line;
				break;
			case "replace_range":
				endLine = edit.end.line;
				break;
			default:
				continue;
		}
		if (edit.lines.length === 0) continue;
		const nextSurvivingIdx = endLine; // 0-indexed: endLine (1-indexed) is the next line after `end`
		if (nextSurvivingIdx >= originalFileLines.length) continue;
		const nextSurvivingLine = originalFileLines[nextSurvivingIdx];
		const lastInsertedLine = edit.lines[edit.lines.length - 1];
		const trimmedNext = nextSurvivingLine.trim();
		const trimmedLast = lastInsertedLine.trim();
		// Only warn for non-trivial lines to avoid false positives on blank lines or bare punctuation
		if (trimmedLast.length > 0 && trimmedLast === trimmedNext) {
			const tag = formatLineTag(endLine + 1, nextSurvivingLine);
			warnings.push(
				`Possible boundary duplication: your last replacement line \`${trimmedLast}\` is identical to the next surviving line ${tag}. ` +
					`If you meant to replace the entire block, set \`end\` to ${tag} instead.`,
			);
		}
	}
	// Deduplicate identical edits targeting the same line(s)
	const seenEditKeys = new Map<string, number>();
	const dedupIndices = new Set<number>();
	for (let i = 0; i < edits.length; i++) {
		const edit = edits[i];
		let lineKey: string;
		switch (edit.op) {
			case "replace_line":
				lineKey = `s:${edit.pos.line}`;
				break;
			case "replace_range":
				lineKey = `r:${edit.pos.line}:${edit.end.line}`;
				break;
			case "append_at":
				lineKey = `i:${edit.pos.line}`;
				break;
			case "prepend_at":
				lineKey = `ib:${edit.pos.line}`;
				break;
			case "append_file":
				lineKey = "ieof";
				break;
			case "prepend_file":
				lineKey = "ibef";
				break;
		}
		const dstKey = `${lineKey}:${edit.lines.join("\n")}`;
		if (seenEditKeys.has(dstKey)) {
			dedupIndices.add(i);
		} else {
			seenEditKeys.set(dstKey, i);
		}
	}
	if (dedupIndices.size > 0) {
		for (let i = edits.length - 1; i >= 0; i--) {
			if (dedupIndices.has(i)) edits.splice(i, 1);
		}
	}

	// Compute sort key (descending) — bottom-up application
	const annotated = edits.map((edit, idx) => {
		let sortLine: number;
		let precedence: number;
		switch (edit.op) {
			case "replace_line":
				sortLine = edit.pos.line;
				precedence = 0;
				break;
			case "replace_range":
				sortLine = edit.end.line;
				precedence = 0;
				break;
			case "append_at":
				sortLine = edit.pos.line;
				precedence = 1;
				break;
			case "prepend_at":
				sortLine = edit.pos.line;
				precedence = 2;
				break;
			case "append_file":
				sortLine = fileLines.length + 1;
				precedence = 1;
				break;
			case "prepend_file":
				sortLine = 0;
				precedence = 2;
				break;
		}
		return { edit, idx, sortLine, precedence };
	});

	annotated.sort((a, b) => b.sortLine - a.sortLine || a.precedence - b.precedence || a.idx - b.idx);

	// Apply edits bottom-up
	for (const { edit, idx } of annotated) {
		switch (edit.op) {
			case "replace_line": {
				const origLines = originalFileLines.slice(edit.pos.line - 1, edit.pos.line);
				const newLines = edit.lines;
				if (origLines.length === newLines.length && origLines.every((line, i) => line === newLines[i])) {
					noopEdits.push({
						editIndex: idx,
						loc: `${edit.pos.line}#${edit.pos.hash}`,
						current: origLines.join("\n"),
					});
					break;
				}
				fileLines.splice(edit.pos.line - 1, 1, ...newLines);
				trackFirstChanged(edit.pos.line);
				break;
			}
			case "replace_range": {
				const count = edit.end.line - edit.pos.line + 1;
				fileLines.splice(edit.pos.line - 1, count, ...edit.lines);
				trackFirstChanged(edit.pos.line);
				break;
			}
			case "append_at": {
				const inserted = edit.lines;
				if (inserted.length === 0) {
					noopEdits.push({
						editIndex: idx,
						loc: `${edit.pos.line}#${edit.pos.hash}`,
						current: originalFileLines[edit.pos.line - 1],
					});
					break;
				}
				fileLines.splice(edit.pos.line, 0, ...inserted);
				trackFirstChanged(edit.pos.line + 1);
				break;
			}
			case "prepend_at": {
				const inserted = edit.lines;
				if (inserted.length === 0) {
					noopEdits.push({
						editIndex: idx,
						loc: `${edit.pos.line}#${edit.pos.hash}`,
						current: originalFileLines[edit.pos.line - 1],
					});
					break;
				}
				fileLines.splice(edit.pos.line - 1, 0, ...inserted);
				trackFirstChanged(edit.pos.line);
				break;
			}
			case "append_file": {
				const inserted = edit.lines;
				if (inserted.length === 0) {
					noopEdits.push({ editIndex: idx, loc: "EOF", current: "" });
					break;
				}
				if (fileLines.length === 1 && fileLines[0] === "") {
					fileLines.splice(0, 1, ...inserted);
					trackFirstChanged(1);
				} else {
					fileLines.splice(fileLines.length, 0, ...inserted);
					trackFirstChanged(fileLines.length - inserted.length + 1);
				}
				break;
			}
			case "prepend_file": {
				const inserted = edit.lines;
				if (inserted.length === 0) {
					noopEdits.push({ editIndex: idx, loc: "BOF", current: "" });
					break;
				}
				if (fileLines.length === 1 && fileLines[0] === "") {
					fileLines.splice(0, 1, ...inserted);
				} else {
					fileLines.splice(0, 0, ...inserted);
				}
				trackFirstChanged(1);
				break;
			}
		}
	}

	return {
		lines: fileLines.join("\n"),
		firstChangedLine,
		...(warnings.length > 0 ? { warnings } : {}),
		...(noopEdits.length > 0 ? { noopEdits } : {}),
	};

	function trackFirstChanged(line: number): void {
		if (firstChangedLine === undefined || line < firstChangedLine) {
			firstChangedLine = line;
		}
	}
}

export interface CompactHashlineDiffPreview {
	preview: string;
	addedLines: number;
	removedLines: number;
}

export interface CompactHashlineDiffOptions {
	maxUnchangedRun?: number;
	maxAdditionRun?: number;
	maxDeletionRun?: number;
	maxOutputLines?: number;
}

const NUMBERED_DIFF_LINE_RE = /^([ +-])(\s*\d+)\|(.*)$/;
const HASHLINE_PREVIEW_PLACEHOLDER = "   ";

type DiffRunKind = " " | "+" | "-" | "meta";
type DiffRun = { kind: DiffRunKind; lines: string[] };

interface ParsedNumberedDiffLine {
	kind: " " | "+" | "-";
	lineNumber: number;
	lineWidth: number;
	content: string;
	raw: string;
}

interface CompactPreviewCounters {
	oldLine?: number;
	newLine?: number;
}

function parseNumberedDiffLine(line: string): ParsedNumberedDiffLine | undefined {
	const match = NUMBERED_DIFF_LINE_RE.exec(line);
	if (!match) return undefined;

	const kind = match[1];
	if (kind !== " " && kind !== "+" && kind !== "-") return undefined;

	const lineField = match[2];
	const lineNumber = Number(lineField.trim());
	if (!Number.isInteger(lineNumber)) return undefined;

	return { kind, lineNumber, lineWidth: lineField.length, content: match[3], raw: line };
}

function syncOldLineCounters(counters: CompactPreviewCounters, lineNumber: number): void {
	if (counters.oldLine === undefined || counters.newLine === undefined) {
		counters.oldLine = lineNumber;
		counters.newLine = lineNumber;
		return;
	}

	const delta = lineNumber - counters.oldLine;
	counters.oldLine = lineNumber;
	counters.newLine += delta;
}

function syncNewLineCounters(counters: CompactPreviewCounters, lineNumber: number): void {
	if (counters.oldLine === undefined || counters.newLine === undefined) {
		counters.oldLine = lineNumber;
		counters.newLine = lineNumber;
		return;
	}

	const delta = lineNumber - counters.newLine;
	counters.oldLine += delta;
	counters.newLine = lineNumber;
}

function formatCompactHashlineLine(kind: " " | "+", lineNumber: number, width: number, content: string): string {
	const padded = String(lineNumber).padStart(width, " ");
	return `${kind}${padded}#${computeLineHash(lineNumber, content)}|${content}`;
}

function formatCompactRemovedLine(lineNumber: number, width: number, content: string): string {
	const padded = String(lineNumber).padStart(width, " ");
	return `-${padded}${HASHLINE_PREVIEW_PLACEHOLDER}|${content}`;
}

function formatCompactPreviewLine(line: string, counters: CompactPreviewCounters): { kind: DiffRunKind; text: string } {
	const parsed = parseNumberedDiffLine(line);
	if (!parsed) return { kind: "meta", text: line };

	if (parsed.content === "...") {
		if (parsed.kind === "+") {
			syncNewLineCounters(counters, parsed.lineNumber);
		} else {
			syncOldLineCounters(counters, parsed.lineNumber);
		}
		return { kind: parsed.kind, text: parsed.raw };
	}

	switch (parsed.kind) {
		case "+": {
			syncNewLineCounters(counters, parsed.lineNumber);
			const newLine = counters.newLine;
			if (newLine === undefined) return { kind: "+", text: parsed.raw };
			const text = formatCompactHashlineLine("+", newLine, parsed.lineWidth, parsed.content);
			counters.newLine = newLine + 1;
			return { kind: "+", text };
		}
		case "-": {
			syncOldLineCounters(counters, parsed.lineNumber);
			const text = formatCompactRemovedLine(parsed.lineNumber, parsed.lineWidth, parsed.content);
			counters.oldLine = parsed.lineNumber + 1;
			return { kind: "-", text };
		}
		case " ": {
			syncOldLineCounters(counters, parsed.lineNumber);
			const newLine = counters.newLine;
			if (newLine === undefined) return { kind: " ", text: parsed.raw };
			const text = formatCompactHashlineLine(" ", newLine, parsed.lineWidth, parsed.content);
			counters.oldLine = parsed.lineNumber + 1;
			counters.newLine = newLine + 1;
			return { kind: " ", text };
		}
	}
}

function splitDiffRuns(lines: string[]): DiffRun[] {
	const runs: DiffRun[] = [];
	const counters: CompactPreviewCounters = {};

	for (const line of lines) {
		const formatted = formatCompactPreviewLine(line, counters);
		const prev = runs[runs.length - 1];
		if (prev && prev.kind === formatted.kind) {
			prev.lines.push(formatted.text);
			continue;
		}
		runs.push({ kind: formatted.kind, lines: [formatted.text] });
	}

	return runs;
}

function collapseFromStart(lines: string[], maxLines: number, label: string): string[] {
	if (lines.length <= maxLines) return lines;
	const hidden = lines.length - maxLines;
	return [...lines.slice(0, maxLines), ` ... ${hidden} more ${label} lines`];
}

function collapseFromEnd(lines: string[], maxLines: number, label: string): string[] {
	if (lines.length <= maxLines) return lines;
	const hidden = lines.length - maxLines;
	return [` ... ${hidden} more ${label} lines`, ...lines.slice(-maxLines)];
}

function collapseFromMiddle(lines: string[], maxLines: number, label: string): string[] {
	if (lines.length <= maxLines * 2) return lines;
	const hidden = lines.length - maxLines * 2;
	return [...lines.slice(0, maxLines), ` ... ${hidden} more ${label} lines`, ...lines.slice(-maxLines)];
}

/**
 * Build a compact diff preview suitable for model-visible tool responses.
 *
 * Collapses long unchanged runs and long consecutive additions/removals so the
 * model sees the shape of edits without replaying full file content.
 */
export function buildCompactHashlineDiffPreview(
	diff: string,
	options: CompactHashlineDiffOptions = {},
): CompactHashlineDiffPreview {
	const maxUnchangedRun = options.maxUnchangedRun ?? 2;
	const maxAdditionRun = options.maxAdditionRun ?? 2;
	const maxDeletionRun = options.maxDeletionRun ?? 2;
	const maxOutputLines = options.maxOutputLines ?? 16;

	const inputLines = diff.length === 0 ? [] : diff.split("\n");
	const runs = splitDiffRuns(inputLines);

	const out: string[] = [];
	let addedLines = 0;
	let removedLines = 0;

	for (let runIndex = 0; runIndex < runs.length; runIndex++) {
		const run = runs[runIndex];
		switch (run.kind) {
			case "meta":
				out.push(...run.lines);
				break;
			case "+":
				addedLines += run.lines.length;
				out.push(...collapseFromStart(run.lines, maxAdditionRun, "added"));
				break;
			case "-":
				removedLines += run.lines.length;
				out.push(...collapseFromStart(run.lines, maxDeletionRun, "removed"));
				break;
			case " ":
				if (runIndex === 0) {
					out.push(...collapseFromEnd(run.lines, maxUnchangedRun, "unchanged"));
					break;
				}
				if (runIndex === runs.length - 1) {
					out.push(...collapseFromStart(run.lines, maxUnchangedRun, "unchanged"));
					break;
				}
				out.push(...collapseFromMiddle(run.lines, maxUnchangedRun, "unchanged"));
				break;
		}
	}

	if (out.length > maxOutputLines) {
		const hidden = out.length - maxOutputLines;
		return {
			preview: [...out.slice(0, maxOutputLines), ` ... ${hidden} more preview lines`].join("\n"),
			addedLines,
			removedLines,
		};
	}

	return { preview: out.join("\n"), addedLines, removedLines };
}
