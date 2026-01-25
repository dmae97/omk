import type {
	AgentTool,
	AgentToolContext,
	AgentToolResult,
	AgentToolUpdateCallback,
	ToolCallContext,
} from "@oh-my-pi/pi-agent-core";
import type { Component } from "@oh-my-pi/pi-tui";
import { Text } from "@oh-my-pi/pi-tui";
import { untilAborted } from "@oh-my-pi/pi-utils";
import { Type } from "@sinclair/typebox";
import { renderPromptTemplate } from "../config/prompt-templates";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import { createLspWritethrough, type FileDiagnosticsResult, type WritethroughCallback, writethroughNoop } from "../lsp";
import { getLanguageFromPath, type Theme } from "../modes/theme/theme";
import writeDescription from "../prompts/tools/write.md" with { type: "text" };
import type { ToolSession } from "../sdk";
import { renderStatusLine } from "../tui";
import { type OutputMeta, outputMeta } from "./output-meta";
import { enforcePlanModeWrite, resolvePlanPath } from "./plan-mode-guard";
import {
	formatDiagnostics,
	formatExpandHint,
	formatMoreItems,
	formatStatusIcon,
	shortenPath,
	ToolUIKit,
} from "./render-utils";
import type { RenderCallOptions } from "./renderers";

const writeSchema = Type.Object({
	path: Type.String({ description: "Path to the file to write (relative or absolute)" }),
	content: Type.String({ description: "Content to write to the file" }),
});

/** Details returned by the write tool for TUI rendering */
export interface WriteToolDetails {
	diagnostics?: FileDiagnosticsResult;
	meta?: OutputMeta;
}

const LSP_BATCH_TOOLS = new Set(["edit", "write"]);

