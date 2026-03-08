import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import type { Component } from "@oh-my-pi/pi-tui";
import { ImageProtocol, TERMINAL, Text } from "@oh-my-pi/pi-tui";
import { $env, getProjectDir, isEnoent } from "@oh-my-pi/pi-utils";
import { Type } from "@sinclair/typebox";
import { renderPromptTemplate } from "../config/prompt-templates";
import { type BashResult, executeBash } from "../exec/bash-executor";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import { truncateToVisualLines } from "../modes/components/visual-truncate";
import type { Theme } from "../modes/theme/theme";
import bashDescription from "../prompts/tools/bash.md" with { type: "text" };
import { DEFAULT_MAX_BYTES, TailBuffer } from "../session/streaming-output";
import { renderStatusLine } from "../tui";
import { CachedOutputBlock } from "../tui/output-block";
import { getSixelLineMask } from "../utils/sixel";
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
import { clampTimeout } from "./tool-timeouts";

export const BASH_DEFAULT_PREVIEW_LINES = 10;

const BASH_ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const bashSchemaBase = Type.Object({
	command: Type.String({ description: "Command to execute" }),
	env: Type.Optional(
		Type.Record(Type.String({ pattern: BASH_ENV_NAME_PATTERN.source }), Type.String(), {
			description:
				"Additional environment variables passed to the command and rendered inline as shell assignments; prefer this for multiline or quote-heavy content",
		}),
	),
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
	env?: Record<string, string>;
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

function normalizeBashEnv(env: Record<string, string> | undefined): Record<string, string> | undefined {
	if (!env || Object.keys(env).length === 0) return undefined;
	const normalized: Record<string, string> = {};
	for (const [key, value] of Object.entries(env)) {
		if (!BASH_ENV_NAME_PATTERN.test(key)) {
			throw new ToolError(`Invalid bash env name: ${key}`);
		}
		normalized[key] = value;
	}
	return normalized;
}

function escapeBashEnvValueForDisplay(value: string): string {
	return value
		.replaceAll("\\", "\\\\")
		.replaceAll("\n", "\\n")
		.replaceAll("\r", "\\r")
		.replaceAll("\t", "\\t")
		.replaceAll('"', '\\"')
		.replaceAll("$", "\\$")
		.replaceAll("`", "\\`");
}

function formatBashEnvAssignments(env: Record<string, string> | undefined): string {
	if (!env || Object.keys(env).length === 0) return "";
	return Object.entries(env)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([key, value]) => `${key}="${escapeBashEnvValueForDisplay(value)}"`)
		.join(" ");
}

function unescapePartialJsonString(value: string): string {
	let output = "";
	for (let index = 0; index < value.length; index += 1) {
		const char = value[index];
		if (char !== "\\") {
			output += char;
			continue;
		}
		const next = value[index + 1];
		if (!next) {
			output += "\\";
			break;
		}
		index += 1;
		switch (next) {
			case '"':
				output += '"';
				break;
			case "\\":
				output += "\\";
				break;
			case "/":
				output += "/";
				break;
			case "b":
				output += "\b";
				break;
			case "f":
				output += "\f";
				break;
			case "n":
				output += "\n";
				break;
			case "r":
				output += "\r";
				break;
			case "t":
				output += "\t";
				break;
			case "u": {
				const hex = value.slice(index + 1, index + 5);
				if (/^[0-9a-fA-F]{4}$/u.test(hex)) {
					output += String.fromCharCode(Number.parseInt(hex, 16));
					index += 4;
				} else {
					output += "\\u";
				}
				break;
			}
			default:
				output += next;
		}
	}
	return output;
}

function extractPartialBashEnv(partialJson: string | undefined): Record<string, string> | undefined {
	if (!partialJson) return undefined;
	const envStart = partialJson.search(/"env"\s*:\s*\{/u);
	if (envStart === -1) return undefined;
	const objectStart = partialJson.indexOf("{", envStart);
	if (objectStart === -1) return undefined;
	const envBody = partialJson.slice(objectStart + 1);
	const env: Record<string, string> = {};
	const matcher = /"([A-Za-z_][A-Za-z0-9_]*)"\s*:\s*"((?:\\.|[^"\\])*)(?:"|$)/gu;
	for (const match of envBody.matchAll(matcher)) {
		env[match[1]!] = unescapePartialJsonString(match[2]!);
	}
	return Object.keys(env).length > 0 ? env : undefined;
}

