/**
 * Shared utilities for edit tool TUI rendering.
 */

import type { ToolCallContext } from "@oh-my-pi/pi-agent-core";
import type { Component } from "@oh-my-pi/pi-tui";
import { Text } from "@oh-my-pi/pi-tui";
import type { RenderResultOptions } from "$c/extensibility/custom-tools/types";
import type { FileDiagnosticsResult } from "$c/lsp/index";
import { renderDiff as renderDiffColored } from "$c/modes/components/diff";
import { getLanguageFromPath, type Theme } from "$c/modes/theme/theme";
import type { OutputMeta } from "$c/tools/output-meta";
import {
	formatExpandHint,
	formatStatusIcon,
	getDiffStats,
	shortenPath,
	ToolUIKit,
	truncateDiffByHunk,
} from "$c/tools/render-utils";
import type { RenderCallOptions } from "$c/tools/renderers";
import { renderStatusLine } from "$c/tui";
import type { DiffError, DiffResult, Operation } from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// LSP Batching
// ═══════════════════════════════════════════════════════════════════════════

const LSP_BATCH_TOOLS = new Set(["edit", "write"]);

export function getLspBatchRequest(toolCall: ToolCallContext | undefined): { id: string; flush: boolean } | undefined {
	if (!toolCall) {
		return undefined;
	}
	const hasOtherWrites = toolCall.toolCalls.some(
		(call, index) => index !== toolCall.index && LSP_BATCH_TOOLS.has(call.name),
	);
	if (!hasOtherWrites) {
		return undefined;
	}
	const hasLaterWrites = toolCall.toolCalls.slice(toolCall.index + 1).some((call) => LSP_BATCH_TOOLS.has(call.name));
	return { id: toolCall.batchId, flush: !hasLaterWrites };
}

// ═══════════════════════════════════════════════════════════════════════════
// Tool Details Types
// ═══════════════════════════════════════════════════════════════════════════

export interface EditToolDetails {
	/** Unified diff of the changes made */
	diff: string;
	/** Line number of the first change in the new file (for editor navigation) */
	firstChangedLine?: number;
	/** Diagnostic result (if available) */
	diagnostics?: FileDiagnosticsResult;
	/** Operation type (patch mode only) */
	op?: Operation;
	/** New path after move/rename (patch mode only) */
	rename?: string;
	/** Structured output metadata */
	meta?: OutputMeta;
}

// ═══════════════════════════════════════════════════════════════════════════
// TUI Renderer
// ═══════════════════════════════════════════════════════════════════════════

interface EditRenderArgs {
	path?: string;
	file_path?: string;
	oldText?: string;
	newText?: string;
	patch?: string;
	all?: boolean;
	// Patch mode fields
	op?: Operation;
	rename?: string;
	diff?: string;
}

/** Extended context for edit tool rendering */
export interface EditRenderContext {
	/** Pre-computed diff preview (computed before tool executes) */
	editDiffPreview?: DiffResult | DiffError;
	/** Function to render diff text with syntax highlighting */
	renderDiff?: (diffText: string, options?: { filePath?: string }) => string;
}

const EDIT_DIFF_PREVIEW_HUNKS = 2;
const EDIT_DIFF_PREVIEW_LINES = 24;
const EDIT_STREAMING_PREVIEW_LINES = 12;

function countLines(text: string): number {
	if (!text) return 0;
	return text.split("\n").length;
}

function formatStreamingDiff(diff: string, rawPath: string, uiTheme: Theme): string {
	if (!diff) return "";
	const lines = diff.split("\n");
	const total = lines.length;
	const displayLines = lines.slice(-EDIT_STREAMING_PREVIEW_LINES);
	const hidden = total - displayLines.length;

	let text = "\n\n";
	if (hidden > 0) {
		text += uiTheme.fg("dim", `${uiTheme.format.ellipsis} (${hidden} earlier lines)\n`);
	}
	text += renderDiffColored(displayLines.join("\n"), { filePath: rawPath });
	text += uiTheme.fg("dim", `\n${uiTheme.format.ellipsis} (streaming)`);
	return text;
}

