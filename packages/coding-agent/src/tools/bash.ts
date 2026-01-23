import { relative, resolve, sep } from "node:path";
import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import type { Component } from "@oh-my-pi/pi-tui";
import { Text } from "@oh-my-pi/pi-tui";
import { Type } from "@sinclair/typebox";
import { renderPromptTemplate } from "$c/config/prompt-templates";
import { type BashExecutorOptions, executeBash } from "$c/exec/bash-executor";
import type { RenderResultOptions } from "$c/extensibility/custom-tools/types";
import { truncateToVisualLines } from "$c/modes/components/visual-truncate";
import type { Theme } from "$c/modes/theme/theme";
import bashDescription from "$c/prompts/tools/bash.md" with { type: "text" };
import type { OutputMeta } from "$c/tools/output-meta";
import { ToolError } from "$c/tools/tool-errors";
import { renderOutputBlock, renderStatusLine } from "$c/tui";

import { checkBashInterception, checkSimpleLsInterception } from "./bash-interceptor";
import type { ToolSession } from "./index";
import { allocateOutputArtifact, createTailBuffer } from "./output-utils";
import { resolveToCwd } from "./path-utils";
import { formatBytes, wrapBrackets } from "./render-utils";
import { toolResult } from "./tool-result";
import { DEFAULT_MAX_BYTES } from "./truncate";

export const BASH_DEFAULT_PREVIEW_LINES = 10;

const bashSchema = Type.Object({
	command: Type.String({ description: "Command to execute" }),
	timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (default: 300)" })),
	cwd: Type.Optional(Type.String({ description: "Working directory (default: cwd)" })),
});

export interface BashToolDetails {
	meta?: OutputMeta;
}

export interface BashToolOptions {}

/**
 * Bash tool implementation.
 *
 * Executes bash commands with optional timeout and working directory.
 */
export class BashTool implements AgentTool<typeof bashSchema, BashToolDetails> {
	public readonly name = "bash";
	public readonly label = "Bash";
	public readonly description: string;
	public readonly parameters = bashSchema;

	private readonly session: ToolSession;

	constructor(session: ToolSession) {
		this.session = session;
		this.description = renderPromptTemplate(bashDescription);
	}

	public async execute(
		_toolCallId: string,
		{ command, timeout: rawTimeout = 300, cwd }: { command: string; timeout?: number; cwd?: string },
		signal?: AbortSignal,
		onUpdate?: AgentToolUpdateCallback<BashToolDetails>,
		ctx?: AgentToolContext,
	): Promise<AgentToolResult<BashToolDetails>> {
		// Check interception if enabled and available tools are known
		if (this.session.settings?.getBashInterceptorEnabled()) {
			const rules = this.session.settings?.getBashInterceptorRules?.();
			const interception = checkBashInterception(command, ctx?.toolNames ?? [], rules);
			if (interception.block) {
				throw new ToolError(interception.message ?? "Command blocked");
			}
			if (this.session.settings?.getBashInterceptorSimpleLsEnabled?.() !== false) {
				const lsInterception = checkSimpleLsInterception(command, ctx?.toolNames ?? []);
				if (lsInterception.block) {
					throw new ToolError(lsInterception.message ?? "Command blocked");
				}
			}
		}

		const commandCwd = cwd ? resolveToCwd(cwd, this.session.cwd) : this.session.cwd;
		let cwdStat: Awaited<ReturnType<Bun.BunFile["stat"]>>;
		try {
			cwdStat = await Bun.file(commandCwd).stat();
		} catch {
			throw new ToolError(`Working directory does not exist: ${commandCwd}`);
		}
		if (!cwdStat.isDirectory()) {
			throw new ToolError(`Working directory is not a directory: ${commandCwd}`);
		}

		// Auto-convert milliseconds to seconds if value > 1000 (16+ min is unreasonable)
		let timeoutSec = rawTimeout > 1000 ? rawTimeout / 1000 : rawTimeout;
		// Clamp to reasonable range: 1s - 3600s (1 hour)
		timeoutSec = Math.max(1, Math.min(3600, timeoutSec));
		const timeoutMs = timeoutSec * 1000;

		// Track output for streaming updates (tail only)
		const tailBuffer = createTailBuffer(DEFAULT_MAX_BYTES);

		// Set up artifacts environment and allocation
		const artifactsDir = this.session.getArtifactsDir?.();
		const extraEnv = artifactsDir ? { ARTIFACTS: artifactsDir } : undefined;
		const { artifactPath, artifactId } = await allocateOutputArtifact(this.session, "bash");

		const executorOptions: BashExecutorOptions = {
			cwd: commandCwd,
			timeout: timeoutMs,
			signal,
			env: extraEnv,
			artifactPath,
			artifactId,
			onChunk: (chunk) => {
				tailBuffer.append(chunk);
				if (onUpdate) {
					onUpdate({
						content: [{ type: "text", text: tailBuffer.text() }],
						details: {},
					});
				}
			},
		};

		// Handle errors
		const result = await executeBash(command, executorOptions);
		if (result.cancelled) {
			throw new ToolError(result.output || "Command aborted");
		}

		const outputText = result.output || "(no output)";
		const details: BashToolDetails = {};
		const resultBuilder = toolResult(details).text(outputText).truncationFromSummary(result, { direction: "tail" });

		if (result.exitCode !== 0 && result.exitCode !== undefined) {
			throw new ToolError(`${outputText}\n\nCommand exited with code ${result.exitCode}`);
		}

		return resultBuilder.done();
	}
}

