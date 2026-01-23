/**
 * Structured metadata for tool outputs.
 *
 * Tools populate details.meta using the fluent OutputMetaBuilder.
 * The tool wrapper automatically formats and appends notices at message boundary.
 */

import type { AgentTool, AgentToolResult } from "@oh-my-pi/pi-agent-core";
import type { ImageContent, TextContent } from "@oh-my-pi/pi-ai";
import type { OutputSummary } from "$c/session/streaming-output";
import type { TruncationResult } from "$c/tools/truncate";
import { formatSize } from "$c/tools/truncate";
import { renderError } from "./tool-errors";

/**
 * Truncation metadata for the output notice.
 */
export interface TruncationMeta {
	direction: "head" | "tail";
	truncatedBy: "lines" | "bytes";
	totalLines: number;
	totalBytes: number;
	outputLines: number;
	outputBytes: number;
	/** Line range shown (1-indexed, inclusive) */
	shownRange?: { start: number; end: number };
	/** Artifact ID if full output was saved */
	artifactId?: string;
	/** Next offset for pagination (head truncation only) */
	nextOffset?: number;
}

/**
 * Source resolution info for the output.
 */
export type SourceMeta =
	| { type: "path"; value: string }
	| { type: "url"; value: string }
	| { type: "internal"; value: string };

/**
 * LSP diagnostic info (for edit/write tools).
 */
export interface DiagnosticMeta {
	summary: string;
	messages: string[];
}

/**
 * Limit-specific notices.
 */
export interface LimitsMeta {
	matchLimit?: { reached: number; suggestion: number };
	resultLimit?: { reached: number; suggestion: number };
	headLimit?: { reached: number; suggestion: number };
	columnTruncated?: { maxColumn: number };
}

/**
 * Structured metadata for tool outputs.
 */
export interface OutputMeta {
	truncation?: TruncationMeta;
	source?: SourceMeta;
	diagnostics?: DiagnosticMeta;
	limits?: LimitsMeta;
}

// =============================================================================
// OutputMetaBuilder - Fluent API for building OutputMeta
// =============================================================================

export interface TruncationOptions {
	direction: "head" | "tail";
	startLine?: number;
	totalFileLines?: number;
	artifactId?: string;
}

export interface TruncationSummaryOptions {
	direction: "head" | "tail";
	startLine?: number;
	totalFileLines?: number;
}

export interface TruncationTextOptions {
	direction: "head" | "tail";
	totalLines?: number;
	totalBytes?: number;
	maxBytes?: number;
}

/**
 * Fluent builder for OutputMeta.
 *
 * @example
 * ```ts
 * details.meta = outputMeta()
 *   .truncation(truncation, { direction: "head" })
 *   .matchLimit(limitReached ? effectiveLimit : 0)
 *   .columnTruncated(linesTruncated ? DEFAULT_MAX_COLUMN : 0)
 *   .get();
 * ```
 */
export class OutputMetaBuilder {
	#meta: OutputMeta = {};

	/** Add truncation info from TruncationResult. No-op if not truncated. */
	truncation(result: TruncationResult, options: TruncationOptions): this {
		if (!result.truncated) return this;

		const { direction, startLine = 1, totalFileLines, artifactId } = options;

		let shownStart: number;
		let shownEnd: number;

		if (direction === "tail") {
			shownStart = result.totalLines - result.outputLines + 1;
			shownEnd = result.totalLines;
		} else {
			shownStart = startLine;
			shownEnd = startLine + result.outputLines - 1;
		}

		this.#meta.truncation = {
			direction,
			truncatedBy: result.truncatedBy!,
			totalLines: totalFileLines ?? result.totalLines,
			totalBytes: result.totalBytes,
			outputLines: result.outputLines,
			outputBytes: result.outputBytes,
			shownRange: { start: shownStart, end: shownEnd },
			artifactId,
			nextOffset: direction === "head" ? shownEnd + 1 : undefined,
		};

