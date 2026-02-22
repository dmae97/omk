import { sanitizeText } from "@oh-my-pi/pi-natives";
import { formatBytes } from "../tools/render-utils";

// =============================================================================
// Constants
// =============================================================================

export const DEFAULT_MAX_LINES = 3000;
export const DEFAULT_MAX_BYTES = 50 * 1024; // 50KB
export const DEFAULT_MAX_COLUMN = 1024; // Max chars per grep match line

const NL = "\n";

// =============================================================================
// Interfaces
// =============================================================================

export interface OutputSummary {
	output: string;
	truncated: boolean;
	totalLines: number;
	totalBytes: number;
	outputLines: number;
	outputBytes: number;
	/** Artifact ID for internal URL access (artifact://<id>) when truncated */
	artifactId?: string;
}

export interface OutputSinkOptions {
	artifactPath?: string;
	artifactId?: string;
	spillThreshold?: number;
	onChunk?: (chunk: string) => void;
}

export interface TruncationResult {
	content: string;
	truncated: boolean;
	truncatedBy: "lines" | "bytes" | null;
	totalLines: number;
	totalBytes: number;
	outputLines: number;
	outputBytes: number;
	lastLinePartial: boolean;
	firstLineExceedsLimit: boolean;
	maxLines: number;
	maxBytes: number;
}

export interface TruncationOptions {
	/** Maximum number of lines (default: 3000) */
	maxLines?: number;
	/** Maximum number of bytes (default: 50KB) */
	maxBytes?: number;
}

/** Result from byte-level truncation helpers. */
export interface ByteTruncationResult {
	text: string;
	bytes: number;
}

export interface TailTruncationNoticeOptions {
	fullOutputPath?: string;
	originalContent?: string;
	suffix?: string;
}

export interface HeadTruncationNoticeOptions {
	startLine?: number;
	totalFileLines?: number;
}

// =============================================================================
// Internal low-level helpers
// =============================================================================

/** Count newline characters via native substring search. */
function countNewlines(text: string): number {
	let count = 0;
	let pos = text.indexOf(NL);
	while (pos !== -1) {
		count++;
		pos = text.indexOf(NL, pos + 1);
	}
	return count;
}

/** Zero-copy view of a Uint8Array as a Buffer (copies only if already a Buffer). */
function asBuffer(data: Uint8Array): Buffer {
	return Buffer.isBuffer(data) ? (data as Buffer) : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}

/** Advance past UTF-8 continuation bytes (10xxxxxx) to a leading byte. */
function findUtf8BoundaryForward(buf: Buffer, pos: number): number {
	let i = Math.max(0, pos);
	while (i < buf.length && (buf[i] & 0xc0) === 0x80) i++;
	return i;
}

/** Retreat past UTF-8 continuation bytes to land on a leading byte. */
function findUtf8BoundaryBackward(buf: Buffer, cut: number): number {
	let i = Math.min(buf.length, Math.max(0, cut));
	// If the cut is at end-of-buffer, it's already a valid boundary.
	if (i >= buf.length) return buf.length;
	while (i > 0 && (buf[i] & 0xc0) === 0x80) i--;
	return i;
}

// =============================================================================
// Byte-level truncation (windowed encoding)
// =============================================================================

function truncateBytesWindowed(
	data: string | Uint8Array,
	maxBytesRaw: number,
	mode: "head" | "tail",
): ByteTruncationResult {
	const maxBytes = maxBytesRaw;
	if (maxBytes === 0) return { text: "", bytes: 0 };

	// --------------------------
	// String path (windowed)
	// --------------------------
	if (typeof data === "string") {
		// Fast non-truncation check only when it *might* fit.
		if (data.length <= maxBytes) {
			const len = Buffer.byteLength(data, "utf-8");
			if (len <= maxBytes) return { text: data, bytes: len };
			// else: multibyte-heavy string; fall through to truncation using full string as window.
		}

		const window =
			mode === "head"
				? data.substring(0, Math.min(data.length, maxBytes))
				: data.substring(Math.max(0, data.length - maxBytes));

		const buf = Buffer.from(window, "utf-8");

		if (mode === "head") {
			const end = findUtf8BoundaryBackward(buf, maxBytes);
			if (end <= 0) return { text: "", bytes: 0 };
			const slice = buf.subarray(0, end);
			return { text: slice.toString("utf-8"), bytes: slice.length };
		} else {
			const startAt = Math.max(0, buf.length - maxBytes);
			const start = findUtf8BoundaryForward(buf, startAt);
			const slice = buf.subarray(start);
			return { text: slice.toString("utf-8"), bytes: slice.length };
		}
	}

	// --------------------------
	// Uint8Array / Buffer path
	// --------------------------
	const buf = asBuffer(data);
	if (buf.length <= maxBytes) return { text: buf.toString("utf-8"), bytes: buf.length };

	if (mode === "head") {
		const end = findUtf8BoundaryBackward(buf, maxBytes);
		if (end <= 0) return { text: "", bytes: 0 };
		const slice = buf.subarray(0, end);
		return { text: slice.toString("utf-8"), bytes: slice.length };
	} else {
		const startAt = buf.length - maxBytes;
		const start = findUtf8BoundaryForward(buf, startAt);
		const slice = buf.subarray(start);
		return { text: slice.toString("utf-8"), bytes: slice.length };
	}
}

