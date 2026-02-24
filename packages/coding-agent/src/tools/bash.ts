import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import type { Component } from "@oh-my-pi/pi-tui";
import { Text } from "@oh-my-pi/pi-tui";
import { $env, getProjectDir, isEnoent } from "@oh-my-pi/pi-utils";
import { Type } from "@sinclair/typebox";
import { renderPromptTemplate } from "../config/prompt-templates";
import { type BashResult, executeBash } from "../exec/bash-executor";
import { NON_INTERACTIVE_ENV } from "../exec/non-interactive-env";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import { truncateToVisualLines } from "../modes/components/visual-truncate";
import type { Theme } from "../modes/theme/theme";
import bashDescription from "../prompts/tools/bash.md" with { type: "text" };
import { DEFAULT_MAX_BYTES, TailBuffer } from "../session/streaming-output";
import { renderStatusLine } from "../tui";
import { CachedOutputBlock } from "../tui/output-block";
import type { ToolSession } from ".";
import { type BashInteractiveResult, runInteractiveBashPty } from "./bash-interactive";
import { checkBashInterception } from "./bash-interceptor";
import { applyHeadTail } from "./bash-normalize";
import { expandInternalUrls, type InternalUrlExpansionOptions } from "./bash-skill-urls";
import { formatStyledTruncationWarning, type OutputMeta } from "./output-meta";
import { resolveToCwd } from "./path-utils";
import { replaceTabs } from "./render-utils";
import { ToolAbortError, ToolError } from "./tool-errors";
import { toolResult } from "./tool-result";

export const BASH_DEFAULT_PREVIEW_LINES = 10;

const bashSchemaBase = Type.Object({
	command: Type.String({ description: "Command to execute" }),
	timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (default: 300)" })),
	cwd: Type.Optional(Type.String({ description: "Working directory (default: cwd)" })),
	head: Type.Optional(Type.Number({ description: "Return only first N lines of output" })),
	tail: Type.Optional(Type.Number({ description: "Return only last N lines of output" })),
	pty: Type.Optional(
		Type.Boolean({
			description: "Run in PTY mode when command needs a real terminal (e.g. sudo/ssh/top/less); default: false",
		}),
	),
});

const bashSchemaWithAsync = Type.Object({
	...bashSchemaBase.properties,
	async: Type.Optional(
		Type.Boolean({
			description: "Run in background; returns immediately with a job ID. Result delivered as follow-up.",
		}),
	),
});

type BashToolSchema = typeof bashSchemaBase | typeof bashSchemaWithAsync;

export interface BashToolInput {
	command: string;
	timeout?: number;
	cwd?: string;
	head?: number;
	tail?: number;
	async?: boolean;
	pty?: boolean;
}

export interface BashToolDetails {
	meta?: OutputMeta;
	async?: {
		state: "running" | "completed" | "failed";
		jobId: string;
		type: "bash";
	};
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
export class BashTool implements AgentTool<BashToolSchema, BashToolDetails> {
	readonly name = "bash";
	readonly label = "Bash";
	readonly description: string;
	readonly parameters: BashToolSchema;
	readonly concurrency = "exclusive";
	readonly strict = true;
	readonly #asyncEnabled: boolean;

	constructor(private readonly session: ToolSession) {
		this.#asyncEnabled = this.session.settings.get("async.enabled");
		this.parameters = this.#asyncEnabled ? bashSchemaWithAsync : bashSchemaBase;
		this.description = renderPromptTemplate(bashDescription, { asyncEnabled: this.#asyncEnabled });
	}

	#formatResultOutput(result: BashResult | BashInteractiveResult, headLines?: number, tailLines?: number): string {
		let outputText = normalizeResultOutput(result);
		const headTailResult = applyHeadTail(outputText, headLines, tailLines);
		if (headTailResult.applied) {
			outputText = headTailResult.text;
		}
		if (!outputText) {
			outputText = "(no output)";
		}
		return outputText;
	}

	#buildResultText(result: BashResult | BashInteractiveResult, timeoutSec: number, outputText: string): string {
		if (result.cancelled) {
			throw new ToolError(normalizeResultOutput(result) || "Command aborted");
		}
		if (isInteractiveResult(result) && result.timedOut) {
			throw new ToolError(normalizeResultOutput(result) || `Command timed out after ${timeoutSec} seconds`);
		}
		if (result.exitCode === undefined) {
			throw new ToolError(`${outputText}\n\nCommand failed: missing exit status`);
		}
		if (result.exitCode !== 0) {
			throw new ToolError(`${outputText}\n\nCommand exited with code ${result.exitCode}`);
		}
		return outputText;
	}