		return this;
	}

	/** Add truncation info from OutputSummary. No-op if not truncated. */
	truncationFromSummary(summary: OutputSummary, options: TruncationSummaryOptions): this {
		if (!summary.truncated) return this;

		const { direction, startLine = 1, totalFileLines } = options;
		const totalLines = totalFileLines ?? summary.totalLines;
		const truncatedBy: "lines" | "bytes" =
			summary.outputBytes < summary.totalBytes
				? "bytes"
				: summary.outputLines < summary.totalLines
					? "lines"
					: "bytes";

		let shownStart: number;
		let shownEnd: number;

		if (direction === "tail") {
			shownStart = totalLines - summary.outputLines + 1;
			shownEnd = totalLines;
		} else {
			shownStart = startLine;
			shownEnd = startLine + summary.outputLines - 1;
		}

		this.#meta.truncation = {
			direction,
			truncatedBy,
			totalLines,
			totalBytes: summary.totalBytes,
			outputLines: summary.outputLines,
			outputBytes: summary.outputBytes,
			shownRange: { start: shownStart, end: shownEnd },
			artifactId: summary.artifactId,
			nextOffset: direction === "head" ? shownEnd + 1 : undefined,
		};

		return this;
	}

	/** Add truncation info from truncated output text. No-op if truncation not detected. */
	truncationFromText(text: string, options: TruncationTextOptions): this {
		const outputLines = text.length > 0 ? text.split("\n").length : 0;
		const outputBytes = Buffer.byteLength(text, "utf-8");
		const totalLines = options.totalLines ?? outputLines;
		const totalBytes = options.totalBytes ?? outputBytes;

		const truncated = totalLines > outputLines || totalBytes > outputBytes || false;
		if (!truncated) return this;

		const truncatedBy: "lines" | "bytes" =
			options.maxBytes && outputBytes >= options.maxBytes
				? "bytes"
				: totalBytes > outputBytes
					? "bytes"
					: totalLines > outputLines
						? "lines"
						: "bytes";

		let shownStart: number;
		let shownEnd: number;

		if (options.direction === "tail") {
			shownStart = totalLines - outputLines + 1;
			shownEnd = totalLines;
		} else {
			shownStart = 1;
			shownEnd = outputLines;
		}

		this.#meta.truncation = {
			direction: options.direction,
			truncatedBy,
			totalLines,
			totalBytes,
			outputLines,
			outputBytes,
			shownRange: { start: shownStart, end: shownEnd },
			nextOffset: options.direction === "head" ? shownEnd + 1 : undefined,
		};

		return this;
	}

	/** Add match limit notice. No-op if reached <= 0. */
	matchLimit(reached: number, suggestion = reached * 2): this {
		if (reached <= 0) return this;
		this.#meta.limits = { ...this.#meta.limits, matchLimit: { reached, suggestion } };
		return this;
	}

	/** Add limit notices in one call. */
	limits(limits: { matchLimit?: number; resultLimit?: number; headLimit?: number; columnMax?: number }): this {
		if (limits.matchLimit !== undefined) {
			this.matchLimit(limits.matchLimit);
		}
		if (limits.resultLimit !== undefined) {
			this.resultLimit(limits.resultLimit);
		}
		if (limits.headLimit !== undefined) {
			this.headLimit(limits.headLimit);
		}
		if (limits.columnMax !== undefined) {
			this.columnTruncated(limits.columnMax);
		}
		return this;
	}

	/** Add result limit notice. No-op if reached <= 0. */
	resultLimit(reached: number, suggestion = reached * 2): this {
		if (reached <= 0) return this;
		this.#meta.limits = { ...this.#meta.limits, resultLimit: { reached, suggestion } };
		return this;
	}

	/** Add head_limit notice. No-op if reached <= 0. */
	headLimit(reached: number, suggestion = reached * 2): this {
		if (reached <= 0) return this;
		this.#meta.limits = { ...this.#meta.limits, headLimit: { reached, suggestion } };
		return this;
	}

	/** Add column truncation notice. No-op if maxColumn <= 0. */
	columnTruncated(maxColumn: number): this {
		if (maxColumn <= 0) return this;
		this.#meta.limits = { ...this.#meta.limits, columnTruncated: { maxColumn } };
		return this;
	}

	/** Add source path info. */
	sourcePath(value: string): this {
		this.#meta.source = { type: "path", value };
		return this;
	}

	/** Add source URL info. */
	sourceUrl(value: string): this {
		this.#meta.source = { type: "url", value };
		return this;
	}

	/** Add internal URL source info (skill://, agent://, artifact://). */
	sourceInternal(value: string): this {
		this.#meta.source = { type: "internal", value };
		return this;
	}

	/** Add LSP diagnostics. No-op if no messages. */
	diagnostics(summary: string, messages: string[]): this {
		if (messages.length === 0) return this;
		this.#meta.diagnostics = { summary, messages };
		return this;
	}

	/** Get the built OutputMeta, or undefined if empty. */
	get(): OutputMeta | undefined {
		return Object.keys(this.#meta).length > 0 ? this.#meta : undefined;
	}
}