/**
 * Truncate a string/buffer to fit within a byte limit, keeping the tail.
 * Handles multi-byte UTF-8 boundaries correctly.
 */
export function truncateTailBytes(data: string | Uint8Array, maxBytes: number): ByteTruncationResult {
	return truncateBytesWindowed(data, maxBytes, "tail");
}

/**
 * Truncate a string/buffer to fit within a byte limit, keeping the head.
 * Handles multi-byte UTF-8 boundaries correctly.
 */
export function truncateHeadBytes(data: string | Uint8Array, maxBytes: number): ByteTruncationResult {
	return truncateBytesWindowed(data, maxBytes, "head");
}

// =============================================================================
// Line-level utilities
// =============================================================================

/**
 * Truncate a single line to max characters, appending '…' if truncated.
 */
export function truncateLine(
	line: string,
	maxChars: number = DEFAULT_MAX_COLUMN,
): { text: string; wasTruncated: boolean } {
	if (line.length <= maxChars) return { text: line, wasTruncated: false };
	return { text: `${line.slice(0, maxChars)}…`, wasTruncated: true };
}

// =============================================================================
// Content truncation (line + byte aware, no full Buffer allocation)
// =============================================================================

/** Shared helper to build a no-truncation result. */
function noTruncResult(
	content: string,
	totalLines: number,
	totalBytes: number,
	maxLines: number,
	maxBytes: number,
): TruncationResult {
	return {
		content,
		truncated: false,
		truncatedBy: null,
		totalLines,
		totalBytes,
		outputLines: totalLines,
		outputBytes: totalBytes,
		lastLinePartial: false,
		firstLineExceedsLimit: false,
		maxLines,
		maxBytes,
	};
}

/**
 * Truncate content from the head (keep first N lines/bytes).
 * Never returns partial lines. If the first line exceeds the byte limit,
 * returns empty content with firstLineExceedsLimit=true.
 *
 * This implementation avoids Buffer.from(content) for the whole input.
 * It only computes UTF-8 byteLength for candidate lines that can still fit.
 */
export function truncateHead(content: string, options: TruncationOptions = {}): TruncationResult {
	const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

	const totalBytes = Buffer.byteLength(content, "utf-8");
	const totalLines = countNewlines(content) + 1;

	if (totalLines <= maxLines && totalBytes <= maxBytes) {
		return noTruncResult(content, totalLines, totalBytes, maxLines, maxBytes);
	}

	let includedLines = 0;
	let bytesUsed = 0;
	let cutIndex = 0; // char index where we cut (exclusive)
	let cursor = 0;

	let truncatedBy: "lines" | "bytes" = "lines";

	while (includedLines < maxLines) {
		const nl = content.indexOf(NL, cursor);
		const lineEnd = nl === -1 ? content.length : nl;

		const sepBytes = includedLines > 0 ? 1 : 0;
		const remaining = maxBytes - bytesUsed - sepBytes;

		// No room even for separators / bytes.
		if (remaining < 0) {
			truncatedBy = "bytes";
			break;
		}

		// Fast reject huge lines without slicing/encoding:
		// UTF-8 bytes >= UTF-16 code units, so if code units exceed remaining, bytes must exceed too.
		const lineCodeUnits = lineEnd - cursor;
		if (lineCodeUnits > remaining) {
			truncatedBy = "bytes";
			if (includedLines === 0) {
				return {
					content: "",
					truncated: true,
					truncatedBy: "bytes",
					totalLines,
					totalBytes,
					outputLines: 0,
					outputBytes: 0,
					lastLinePartial: false,
					firstLineExceedsLimit: true,
					maxLines,
					maxBytes,
				};
			}
			break;
		}

		// Small slice (bounded by remaining <= maxBytes) for exact UTF-8 byte count.
		const lineText = content.slice(cursor, lineEnd);
		const lineBytes = Buffer.byteLength(lineText, "utf-8");

		if (lineBytes > remaining) {
			truncatedBy = "bytes";
			if (includedLines === 0) {
				return {
					content: "",
					truncated: true,
					truncatedBy: "bytes",
					totalLines,
					totalBytes,
					outputLines: 0,
					outputBytes: 0,
					lastLinePartial: false,
					firstLineExceedsLimit: true,
					maxLines,
					maxBytes,
				};
			}
			break;
		}

		// Include the line (join semantics: no trailing newline after the last included line).
		bytesUsed += sepBytes + lineBytes;
		includedLines++;

		cutIndex = nl === -1 ? content.length : nl; // exclude the newline after the last included line
		if (nl === -1) break;
		cursor = nl + 1;
	}

	if (includedLines >= maxLines && bytesUsed <= maxBytes) truncatedBy = "lines";

	return {
		content: content.slice(0, cutIndex),
		truncated: true,
		truncatedBy,
		totalLines,
		totalBytes,
		outputLines: includedLines,
		outputBytes: bytesUsed,
		lastLinePartial: false,
		firstLineExceedsLimit: false,
		maxLines,
		maxBytes,
	};
}

