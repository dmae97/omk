import type { AgentTool, AgentToolContext, ToolCallContext } from "@oh-my-pi/pi-agent-core";
import type { Component } from "@oh-my-pi/pi-tui";
import { Text } from "@oh-my-pi/pi-tui";
import { Type } from "@sinclair/typebox";
import { getLanguageFromPath, highlightCode, type Theme } from "../../modes/interactive/theme/theme";
import writeDescription from "../../prompts/tools/write.md" with { type: "text" };
import type { RenderResultOptions } from "../custom-tools/types";
import { renderPromptTemplate } from "../prompt-templates";
import type { ToolSession } from "../sdk";
import { untilAborted } from "../utils";
import { createLspWritethrough, type FileDiagnosticsResult, writethroughNoop } from "./lsp/index";
import { resolveToCwd } from "./path-utils";
import { formatDiagnostics, formatExpandHint, replaceTabs, shortenPath } from "./render-utils";

const writeSchema = Type.Object({
	path: Type.String({ description: "Path to the file to write (relative or absolute)" }),
	content: Type.String({ description: "Content to write to the file" }),
});

/** Details returned by the write tool for TUI rendering */
export interface WriteToolDetails {
	diagnostics?: FileDiagnosticsResult;
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

export function createWriteTool(session: ToolSession): AgentTool<typeof writeSchema, WriteToolDetails> {
	const enableLsp = session.enableLsp ?? true;
	const enableFormat = enableLsp ? (session.settings?.getLspFormatOnWrite() ?? true) : false;
	const enableDiagnostics = enableLsp ? (session.settings?.getLspDiagnosticsOnWrite() ?? true) : false;
	const writethrough = enableLsp
		? createLspWritethrough(session.cwd, { enableFormat, enableDiagnostics })
		: writethroughNoop;
	return {
		name: "write",
		label: "Write",
		description: renderPromptTemplate(writeDescription),
		parameters: writeSchema,
		execute: async (
			_toolCallId: string,
			{ path, content }: { path: string; content: string },
			signal?: AbortSignal,
			_onUpdate?: unknown,
			context?: AgentToolContext,
		) => {
			return untilAborted(signal, async () => {
				const absolutePath = resolveToCwd(path, session.cwd);
				const batchRequest = getLspBatchRequest(context?.toolCall);

				const diagnostics = await writethrough(absolutePath, content, signal, undefined, batchRequest);

				let resultText = `Successfully wrote ${content.length} bytes to ${path}`;
				if (!diagnostics) {
					return {
						content: [{ type: "text", text: resultText }],
						details: {},
					};
				}

				const messages = diagnostics?.messages;
				if (messages && messages.length > 0) {
					resultText += `\n\nLSP Diagnostics (${diagnostics.summary}):\n`;
					resultText += messages.map((d) => `  ${d}`).join("\n");
				}
				return {
					content: [{ type: "text", text: resultText }],
					details: { diagnostics },
				};
			});
		},
	};
}

// =============================================================================
// TUI Renderer
// =============================================================================

interface WriteRenderArgs {
	path?: string;
	file_path?: string;
	content?: string;
}

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
	renderCall(args: WriteRenderArgs, uiTheme: Theme): Component {
		const rawPath = args.file_path || args.path || "";
		const filePath = shortenPath(rawPath);
		const pathDisplay = filePath ? uiTheme.fg("accent", filePath) : uiTheme.fg("toolOutput", uiTheme.format.ellipsis);
		const text = `${uiTheme.fg("toolTitle", uiTheme.bold("Write"))} ${pathDisplay}`;
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
