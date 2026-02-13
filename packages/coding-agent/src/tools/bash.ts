import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import type { Component } from "@oh-my-pi/pi-tui";
import { Text } from "@oh-my-pi/pi-tui";
import { $env, isEnoent } from "@oh-my-pi/pi-utils";
import { getProjectDir } from "@oh-my-pi/pi-utils/dirs";
import { type Static, Type } from "@sinclair/typebox";
import { renderPromptTemplate } from "../config/prompt-templates";
import { type BashResult, executeBash } from "../exec/bash-executor";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import { truncateToVisualLines } from "../modes/components/visual-truncate";
import type { Theme } from "../modes/theme/theme";
import bashDescription from "../prompts/tools/bash.md" with { type: "text" };
import { renderStatusLine } from "../tui";
import { CachedOutputBlock } from "../tui/output-block";
import type { ToolSession } from ".";
import { type BashInteractiveResult, runInteractiveBashPty } from "./bash-interactive";
import { checkBashInterception } from "./bash-interceptor";
import { applyHeadTail, normalizeBashCommand } from "./bash-normalize";
import type { OutputMeta } from "./output-meta";
import { allocateOutputArtifact, createTailBuffer } from "./output-utils";
import { resolveToCwd } from "./path-utils";
import { formatBytes, replaceTabs, wrapBrackets } from "./render-utils";
import { ToolAbortError, ToolError } from "./tool-errors";
import { toolResult } from "./tool-result";
import { DEFAULT_MAX_BYTES } from "./truncate";

export const BASH_DEFAULT_PREVIEW_LINES = 10;

const bashSchema = Type.Object({
	command: Type.String({ description: "Command to execute" }),
	timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (default: 300)" })),
	cwd: Type.Optional(Type.String({ description: "Working directory (default: cwd)" })),
	head: Type.Optional(Type.Number({ description: "Return only first N lines of output" })),
	tail: Type.Optional(Type.Number({ description: "Return only last N lines of output" })),
});

export type BashToolInput = Static<typeof bashSchema>;

export interface BashToolDetails {
	meta?: OutputMeta;
}

export interface BashToolOptions {}

function normalizeResultOutput(result: BashResult | BashInteractiveResult): string {
	return result.output || "";
}

function isInteractiveResult(result: BashResult | BashInteractiveResult): result is BashInteractiveResult {
	return "timedOut" in result;
}
/**
 * Bash tool implementation.
 *
 * Executes bash commands with optional timeout and working directory.
 */
export class BashTool implements AgentTool<typeof bashSchema, BashToolDetails> {
	readonly name = "bash";
	readonly label = "Bash";
	readonly description: string;
	readonly parameters = bashSchema;
	readonly concurrency = "exclusive";

	constructor(private readonly session: ToolSession) {
		this.description = renderPromptTemplate(bashDescription);
	}