	async execute(
		_toolCallId: string,
		{
			command: rawCommand,
			timeout: rawTimeout = 300,
			cwd,
			head,
			tail,
			async: asyncRequested = false,
			pty = false,
		}: BashToolInput,
		signal?: AbortSignal,
		onUpdate?: AgentToolUpdateCallback<BashToolDetails>,
		ctx?: AgentToolContext,
	): Promise<AgentToolResult<BashToolDetails>> {
		let command = rawCommand;

		// Extract leading `cd <path> && ...` into cwd when the model ignores the cwd parameter.
		if (!cwd) {
			const cdMatch = command.match(/^cd\s+((?:[^&\\]|\\.)+?)\s*&&\s*/);
			if (cdMatch) {
				cwd = cdMatch[1].trim().replace(/^["']|["']$/g, "");
				command = command.slice(cdMatch[0].length);
			}
		}
		if (asyncRequested && !this.#asyncEnabled) {
			throw new ToolError("Async bash execution is disabled. Enable async.enabled to use async mode.");
		}

		// Only apply explicit head/tail params from tool input.
		const headLines = head;
		const tailLines = tail;

		// Check interception if enabled and available tools are known
		if (this.session.settings.get("bashInterceptor.enabled")) {
			const rules = this.session.settings.getBashInterceptorRules();
			const interception = checkBashInterception(command, ctx?.toolNames ?? [], rules);
			if (interception.block) {
				throw new ToolError(interception.message ?? "Command blocked");
			}
		}

		const internalUrlOptions: InternalUrlExpansionOptions = {
			skills: this.session.skills ?? [],
			internalRouter: this.session.internalRouter,
			localOptions: {
				getArtifactsDir: this.session.getArtifactsDir,
				getSessionId: this.session.getSessionId,
			},
		};
		command = await expandInternalUrls(command, { ...internalUrlOptions, ensureLocalParentDirs: true });

		// Resolve protocol URLs (skill://, agent://, etc.) in extracted cwd.
		if (cwd?.includes("://")) {
			cwd = await expandInternalUrls(cwd, { ...internalUrlOptions, noEscape: true });
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

		if (asyncRequested) {
			const manager = this.session.asyncJobManager;
			if (!manager) {
				throw new ToolError("Async job manager unavailable for this session.");
			}
			const label = command.length > 120 ? `${command.slice(0, 117)}...` : command;
			const tailBuffer = new TailBuffer(DEFAULT_MAX_BYTES);
			const jobId = manager.register(
				"bash",
				label,
				async ({ jobId, signal: runSignal, reportProgress }) => {
					const { path: artifactPath, id: artifactId } =
						(await this.session.allocateOutputArtifact?.("bash")) ?? {};
					try {
						const result = await executeBash(command, {
							cwd: commandCwd,
							sessionKey: `${this.session.getSessionId?.() ?? ""}:async:${jobId}`,
							timeout: timeoutMs,
							signal: runSignal,
							env: NON_INTERACTIVE_ENV,
							artifactPath,
							artifactId,
							onChunk: chunk => {
								tailBuffer.append(chunk);
								void reportProgress(tailBuffer.text(), { async: { state: "running", jobId, type: "bash" } });
							},
						});
						const outputText = this.#formatResultOutput(result, headLines, tailLines);
						const finalText = this.#buildResultText(result, timeoutSec, outputText);
						await reportProgress(finalText, { async: { state: "completed", jobId, type: "bash" } });
						return finalText;
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						await reportProgress(message, { async: { state: "failed", jobId, type: "bash" } });
						throw error;
					}
				},
				{
					onProgress: (text, details) => {
						onUpdate?.({ content: [{ type: "text", text }], details: details ?? {} });
					},
				},
			);
			return {
				content: [{ type: "text", text: `Background job ${jobId} started: ${label}` }],
				details: { async: { state: "running", jobId, type: "bash" } },
			};
		}

		// Track output for streaming updates (tail only)
		const tailBuffer = new TailBuffer(DEFAULT_MAX_BYTES);

		// Allocate artifact for truncated output storage
		const { path: artifactPath, id: artifactId } = (await this.session.allocateOutputArtifact?.("bash")) ?? {};

		const usePty = pty && $env.PI_NO_PTY !== "1" && ctx?.hasUI === true && ctx.ui !== undefined;
		const result: BashResult | BashInteractiveResult = usePty
			? await runInteractiveBashPty(ctx.ui!, {
					command,
					cwd: commandCwd,
					timeoutMs,
					signal,
					artifactPath,
					artifactId,
				})
			: await executeBash(command, {
					cwd: commandCwd,
					sessionKey: this.session.getSessionId?.() ?? undefined,
					timeout: timeoutMs,
					signal,
					env: NON_INTERACTIVE_ENV,
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

		const outputText = this.#formatResultOutput(result, headLines, tailLines);
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

export const bashToolRenderer = {
	renderCall(args: BashRenderArgs, _options: RenderResultOptions, uiTheme: Theme): Component {
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
				if (details?.meta?.truncation && !showingFullOutput) {
					warningLine = formatStyledTruncationWarning(details.meta, uiTheme) ?? undefined;
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
