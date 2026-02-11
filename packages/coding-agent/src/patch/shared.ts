/**
 * Shared utilities for edit tool TUI rendering.
 */
import type { ToolCallContext } from "@oh-my-pi/pi-agent-core";
import type { Component } from "@oh-my-pi/pi-tui";
import { Text } from "@oh-my-pi/pi-tui";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import type { FileDiagnosticsResult } from "../lsp";
import { renderDiff as renderDiffColored } from "../modes/components/diff";
import { getLanguageFromPath, type Theme } from "../modes/theme/theme";
import type { OutputMeta } from "../tools/output-meta";
import {
	formatExpandHint,
	formatStatusIcon,
	getDiffStats,
	PREVIEW_LIMITS,
	replaceTabs,
	shortenPath,
	ToolUIKit,
	truncateDiffByHunk,
} from "../tools/render-utils";
import type { RenderCallOptions } from "../tools/renderers";
import { Ellipsis, Hasher, type RenderCache, renderStatusLine, truncateToWidth } from "../tui";
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
	const hasLaterWrites = toolCall.toolCalls.slice(toolCall.index + 1).some(call => LSP_BATCH_TOOLS.has(call.name));
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
	/**
	 * Computed preview diff (used when tool args don't include a diff, e.g. hashline mode).
	 */
	previewDiff?: string;
	// Hashline mode fields
	edits?: HashlineEditPreview[];
}

type HashlineEditPreview =
	| { replaceLine: { loc: string; content: string } }
	| { replaceLines: { start: string; end: string; content: string } }
	| { insertAfter: { loc: string; content: string } };

/** Extended context for edit tool rendering */
export interface EditRenderContext {
	/** Pre-computed diff preview (computed before tool executes) */
	editDiffPreview?: DiffResult | DiffError;
	/** Function to render diff text with syntax highlighting */
	renderDiff?: (diffText: string, options?: { filePath?: string }) => string;
}

const EDIT_STREAMING_PREVIEW_LINES = 12;

function countLines(text: string): number {
	if (!text) return 0;
	return text.split("\n").length;
}

function formatStreamingDiff(diff: string, rawPath: string, uiTheme: Theme, label = "streaming"): string {
	if (!diff) return "";
	const lines = diff.split("\n");
	const total = lines.length;
	const displayLines = lines.slice(-EDIT_STREAMING_PREVIEW_LINES);
	const hidden = total - displayLines.length;
	let text = "\n\n";
	if (hidden > 0) {
		text += uiTheme.fg("dim", `… (${hidden} earlier lines)\n`);
	}
	text += renderDiffColored(displayLines.join("\n"), { filePath: rawPath });
	text += uiTheme.fg("dim", `\n… (${label})`);
	return text;
}