function formatMetadataLine(lineCount: number | null, language: string | undefined, uiTheme: Theme): string {
	const icon = uiTheme.getLangIcon(language);
	if (lineCount !== null) {
		return uiTheme.fg("dim", `${icon} ${lineCount} lines`);
	}
	return uiTheme.fg("dim", `${icon}`);
}

function renderDiffSection(
	diff: string,
	rawPath: string,
	expanded: boolean,
	uiTheme: Theme,
	ui: ToolUIKit,
	renderDiffFn: (t: string, o?: { filePath?: string }) => string,
): string {
	let text = "";
	const diffStats = getDiffStats(diff);
	text += `\n${uiTheme.fg("dim", uiTheme.format.bracketLeft)}${ui.formatDiffStats(
		diffStats.added,
		diffStats.removed,
		diffStats.hunks,
	)}${uiTheme.fg("dim", uiTheme.format.bracketRight)}`;

	const {
		text: truncatedDiff,
		hiddenHunks,
		hiddenLines,
	} = expanded
		? { text: diff, hiddenHunks: 0, hiddenLines: 0 }
		: truncateDiffByHunk(diff, EDIT_DIFF_PREVIEW_HUNKS, EDIT_DIFF_PREVIEW_LINES);

	text += `\n\n${renderDiffFn(truncatedDiff, { filePath: rawPath })}`;
	if (!expanded && (hiddenHunks > 0 || hiddenLines > 0)) {
		const remainder: string[] = [];
		if (hiddenHunks > 0) remainder.push(`${hiddenHunks} more hunks`);
		if (hiddenLines > 0) remainder.push(`${hiddenLines} more lines`);
		text += uiTheme.fg(
			"toolOutput",
			`\n${uiTheme.format.ellipsis} (${remainder.join(", ")}) ${formatExpandHint(uiTheme)}`,
		);
	}
	return text;
}

