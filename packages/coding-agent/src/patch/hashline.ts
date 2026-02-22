/**
 * Hashline edit mode — a line-addressable edit format using content hashes.
 *
 * Each line in a file is identified by its 1-indexed line number and a short
 * hexadecimal hash derived from the normalized line content (xxHash32, truncated to 2
 * hex chars).
 * The combined `LINE#ID` reference acts as both an address and a staleness check:
 * if the file has changed since the caller last read it, hash mismatches are caught
 * before any mutation occurs.
 *
 * Displayed format: `LINENUM#HASH:CONTENT`
 * Reference format: `"LINENUM#HASH"` (e.g. `"5#aa"`)
 */

import type { HashMismatch } from "./types";

export type LineTag = { line: number; hash: string };
export type HashlineEdit =
	| { op: "replace"; tag: LineTag; content: string[] }
	| { op: "replace"; first: LineTag; last: LineTag; content: string[] }
	| { op: "append"; after?: LineTag; content: string[] }
	| { op: "prepend"; before?: LineTag; content: string[] }
	| { op: "insert"; after: LineTag; before: LineTag; content: string[] };

const NIBBLE_STR = "ZPMQVRWSNKTXJBYH";

const DICT = Array.from({ length: 256 }, (_, i) => {
	const h = i >>> 4;
	const l = i & 0x0f;
	return `${NIBBLE_STR[h]}${NIBBLE_STR[l]}`;
});

/**
 * Compute a short hexadecimal hash of a single line.
 *
 * Uses xxHash32 on a whitespace-normalized line, truncated to {@link HASH_LEN}
 * hex characters. The `idx` parameter is accepted for compatibility with older
 * call sites, but is not currently mixed into the hash.
 * The line input should not include a trailing newline.
 */
export function computeLineHash(idx: number, line: string): string {
	if (line.endsWith("\r")) {
		line = line.slice(0, -1);
	}
	line = line.replace(/\s+/g, "");
	void idx; // Might use line, but for now, let's not.
	return DICT[Bun.hash.xxHash32(line) & 0xff];
}

/**
 * Formats a tag given the line number and content.
 */
export function formatLineTag(line: number, content: string): string {
	return `${line}#${computeLineHash(line, content)}`;
}

/**
 * Format file content with hashline prefixes for display.
 *
 * Each line becomes `LINENUM#HASH:CONTENT` where LINENUM is 1-indexed.
 *
 * @param content - Raw file content string
 * @param startLine - First line number (1-indexed, defaults to 1)
 * @returns Formatted string with one hashline-prefixed line per input line
 *
 * @example
 * ```
 * formatHashLines("function hi() {\n  return;\n}")
 * // "1#HH:function hi() {\n2#HH:  return;\n3#HH:}"
 * ```
 */