function getLspBatchRequest(toolCall: ToolCallContext | undefined): { id: string; flush: boolean } | undefined {
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
// Tool Class
// ═══════════════════════════════════════════════════════════════════════════

type WriteParams = { path: string; content: string };

/**
 * Write tool implementation.
 *
 * Creates or overwrites files with optional LSP formatting and diagnostics.
 */
export class WriteTool implements AgentTool<typeof writeSchema, WriteToolDetails> {
	public readonly name = "write";
	public readonly label = "Write";
	public readonly description: string;
	public readonly parameters = writeSchema;

	private readonly session: ToolSession;
	private readonly writethrough: WritethroughCallback;

	constructor(session: ToolSession) {
		this.session = session;
		const enableLsp = session.enableLsp ?? true;
		const enableFormat = enableLsp ? (session.settings?.getLspFormatOnWrite() ?? true) : false;
		const enableDiagnostics = enableLsp ? (session.settings?.getLspDiagnosticsOnWrite() ?? true) : false;
		this.writethrough = enableLsp
			? createLspWritethrough(session.cwd, { enableFormat, enableDiagnostics })
			: writethroughNoop;
		this.description = renderPromptTemplate(writeDescription);
	}

	public async execute(
		_toolCallId: string,
		{ path, content }: WriteParams,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<WriteToolDetails>,
		context?: AgentToolContext,
	): Promise<AgentToolResult<WriteToolDetails>> {
		return untilAborted(signal, async () => {
			enforcePlanModeWrite(this.session, path, { op: "create" });
			const absolutePath = resolvePlanPath(this.session, path);
			const batchRequest = getLspBatchRequest(context?.toolCall);

			const diagnostics = await this.writethrough(absolutePath, content, signal, undefined, batchRequest);

			const resultText = `Successfully wrote ${content.length} bytes to ${path}`;
			if (!diagnostics) {
				return {
					content: [{ type: "text", text: resultText }],
					details: {},
				};
			}

			return {
				content: [{ type: "text", text: resultText }],
				details: {
					diagnostics,
					meta: outputMeta()
						.diagnostics(diagnostics.summary, diagnostics.messages ?? [])
						.get(),
				},
			};
		});
	}
}

// =============================================================================
// TUI Renderer
// =============================================================================

interface WriteRenderArgs {
	path?: string;
	file_path?: string;
	content?: string;
}

const WRITE_PREVIEW_LINES = 6;
const WRITE_STREAMING_PREVIEW_LINES = 12;

function countLines(text: string): number {
	if (!text) return 0;
	return text.split("\n").length;
}

function formatMetadataLine(lineCount: number | null, language: string | undefined, uiTheme: Theme): string {
	const icon = uiTheme.getLangIcon(language);
	if (lineCount !== null) {
		return uiTheme.fg("dim", `${icon} ${lineCount} lines`);
	}
	return uiTheme.fg("dim", `${icon}`);
}

function formatStreamingContent(content: string, uiTheme: Theme, ui: ToolUIKit): string {
	if (!content) return "";
	const lines = content.split("\n");
	const displayLines = lines.slice(-WRITE_STREAMING_PREVIEW_LINES);
	const hidden = lines.length - displayLines.length;

	let text = "\n\n";
	if (hidden > 0) {
		text += uiTheme.fg("dim", `${uiTheme.format.ellipsis} (${hidden} earlier lines)\n`);
	}
	for (const line of displayLines) {
		text += `${uiTheme.fg("toolOutput", ui.truncate(line, 80))}\n`;
	}
	text += uiTheme.fg("dim", `${uiTheme.format.ellipsis} (streaming)`);
	return text;
}

function renderContentPreview(content: string, expanded: boolean, uiTheme: Theme, ui: ToolUIKit): string {
	if (!content) return "";
	const lines = content.split("\n");
	const maxLines = expanded ? lines.length : Math.min(lines.length, WRITE_PREVIEW_LINES);
	const displayLines = expanded ? lines : lines.slice(-maxLines);
	const hidden = lines.length - displayLines.length;

	let text = "\n\n";
	for (const line of displayLines) {
		text += `${uiTheme.fg("toolOutput", ui.truncate(line, 80))}\n`;
	}
	if (!expanded && hidden > 0) {
		const hint = formatExpandHint(uiTheme, expanded, hidden > 0);
		const moreLine = `${formatMoreItems(hidden, "line", uiTheme)}${hint ? ` ${hint}` : ""}`;
		text += uiTheme.fg("dim", moreLine);
	}
	return text;
}

export const writeToolRenderer = {
	renderCall(args: WriteRenderArgs, uiTheme: Theme, options?: RenderCallOptions): Component {
		const ui = new ToolUIKit(uiTheme);
		const rawPath = args.file_path || args.path || "";
		const filePath = shortenPath(rawPath);
		const lang = getLanguageFromPath(rawPath) ?? "text";
		const langIcon = uiTheme.fg("muted", uiTheme.getLangIcon(lang));
		const pathDisplay = filePath ? uiTheme.fg("accent", filePath) : uiTheme.fg("toolOutput", uiTheme.format.ellipsis);
		const spinner =
			options?.spinnerFrame !== undefined ? formatStatusIcon("running", uiTheme, options.spinnerFrame) : "";

		let text = `${ui.title("Write")} ${spinner ? `${spinner} ` : ""}${langIcon} ${pathDisplay}`;

		if (!args.content) {
			return new Text(text, 0, 0);
		}

		// Show streaming preview of content (tail)
		text += formatStreamingContent(args.content, uiTheme, ui);

		return new Text(text, 0, 0);
	},

	renderResult(
		result: { content: Array<{ type: string; text?: string }>; details?: WriteToolDetails },
		{ expanded }: RenderResultOptions,
		uiTheme: Theme,
		args?: WriteRenderArgs,
	): Component {
		const ui = new ToolUIKit(uiTheme);
		const rawPath = args?.file_path || args?.path || "";
		const filePath = shortenPath(rawPath);
		const fileContent = args?.content || "";
		const lang = getLanguageFromPath(rawPath);
		const langIcon = uiTheme.fg("muted", uiTheme.getLangIcon(lang));
		const pathDisplay = filePath ? uiTheme.fg("accent", filePath) : uiTheme.fg("toolOutput", uiTheme.format.ellipsis);
		const lineCount = countLines(fileContent);

		// Build header with status icon
		const header = renderStatusLine(
			{
				icon: "success",
				title: "Write",
				description: `${langIcon} ${pathDisplay}`,
			},
			uiTheme,
		);
		let text = header;

		// Add metadata line
		text += `\n${formatMetadataLine(lineCount, lang ?? "text", uiTheme)}`;

		// Show content preview (collapsed tail, expandable)
		text += renderContentPreview(fileContent, expanded, uiTheme, ui);

		// Show diagnostics if available
		if (result.details?.diagnostics) {
			const diagText = formatDiagnostics(result.details.diagnostics, expanded, uiTheme, fp =>
				uiTheme.getLangIcon(getLanguageFromPath(fp)),
			);
			if (diagText.trim()) {
				const diagLines = diagText.split("\n");
				const firstNonEmpty = diagLines.findIndex(line => line.trim());
				if (firstNonEmpty >= 0) {
					text += `\n${diagLines.slice(firstNonEmpty).join("\n")}`;
				}
			}
		}

		return new Text(text, 0, 0);
	},
	mergeCallAndResult: true,
};
