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
import { getLanguageFromPath, type Theme } from "$c/modes/theme/theme";
import writeDescription from "$c/prompts/tools/write.md" with { type: "text" };
import type { ToolSession } from "$c/sdk";
import { type OutputMeta, outputMeta } from "$c/tools/output-meta";
import { renderCodeCell, renderStatusLine } from "$c/tui";
import { resolveToCwd } from "./path-utils";
import { formatDiagnostics, shortenPath } from "./render-utils";
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
		const pathDisplay = filePath || uiTheme.format.ellipsis;
		const status = options?.spinnerFrame !== undefined ? "running" : "pending";
		const text = renderStatusLine(
			{ icon: status, title: "Write", description: pathDisplay, spinnerFrame: options?.spinnerFrame },
			uiTheme,
		);
		if (!args.content) {
			return new Text(text, 0, 0);
		}

		const contentLines = args.content.split("\n");
		const displayLines = contentLines.slice(-WRITE_STREAMING_PREVIEW_LINES);
		const hidden = contentLines.length - displayLines.length;
		const outputLines: string[] = [];
		if (hidden > 0) {
			outputLines.push(uiTheme.fg("dim", `${uiTheme.format.ellipsis} (${hidden} earlier lines)`));
		}
		outputLines.push(uiTheme.fg("dim", `${uiTheme.format.ellipsis} (streaming)`));

		return {
			render: (width: number) =>
				renderCodeCell(
					{
						code: displayLines.join("\n"),
						language: getLanguageFromPath(rawPath),
						title: filePath ? `Write ${filePath}` : "Write",
						status,
						spinnerFrame: options?.spinnerFrame,
						output: outputLines.join("\n"),
						codeMaxLines: WRITE_STREAMING_PREVIEW_LINES,
						expanded: true,
						width,
					},
					uiTheme,
				),
			invalidate: () => {},
		};
	},

	renderResult(
		result: { content: Array<{ type: string; text?: string }>; details?: WriteToolDetails },
		{ expanded, isPartial, spinnerFrame }: RenderResultOptions,
		uiTheme: Theme,
		args?: WriteRenderArgs,
	): Component {
		const rawPath = args?.file_path || args?.path || "";
		const filePath = shortenPath(rawPath);
		const fileContent = args?.content || "";
		const lang = getLanguageFromPath(rawPath);
		const outputLines: string[] = [];
		const lineCount = countLines(fileContent);

		outputLines.push(formatMetadataLine(lineCount, lang ?? "text", uiTheme));

		if (isPartial && fileContent) {
			const contentLines = fileContent.split("\n");
			const displayLines = contentLines.slice(-WRITE_STREAMING_PREVIEW_LINES);
			const hidden = contentLines.length - displayLines.length;
			if (hidden > 0) {
				outputLines.push(uiTheme.fg("dim", `${uiTheme.format.ellipsis} (${hidden} earlier lines)`));
			}
			outputLines.push(uiTheme.fg("dim", `${uiTheme.format.ellipsis} (streaming)`));

			return {
				render: (width: number) =>
					renderCodeCell(
						{
							code: displayLines.join("\n"),
							language: lang,
							title: filePath ? `Write ${filePath}` : "Write",
							status: spinnerFrame !== undefined ? "running" : "pending",
							spinnerFrame,
							output: outputLines.join("\n"),
							codeMaxLines: WRITE_STREAMING_PREVIEW_LINES,
							expanded: true,
							width,
						},
						uiTheme,
					),
				invalidate: () => {},
			};
		}

		if (result.details?.diagnostics) {
			const diagText = formatDiagnostics(result.details.diagnostics, expanded, uiTheme, (fp) =>
				uiTheme.getLangIcon(getLanguageFromPath(fp)),
			);
			if (diagText.trim()) {
				const diagLines = diagText.split("\n");
				const firstNonEmpty = diagLines.findIndex((line) => line.trim());
				outputLines.push(...(firstNonEmpty >= 0 ? diagLines.slice(firstNonEmpty) : []));
			}
		}

		return {
			render: (width: number) =>
				renderCodeCell(
					{
						code: fileContent,
						language: lang,
						title: filePath ? `Write ${filePath}` : "Write",
						status: "complete",
						output: outputLines.join("\n"),
						codeMaxLines: expanded ? Number.POSITIVE_INFINITY : 10,
						expanded,
						width,
					},
					uiTheme,
				),
			invalidate: () => {},
		};
	},
	mergeCallAndResult: true,
};