/** Create a new OutputMetaBuilder. */
export function outputMeta(): OutputMetaBuilder {
	return new OutputMetaBuilder();
}

// =============================================================================
// Notice formatting
// =============================================================================

/**
 * Format notices from OutputMeta for LLM consumption.
 * Returns empty string if no notices needed.
 */
export function formatOutputNotice(meta: OutputMeta | undefined): string {
	if (!meta) return "";

	const parts: string[] = [];

	// Truncation notice
	if (meta.truncation) {
		const t = meta.truncation;
		const range = t.shownRange;
		let notice: string;

		if (range) {
			notice = `Showing lines ${range.start}-${range.end} of ${t.totalLines}`;
		} else {
			notice = `Showing ${t.outputLines} of ${t.totalLines} lines`;
		}

		if (t.truncatedBy === "bytes") {
			notice += ` (${formatSize(t.outputBytes)} limit)`;
		}

		if (t.artifactId != null) {
			notice += `. Full: artifact://${t.artifactId}`;
		} else if (t.nextOffset != null) {
			notice += `. Use offset=${t.nextOffset} to continue`;
		}

		parts.push(notice);
	}

	// Limit notices
	if (meta.limits?.matchLimit) {
		const l = meta.limits.matchLimit;
		parts.push(`${l.reached} matches limit reached. Use limit=${l.suggestion} for more`);
	}
	if (meta.limits?.resultLimit) {
		const l = meta.limits.resultLimit;
		parts.push(`${l.reached} results limit reached. Use limit=${l.suggestion} for more`);
	}
	if (meta.limits?.headLimit) {
		const l = meta.limits.headLimit;
		parts.push(`${l.reached} results limit reached. Use head_limit=${l.suggestion} for more`);
	}
	if (meta.limits?.columnTruncated) {
		parts.push(`Some lines truncated to ${meta.limits.columnTruncated.maxColumn} chars`);
	}

	// Diagnostics
	let diagnosticsNotice = "";
	if (meta.diagnostics && meta.diagnostics.messages.length > 0) {
		const d = meta.diagnostics;
		diagnosticsNotice = `\n\nLSP Diagnostics (${d.summary}):\n  ${d.messages.join("\n  ")}`;
	}

	const notice = parts.length ? `\n\n[${parts.join(". ")}]` : "";
	return notice + diagnosticsNotice;
}

// =============================================================================
// Tool wrapper
// =============================================================================

/**
 * Append output notice to tool result content if meta is present.
 */
function appendOutputNotice(
	content: Array<{ type: string; text?: string }>,
	meta: OutputMeta | undefined,
): Array<{ type: string; text?: string }> {
	const notice = formatOutputNotice(meta);
	if (!notice) return content;

	const result = [...content];
	for (let i = result.length - 1; i >= 0; i--) {
		if (result[i].type === "text" && result[i].text != null) {
			result[i] = { ...result[i], text: result[i].text + notice };
			return result;
		}
	}

	result.push({ type: "text", text: notice.trim() });
	return result;
}

/**
 * Wrap a tool to:
 * 1. Automatically append output notices based on details.meta
 * 2. Handle ToolError rendering
 */
export function wrapToolWithMetaNotice<T extends AgentTool<any, any, any>>(tool: T): T {
	const originalExecute = tool.execute.bind(tool);

	const wrappedExecute: typeof tool.execute = async (
		toolCallId,
		params,
		signal,
		onUpdate,
		context,
	): Promise<AgentToolResult<any, any>> => {
		let result: AgentToolResult<any, any>;

		try {
			result = await originalExecute(toolCallId, params, signal, onUpdate, context);
		} catch (e) {
			// Use ToolError.render() if available
			return {
				content: [{ type: "text", text: renderError(e) }],
				details: {},
			};
		}

		// Append notices from meta
		const meta = (result.details as { meta?: OutputMeta } | undefined)?.meta;
		if (meta) {
			return {
				...result,
				content: appendOutputNotice(result.content, meta) as (TextContent | ImageContent)[],
			};
		}

		return result;
	};

	return {
		...tool,
		execute: wrappedExecute,
	} as T;
}

/**
 * Wrap all tools with meta notice formatting and error handling.
 */
export function wrapToolsWithMetaNotice<T extends AgentTool<any, any, any>>(tools: T[]): T[] {
	return tools.map(wrapToolWithMetaNotice);
}
