/**
 * Shared truncation utilities for tool outputs.
 *
 * Truncation is based on two independent limits - whichever is hit first wins:
 * - Line limit (default: 4000 lines)
 * - Byte limit (default: 50KB)
 *
 * Never returns partial lines (except bash tail truncation edge case
 * and the read tool's long-line snippet fallback).
 */

export const DEFAULT_MAX_LINES = 4000;
export const DEFAULT_MAX_BYTES = 50 * 1024; // 50KB
export const DEFAULT_MAX_COLUMN = 1024; // Max chars per grep match line

export interface TruncationResult {
	/** The truncated content */
	content: string;
	/** Whether truncation occurred */
	truncated: boolean;
	/** Which limit was hit: "lines", "bytes", or null if not truncated */
	truncatedBy: "lines" | "bytes" | null;
	/** Total number of lines in the original content */
	totalLines: number;
	/** Total number of bytes in the original content */
	totalBytes: number;
	/** Number of complete lines in the truncated output */
	outputLines: number;
	/** Number of bytes in the truncated output */
	outputBytes: number;
	/** Whether the last line was partially truncated (only for tail truncation edge case) */
	lastLinePartial: boolean;
	/** Whether the first line exceeded the byte limit (for head truncation) */
	firstLineExceedsLimit: boolean;
	/** The max lines limit that was applied */
	maxLines: number;
	/** The max bytes limit that was applied */
	maxBytes: number;
}

export interface TruncationOptions {
	/** Maximum number of lines (default: 2000) */
	maxLines?: number;
	/** Maximum number of bytes (default: 50KB) */
	maxBytes?: number;
}

/**
 * Format bytes as human-readable size.
 */
export function formatSize(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes}B`;
	} else if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)}KB`;
	} else {
		return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
	}
}

/**
 * Truncate content from the head (keep first N lines/bytes).
 * Suitable for file reads where you want to see the beginning.
 *
 * Never returns partial lines. If first line exceeds byte limit,
 * returns empty content with firstLineExceedsLimit=true.
 */