// =============================================================================
// TUI Renderer
// =============================================================================

interface BashRenderArgs {
	command?: string;
	timeout?: number;
	cwd?: string;
}

interface BashRenderContext {
	/** Raw output text */
	output?: string;
	/** Whether output came from artifact storage */
	isFullOutput?: boolean;
	/** Whether output is expanded */
	expanded?: boolean;
	/** Number of preview lines when collapsed */
	previewLines?: number;
	/** Timeout in seconds */
	timeout?: number;
}

// Preview line limit when not expanded (matches tool-execution behavior)
export const BASH_PREVIEW_LINES = 10;

export const bashToolRenderer = {
	renderCall(args: BashRenderArgs, uiTheme: Theme): Component {
		const command = args.command || uiTheme.format.ellipsis;
		const prompt = "$";
		const cwd = process.cwd();
		let displayWorkdir = args.cwd;

		if (displayWorkdir) {
			const resolvedCwd = resolve(cwd);
			const resolvedWorkdir = resolve(displayWorkdir);
			if (resolvedWorkdir === resolvedCwd) {
				displayWorkdir = undefined;
			} else {
				const relativePath = relative(resolvedCwd, resolvedWorkdir);
				const isWithinCwd = relativePath && !relativePath.startsWith("..") && !relativePath.startsWith(`..${sep}`);
				if (isWithinCwd) {
					displayWorkdir = relativePath;
				}
			}
		}

		const cmdText = displayWorkdir ? `${prompt} cd ${displayWorkdir} && ${command}` : `${prompt} ${command}`;
		const text = renderStatusLine({ icon: "pending", title: "Bash", description: cmdText }, uiTheme);
		return new Text(text, 0, 0);
	},

	renderResult(
		result: {
			content: Array<{ type: string; text?: string }>;
			details?: BashToolDetails;
		},
		options: RenderResultOptions & { renderContext?: BashRenderContext },
		uiTheme: Theme,
	): Component {
		const header = renderStatusLine({ icon: "success", title: "Bash" }, uiTheme);
		const { renderContext } = options;
		const details = result.details;
		const expanded = renderContext?.expanded ?? options.expanded;
		const previewLines = renderContext?.previewLines ?? BASH_DEFAULT_PREVIEW_LINES;

		// Get output from context (preferred) or fall back to result content
		const output = renderContext?.output ?? (result.content?.find((c) => c.type === "text")?.text ?? "").trim();
		const displayOutput = output;
		const showingFullOutput = expanded && renderContext?.isFullOutput === true;

		// Build truncation warning lines (static, doesn't depend on width)
		const truncation = details?.meta?.truncation;
		const timeoutSeconds = renderContext?.timeout;
		const timeoutLine =
			typeof timeoutSeconds === "number"
				? uiTheme.fg(
						"dim",
						`${uiTheme.format.bracketLeft}Timeout: ${timeoutSeconds}s${uiTheme.format.bracketRight}`,
					)
				: undefined;
		let warningLine: string | undefined;
		if (truncation && !showingFullOutput) {
			const warnings: string[] = [];
			if (truncation?.artifactId) {
				warnings.push(`Full output: artifact://${truncation.artifactId}`);
			}
			if (truncation.truncatedBy === "lines") {
				warnings.push(`Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`);
			} else {
				warnings.push(
					`Truncated: ${truncation.outputLines} lines shown (${formatBytes(truncation.outputBytes)} limit)`,
				);
			}
			if (warnings.length > 0) {
				warningLine = uiTheme.fg("warning", wrapBrackets(warnings.join(". "), uiTheme));
			}
		}

		return {
			render: (width: number): string[] => {
				const outputLines: string[] = [];
				if (displayOutput) {
					if (expanded) {
						outputLines.push(...displayOutput.split("\n").map((line) => uiTheme.fg("toolOutput", line)));
					} else {
						const styledOutput = displayOutput
							.split("\n")
							.map((line) => uiTheme.fg("toolOutput", line))
							.join("\n");
						const textContent = `\n${styledOutput}`;
						const result = truncateToVisualLines(textContent, previewLines, width);
						if (result.skippedCount > 0) {
							outputLines.push(
								uiTheme.fg(
									"dim",
									`${uiTheme.format.ellipsis} (${result.skippedCount} earlier lines, showing ${result.visualLines.length} of ${result.skippedCount + result.visualLines.length}) (ctrl+o to expand)`,
								),
							);
						}
						outputLines.push(...result.visualLines);
					}
				}
				if (timeoutLine) outputLines.push(timeoutLine);
				if (warningLine) outputLines.push(warningLine);

				return renderOutputBlock(
					{
						header,
						state: "success",
						sections: [{ label: uiTheme.fg("toolTitle", "Output"), lines: outputLines }],
						width,
					},
					uiTheme,
				);
			},
			invalidate: () => {},
		};
	},
};
