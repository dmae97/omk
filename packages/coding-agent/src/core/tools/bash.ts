import { relative, resolve, sep } from "node:path";
import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import type { Component } from "@oh-my-pi/pi-tui";
import { Text, truncateToWidth } from "@oh-my-pi/pi-tui";
import { Type } from "@sinclair/typebox";
import { truncateToVisualLines } from "../../modes/interactive/components/visual-truncate";
import type { Theme } from "../../modes/interactive/theme/theme";
import bashDescription from "../../prompts/tools/bash.md" with { type: "text" };
import { type BashExecutorOptions, executeBash } from "../bash-executor";
import type { RenderResultOptions } from "../custom-tools/types";
import { renderPromptTemplate } from "../prompt-templates";
import { checkBashInterception, checkSimpleLsInterception } from "./bash-interceptor";
import type { ToolSession } from "./index";
import { resolveToCwd } from "./path-utils";
import { ToolUIKit } from "./render-utils";
import { formatTailTruncationNotice, type TruncationResult, truncateTail } from "./truncate";

export const BASH_DEFAULT_PREVIEW_LINES = 10;

const bashSchema = Type.Object({
	command: Type.String({ description: "Bash command to execute" }),
	timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional, no default timeout)" })),
	cwd: Type.Optional(Type.String({ description: "Working directory for the command (default: current directory)" })),
});

