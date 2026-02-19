/**
 * Hashline edit mode — a line-addressable edit format using content hashes.
 *
 * Each line in a file is identified by its 1-indexed line number and a short
 * base36 hash derived from the normalized line content (xxHash32, truncated to 4
 * base36 chars).
 * The combined `LINE#ID` reference acts as both an address and a staleness check:
 * if the file has changed since the caller last read it, hash mismatches are caught
 * before any mutation occurs.
 *
 * Displayed format: `LINENUM#HASH|CONTENT`
 * Reference format: `"LINENUM#HASH"` (e.g. `"5#a3f2"`)
 */

import type { HashlineEdit } from "./index";
import type { HashMismatch } from "./types";

type ParsedRefs =
	| { kind: "single"; ref: { line: number; hash: string } }
	| { kind: "range"; start: { line: number; hash: string }; end: { line: number; hash: string } }
	| { kind: "insertAfter"; after: { line: number; hash: string } }
	| { kind: "insertBefore"; before: { line: number; hash: string } }
	| { kind: "insertBetween"; after: { line: number; hash: string }; before: { line: number; hash: string } }
	| { kind: "insertAtEof" };

function parseHashlineEdit(edit: HashlineEdit): { spec: ParsedRefs; dstLines: string[] } {
	if ("set" in edit) {
		return {
			spec: { kind: "single", ref: parseLineRef(edit.set.ref) },
			dstLines: edit.set.body,
		};
	}
	if ("set_range" in edit) {
		const r = edit.set_range as Record<string, unknown>;
		const start = parseLineRef(r.beg as string);
		if (!r.end) {
			return {
				spec: { kind: "single", ref: start },
				dstLines: Array.isArray(r.body) ? (r.body as string[]) : splitDstLines(String(r.body ?? "")),
			};
		}
		const end = parseLineRef(r.end as string);
		return {
			spec: start.line === end.line ? { kind: "single", ref: start } : { kind: "range", start, end },
			dstLines: Array.isArray(r.body) ? (r.body as string[]) : splitDstLines(String(r.body ?? "")),
		};
	}
	if ("insert" in edit) {
		const r = edit.insert as Record<string, unknown>;
		const dstLines = Array.isArray(r.body) ? (r.body as string[]) : splitDstLines(String(r.text ?? r.content ?? ""));
		const hasAfterField = "after" in r;
		const hasBeforeField = "before" in r;
		const afterRef = r.after;
		const beforeRef = r.before;
		if (hasAfterField && (typeof afterRef !== "string" || afterRef.trim().length === 0)) {
			throw new Error('insert.after must be a non-empty "LINE#ID" string when provided');
		}
		if (hasBeforeField && (typeof beforeRef !== "string" || beforeRef.trim().length === 0)) {
			throw new Error('insert.before must be a non-empty "LINE#ID" string when provided');
		}
		const hasAfter = hasAfterField && typeof afterRef === "string";
		const hasBefore = hasBeforeField && typeof beforeRef === "string";
		if (hasAfter && hasBefore) {
			return {
				spec: {
					kind: "insertBetween",
					after: parseLineRef(afterRef),
					before: parseLineRef(beforeRef),
				},
				dstLines,
			};
		}
		if (hasAfter) {
			return {
				spec: { kind: "insertAfter", after: parseLineRef(afterRef) },
				dstLines,
			};
		}
		if (hasBefore) {
			return {
				spec: { kind: "insertBefore", before: parseLineRef(beforeRef) },
				dstLines,
			};
		}
		return { spec: { kind: "insertAtEof" }, dstLines };
	}
	if ("replace" in edit) {
		throw new Error("replace edits are applied separately; do not pass them to applyHashlineEdits");
	}
	throw new Error("Unknown hashline edit operation");
}
/** Split dst into lines; empty string means delete (no lines). */
function splitDstLines(dst: string): string[] {
	return dst === "" ? [] : dst.split("\n");
}