function formatStreamingHashlineEdits(edits: HashlineEditPreview[], uiTheme: Theme, ui: ToolUIKit): string {
	const MAX_EDITS = 4;
	const MAX_DST_LINES = 8;
	let text = "\n\n";
	text += uiTheme.fg("dim", `[${edits.length} hashline edit${edits.length === 1 ? "" : "s"}]`);
	text += "\n";
	let shownEdits = 0;
	let shownDstLines = 0;
	for (const edit of edits) {
		shownEdits++;
		if (shownEdits > MAX_EDITS) break;
		const formatted = formatHashlineEdit(edit);
		text += uiTheme.fg("toolOutput", ui.truncate(replaceTabs(formatted.srcLabel), 120));
		text += "\n";
		if (formatted.dst === "") {
			text += uiTheme.fg("dim", ui.truncate("  (delete)", 120));
			text += "\n";
			continue;
		}
		for (const dstLine of formatted.dst.split("\n")) {
			shownDstLines++;
			if (shownDstLines > MAX_DST_LINES) break;
			text += uiTheme.fg("toolOutput", ui.truncate(replaceTabs(`+ ${dstLine}`), 120));
			text += "\n";
		}
		if (shownDstLines > MAX_DST_LINES) break;
	}
	if (edits.length > MAX_EDITS) {
		text += uiTheme.fg("dim", `… (${edits.length - MAX_EDITS} more edits)`);
	}
	if (shownDstLines > MAX_DST_LINES) {
		text += uiTheme.fg("dim", `\n… (${shownDstLines - MAX_DST_LINES} more dst lines)`);
	}

	return text.trimEnd();
	function formatHashlineEdit(edit: HashlineEditPreview): { srcLabel: string; dst: string } {
		if ("replaceLine" in edit) {
			return {
				srcLabel: `• replaceLine ${edit.replaceLine.loc}`,
				dst: edit.replaceLine.content,
			};
		}
		if ("replaceLines" in edit) {
			return {
				srcLabel: `• replaceLines ${edit.replaceLines.start}..${edit.replaceLines.end}`,
				dst: edit.replaceLines.content,
			};
		}
		return {
			srcLabel: `• insertAfter ${edit.insertAfter.loc}..`,
			dst: edit.insertAfter.content,
		};
	}
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
		: truncateDiffByHunk(diff, PREVIEW_LIMITS.DIFF_COLLAPSED_HUNKS, PREVIEW_LIMITS.DIFF_COLLAPSED_LINES);

	text += `\n\n${renderDiffFn(truncatedDiff, { filePath: rawPath })}`;
	if (!expanded && (hiddenHunks > 0 || hiddenLines > 0)) {
		const remainder: string[] = [];
		if (hiddenHunks > 0) remainder.push(`${hiddenHunks} more hunks`);
		if (hiddenLines > 0) remainder.push(`${hiddenLines} more lines`);
		text += uiTheme.fg("toolOutput", `\n… (${remainder.join(", ")}) ${formatExpandHint(uiTheme)}`);
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
		let pathDisplay = filePath ? uiTheme.fg("accent", filePath) : uiTheme.fg("toolOutput", "…");

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
		if (args.previewDiff) {
			text += formatStreamingDiff(args.previewDiff, rawPath, uiTheme, "preview");
		} else if (args.diff && args.op) {
			text += formatStreamingDiff(args.diff, rawPath, uiTheme);
		} else if (args.edits && args.edits.length > 0) {
			text += formatStreamingHashlineEdits(args.edits, uiTheme, ui);
		} else if (args.diff) {
			const previewLines = args.diff.split("\n");
			const maxLines = 6;
			text += "\n\n";
			for (const line of previewLines.slice(0, maxLines)) {
				text += `${uiTheme.fg("toolOutput", ui.truncate(replaceTabs(line), 80))}\n`;
			}
			if (previewLines.length > maxLines) {
				text += uiTheme.fg("dim", `… ${previewLines.length - maxLines} more lines`);
			}
		} else if (args.newText || args.patch) {
			const previewLines = (args.newText ?? args.patch ?? "").split("\n");
			const maxLines = 6;
			text += "\n\n";
			for (const line of previewLines.slice(0, maxLines)) {
				text += `${uiTheme.fg("toolOutput", ui.truncate(replaceTabs(line), 80))}\n`;
			}
			if (previewLines.length > maxLines) {
				text += uiTheme.fg("dim", `… ${previewLines.length - maxLines} more lines`);
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
		const rawPath = args?.file_path || args?.path || "";
		const filePath = shortenPath(rawPath);
		const editLanguage = getLanguageFromPath(rawPath) ?? "text";
		const editIcon = uiTheme.fg("muted", uiTheme.getLangIcon(editLanguage));

		const op = args?.op || result.details?.op;
		const rename = args?.rename || result.details?.rename;
		const opTitle = op === "create" ? "Create" : op === "delete" ? "Delete" : "Edit";

		// Pre-compute metadata line (static across renders)
		const metadataLine =
			op !== "delete"
				? `\n${formatMetadataLine(countLines(args?.newText ?? args?.oldText ?? args?.diff ?? args?.patch ?? ""), editLanguage, uiTheme)}`
				: "";

		// Pre-compute error text (static)
		const errorText = result.isError ? (result.content?.find(c => c.type === "text")?.text ?? "") : "";

		let cached: RenderCache | undefined;

		return {
			render(width) {
				const { expanded, renderContext } = options;
				const editDiffPreview = renderContext?.editDiffPreview;
				const renderDiffFn = renderContext?.renderDiff ?? ((t: string) => t);
				const key = new Hasher().bool(expanded).u32(width).digest();
				if (cached?.key === key) return cached.lines;

				// Build path display with line number
				let pathDisplay = filePath ? uiTheme.fg("accent", filePath) : uiTheme.fg("toolOutput", "…");
				const firstChangedLine =
					(editDiffPreview && "firstChangedLine" in editDiffPreview
						? editDiffPreview.firstChangedLine
						: undefined) || (result.details && !result.isError ? result.details.firstChangedLine : undefined);
				if (firstChangedLine) {
					pathDisplay += uiTheme.fg("warning", `:${firstChangedLine}`);
				}

				// Add arrow for rename operations
				if (rename) {
					pathDisplay += ` ${uiTheme.fg("dim", "→")} ${uiTheme.fg("accent", shortenPath(rename))}`;
				}

				const header = renderStatusLine(
					{
						icon: result.isError ? "error" : "success",
						title: opTitle,
						description: `${editIcon} ${pathDisplay}`,
					},
					uiTheme,
				);
				let text = header;
				text += metadataLine;

				if (result.isError) {
					if (errorText) {
						text += `\n\n${uiTheme.fg("error", replaceTabs(errorText))}`;
					}
				} else if (result.details?.diff) {
					text += renderDiffSection(result.details.diff, rawPath, expanded, uiTheme, ui, renderDiffFn);
				} else if (editDiffPreview) {
					if ("error" in editDiffPreview) {
						text += `\n\n${uiTheme.fg("error", replaceTabs(editDiffPreview.error))}`;
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

				const lines =
					width > 0 ? text.split("\n").map(line => truncateToWidth(line, width, Ellipsis.Omit)) : text.split("\n");
				cached = { key, lines };
				return lines;
			},
			invalidate() {
				cached = undefined;
			},
		};
	},
};