export function truncateHead(content: string, options: TruncationOptions = {}): TruncationResult {
	const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

	const totalBytes = Buffer.byteLength(content, "utf-8");
	const lines = content.split("\n");
	const totalLines = lines.length;

	// Check if no truncation needed
	if (totalLines <= maxLines && totalBytes <= maxBytes) {
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

	// Check if first line alone exceeds byte limit
	const firstLineBytes = Buffer.byteLength(lines[0], "utf-8");
	if (firstLineBytes > maxBytes) {
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

	// Collect complete lines that fit
	const outputLinesArr: string[] = [];
	let outputBytesCount = 0;
	let truncatedBy: "lines" | "bytes" = "lines";

	for (let i = 0; i < lines.length && i < maxLines; i++) {
		const line = lines[i];
		const lineBytes = Buffer.byteLength(line, "utf-8") + (i > 0 ? 1 : 0); // +1 for newline

		if (outputBytesCount + lineBytes > maxBytes) {
			truncatedBy = "bytes";
			break;
		}

		outputLinesArr.push(line);
		outputBytesCount += lineBytes;
	}

	// If we exited due to line limit
	if (outputLinesArr.length >= maxLines && outputBytesCount <= maxBytes) {
		truncatedBy = "lines";
	}

	const outputContent = outputLinesArr.join("\n");
	const finalOutputBytes = Buffer.byteLength(outputContent, "utf-8");

	return {
		content: outputContent,
		truncated: true,
		truncatedBy,
		totalLines,
		totalBytes,
		outputLines: outputLinesArr.length,
		outputBytes: finalOutputBytes,
		lastLinePartial: false,
		firstLineExceedsLimit: false,
		maxLines,
		maxBytes,
	};
}

/**
 * Truncate content from the tail (keep last N lines/bytes).
 * Suitable for bash output where you want to see the end (errors, final results).
 *
 * May return partial first line if the last line of original content exceeds byte limit.
 */
export function truncateTail(content: string, options: TruncationOptions = {}): TruncationResult {
	const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

	const totalBytes = Buffer.byteLength(content, "utf-8");
	const lines = content.split("\n");
	const totalLines = lines.length;

	// Check if no truncation needed
	if (totalLines <= maxLines && totalBytes <= maxBytes) {
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

	// Work backwards from the end
	const outputLinesArr: string[] = [];
	let outputBytesCount = 0;
	let truncatedBy: "lines" | "bytes" = "lines";
	let lastLinePartial = false;

	for (let i = lines.length - 1; i >= 0 && outputLinesArr.length < maxLines; i--) {
		const line = lines[i];
		const lineBytes = Buffer.byteLength(line, "utf-8") + (outputLinesArr.length > 0 ? 1 : 0); // +1 for newline

		if (outputBytesCount + lineBytes > maxBytes) {
			truncatedBy = "bytes";
			// Edge case: if we haven't added ANY lines yet and this line exceeds maxBytes,
			// take the end of the line (partial)
			if (outputLinesArr.length === 0) {
				const truncatedLine = truncateStringToBytesFromEnd(line, maxBytes);
				outputLinesArr.unshift(truncatedLine);
				outputBytesCount = Buffer.byteLength(truncatedLine, "utf-8");
				lastLinePartial = true;
			}
			break;
		}

		outputLinesArr.unshift(line);
		outputBytesCount += lineBytes;
	}

	// If we exited due to line limit
	if (outputLinesArr.length >= maxLines && outputBytesCount <= maxBytes) {
		truncatedBy = "lines";
	}

	const outputContent = outputLinesArr.join("\n");
	const finalOutputBytes = Buffer.byteLength(outputContent, "utf-8");

	return {
		content: outputContent,
		truncated: true,
		truncatedBy,
		totalLines,
		totalBytes,
		outputLines: outputLinesArr.length,
		outputBytes: finalOutputBytes,
		lastLinePartial,
		firstLineExceedsLimit: false,
		maxLines,
		maxBytes,
	};
}

/**
 * Truncate a string to fit within a byte limit (from the end).
 * Handles multi-byte UTF-8 characters correctly.
 */
function truncateStringToBytesFromEnd(str: string, maxBytes: number): string {
	const buf = Buffer.from(str, "utf-8");
	if (buf.length <= maxBytes) {
		return str;
	}

	// Start from the end, skip maxBytes back
	let start = buf.length - maxBytes;

	// Find a valid UTF-8 boundary (start of a character)
	while (start < buf.length && (buf[start] & 0xc0) === 0x80) {
		start++;
	}

	return buf.slice(start).toString("utf-8");
}

/**
 * Truncate a string to fit within a byte limit (from the start).
 * Handles multi-byte UTF-8 characters correctly.
 */
export function truncateStringToBytesFromStart(str: string, maxBytes: number): { text: string; bytes: number } {
	const buf = Buffer.from(str, "utf-8");
	if (buf.length <= maxBytes) {
		return { text: str, bytes: buf.length };
	}

	let end = maxBytes;

	// Find a valid UTF-8 boundary (start of a character)
	while (end > 0 && (buf[end] & 0xc0) === 0x80) {
		end--;
	}

	if (end <= 0) {
		return { text: "", bytes: 0 };
	}

	const text = buf.slice(0, end).toString("utf-8");
	return { text, bytes: Buffer.byteLength(text, "utf-8") };
}

/**
 * Truncate a single line to max characters, adding [truncated] suffix.
 * Used for grep match lines.
 */
export function truncateLine(
	line: string,
	maxChars: number = DEFAULT_MAX_COLUMN,
): { text: string; wasTruncated: boolean } {
	if (line.length <= maxChars) {
		return { text: line, wasTruncated: false };
	}
	return { text: `${line.slice(0, maxChars)}... [truncated]`, wasTruncated: true };
}

// =============================================================================
// Truncation notice formatting
// =============================================================================

export interface TailTruncationNoticeOptions {
	/** Path to full output file (e.g., from bash/python executor) */
	fullOutputPath?: string;
	/** Original content for computing last line size when lastLinePartial */
	originalContent?: string;
	/** Additional suffix to append inside the brackets */
	suffix?: string;
}

/**
 * Format a truncation notice for tail-truncated output (bash, python, ssh).
 * Returns empty string if not truncated.
 *
 * Examples:
 * - "[Showing last 50KB of line 1000 (line is 2.1MB). Full output: /tmp/out.txt]"
 * - "[Showing lines 500-1000 of 1000. Full output: /tmp/out.txt]"
 * - "[Showing lines 500-1000 of 1000 (50KB limit). Full output: /tmp/out.txt]"
 */
export function formatTailTruncationNotice(
	truncation: TruncationResult,
	options: TailTruncationNoticeOptions = {},
): string {
	if (!truncation.truncated) {
		return "";
	}

	const { fullOutputPath, originalContent, suffix = "" } = options;
	const startLine = truncation.totalLines - truncation.outputLines + 1;
	const endLine = truncation.totalLines;
	const fullOutputPart = fullOutputPath ? `. Full output: ${fullOutputPath}` : "";

	let notice: string;

	if (truncation.lastLinePartial) {
		let lastLineSizePart = "";
		if (originalContent) {
			const lastLine = originalContent.split("\n").pop() || "";
			lastLineSizePart = ` (line is ${formatSize(Buffer.byteLength(lastLine, "utf-8"))})`;
		}
		notice = `[Showing last ${formatSize(truncation.outputBytes)} of line ${endLine}${lastLineSizePart}${fullOutputPart}${suffix}]`;
	} else if (truncation.truncatedBy === "lines") {
		notice = `[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}${fullOutputPart}${suffix}]`;
	} else {
		notice = `[Showing lines ${startLine}-${endLine} of ${truncation.totalLines} (${formatSize(truncation.maxBytes)} limit)${fullOutputPart}${suffix}]`;
	}

	return `\n\n${notice}`;
}

export interface HeadTruncationNoticeOptions {
	/** 1-indexed start line number (default: 1) */
	startLine?: number;
	/** Total lines in the original file (for "of N" display) */
	totalFileLines?: number;
}

/**
 * Format a truncation notice for head-truncated output (read tool).
 * Returns empty string if not truncated.
 *
 * Examples:
 * - "[Showing lines 1-2000 of 5000. Use offset=2001 to continue]"
 * - "[Showing lines 100-2099 of 5000 (50KB limit). Use offset=2100 to continue]"
 */
export function formatHeadTruncationNotice(
	truncation: TruncationResult,
	options: HeadTruncationNoticeOptions = {},
): string {
	if (!truncation.truncated) {
		return "";
	}

	const startLineDisplay = options.startLine ?? 1;
	const totalFileLines = options.totalFileLines ?? truncation.totalLines;
	const endLineDisplay = startLineDisplay + truncation.outputLines - 1;
	const nextOffset = endLineDisplay + 1;

	let notice: string;

	if (truncation.truncatedBy === "lines") {
		notice = `[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines}. Use offset=${nextOffset} to continue]`;
	} else {
		notice = `[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines} (${formatSize(truncation.maxBytes)} limit). Use offset=${nextOffset} to continue]`;
	}

	return `\n\n${notice}`;
}