/** Pattern matching hashline display format: `LINE#ID|CONTENT` */
const HASHLINE_PREFIX_RE = /^\s*(?:>>>|>>)?\s*\d+#[0-9a-zA-Z]{1,16}\|/;

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

function stripAllWhitespace(s: string): string {
	return s.replace(/\s+/g, "");
}

function stripTrailingContinuationTokens(s: string): string {
	// Heuristic: models often merge a continuation line into the prior line
	// while also changing the trailing operator (e.g. `&&` → `||`).
	// Strip common trailing continuation tokens so we can still detect merges.
	return s.replace(/(?:&&|\|\||\?\?|\?|:|=|,|\+|-|\*|\/|\.|\()\s*$/u, "");
}

function stripMergeOperatorChars(s: string): string {
	// Used for merge detection when the model changes a logical operator like
	// `||` → `??` while also merging adjacent lines.
	return s.replace(/[|&?]/g, "");
}

function leadingWhitespace(s: string): string {
	const match = s.match(/^\s*/);
	return match ? match[0] : "";
}

function restoreLeadingIndent(templateLine: string, line: string): string {
	if (line.length === 0) return line;
	const templateIndent = leadingWhitespace(templateLine);
	if (templateIndent.length === 0) return line;
	const indent = leadingWhitespace(line);
	if (indent.length > 0) return line;
	return templateIndent + line;
}

const CONFUSABLE_HYPHENS_RE = /[\u2010\u2011\u2012\u2013\u2014\u2212\uFE63\uFF0D]/g;

function normalizeConfusableHyphens(s: string): string {
	return s.replace(CONFUSABLE_HYPHENS_RE, "-");
}

function normalizeConfusableHyphensInLines(lines: string[]): string[] {
	return lines.map(l => normalizeConfusableHyphens(l));
}

function restoreIndentForPairedReplacement(oldLines: string[], newLines: string[]): string[] {
	if (oldLines.length !== newLines.length) return newLines;
	let changed = false;
	const out = new Array<string>(newLines.length);
	for (let i = 0; i < newLines.length; i++) {
		const restored = restoreLeadingIndent(oldLines[i], newLines[i]);
		out[i] = restored;
		if (restored !== newLines[i]) changed = true;
	}
	return changed ? out : newLines;
}

/**
 * Undo pure formatting rewrites where the model reflows a single logical line
 * into multiple lines (or similar), but the token stream is identical.
 */
function restoreOldWrappedLines(oldLines: string[], newLines: string[]): string[] {
	if (oldLines.length === 0 || newLines.length < 2) return newLines;

	const canonToOld = new Map<string, { line: string; count: number }>();
	for (const line of oldLines) {
		const canon = stripAllWhitespace(line);
		const bucket = canonToOld.get(canon);
		if (bucket) bucket.count++;
		else canonToOld.set(canon, { line, count: 1 });
	}

	const candidates: { start: number; len: number; replacement: string; canon: string }[] = [];
	for (let start = 0; start < newLines.length; start++) {
		for (let len = 2; len <= 10 && start + len <= newLines.length; len++) {
			const canonSpan = stripAllWhitespace(newLines.slice(start, start + len).join(""));
			const old = canonToOld.get(canonSpan);
			if (old && old.count === 1 && canonSpan.length >= 6) {
				candidates.push({ start, len, replacement: old.line, canon: canonSpan });
			}
		}
	}
	if (candidates.length === 0) return newLines;

	// Keep only spans whose canonical match is unique in the new output.
	const canonCounts = new Map<string, number>();
	for (const c of candidates) {
		canonCounts.set(c.canon, (canonCounts.get(c.canon) ?? 0) + 1);
	}
	const uniqueCandidates = candidates.filter(c => (canonCounts.get(c.canon) ?? 0) === 1);
	if (uniqueCandidates.length === 0) return newLines;

	// Apply replacements back-to-front so indices remain stable.
	uniqueCandidates.sort((a, b) => b.start - a.start);
	const out = [...newLines];
	for (const c of uniqueCandidates) {
		out.splice(c.start, c.len, c.replacement);
	}
	return out;
}

function stripInsertAnchorEchoAfter(anchorLine: string, dstLines: string[]): string[] {
	if (dstLines.length <= 1) return dstLines;
	if (equalsIgnoringWhitespace(dstLines[0], anchorLine)) {
		return dstLines.slice(1);
	}
	return dstLines;
}

function stripInsertAnchorEchoBefore(anchorLine: string, dstLines: string[]): string[] {
	if (dstLines.length <= 1) return dstLines;
	if (equalsIgnoringWhitespace(dstLines[dstLines.length - 1], anchorLine)) {
		return dstLines.slice(0, -1);
	}
	return dstLines;
}

function stripInsertBoundaryEcho(afterLine: string, beforeLine: string, dstLines: string[]): string[] {
	let out = dstLines;
	if (out.length > 1 && equalsIgnoringWhitespace(out[0], afterLine)) {
		out = out.slice(1);
	}
	if (out.length > 1 && equalsIgnoringWhitespace(out[out.length - 1], beforeLine)) {
		out = out.slice(0, -1);
	}
	return out;
}

function stripRangeBoundaryEcho(fileLines: string[], startLine: number, endLine: number, dstLines: string[]): string[] {
	// Only strip when the model replaced with multiple lines and grew the edit.
	// This avoids turning a single-line replacement into a deletion.
	const count = endLine - startLine + 1;
	if (dstLines.length <= 1 || dstLines.length <= count) return dstLines;

	let out = dstLines;
	const beforeIdx = startLine - 2;
	if (beforeIdx >= 0 && equalsIgnoringWhitespace(out[0], fileLines[beforeIdx])) {
		out = out.slice(1);
	}

	const afterIdx = endLine;
	if (
		afterIdx < fileLines.length &&
		out.length > 0 &&
		equalsIgnoringWhitespace(out[out.length - 1], fileLines[afterIdx])
	) {
		out = out.slice(0, -1);
	}

	return out;
}

/**
 * Strip hashline display prefixes and diff `+` markers from replacement lines.
 *
 * Models frequently copy the `LINE#ID  ` prefix from read output into their
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
const RADIX = 16;
const HASH_MOD = RADIX ** HASH_LEN;

const DICT = Array.from({ length: HASH_MOD }, (_, i) => i.toString(RADIX).padStart(HASH_LEN, "0"));

/**
 * Compute a short base36 hash of a single line.
 *
 * Uses xxHash64 on a whitespace-normalized line, truncated to {@link HASH_LEN}
 * base36 characters. The `idx` parameter is accepted for compatibility with older
 * call sites, but is not currently mixed into the hash.
 * The line input should not include a trailing newline.
 */
export function computeLineHash(idx: number, line: string): string {
	if (line.endsWith("\r")) {
		line = line.slice(0, -1);
	}
	line = line.replace(/\s+/g, "");
	void idx; // Might use line, but for now, let's not.
	return DICT[Bun.hash.xxHash32(line) % HASH_MOD];
}

/**
 * Format file content with hashline prefixes for display.
 *
 * Each line becomes `LINENUM#HASH|CONTENT` where LINENUM is 1-indexed.
 *
 * @param content - Raw file content string
 * @param startLine - First line number (1-indexed, defaults to 1)
 * @returns Formatted string with one hashline-prefixed line per input line
 *
 * @example
 * ```
 * formatHashLines("function hi() {\n  return;\n}")
 * // "1#HH|function hi() {\n2#HH|  return;\n3#HH|}"
 * ```
 */
export function formatHashLines(content: string, startLine = 1): string {
	const lines = content.split("\n");
	return lines
		.map((line, i) => {
			const num = startLine + i;
			const hash = computeLineHash(num, line);
			return `${num}#${hash}|${line}`;
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
		const formatted = `${lineNum}#${computeLineHash(lineNum, line)}|${line}`;
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
		const formatted = `${lineNum}#${computeLineHash(lineNum, line)}|${line}`;
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
export function parseLineRef(ref: string): { line: number; hash: string } {
	// Strip display-format suffix: "5#ab|some content" → "5#ab", or legacy "5#ab  some content" → "5#ab"
	// Models often copy the full display format from read output.
	const cleaned = ref
		.replace(/\|.*$/, "")
		.replace(/ {2}.*$/, "")
		.replace(/^>+\s*/, "")
		.trim();
	const normalized = cleaned.replace(/\s*#\s*/, "#");
	const strictMatch = normalized.match(/^(\d+)#([0-9a-zA-Z]{1,16})$/);
	const prefixMatch = strictMatch ? null : normalized.match(new RegExp(`^(\\d+)#([0-9a-zA-Z]{${HASH_LEN}})`));
	const match = strictMatch ?? prefixMatch;
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

			const content = fileLines[lineNum - 1];
			const hash = computeLineHash(lineNum, content);
			const prefix = `${lineNum}#${hash}`;

			if (mismatchSet.has(lineNum)) {
				lines.push(`>>> ${prefix}|${content}`);
			} else {
				lines.push(`    ${prefix}|${content}`);
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
 * Each edit operation identifies target lines directly (`set`, `set_range`,
 * `insert`). Line references are resolved via {@link parseLineRef}
 * and hashes validated before any mutation.
 *
 * Edits are sorted bottom-up (highest effective line first) so earlier
 * splices don't invalidate later line numbers.
 *
 * @returns The modified content and the 1-indexed first changed line number
 */
export function applyHashlineEdits(
	content: string,
	edits: HashlineEdit[],
): {
	content: string;
	firstChangedLine: number | undefined;
	warnings?: string[];
	noopEdits?: Array<{ editIndex: number; loc: string; currentContent: string }>;
} {
	if (edits.length === 0) {
		return { content, firstChangedLine: undefined };
	}

	const fileLines = content.split("\n");
	const originalFileLines = [...fileLines];
	let firstChangedLine: number | undefined;
	const noopEdits: Array<{ editIndex: number; loc: string; currentContent: string }> = [];

	const autocorrect = Bun.env.PI_HL_AUTOCORRECT === "1";

	// Parse src specs and dst lines up front
	const parsed = edits.map(edit => {
		const parsedEdit = parseHashlineEdit(edit);
		return {
			spec: parsedEdit.spec,
			dstLines: stripNewLinePrefixes(parsedEdit.dstLines),
		};
	});

	function collectExplicitlyTouchedLines(): Set<number> {
		const touched = new Set<number>();
		for (const { spec } of parsed) {
			switch (spec.kind) {
				case "single":
					touched.add(spec.ref.line);
					break;
				case "range":
					for (let ln = spec.start.line; ln <= spec.end.line; ln++) touched.add(ln);
					break;
				case "insertAfter":
					touched.add(spec.after.line);
					break;
				case "insertBefore":
					touched.add(spec.before.line);
					break;
				case "insertBetween":
					touched.add(spec.after.line);
					touched.add(spec.before.line);
					break;
				case "insertAtEof":
					break;
			}
		}
		return touched;
	}

	const explicitlyTouchedLines = collectExplicitlyTouchedLines();
	// Pre-validate: collect all hash mismatches before mutating
	const mismatches: HashMismatch[] = [];
	function validateRef(ref: { line: number; hash: string }): boolean {
		if (ref.line < 1 || ref.line > fileLines.length) {
			throw new Error(`Line ${ref.line} does not exist (file has ${fileLines.length} lines)`);
		}
		const actualHash = computeLineHash(ref.line, fileLines[ref.line - 1]);
		if (actualHash === ref.hash.toLowerCase()) {
			return true;
		}
		mismatches.push({ line: ref.line, expected: ref.hash, actual: actualHash });
		return false;
	}
	for (const { spec, dstLines } of parsed) {
		switch (spec.kind) {
			case "single": {
				if (!validateRef(spec.ref)) continue;
				break;
			}
			case "insertAfter": {
				if (dstLines.length === 0) {
					throw new Error('Insert-after edit (src "N#HH..") requires non-empty dst');
				}
				if (!validateRef(spec.after)) continue;
				break;
			}
			case "insertBefore": {
				if (dstLines.length === 0) {
					throw new Error('Insert-before edit (src "N#HH..") requires non-empty dst');
				}
				if (!validateRef(spec.before)) continue;
				break;
			}
			case "insertBetween": {
				if (dstLines.length === 0) {
					throw new Error('Insert-between edit (src "A#HH.. B#HH..") requires non-empty dst');
				}
				if (spec.before.line !== spec.after.line + 1) {
					throw new Error(
						`insert requires adjacent anchors (after ${spec.after.line}, before ${spec.before.line})`,
					);
				}
				const afterValid = validateRef(spec.after);
				const beforeValid = validateRef(spec.before);
				if (!afterValid || !beforeValid) continue;
				break;
			}
			case "insertAtEof": {
				if (dstLines.length === 0) {
					throw new Error("Insert-at-EOF edit requires non-empty dst");
				}
				break;
			}
			case "range": {
				if (spec.start.line > spec.end.line) {
					throw new Error(`Range start line ${spec.start.line} must be <= end line ${spec.end.line}`);
				}

				const startValid = validateRef(spec.start);
				const endValid = validateRef(spec.end);
				if (!startValid || !endValid) continue;
				break;
			}
		}
	}
	if (mismatches.length > 0) {
		throw new HashlineMismatchError(mismatches, fileLines);
	}
	// Deduplicate identical edits targeting the same line(s)
	const seenEditKeys = new Map<string, number>();
	const dedupIndices = new Set<number>();
	for (let i = 0; i < parsed.length; i++) {
		const p = parsed[i];
		let lineKey: string;
		switch (p.spec.kind) {
			case "single":
				lineKey = `s:${p.spec.ref.line}`;
				break;
			case "range":
				lineKey = `r:${p.spec.start.line}:${p.spec.end.line}`;
				break;
			case "insertAfter":
				lineKey = `i:${p.spec.after.line}`;
				break;
			case "insertBefore":
				lineKey = `ib:${p.spec.before.line}`;
				break;
			case "insertBetween":
				lineKey = `ix:${p.spec.after.line}:${p.spec.before.line}`;
				break;
			case "insertAtEof":
				lineKey = "ieof";
				break;
		}
		const dstKey = `${lineKey}|${p.dstLines.join("\n")}`;
		if (seenEditKeys.has(dstKey)) {
			dedupIndices.add(i);
		} else {
			seenEditKeys.set(dstKey, i);
		}
	}
	if (dedupIndices.size > 0) {
		for (let i = parsed.length - 1; i >= 0; i--) {
			if (dedupIndices.has(i)) parsed.splice(i, 1);
		}
	}

	// Compute sort key (descending) — bottom-up application
	const annotated = parsed.map((p, idx) => {
		let sortLine: number;
		let precedence: number;
		switch (p.spec.kind) {
			case "single":
				sortLine = p.spec.ref.line;
				precedence = 0;
				break;
			case "range":
				sortLine = p.spec.end.line;
				precedence = 0;
				break;
			case "insertAfter":
				sortLine = p.spec.after.line;
				precedence = 1;
				break;
			case "insertBefore":
				sortLine = p.spec.before.line;
				precedence = 2;
				break;
			case "insertBetween":
				sortLine = p.spec.before.line;
				precedence = 3;
				break;
			case "insertAtEof":
				sortLine = fileLines.length + 1;
				precedence = 4;
				break;
		}
		return { ...p, idx, sortLine, precedence };
	});

	annotated.sort((a, b) => b.sortLine - a.sortLine || a.precedence - b.precedence || a.idx - b.idx);

	// Apply edits bottom-up
	for (const { spec, dstLines, idx } of annotated) {
		switch (spec.kind) {
			case "single": {
				const merged = autocorrect ? maybeExpandSingleLineMerge(spec.ref.line, dstLines) : null;
				if (merged) {
					const origLines = originalFileLines.slice(
						merged.startLine - 1,
						merged.startLine - 1 + merged.deleteCount,
					);
					let nextLines = merged.newLines;
					nextLines = restoreIndentForPairedReplacement([origLines[0] ?? ""], nextLines);
					if (
						origLines.join("\n") === nextLines.join("\n") &&
						origLines.some(l => CONFUSABLE_HYPHENS_RE.test(l))
					) {
						nextLines = normalizeConfusableHyphensInLines(nextLines);
					}
					if (origLines.join("\n") === nextLines.join("\n")) {
						noopEdits.push({
							editIndex: idx,
							loc: `${spec.ref.line}#${spec.ref.hash}`,
							currentContent: origLines.join("\n"),
						});
						break;
					}
					fileLines.splice(merged.startLine - 1, merged.deleteCount, ...nextLines);
					trackFirstChanged(merged.startLine);
					break;
				}

				const count = 1;
				const origLines = originalFileLines.slice(spec.ref.line - 1, spec.ref.line);
				let stripped = autocorrect
					? stripRangeBoundaryEcho(originalFileLines, spec.ref.line, spec.ref.line, dstLines)
					: dstLines;
				stripped = autocorrect ? restoreOldWrappedLines(origLines, stripped) : stripped;
				let newLines = autocorrect ? restoreIndentForPairedReplacement(origLines, stripped) : stripped;
				if (
					autocorrect &&
					origLines.join("\n") === newLines.join("\n") &&
					origLines.some(l => CONFUSABLE_HYPHENS_RE.test(l))
				) {
					newLines = normalizeConfusableHyphensInLines(newLines);
				}
				if (origLines.join("\n") === newLines.join("\n")) {
					noopEdits.push({
						editIndex: idx,
						loc: `${spec.ref.line}#${spec.ref.hash}`,
						currentContent: origLines.join("\n"),
					});
					break;
				}
				fileLines.splice(spec.ref.line - 1, count, ...newLines);
				trackFirstChanged(spec.ref.line);
				break;
			}
			case "range": {
				const count = spec.end.line - spec.start.line + 1;
				const origLines = originalFileLines.slice(spec.start.line - 1, spec.start.line - 1 + count);
				let stripped = autocorrect
					? stripRangeBoundaryEcho(originalFileLines, spec.start.line, spec.end.line, dstLines)
					: dstLines;
				stripped = autocorrect ? restoreOldWrappedLines(origLines, stripped) : stripped;
				let newLines = autocorrect ? restoreIndentForPairedReplacement(origLines, stripped) : stripped;
				if (
					autocorrect &&
					origLines.join("\n") === newLines.join("\n") &&
					origLines.some(l => CONFUSABLE_HYPHENS_RE.test(l))
				) {
					newLines = normalizeConfusableHyphensInLines(newLines);
				}
				if (origLines.join("\n") === newLines.join("\n")) {
					noopEdits.push({
						editIndex: idx,
						loc: `${spec.start.line}#${spec.start.hash}`,
						currentContent: origLines.join("\n"),
					});
					break;
				}
				fileLines.splice(spec.start.line - 1, count, ...newLines);
				trackFirstChanged(spec.start.line);
				break;
			}
			case "insertAfter": {
				const anchorLine = originalFileLines[spec.after.line - 1];
				const inserted = autocorrect ? stripInsertAnchorEchoAfter(anchorLine, dstLines) : dstLines;
				if (inserted.length === 0) {
					noopEdits.push({
						editIndex: idx,
						loc: `${spec.after.line}#${spec.after.hash}`,
						currentContent: originalFileLines[spec.after.line - 1],
					});
					break;
				}
				fileLines.splice(spec.after.line, 0, ...inserted);
				trackFirstChanged(spec.after.line + 1);
				break;
			}
			case "insertBefore": {
				const anchorLine = originalFileLines[spec.before.line - 1];
				const inserted = autocorrect ? stripInsertAnchorEchoBefore(anchorLine, dstLines) : dstLines;
				if (inserted.length === 0) {
					noopEdits.push({
						editIndex: idx,
						loc: `${spec.before.line}#${spec.before.hash}`,
						currentContent: originalFileLines[spec.before.line - 1],
					});
					break;
				}
				fileLines.splice(spec.before.line - 1, 0, ...inserted);
				trackFirstChanged(spec.before.line);
				break;
			}
			case "insertBetween": {
				const afterLine = originalFileLines[spec.after.line - 1];
				const beforeLine = originalFileLines[spec.before.line - 1];
				const inserted = autocorrect ? stripInsertBoundaryEcho(afterLine, beforeLine, dstLines) : dstLines;
				if (inserted.length === 0) {
					noopEdits.push({
						editIndex: idx,
						loc: `${spec.after.line}#${spec.after.hash}..${spec.before.line}#${spec.before.hash}`,
						currentContent: `${afterLine}\n${beforeLine}`,
					});
					break;
				}
				fileLines.splice(spec.before.line - 1, 0, ...inserted);
				trackFirstChanged(spec.before.line);
				break;
			}
			case "insertAtEof": {
				if (fileLines.length === 1 && fileLines[0] === "") {
					fileLines.splice(0, 1, ...dstLines);
					trackFirstChanged(1);
					break;
				}
				fileLines.splice(fileLines.length, 0, ...dstLines);
				trackFirstChanged(fileLines.length - dstLines.length + 1);
				break;
			}
		}
	}

	return {
		content: fileLines.join("\n"),
		firstChangedLine,
		...(noopEdits.length > 0 ? { noopEdits } : {}),
	};

	function trackFirstChanged(line: number): void {
		if (firstChangedLine === undefined || line < firstChangedLine) {
			firstChangedLine = line;
		}
	}

	function maybeExpandSingleLineMerge(
		line: number,
		dst: string[],
	): { startLine: number; deleteCount: number; newLines: string[] } | null {
		if (dst.length !== 1) return null;
		if (line < 1 || line > fileLines.length) return null;

		const newLine = dst[0];
		const newCanon = stripAllWhitespace(newLine);
		const newCanonForMergeOps = stripMergeOperatorChars(newCanon);
		if (newCanon.length === 0) return null;

		const orig = fileLines[line - 1];
		const origCanon = stripAllWhitespace(orig);
		const origCanonForMatch = stripTrailingContinuationTokens(origCanon);
		const origCanonForMergeOps = stripMergeOperatorChars(origCanon);
		const origLooksLikeContinuation = origCanonForMatch.length < origCanon.length;
		if (origCanon.length === 0) return null;
		const nextIdx = line;
		const prevIdx = line - 2;
		// Case A: dst absorbed the next continuation line.
		if (origLooksLikeContinuation && nextIdx < fileLines.length && !explicitlyTouchedLines.has(line + 1)) {
			const next = fileLines[nextIdx];
			const nextCanon = stripAllWhitespace(next);
			const a = newCanon.indexOf(origCanonForMatch);
			const b = newCanon.indexOf(nextCanon);
			if (a !== -1 && b !== -1 && a < b && newCanon.length <= origCanon.length + nextCanon.length + 32) {
				return { startLine: line, deleteCount: 2, newLines: [newLine] };
			}
		}
		// Case B: dst absorbed the previous declaration/continuation line.
		if (prevIdx >= 0 && !explicitlyTouchedLines.has(line - 1)) {
			const prev = fileLines[prevIdx];
			const prevCanon = stripAllWhitespace(prev);
			const prevCanonForMatch = stripTrailingContinuationTokens(prevCanon);
			const prevLooksLikeContinuation = prevCanonForMatch.length < prevCanon.length;
			if (!prevLooksLikeContinuation) return null;
			const a = newCanonForMergeOps.indexOf(stripMergeOperatorChars(prevCanonForMatch));
			const b = newCanonForMergeOps.indexOf(origCanonForMergeOps);
			if (a !== -1 && b !== -1 && a < b && newCanon.length <= prevCanon.length + origCanon.length + 32) {
				return { startLine: line - 1, deleteCount: 2, newLines: [newLine] };
			}
		}

		return null;
	}
}