export function formatHashLines(content: string, startLine = 1): string {
	const lines = content.split("\n");
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

			const content = fileLines[lineNum - 1];
			const hash = computeLineHash(lineNum, content);
			const prefix = `${lineNum}#${hash}`;

			if (mismatchSet.has(lineNum)) {
				lines.push(`>>> ${prefix}:${content}`);
			} else {
				lines.push(`    ${prefix}:${content}`);
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

// ═══════════════════════════════════════════════════════════════════════════
// Edit Application
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Apply an array of hashline edits to file content.
 *
 * Each edit operation identifies target lines directly (`replace`,
 * `insert`). Line references are resolved via {@link parseTag}
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
			case "replace": {
				if ("tag" in edit) {
					if (!validateRef(edit.tag)) continue;
				} else {
					if (edit.first.line > edit.last.line) {
						throw new Error(`Range start line ${edit.first.line} must be <= end line ${edit.last.line}`);
					}
					const startValid = validateRef(edit.first);
					const endValid = validateRef(edit.last);
					if (!startValid || !endValid) continue;
				}
				break;
			}
			case "append": {
				if (edit.content.length === 0) {
					throw new Error('Insert-after edit (src "N#HH..") requires non-empty dst');
				}
				if (edit.after && !validateRef(edit.after)) continue;
				break;
			}
			case "prepend": {
				if (edit.content.length === 0) {
					throw new Error('Insert-before edit (src "N#HH..") requires non-empty dst');
				}
				if (edit.before && !validateRef(edit.before)) continue;
				break;
			}
			case "insert": {
				if (edit.content.length === 0) {
					throw new Error('Insert-between edit (src "A#HH.. B#HH..") requires non-empty dst');
				}
				if (edit.before.line <= edit.after.line) {
					throw new Error(`insert requires after (${edit.after.line}) < before (${edit.before.line})`);
				}
				const afterValid = validateRef(edit.after);
				const beforeValid = validateRef(edit.before);
				if (!afterValid || !beforeValid) continue;
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
	for (let i = 0; i < edits.length; i++) {
		const edit = edits[i];
		let lineKey: string;
		switch (edit.op) {
			case "replace":
				if ("tag" in edit) {
					lineKey = `s:${edit.tag.line}`;
				} else {
					lineKey = `r:${edit.first.line}:${edit.last.line}`;
				}
				break;
			case "append":
				if (edit.after) {
					lineKey = `i:${edit.after.line}`;
					break;
				}
				lineKey = "ieof";
				break;
			case "prepend":
				if (edit.before) {
					lineKey = `ib:${edit.before.line}`;
					break;
				}
				lineKey = "ibef";
				break;
			case "insert":
				lineKey = `ix:${edit.after.line}:${edit.before.line}`;
				break;
		}
		const dstKey = `${lineKey}:${edit.content.join("\n")}`;
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
			case "replace":
				if ("tag" in edit) {
					sortLine = edit.tag.line;
				} else {
					sortLine = edit.last.line;
				}
				precedence = 0;
				break;
			case "append":
				sortLine = edit.after ? edit.after.line : fileLines.length + 1;
				precedence = 1;
				break;
			case "prepend":
				sortLine = edit.before ? edit.before.line : 0;
				precedence = 2;
				break;
			case "insert":
				sortLine = edit.before.line;
				precedence = 3;
				break;
		}
		return { edit, idx, sortLine, precedence };
	});

	annotated.sort((a, b) => b.sortLine - a.sortLine || a.precedence - b.precedence || a.idx - b.idx);

	// Apply edits bottom-up
	for (const { edit, idx } of annotated) {
		switch (edit.op) {
			case "replace": {
				if ("tag" in edit) {
					const origLines = originalFileLines.slice(edit.tag.line - 1, edit.tag.line);
					const newLines = edit.content;
					if (origLines.every((line, i) => line === newLines[i])) {
						noopEdits.push({
							editIndex: idx,
							loc: `${edit.tag.line}#${edit.tag.hash}`,
							currentContent: origLines.join("\n"),
						});
						break;
					}
					fileLines.splice(edit.tag.line - 1, 1, ...newLines);
					trackFirstChanged(edit.tag.line);
				} else {
					const count = edit.last.line - edit.first.line + 1;
					const newLines = edit.content;
					fileLines.splice(edit.first.line - 1, count, ...newLines);
					trackFirstChanged(edit.first.line);
				}
				break;
			}
			case "append": {
				const inserted = edit.content;
				if (inserted.length === 0) {
					noopEdits.push({
						editIndex: idx,
						loc: edit.after ? `${edit.after.line}#${edit.after.hash}` : "EOF",
						currentContent: edit.after ? originalFileLines[edit.after.line - 1] : "",
					});
					break;
				}
				if (edit.after) {
					fileLines.splice(edit.after.line, 0, ...inserted);
					trackFirstChanged(edit.after.line + 1);
				} else {
					if (fileLines.length === 1 && fileLines[0] === "") {
						fileLines.splice(0, 1, ...inserted);
						trackFirstChanged(1);
					} else {
						fileLines.splice(fileLines.length, 0, ...inserted);
						trackFirstChanged(fileLines.length - inserted.length + 1);
					}
				}
				break;
			}
			case "prepend": {
				const inserted = edit.content;
				if (inserted.length === 0) {
					noopEdits.push({
						editIndex: idx,
						loc: edit.before ? `${edit.before.line}#${edit.before.hash}` : "BOF",
						currentContent: edit.before ? originalFileLines[edit.before.line - 1] : "",
					});
					break;
				}
				if (edit.before) {
					fileLines.splice(edit.before.line - 1, 0, ...inserted);
					trackFirstChanged(edit.before.line);
				} else {
					if (fileLines.length === 1 && fileLines[0] === "") {
						fileLines.splice(0, 1, ...inserted);
					} else {
						fileLines.splice(0, 0, ...inserted);
					}
					trackFirstChanged(1);
				}
				break;
			}
			case "insert": {
				const afterLine = originalFileLines[edit.after.line - 1];
				const beforeLine = originalFileLines[edit.before.line - 1];
				const inserted = edit.content;
				if (inserted.length === 0) {
					noopEdits.push({
						editIndex: idx,
						loc: `${edit.after.line}#${edit.after.hash}..${edit.before.line}#${edit.before.hash}`,
						currentContent: `${afterLine}\n${beforeLine}`,
					});
					break;
				}
				fileLines.splice(edit.before.line - 1, 0, ...inserted);
				trackFirstChanged(edit.before.line);
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
}
