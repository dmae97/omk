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
import { renderPromptTemplate } from "$c/config/prompt-templates";
import type { RenderResultOptions } from "$c/extensibility/custom-tools/types";
import {
	createLspWritethrough,
	type FileDiagnosticsResult,
	type WritethroughCallback,
	writethroughNoop,
} from "$c/lsp/index";
import { getLanguageFromPath, highlightCode, type Theme } from "$c/modes/theme/theme";
import writeDescription from "$c/prompts/tools/write.md" with { type: "text" };
import type { ToolSession } from "$c/sdk";
import { type OutputMeta, outputMeta } from "$c/tools/output-meta";
import { resolveToCwd } from "./path-utils";
import { formatDiagnostics, formatExpandHint, formatStatusIcon, replaceTabs, shortenPath } from "./render-utils";
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
	const hasLaterWrites = toolCall.toolCalls.slice(toolCall.index + 1).some((call) => LSP_BATCH_TOOLS.has(call.name));
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
			const absolutePath = resolveToCwd(path, this.session.cwd);
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

const WRITE_STREAMING_PREVIEW_LINES = 12;

function countLines(text: string): number {
	if (!text) return 0;
	return text.split("\n").length;
}

function formatStreamingContent(content: string, rawPath: string, uiTheme: Theme): string {
	if (!content) return "";
	const lang = getLanguageFromPath(rawPath);
	const lines = content.split("\n");
	const total = lines.length;
	const displayLines = lines.slice(-WRITE_STREAMING_PREVIEW_LINES);
	const hidden = total - displayLines.length;

	const formattedLines = lang
		? highlightCode(replaceTabs(displayLines.join("\n")), lang)
		: displayLines.map((line: string) => uiTheme.fg("toolOutput", replaceTabs(line)));

	let text = "\n\n";
	if (hidden > 0) {
		text += uiTheme.fg("dim", `${uiTheme.format.ellipsis} (${hidden} earlier lines)\n`);
	}
	text += formattedLines.join("\n");
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

export const writeToolRenderer = {
	renderCall(args: WriteRenderArgs, uiTheme: Theme, options?: RenderCallOptions): Component {
		const rawPath = args.file_path || args.path || "";
		const filePath = shortenPath(rawPath);
		const pathDisplay = filePath ? uiTheme.fg("accent", filePath) : uiTheme.fg("toolOutput", uiTheme.format.ellipsis);
		const spinner =
			options?.spinnerFrame !== undefined ? formatStatusIcon("running", uiTheme, options.spinnerFrame) : "";
		let text = `${uiTheme.fg("toolTitle", uiTheme.bold("Write"))} ${spinner ? `${spinner} ` : ""}${pathDisplay}`;

		// Show streaming preview of content
		if (args.content) {
			text += formatStreamingContent(args.content, rawPath, uiTheme);
		}

		return new Text(text, 0, 0);
	},

	renderResult(
		result: { content: Array<{ type: string; text?: string }>; details?: WriteToolDetails },
		{ expanded }: RenderResultOptions,
		uiTheme: Theme,
		args?: WriteRenderArgs,
	): Component {
		const rawPath = args?.file_path || args?.path || "";
		const fileContent = args?.content || "";
		const lang = getLanguageFromPath(rawPath);
		const contentLines = fileContent
			? lang
				? highlightCode(replaceTabs(fileContent), lang)
				: fileContent.split("\n")
			: [];
		const totalLines = contentLines.length;
		const outputLines: string[] = [];

		outputLines.push(formatMetadataLine(countLines(fileContent), lang ?? "text", uiTheme));

		if (fileContent) {
			const maxLines = expanded ? contentLines.length : 10;
			const displayLines = contentLines.slice(0, maxLines);
			const remaining = contentLines.length - maxLines;

			outputLines.push(
				"",
				...displayLines.map((line: string) =>
					lang ? replaceTabs(line) : uiTheme.fg("toolOutput", replaceTabs(line)),
				),
			);
			if (remaining > 0) {
				outputLines.push(
					uiTheme.fg(
						"toolOutput",
						`${uiTheme.format.ellipsis} (${remaining} more lines, ${totalLines} total) ${formatExpandHint(uiTheme)}`,
					),
				);
			}
		}

		// Show LSP diagnostics if available
		if (result.details?.diagnostics) {
			outputLines.push(
				formatDiagnostics(result.details.diagnostics, expanded, uiTheme, (fp) =>
					uiTheme.getLangIcon(getLanguageFromPath(fp)),
				),
			);
		}

		return new Text(outputLines.join("\n"), 0, 0);
	},
};