	async execute(
		_toolCallId: string,
		{ command: rawCommand, timeout: rawTimeout = 300, cwd, head, tail }: BashToolInput,
		signal?: AbortSignal,
		onUpdate?: AgentToolUpdateCallback<BashToolDetails>,
		ctx?: AgentToolContext,
	): Promise<AgentToolResult<BashToolDetails>> {
		// Normalize command: strip head/tail pipes and 2>&1
		const normalized = normalizeBashCommand(rawCommand);
		const command = normalized.command;

		// Merge explicit params with extracted ones (explicit takes precedence)
		const headLines = head ?? normalized.headLines;
		const tailLines = tail ?? normalized.tailLines;

		// Check interception if enabled and available tools are known
		if (this.session.settings.get("bashInterceptor.enabled")) {
			const rules = this.session.settings.getBashInterceptorRules();
			const interception = checkBashInterception(command, ctx?.toolNames ?? [], rules);
			if (interception.block) {
				throw new ToolError(interception.message ?? "Command blocked");
			}
		}

		const commandCwd = cwd ? resolveToCwd(cwd, this.session.cwd) : this.session.cwd;
		let cwdStat: fs.Stats;
		try {
			cwdStat = await fs.promises.stat(commandCwd);
		} catch (err) {
			if (isEnoent(err)) {
				throw new ToolError(`Working directory does not exist: ${commandCwd}`);
			}
			throw err;
		}
		if (!cwdStat.isDirectory()) {
			throw new ToolError(`Working directory is not a directory: ${commandCwd}`);
		}

		// Clamp to reasonable range: 1s - 3600s (1 hour)
		const timeoutSec = Math.max(1, Math.min(3600, rawTimeout));
		const timeoutMs = timeoutSec * 1000;

		// Track output for streaming updates (tail only)
		const tailBuffer = createTailBuffer(DEFAULT_MAX_BYTES);

		// Set up artifacts environment and allocation
		const artifactsDir = this.session.getArtifactsDir?.();
		const extraEnv = artifactsDir ? { ARTIFACTS: artifactsDir } : undefined;
		const { artifactPath, artifactId } = await allocateOutputArtifact(this.session, "bash");

		const usePty =
			this.session.settings.get("bash.virtualTerminal") === "on" &&
			$env.PI_NO_PTY !== "1" &&
			ctx?.hasUI === true &&
			ctx.ui !== undefined;
		const result: BashResult | BashInteractiveResult = usePty
			? await runInteractiveBashPty(ctx.ui!, {
					command,
					cwd: commandCwd,
					timeoutMs,
					signal,
					env: extraEnv,
					artifactPath,
					artifactId,
				})
			: await executeBash(command, {
					cwd: commandCwd,
					timeout: timeoutMs,
					signal,
					env: extraEnv,
					artifactPath,
					artifactId,
					onChunk: chunk => {
						tailBuffer.append(chunk);
						if (onUpdate) {
							onUpdate({
								content: [{ type: "text", text: tailBuffer.text() }],
								details: {},
							});
						}
					},
				});
		if (result.cancelled) {
			if (signal?.aborted) {
				throw new ToolAbortError(normalizeResultOutput(result) || "Command aborted");
			}
			throw new ToolError(normalizeResultOutput(result) || "Command aborted");
		}
		if (isInteractiveResult(result) && result.timedOut) {
			throw new ToolError(normalizeResultOutput(result) || `Command timed out after ${timeoutSec} seconds`);
		}
		// Apply head/tail filtering if specified
		let outputText = normalizeResultOutput(result);
		const headTailResult = applyHeadTail(outputText, headLines, tailLines);
		if (headTailResult.applied) {
			outputText = headTailResult.text;
		}
		if (!outputText) {
			outputText = "(no output)";
		}
		const details: BashToolDetails = {};
		const resultBuilder = toolResult(details).text(outputText).truncationFromSummary(result, { direction: "tail" });
		if (result.exitCode === undefined) {
			throw new ToolError(`${outputText}\n\nCommand failed: missing exit status`);
		}
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

function formatBashCommand(args: BashRenderArgs, _uiTheme: Theme): string {
	const command = args.command || "…";
	const prompt = "$";
	const cwd = getProjectDir();
	let displayWorkdir = args.cwd;

	if (displayWorkdir) {
		const resolvedCwd = path.resolve(cwd);
		const resolvedWorkdir = path.resolve(displayWorkdir);
		if (resolvedWorkdir === resolvedCwd) {
			displayWorkdir = undefined;
		} else {
			const relativePath = path.relative(resolvedCwd, resolvedWorkdir);
			const isWithinCwd =
				relativePath && !relativePath.startsWith("..") && !relativePath.startsWith(`..${path.sep}`);
			if (isWithinCwd) {
				displayWorkdir = relativePath;
			}
		}
	}

	return displayWorkdir ? `${prompt} cd ${displayWorkdir} && ${command}` : `${prompt} ${command}`;
}

// Preview line limit when not expanded (matches tool-execution behavior)
export const BASH_PREVIEW_LINES = 10;

export const bashToolRenderer = {
	renderCall(args: BashRenderArgs, uiTheme: Theme): Component {
		const cmdText = formatBashCommand(args, uiTheme);
		const text = renderStatusLine({ icon: "pending", title: "Bash", description: cmdText }, uiTheme);
		return new Text(text, 0, 0);
	},

	renderResult(
		result: {
			content: Array<{ type: string; text?: string }>;
			details?: BashToolDetails;
			isError?: boolean;
		},
		options: RenderResultOptions & { renderContext?: BashRenderContext },
		uiTheme: Theme,
		args?: BashRenderArgs,
	): Component {
		const cmdText = args ? formatBashCommand(args, uiTheme) : undefined;
		const isError = result.isError === true;
		const header = renderStatusLine({ icon: isError ? "error" : "success", title: "Bash" }, uiTheme);
		const details = result.details;
		const truncation = details?.meta?.truncation;
		const outputBlock = new CachedOutputBlock();

		return {
			render: (width: number): string[] => {
				// REACTIVE: read mutable options at render time
				const { renderContext } = options;
				const expanded = renderContext?.expanded ?? options.expanded;
				const previewLines = renderContext?.previewLines ?? BASH_DEFAULT_PREVIEW_LINES;

				// Get output from context (preferred) or fall back to result content
				const output = renderContext?.output ?? result.content?.find(c => c.type === "text")?.text ?? "";
				const displayOutput = output.trimEnd();
				const showingFullOutput = expanded && renderContext?.isFullOutput === true;

				// Build truncation warning
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

				const outputLines: string[] = [];
				const hasOutput = displayOutput.trim().length > 0;
				if (hasOutput) {
					if (expanded) {
						outputLines.push(
							...displayOutput.split("\n").map(line => uiTheme.fg("toolOutput", replaceTabs(line))),
						);
					} else {
						const styledOutput = displayOutput
							.split("\n")
							.map(line => uiTheme.fg("toolOutput", replaceTabs(line)))
							.join("\n");
						const textContent = styledOutput;
						const result = truncateToVisualLines(textContent, previewLines, width);
						if (result.skippedCount > 0) {
							outputLines.push(
								uiTheme.fg(
									"dim",
									`… (${result.skippedCount} earlier lines, showing ${result.visualLines.length} of ${result.skippedCount + result.visualLines.length}) (ctrl+o to expand)`,
								),
							);
						}
						outputLines.push(...result.visualLines);
					}
				}
				if (timeoutLine) outputLines.push(timeoutLine);
				if (warningLine) outputLines.push(warningLine);

				return outputBlock.render(
					{
						header,
						state: isError ? "error" : "success",
						sections: [
							{ lines: cmdText ? [uiTheme.fg("dim", cmdText)] : [] },
							{ label: uiTheme.fg("toolTitle", "Output"), lines: outputLines },
						],
						width,
					},
					uiTheme,
				);
			},
			invalidate: () => {
				outputBlock.invalidate();
			},
		};
	},
	mergeCallAndResult: true,
	inline: true,
};