/**
 * Truncate content from the tail (keep last N lines/bytes).
 * May return a partial first line if the last line exceeds the byte limit.
 *
 * Also avoids Buffer.from(content) for the whole input.
 */
export function truncateTail(content: string, options: TruncationOptions = {}): TruncationResult {
	const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

	const totalBytes = Buffer.byteLength(content, "utf-8");
	const totalLines = countNewlines(content) + 1;

	if (totalLines <= maxLines && totalBytes <= maxBytes) {
		return noTruncResult(content, totalLines, totalBytes, maxLines, maxBytes);
	}

	let includedLines = 0;
	let bytesUsed = 0;
	let startIndex = content.length; // char index where output starts
	let end = content.length; // char index where current line ends (exclusive)

	let truncatedBy: "lines" | "bytes" = "lines";

	while (includedLines < maxLines) {
		const nl = content.lastIndexOf(NL, end - 1);
		const lineStart = nl === -1 ? 0 : nl + 1;

		const sepBytes = includedLines > 0 ? 1 : 0;
		const remaining = maxBytes - bytesUsed - sepBytes;

		if (remaining < 0) {
			truncatedBy = "bytes";
			break;
		}

		const lineCodeUnits = end - lineStart;

		// Fast reject huge line without slicing/encoding.
		if (lineCodeUnits > remaining) {
			truncatedBy = "bytes";
			if (includedLines === 0) {
				// Window the line substring to avoid materializing a giant string.
				const windowStart = Math.max(lineStart, end - maxBytes);
				const window = content.substring(windowStart, end);
				const tail = truncateTailBytes(window, maxBytes);
				return {
					content: tail.text,
					truncated: true,
					truncatedBy: "bytes",
					totalLines,
					totalBytes,
					outputLines: 1,
					outputBytes: tail.bytes,
					lastLinePartial: true,
					firstLineExceedsLimit: false,
					maxLines,
					maxBytes,
				};
			}
			break;
		}

		const lineText = content.slice(lineStart, end);
		const lineBytes = Buffer.byteLength(lineText, "utf-8");

		if (lineBytes > remaining) {
			truncatedBy = "bytes";
			if (includedLines === 0) {
				const tail = truncateTailBytes(lineText, maxBytes);
				return {
					content: tail.text,
					truncated: true,
					truncatedBy: "bytes",
					totalLines,
					totalBytes,
					outputLines: 1,
					outputBytes: tail.bytes,
					lastLinePartial: true,
					firstLineExceedsLimit: false,
					maxLines,
					maxBytes,
				};
			}
			break;
		}

		bytesUsed += sepBytes + lineBytes;
		includedLines++;
		startIndex = lineStart;

		if (nl === -1) break;
		end = nl; // exclude the newline itself; it'll be accounted as sepBytes in the next iteration
	}

	if (includedLines >= maxLines && bytesUsed <= maxBytes) truncatedBy = "lines";

	return {
		content: content.slice(startIndex),
		truncated: true,
		truncatedBy,
		totalLines,
		totalBytes,
		outputLines: includedLines,
		outputBytes: bytesUsed,
		lastLinePartial: false,
		firstLineExceedsLimit: false,
		maxLines,
		maxBytes,
	};
}