export interface BashToolDetails {
	truncation?: TruncationResult;
	fullOutputPath?: string;
	fullOutput?: string;
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
		{ command, timeout, cwd }: { command: string; timeout?: number; cwd?: string },
		signal?: AbortSignal,
		onUpdate?: AgentToolUpdateCallback<BashToolDetails>,
		ctx?: AgentToolContext,
	): Promise<AgentToolResult<BashToolDetails>> {
		// Check interception if enabled and available tools are known
		if (this.session.settings?.getBashInterceptorEnabled()) {
			const rules = this.session.settings?.getBashInterceptorRules?.();
			const interception = checkBashInterception(command, ctx?.toolNames ?? [], rules);
			if (interception.block) {
				throw new Error(interception.message);
			}
			if (this.session.settings?.getBashInterceptorSimpleLsEnabled?.() !== false) {
				const lsInterception = checkSimpleLsInterception(command, ctx?.toolNames ?? []);
				if (lsInterception.block) {
					throw new Error(lsInterception.message);
				}
			}
		}

		const commandCwd = cwd ? resolveToCwd(cwd, this.session.cwd) : this.session.cwd;
		let cwdStat: Awaited<ReturnType<Bun.BunFile["stat"]>>;
		try {
			cwdStat = await Bun.file(commandCwd).stat();
		} catch {
			throw new Error(`Working directory does not exist: ${commandCwd}`);
		}
		if (!cwdStat.isDirectory()) {
			throw new Error(`Working directory is not a directory: ${commandCwd}`);
		}

		// Track output for streaming updates
		let currentOutput = "";

		const executorOptions: BashExecutorOptions = {
			cwd: commandCwd,
			timeout: timeout ? timeout * 1000 : undefined, // Convert to milliseconds
			signal,
			onChunk: (chunk) => {
				currentOutput += chunk;
				if (onUpdate) {
					const truncation = truncateTail(currentOutput);
					onUpdate({
						content: [{ type: "text", text: truncation.content || "" }],
						details: truncation.truncated ? { truncation, fullOutput: currentOutput } : {},
					});
				}
			},
		};

		// Handle errors
		const result = await executeBash(command, executorOptions);
		if (result.cancelled) {
			throw new Error(result.output || "Command aborted");
		}

		// Apply tail truncation for final output
		const truncation = truncateTail(result.output);
		let outputText = truncation.content || "(no output)";

		let details: BashToolDetails | undefined;

		if (truncation.truncated) {
			details = {
				truncation,
				fullOutputPath: result.fullOutputPath,
				fullOutput: currentOutput,
			};
			outputText += formatTailTruncationNotice(truncation, {
				fullOutputPath: result.fullOutputPath,
				originalContent: result.output,
			});
		}

		if (result.exitCode !== 0 && result.exitCode !== undefined) {
			outputText += `\n\nCommand exited with code ${result.exitCode}`;
			throw new Error(outputText);
		}

		return { content: [{ type: "text", text: outputText }], details };
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
		const ui = new ToolUIKit(uiTheme);
		const command = args.command || uiTheme.format.ellipsis;
		const prompt = uiTheme.fg("accent", "$");
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

		const cmdText = displayWorkdir
			? `${prompt} ${uiTheme.fg("dim", `cd ${displayWorkdir} &&`)} ${command}`
			: `${prompt} ${command}`;
		const text = ui.title(cmdText);
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
		const ui = new ToolUIKit(uiTheme);
		const { renderContext } = options;
		const details = result.details;

		const expanded = renderContext?.expanded ?? options.expanded;
		const previewLines = renderContext?.previewLines ?? BASH_DEFAULT_PREVIEW_LINES;

		// Get output from context (preferred) or fall back to result content
		const output = renderContext?.output ?? (result.content?.find((c) => c.type === "text")?.text ?? "").trim();
		const fullOutput = details?.fullOutput;
		const displayOutput = expanded ? (fullOutput ?? output) : output;
		const showingFullOutput = expanded && fullOutput !== undefined;

		// Build truncation warning lines (static, doesn't depend on width)
		const truncation = details?.truncation;
		const fullOutputPath = details?.fullOutputPath;
		const timeoutSeconds = renderContext?.timeout;
		const timeoutLine =
			typeof timeoutSeconds === "number"
				? uiTheme.fg("dim", ui.wrapBrackets(`Timeout: ${timeoutSeconds}s`))
				: undefined;
		let warningLine: string | undefined;
		if (fullOutputPath || (truncation?.truncated && !showingFullOutput)) {
			const warnings: string[] = [];
			if (fullOutputPath) {
				warnings.push(`Full output: ${fullOutputPath}`);
			}
			if (truncation?.truncated && !showingFullOutput) {
				if (truncation.truncatedBy === "lines") {
					warnings.push(`Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`);
				} else {
					warnings.push(
						`Truncated: ${truncation.outputLines} lines shown (${ui.formatBytes(truncation.maxBytes)} limit)`,
					);
				}
			}
			if (warnings.length > 0) {
				warningLine = uiTheme.fg("warning", ui.wrapBrackets(warnings.join(". ")));
			}
		}

		if (!displayOutput) {
			// No output - just show warning if any
			const lines = [timeoutLine, warningLine].filter(Boolean) as string[];
			return new Text(lines.join("\n"), 0, 0);
		}

		if (expanded) {
			// Show all lines when expanded
			const styledOutput = displayOutput
				.split("\n")
				.map((line) => uiTheme.fg("toolOutput", line))
				.join("\n");
			const lines = [styledOutput, timeoutLine, warningLine].filter(Boolean) as string[];
			return new Text(lines.join("\n"), 0, 0);
		}

		// Collapsed: use width-aware caching component
		const styledOutput = displayOutput
			.split("\n")
			.map((line) => uiTheme.fg("toolOutput", line))
			.join("\n");
		const textContent = `\n${styledOutput}`;

		let cachedWidth: number | undefined;
		let cachedLines: string[] | undefined;
		let cachedSkipped: number | undefined;

		return {
			render: (width: number): string[] => {
				if (cachedLines === undefined || cachedWidth !== width) {
					const result = truncateToVisualLines(textContent, previewLines, width);
					cachedLines = result.visualLines;
					cachedSkipped = result.skippedCount;
					cachedWidth = width;
				}
				const outputLines: string[] = [];
				if (cachedSkipped && cachedSkipped > 0) {
					outputLines.push("");
					const skippedLine = uiTheme.fg(
						"dim",
						`${uiTheme.format.ellipsis} (${cachedSkipped} earlier lines, showing ${cachedLines.length} of ${cachedSkipped + cachedLines.length}) (ctrl+o to expand)`,
					);
					outputLines.push(truncateToWidth(skippedLine, width, uiTheme.fg("dim", uiTheme.format.ellipsis)));
				}
				outputLines.push(...cachedLines);
				if (timeoutLine) {
					outputLines.push(truncateToWidth(timeoutLine, width, uiTheme.fg("dim", uiTheme.format.ellipsis)));
				}
				if (warningLine) {
					outputLines.push(truncateToWidth(warningLine, width, uiTheme.fg("warning", uiTheme.format.ellipsis)));
				}
				return outputLines;
			},
			invalidate: () => {
				cachedWidth = undefined;
				cachedLines = undefined;
				cachedSkipped = undefined;
			},
		};
	},
};