function getBashEnvForDisplay(args: BashRenderArgs): Record<string, string> | undefined {
	// During streaming, partial-json parsing often does not surface env values until the object closes.
	// Recover them from the raw JSON buffer so the pending bash preview can show `NAME="..." cmd` immediately,
	// instead of rendering only the command and making the env assignment appear at the very end.
	const partialEnv = extractPartialBashEnv(args.__partialJson);
	if (partialEnv && args.env) return { ...partialEnv, ...args.env };
	return args.env ?? partialEnv;
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
		this.description = renderPromptTemplate(bashDescription, {
			asyncEnabled: this.#asyncEnabled,
			hasAstGrep: this.session.settings.get("astGrep.enabled"),
			hasAstEdit: this.session.settings.get("astEdit.enabled"),
		});
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
			env: rawEnv,
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
		const env = normalizeBashEnv(rawEnv);

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
		const resolvedEnv = env
			? Object.fromEntries(
					await Promise.all(
						Object.entries(env).map(async ([key, value]) => [
							key,
							await expandInternalUrls(value, {
								...internalUrlOptions,
								ensureLocalParentDirs: true,
								noEscape: true,
							}),
						]),
					),
				)
			: undefined;

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
		const timeoutSec = clampTimeout("bash", rawTimeout);
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
							env: resolvedEnv,
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
					env: resolvedEnv,
					artifactPath,
					artifactId,
				})
			: await executeBash(command, {
					cwd: commandCwd,
					sessionKey: this.session.getSessionId?.() ?? undefined,
					timeout: timeoutMs,
					signal,
					env: resolvedEnv,
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
	env?: Record<string, string>;
	timeout?: number;
	cwd?: string;
	__partialJson?: string;
	[key: string]: unknown;
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

function formatBashCommand(args: BashRenderArgs): string {
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

	const renderedCommand = [formatBashEnvAssignments(getBashEnvForDisplay(args)), command].filter(Boolean).join(" ");
	return displayWorkdir ? `${prompt} cd ${displayWorkdir} && ${renderedCommand}` : `${prompt} ${renderedCommand}`;
}

export const bashToolRenderer = {
	renderCall(args: BashRenderArgs, _options: RenderResultOptions, uiTheme: Theme): Component {
		const cmdText = formatBashCommand(args);
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
		const cmdText = args ? formatBashCommand(args) : undefined;
		const isError = result.isError === true;
		const icon = options.isPartial ? "pending" : isError ? "error" : "success";
		const header = renderStatusLine({ icon, title: "Bash" }, uiTheme);
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
				const rawOutputLines = displayOutput.split("\n");
				const sixelLineMask =
					TERMINAL.imageProtocol === ImageProtocol.Sixel ? getSixelLineMask(rawOutputLines) : undefined;
				const hasSixelOutput = sixelLineMask?.some(Boolean) ?? false;
				if (hasOutput) {
					if (hasSixelOutput) {
						outputLines.push(
							...rawOutputLines.map((line, index) =>
								sixelLineMask?.[index] ? line : uiTheme.fg("toolOutput", replaceTabs(line)),
							),
						);
					} else if (expanded) {
						outputLines.push(...rawOutputLines.map(line => uiTheme.fg("toolOutput", replaceTabs(line))));
					} else {
						const styledOutput = rawOutputLines
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
						state: options.isPartial ? "pending" : isError ? "error" : "success",
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