// =============================================================================
// TailBuffer — ring-style tail buffer with lazy joining
// =============================================================================

const MAX_PENDING = 10;

export class TailBuffer {
	#pending: string[] = [];
	#pos = 0; // byte count of the currently-held tail (after trims)

	constructor(readonly maxBytes: number) {}

	append(text: string): void {
		if (!text) return;

		const max = this.maxBytes;
		if (max === 0) {
			this.#pending.length = 0;
			this.#pos = 0;
			return;
		}

		const n = Buffer.byteLength(text, "utf-8");

		// If the incoming chunk alone is >= budget, it fully dominates the tail.
		if (n >= max) {
			const { text: t, bytes } = truncateTailBytes(text, max);
			this.#pending[0] = t;
			this.#pending.length = 1;
			this.#pos = bytes;
			return;
		}

		this.#pos += n;

		if (this.#pending.length === 0) {
			this.#pending[0] = text;
			this.#pending.length = 1;
		} else {
			this.#pending.push(text);
			if (this.#pending.length > MAX_PENDING) this.#compact();
		}

		// Trim when we exceed 2× budget to amortize cost.
		if (this.#pos > max * 2) this.#trimTo(max);
	}

	text(): string {
		const max = this.maxBytes;
		this.#trimTo(max);
		return this.#flush();
	}

	bytes(): number {
		const max = this.maxBytes;
		this.#trimTo(max);
		return this.#pos;
	}

	// -- private ---------------------------------------------------------------

	#compact(): void {
		this.#pending[0] = this.#pending.join("");
		this.#pending.length = 1;
	}

	#flush(): string {
		if (this.#pending.length === 0) return "";
		if (this.#pending.length > 1) this.#compact();
		return this.#pending[0];
	}

	#trimTo(max: number): void {
		if (max === 0) {
			this.#pending.length = 0;
			this.#pos = 0;
			return;
		}
		if (this.#pos <= max) return;

		const joined = this.#flush();
		const { text, bytes } = truncateTailBytes(joined, max);
		this.#pos = bytes;
		this.#pending[0] = text;
		this.#pending.length = 1;
	}
}

// =============================================================================
// OutputSink — line-buffered output with file spill support
// =============================================================================

export class OutputSink {
	#buffer = "";
	#bufferBytes = 0;
	#totalLines = 0; // newline count
	#totalBytes = 0;
	#sawData = false;
	#truncated = false;

	#file?: {
		path: string;
		artifactId?: string;
		sink: Bun.FileSink;
	};

	readonly #artifactPath?: string;
	readonly #artifactId?: string;
	readonly #spillThreshold: number;
	readonly #onChunk?: (chunk: string) => void;

	constructor(options?: OutputSinkOptions) {
		const { artifactPath, artifactId, spillThreshold = DEFAULT_MAX_BYTES, onChunk } = options ?? {};
		this.#artifactPath = artifactPath;
		this.#artifactId = artifactId;
		this.#spillThreshold = spillThreshold;
		this.#onChunk = onChunk;
	}

	async push(chunk: string): Promise<void> {
		chunk = sanitizeText(chunk);
		this.#onChunk?.(chunk);

		const dataBytes = Buffer.byteLength(chunk, "utf-8");
		this.#totalBytes += dataBytes;

		if (chunk.length > 0) {
			this.#sawData = true;
			this.#totalLines += countNewlines(chunk);
		}

		const threshold = this.#spillThreshold;
		const willOverflow = this.#bufferBytes + dataBytes > threshold;

		// Write to file if already spilling or about to overflow
		if (this.#file != null || willOverflow) {
			const sink = await this.#ensureFileSink();
			await sink?.write(chunk);
		}

		if (!willOverflow) {
			this.#buffer += chunk;
			this.#bufferBytes += dataBytes;
			return;
		}

		// Overflow: keep only a tail window in memory.
		this.#truncated = true;

		// Avoid creating a giant intermediate string when chunk alone dominates.
		if (dataBytes >= threshold) {
			const { text, bytes } = truncateTailBytes(chunk, threshold);
			this.#buffer = text;
			this.#bufferBytes = bytes;
		} else {
			// Intermediate size is bounded (<= threshold + dataBytes), safe to concat.
			this.#buffer += chunk;
			this.#bufferBytes += dataBytes;

			const { text, bytes } = truncateTailBytes(this.#buffer, threshold);
			this.#buffer = text;
			this.#bufferBytes = bytes;
		}

		if (this.#file) this.#truncated = true;
	}

	createInput(): WritableStream<Uint8Array | string> {
		const dec = new TextDecoder("utf-8", { ignoreBOM: true });
		const finalize = async () => {
			await this.push(dec.decode());
		};
		return new WritableStream({
			write: async chunk => {
				await this.push(typeof chunk === "string" ? chunk : dec.decode(chunk, { stream: true }));
			},
			close: finalize,
			abort: finalize,
		});
	}

	async dump(notice?: string): Promise<OutputSummary> {
		const noticeLine = notice ? `[${notice}]\n` : "";
		const outputLines = this.#buffer.length > 0 ? countNewlines(this.#buffer) + 1 : 0;
		const totalLines = this.#sawData ? this.#totalLines + 1 : 0;

		if (this.#file) await this.#file.sink.end();

		return {
			output: `${noticeLine}${this.#buffer}`,
			truncated: this.#truncated,
			totalLines,
			totalBytes: this.#totalBytes,
			outputLines,
			outputBytes: this.#bufferBytes,
			artifactId: this.#file?.artifactId,
		};
	}

	// -- private ---------------------------------------------------------------

	async #ensureFileSink(): Promise<Bun.FileSink | null> {
		if (!this.#artifactPath) return null;
		if (this.#file) return this.#file.sink;

		try {
			const sink = Bun.file(this.#artifactPath).writer();
			this.#file = { path: this.#artifactPath, artifactId: this.#artifactId, sink };

			// Flush existing buffer to file BEFORE it gets trimmed further.
			if (this.#buffer.length > 0) {
				await sink.write(this.#buffer);
			}
			return sink;
		} catch {
			try {
				await this.#file?.sink?.end();
			} catch {
				/* ignore */
			}
			this.#file = undefined;
			return null;
		}
	}
}

// =============================================================================
// Truncation notice formatting
// =============================================================================

/**
 * Format a truncation notice for tail-truncated output (bash, python, ssh).
 * Returns empty string if not truncated.
 */
export function formatTailTruncationNotice(
	truncation: TruncationResult,
	options: TailTruncationNoticeOptions = {},
): string {
	if (!truncation.truncated) return "";

	const { fullOutputPath, originalContent, suffix = "" } = options;
	const startLine = truncation.totalLines - truncation.outputLines + 1;
	const endLine = truncation.totalLines;
	const fullOutputPart = fullOutputPath ? `. Full output: ${fullOutputPath}` : "";

	let notice: string;
	if (truncation.lastLinePartial) {
		let lastLineSizePart = "";
		if (originalContent) {
			const lastNl = originalContent.lastIndexOf(NL);
			const lastLine = lastNl === -1 ? originalContent : originalContent.substring(lastNl + 1);
			lastLineSizePart = ` (line is ${formatBytes(Buffer.byteLength(lastLine, "utf-8"))})`;
		}
		notice = `[Showing last ${formatBytes(truncation.outputBytes)} of line ${endLine}${lastLineSizePart}${fullOutputPart}${suffix}]`;
	} else if (truncation.truncatedBy === "lines") {
		notice = `[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}${fullOutputPart}${suffix}]`;
	} else {
		notice = `[Showing lines ${startLine}-${endLine} of ${truncation.totalLines} (${formatBytes(truncation.maxBytes)} limit)${fullOutputPart}${suffix}]`;
	}

	return `\n\n${notice}`;
}

/**
 * Format a truncation notice for head-truncated output (read tool).
 * Returns empty string if not truncated.
 */
export function formatHeadTruncationNotice(
	truncation: TruncationResult,
	options: HeadTruncationNoticeOptions = {},
): string {
	if (!truncation.truncated) return "";

	const startLineDisplay = options.startLine ?? 1;
	const totalFileLines = options.totalFileLines ?? truncation.totalLines;
	const endLineDisplay = startLineDisplay + truncation.outputLines - 1;
	const nextOffset = endLineDisplay + 1;

	const notice =
		truncation.truncatedBy === "lines"
			? `[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines}. Use offset=${nextOffset} to continue]`
			: `[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines} (${formatBytes(truncation.maxBytes)} limit). Use offset=${nextOffset} to continue]`;

	return `\n\n${notice}`;
}