export const editToolRenderer = {
	mergeCallAndResult: true,

	renderCall(args: EditRenderArgs, uiTheme: Theme, options?: RenderCallOptions): Component {
		const ui = new ToolUIKit(uiTheme);
		const rawPath = args.file_path || args.path || "";
		const filePath = shortenPath(rawPath);
		const editLanguage = getLanguageFromPath(rawPath) ?? "text";
		const editIcon = uiTheme.fg("muted", uiTheme.getLangIcon(editLanguage));
		let pathDisplay = filePath ? uiTheme.fg("accent", filePath) : uiTheme.fg("toolOutput", uiTheme.format.ellipsis);

		// Add arrow for move/rename operations
		if (args.rename) {
			pathDisplay += ` ${uiTheme.fg("dim", "→")} ${uiTheme.fg("accent", shortenPath(args.rename))}`;
		}

		// Show operation type for patch mode
		const opTitle = args.op === "create" ? "Create" : args.op === "delete" ? "Delete" : "Edit";
		const spinner =
			options?.spinnerFrame !== undefined ? formatStatusIcon("running", uiTheme, options.spinnerFrame) : "";
		let text = `${ui.title(opTitle)} ${spinner ? `${spinner} ` : ""}${editIcon} ${pathDisplay}`;

		// Show streaming preview of diff/content
		if (args.diff && args.op) {
			text += formatStreamingDiff(args.diff, rawPath, uiTheme);
		} else if (args.diff) {
			const previewLines = args.diff.split("\n");
			const maxLines = 6;
			text += "\n\n";
			for (const line of previewLines.slice(0, maxLines)) {
				text += `${uiTheme.fg("toolOutput", ui.truncate(line, 80))}\n`;
			}
			if (previewLines.length > maxLines) {
				text += uiTheme.fg("dim", `${uiTheme.format.ellipsis} ${previewLines.length - maxLines} more lines`);
			}
		} else if (args.newText || args.patch) {
			const previewLines = (args.newText ?? args.patch ?? "").split("\n");
			const maxLines = 6;
			text += "\n\n";
			for (const line of previewLines.slice(0, maxLines)) {
				text += `${uiTheme.fg("toolOutput", ui.truncate(line, 80))}\n`;
			}
			if (previewLines.length > maxLines) {
				text += uiTheme.fg("dim", `${uiTheme.format.ellipsis} ${previewLines.length - maxLines} more lines`);
			}
		}

		return new Text(text, 0, 0);
	},

	renderResult(
		result: { content: Array<{ type: string; text?: string }>; details?: EditToolDetails; isError?: boolean },
		options: RenderResultOptions & { renderContext?: EditRenderContext },
		uiTheme: Theme,
		args?: EditRenderArgs,
	): Component {
		const ui = new ToolUIKit(uiTheme);
		const { expanded, renderContext } = options;
		const rawPath = args?.file_path || args?.path || "";
		const filePath = shortenPath(rawPath);
		const editLanguage = getLanguageFromPath(rawPath) ?? "text";
		const editIcon = uiTheme.fg("muted", uiTheme.getLangIcon(editLanguage));
		const editDiffPreview = renderContext?.editDiffPreview;
		const renderDiffFn = renderContext?.renderDiff ?? ((t: string) => t);

		// Get op and rename from args or details
		const op = args?.op || result.details?.op;
		const rename = args?.rename || result.details?.rename;

		// Build path display with line number if available
		let pathDisplay = filePath ? uiTheme.fg("accent", filePath) : uiTheme.fg("toolOutput", uiTheme.format.ellipsis);
		const firstChangedLine =
			(editDiffPreview && "firstChangedLine" in editDiffPreview ? editDiffPreview.firstChangedLine : undefined) ||
			(result.details && !result.isError ? result.details.firstChangedLine : undefined);
		if (firstChangedLine) {
			pathDisplay += uiTheme.fg("warning", `:${firstChangedLine}`);
		}

		// Add arrow for rename operations
		if (rename) {
			pathDisplay += ` ${uiTheme.fg("dim", "→")} ${uiTheme.fg("accent", shortenPath(rename))}`;
		}

		// Show operation type for patch mode
		const opTitle = op === "create" ? "Create" : op === "delete" ? "Delete" : "Edit";
		const header = renderStatusLine(
			{
				icon: result.isError ? "error" : "success",
				title: opTitle,
				description: `${editIcon} ${pathDisplay}`,
			},
			uiTheme,
		);
		let text = header;

		// Skip metadata line for delete operations
		if (op !== "delete") {
			const editLineCount = countLines(args?.newText ?? args?.oldText ?? args?.diff ?? args?.patch ?? "");
			text += `\n${formatMetadataLine(editLineCount, editLanguage, uiTheme)}`;
		}

		if (result.isError) {
			// Show error from result
			const errorText = result.content?.find((c) => c.type === "text")?.text ?? "";
			if (errorText) {
				text += `\n\n${uiTheme.fg("error", errorText)}`;
			}
		} else if (result.details?.diff) {
			// Prefer actual diff after execution
			text += renderDiffSection(result.details.diff, rawPath, expanded, uiTheme, ui, renderDiffFn);
		} else if (editDiffPreview) {
			// Use cached diff preview when no actual diff is available
			if ("error" in editDiffPreview) {
				text += `\n\n${uiTheme.fg("error", editDiffPreview.error)}`;
			} else if (editDiffPreview.diff) {
				text += renderDiffSection(editDiffPreview.diff, rawPath, expanded, uiTheme, ui, renderDiffFn);
			}
		}

		// Show LSP diagnostics if available
		if (result.details?.diagnostics) {
			text += ui.formatDiagnostics(result.details.diagnostics, expanded, (fp: string) =>
				uiTheme.getLangIcon(getLanguageFromPath(fp)),
			);
		}

		return new Text(text, 0, 0);
	},
};
