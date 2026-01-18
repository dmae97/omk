import { relative, resolve, sep } from "node:path";
import type { AgentTool, AgentToolContext } from "@oh-my-pi/pi-agent-core";
import type { ImageContent } from "@oh-my-pi/pi-ai";
import type { Component } from "@oh-my-pi/pi-tui";
import { Text, truncateToWidth } from "@oh-my-pi/pi-tui";
import { Type } from "@sinclair/typebox";
import { truncateToVisualLines } from "../../modes/interactive/components/visual-truncate";
import type { Theme } from "../../modes/interactive/theme/theme";
import pythonDescription from "../../prompts/tools/python.md" with { type: "text" };
import type { RenderResultOptions } from "../custom-tools/types";
import { renderPromptTemplate } from "../prompt-templates";
import { executePython, getPreludeDocs, type PythonExecutorOptions } from "../python-executor";
import type { PreludeHelper, PythonStatusEvent } from "../python-kernel";
import type { ToolSession } from "./index";
import { resolveToCwd } from "./path-utils";
import { createToolUIKit, getTreeBranch, getTreeContinuePrefix, shortenPath, truncate } from "./render-utils";
import { DEFAULT_MAX_BYTES, formatSize, type TruncationResult, truncateTail } from "./truncate";

export const PYTHON_DEFAULT_PREVIEW_LINES = 10;

type PreludeCategory = {
	name: string;
	functions: PreludeHelper[];
};

function groupPreludeHelpers(helpers: PreludeHelper[]): PreludeCategory[] {
	const categories: PreludeCategory[] = [];
	const byName = new Map<string, PreludeHelper[]>();
	for (const helper of helpers) {
		let bucket = byName.get(helper.category);
		if (!bucket) {
			bucket = [];
			byName.set(helper.category, bucket);
			categories.push({ name: helper.category, functions: bucket });
		}
		bucket.push(helper);
	}
	return categories;
}

export const pythonSchema = Type.Object({
	code: Type.String({ description: "Python code to execute" }),
	timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional, no default timeout)" })),
	workdir: Type.Optional(
		Type.String({ description: "Working directory for the command (default: current directory)" }),
	),
	reset: Type.Optional(Type.Boolean({ description: "Restart the kernel before executing this code" })),
});

export type PythonToolParams = { code: string; timeout?: number; workdir?: string; reset?: boolean };

export type PythonToolResult = {
	content: Array<{ type: "text"; text: string }>;
	details: PythonToolDetails | undefined;
};

export type PythonProxyExecutor = (params: PythonToolParams, signal?: AbortSignal) => Promise<PythonToolResult>;

export interface PythonToolDetails {
	truncation?: TruncationResult;
	fullOutputPath?: string;
	fullOutput?: string;
	jsonOutputs?: unknown[];
	images?: ImageContent[];
	/** Structured status events from prelude helpers */
	statusEvents?: PythonStatusEvent[];
}

function formatJsonScalar(value: unknown): string {
	if (value === null) return "null";
	if (value === undefined) return "undefined";
	if (typeof value === "string") return JSON.stringify(value);
	if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
	if (typeof value === "function") return "[function]";
	return "[object]";
}

function renderJsonTree(value: unknown, theme: Theme, expanded: boolean, maxDepth = expanded ? 6 : 2): string[] {
	const maxItems = expanded ? 20 : 5;

	const renderNode = (node: unknown, prefix: string, depth: number, isLast: boolean, label?: string): string[] => {
		const branch = getTreeBranch(isLast, theme);
		const displayLabel = label ? `${label}: ` : "";

		if (depth >= maxDepth || node === null || typeof node !== "object") {
			return [`${prefix}${branch} ${displayLabel}${formatJsonScalar(node)}`];
		}

		const isArray = Array.isArray(node);
		const entries = isArray
			? node.map((val, index) => [String(index), val] as const)
			: Object.entries(node as object);
		const header = `${prefix}${branch} ${displayLabel}${isArray ? `Array(${entries.length})` : `Object(${entries.length})`}`;
		const lines = [header];

		const childPrefix = prefix + getTreeContinuePrefix(isLast, theme);
		const visible = entries.slice(0, maxItems);
		for (let i = 0; i < visible.length; i++) {
			const [key, val] = visible[i];
			const childLast = i === visible.length - 1 && (expanded || entries.length <= maxItems);
			lines.push(...renderNode(val, childPrefix, depth + 1, childLast, isArray ? `[${key}]` : key));
		}
		if (!expanded && entries.length > maxItems) {
			const moreBranch = theme.tree.last;
			lines.push(`${childPrefix}${moreBranch} ${entries.length - maxItems} more item(s)`);
		}
		return lines;
	};

	return renderNode(value, "", 0, true);
}

export function getPythonToolDescription(): string {
	const helpers = getPreludeDocs();
	const categories = groupPreludeHelpers(helpers);
	return renderPromptTemplate(pythonDescription, { categories });
}

interface CreatePythonToolOptions {
	proxyExecutor?: PythonProxyExecutor;
}

export function createPythonTool(
	session: ToolSession | null,
	options?: CreatePythonToolOptions,
): AgentTool<typeof pythonSchema> {
	const { proxyExecutor } = options ?? {};

	return {
		name: "python",
		label: "Python",
		description: getPythonToolDescription(),
		parameters: pythonSchema,
		execute: async (
			_toolCallId: string,
			params: PythonToolParams,
			signal?: AbortSignal,
			onUpdate?,
			_ctx?: AgentToolContext,
		) => {
			if (proxyExecutor) {
				return proxyExecutor(params, signal);
			}

			if (!session) {
				throw new Error("Python tool requires a session when not using proxy executor");
			}

			const { code, timeout, workdir, reset } = params;
			const controller = new AbortController();
			const onAbort = () => controller.abort();
			signal?.addEventListener("abort", onAbort, { once: true });

			try {
				if (signal?.aborted) {
					throw new Error("Aborted");
				}

				const commandCwd = workdir ? resolveToCwd(workdir, session.cwd) : session.cwd;
				let cwdStat: Awaited<ReturnType<Bun.BunFile["stat"]>>;
				try {
					cwdStat = await Bun.file(commandCwd).stat();
				} catch {
					throw new Error(`Working directory does not exist: ${commandCwd}`);
				}
				if (!cwdStat.isDirectory()) {
					throw new Error(`Working directory is not a directory: ${commandCwd}`);
				}

				const maxTailBytes = DEFAULT_MAX_BYTES * 2;
				const tailChunks: Array<{ text: string; bytes: number }> = [];
				let tailBytes = 0;
				const jsonOutputs: unknown[] = [];
				const images: ImageContent[] = [];

				const executorOptions: PythonExecutorOptions = {
					cwd: commandCwd,
					timeout: timeout ? timeout * 1000 : undefined,
					signal: controller.signal,
					sessionId: session.getSessionFile?.() ?? `cwd:${session.cwd}`,
					kernelMode: session.settings?.getPythonKernelMode?.() ?? "session",
					reset,
					onChunk: (chunk) => {
						const chunkBytes = Buffer.byteLength(chunk, "utf-8");
						tailChunks.push({ text: chunk, bytes: chunkBytes });
						tailBytes += chunkBytes;
						while (tailBytes > maxTailBytes && tailChunks.length > 1) {
							const removed = tailChunks.shift();
							if (removed) {
								tailBytes -= removed.bytes;
							}
						}
						if (onUpdate) {
							const tailText = tailChunks.map((entry) => entry.text).join("");
							const truncation = truncateTail(tailText);
							onUpdate({
								content: [{ type: "text", text: truncation.content || "" }],
								details: truncation.truncated ? { truncation } : undefined,
							});
						}
					},
				};

				const result = await executePython(code, executorOptions);

				const statusEvents: PythonStatusEvent[] = [];
				for (const output of result.displayOutputs) {
					if (output.type === "json") {
						jsonOutputs.push(output.data);
					}
					if (output.type === "image") {
						images.push({ type: "image", data: output.data, mimeType: output.mimeType });
					}
					if (output.type === "status") {
						statusEvents.push(output.event);
					}
				}

				if (result.cancelled) {
					throw new Error(result.output || "Command aborted");
				}

				const truncation = truncateTail(result.output);
				let outputText =
					truncation.content || (jsonOutputs.length > 0 || images.length > 0 ? "(no text output)" : "(no output)");
				let details: PythonToolDetails | undefined;

				if (truncation.truncated) {
					const fullOutputSuffix = result.fullOutputPath ? ` Full output: ${result.fullOutputPath}` : "";
					details = {
						truncation,
						fullOutputPath: result.fullOutputPath,
						jsonOutputs: jsonOutputs,
						images,
						statusEvents: statusEvents.length > 0 ? statusEvents : undefined,
					};

					const startLine = truncation.totalLines - truncation.outputLines + 1;
					const endLine = truncation.totalLines;

					if (truncation.lastLinePartial) {
						const lastLineSize = formatSize(Buffer.byteLength(result.output.split("\n").pop() || "", "utf-8"));
						outputText += `\n\n[Showing last ${formatSize(truncation.outputBytes)} of line ${endLine} (line is ${lastLineSize})${fullOutputSuffix}]`;
					} else if (truncation.truncatedBy === "lines") {
						outputText += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}${fullOutputSuffix}]`;
					} else {
						outputText += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines} (${formatSize(DEFAULT_MAX_BYTES)} limit)${fullOutputSuffix}]`;
					}
				}

				if (!details && (jsonOutputs.length > 0 || images.length > 0 || statusEvents.length > 0)) {
					details = {
						jsonOutputs: jsonOutputs.length > 0 ? jsonOutputs : undefined,
						images: images.length > 0 ? images : undefined,
						statusEvents: statusEvents.length > 0 ? statusEvents : undefined,
					};
				}

				if (result.exitCode !== 0 && result.exitCode !== undefined) {
					outputText += `\n\nCommand exited with code ${result.exitCode}`;
					throw new Error(outputText);
				}

				return { content: [{ type: "text", text: outputText }], details };
			} finally {
				signal?.removeEventListener("abort", onAbort);
			}
		},
	};
}

interface PythonRenderArgs {
	code?: string;
	timeout?: number;
	workdir?: string;
}

interface PythonRenderContext {
	output?: string;
	expanded?: boolean;
	previewLines?: number;
	timeout?: number;
}

/** Format a status event as a single line for display. */
function formatStatusEvent(event: PythonStatusEvent, theme: Theme): string {
	const { op, ...data } = event;

	// Map operations to available theme icons
	type AvailableIcon = "icon.file" | "icon.folder" | "icon.git" | "icon.package";
	const opIcons: Record<string, AvailableIcon> = {
		// File I/O
		read: "icon.file",
		write: "icon.file",
		append: "icon.file",
		cat: "icon.file",
		touch: "icon.file",
		lines: "icon.file",
		// Navigation/Directory
		ls: "icon.folder",
		cd: "icon.folder",
		pwd: "icon.folder",
		mkdir: "icon.folder",
		tree: "icon.folder",
		stat: "icon.folder",
		// Search (use file icon since no search icon)
		find: "icon.file",
		grep: "icon.file",
		rgrep: "icon.file",
		glob: "icon.file",
		// Edit operations (use file icon)
		replace: "icon.file",
		sed: "icon.file",
		rsed: "icon.file",
		delete_lines: "icon.file",
		delete_matching: "icon.file",
		insert_at: "icon.file",
		// Git
		git_status: "icon.git",
		git_diff: "icon.git",
		git_log: "icon.git",
		git_show: "icon.git",
		git_branch: "icon.git",
		git_file_at: "icon.git",
		git_has_changes: "icon.git",
		// Shell/batch (use package icon)
		run: "icon.package",
		sh: "icon.package",
		env: "icon.package",
		batch: "icon.package",
	};

	const iconKey = opIcons[op] ?? "icon.file";
	const icon = theme.styledSymbol(iconKey, "muted");

	// Format the status message based on operation type
	const parts: string[] = [];

	// Error handling
	if (data.error) {
		return `${icon} ${theme.fg("warning", op)}: ${theme.fg("dim", String(data.error))}`;
	}

	// Build description based on common fields
	switch (op) {
		case "read":
			parts.push(`${data.chars} chars`);
			if (data.path) parts.push(`from ${shortenPath(String(data.path))}`);
			break;
		case "write":
		case "append":
			parts.push(`${data.chars} chars`);
			if (data.path) parts.push(`to ${shortenPath(String(data.path))}`);
			break;
		case "cat":
			parts.push(`${data.files} file${(data.files as number) !== 1 ? "s" : ""}`);
			parts.push(`${data.chars} chars`);
			break;
		case "find":
		case "rgrep":
			parts.push(`${data.count} match${(data.count as number) !== 1 ? "es" : ""}`);
			if (data.pattern) parts.push(`for "${truncate(String(data.pattern), 20, theme.format.ellipsis)}"`);
			break;
		case "grep":
			parts.push(`${data.count} match${(data.count as number) !== 1 ? "es" : ""}`);
			if (data.path) parts.push(`in ${shortenPath(String(data.path))}`);
			break;
		case "ls":
			parts.push(`${data.count} entr${(data.count as number) !== 1 ? "ies" : "y"}`);
			break;
		case "replace":
		case "sed":
			parts.push(`${data.count} replacement${(data.count as number) !== 1 ? "s" : ""}`);
			break;
		case "rsed":
			parts.push(`${data.count} replacement${(data.count as number) !== 1 ? "s" : ""}`);
			if (data.files) parts.push(`in ${data.files} file${(data.files as number) !== 1 ? "s" : ""}`);
			break;
		case "git_status":
			if (data.clean) {
				parts.push("clean");
			} else {
				const statusParts: string[] = [];
				if (data.staged) statusParts.push(`${data.staged} staged`);
				if (data.modified) statusParts.push(`${data.modified} modified`);
				if (data.untracked) statusParts.push(`${data.untracked} untracked`);
				parts.push(statusParts.join(", ") || "unknown");
			}
			if (data.branch) parts.push(`on ${data.branch}`);
			break;
		case "git_log":
			parts.push(`${data.commits} commit${(data.commits as number) !== 1 ? "s" : ""}`);
			break;
		case "git_diff":
			parts.push(`${data.lines} line${(data.lines as number) !== 1 ? "s" : ""}`);
			if (data.staged) parts.push("(staged)");
			break;
		case "diff":
			if (data.identical) {
				parts.push("files identical");
			} else {
				parts.push("files differ");
			}
			break;
		case "batch":
			parts.push(`${data.files} file${(data.files as number) !== 1 ? "s" : ""} processed`);
			break;
		case "wc":
			parts.push(`${data.lines}L ${data.words}W ${data.chars}C`);
			break;
		case "lines":
			parts.push(`${data.count} line${(data.count as number) !== 1 ? "s" : ""}`);
			if (data.start && data.end) parts.push(`(${data.start}-${data.end})`);
			break;
		case "delete_lines":
		case "delete_matching":
			parts.push(`${data.count} line${(data.count as number) !== 1 ? "s" : ""} deleted`);
			break;
		case "insert_at":
			parts.push(`${data.lines_inserted} line${(data.lines_inserted as number) !== 1 ? "s" : ""} inserted`);
			break;
		default:
			// Generic formatting for other operations
			if (data.count !== undefined) {
				parts.push(String(data.count));
			}
			if (data.path) {
				parts.push(shortenPath(String(data.path)));
			}
	}

	const desc = parts.length > 0 ? parts.join(" · ") : "";
	return `${icon} ${theme.fg("muted", op)}${desc ? ` ${theme.fg("dim", desc)}` : ""}`;
}

/** Render status events as tree lines. */
function renderStatusEvents(events: PythonStatusEvent[], theme: Theme, expanded: boolean): string[] {
	if (events.length === 0) return [];

	const maxCollapsed = 3;
	const maxExpanded = 10;
	const displayCount = expanded ? Math.min(events.length, maxExpanded) : Math.min(events.length, maxCollapsed);

	const lines: string[] = [];
	for (let i = 0; i < displayCount; i++) {
		const isLast = i === displayCount - 1 && (expanded || events.length <= maxCollapsed);
		const branch = isLast ? theme.tree.last : theme.tree.branch;
		lines.push(`${theme.fg("dim", branch)} ${formatStatusEvent(events[i], theme)}`);
	}

	if (!expanded && events.length > maxCollapsed) {
		lines.push(
			`${theme.fg("dim", theme.tree.last)} ${theme.fg("dim", `${theme.format.ellipsis} ${events.length - maxCollapsed} more`)}`,
		);
	} else if (expanded && events.length > maxExpanded) {
		lines.push(
			`${theme.fg("dim", theme.tree.last)} ${theme.fg("dim", `${theme.format.ellipsis} ${events.length - maxExpanded} more`)}`,
		);
	}

	return lines;
}

export const pythonToolRenderer = {
	renderCall(args: PythonRenderArgs, uiTheme: Theme): Component {
		const ui = createToolUIKit(uiTheme);
		const code = args.code || uiTheme.format.ellipsis;
		const prompt = uiTheme.fg("accent", ">>>");
		const cwd = process.cwd();
		let displayWorkdir = args.workdir;

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
			? `${prompt} ${uiTheme.fg("dim", `cd ${displayWorkdir} &&`)} ${code}`
			: `${prompt} ${code}`;
		const text = ui.title(cmdText);
		return new Text(text, 0, 0);
	},

	renderResult(
		result: { content: Array<{ type: string; text?: string }>; details?: PythonToolDetails },
		options: RenderResultOptions & { renderContext?: PythonRenderContext },
		uiTheme: Theme,
	): Component {
		const ui = createToolUIKit(uiTheme);
		const { renderContext } = options;
		const details = result.details;

		const expanded = renderContext?.expanded ?? options.expanded;
		const previewLines = renderContext?.previewLines ?? PYTHON_DEFAULT_PREVIEW_LINES;
		const output = renderContext?.output ?? (result.content?.find((c) => c.type === "text")?.text ?? "").trim();
		const fullOutput = details?.fullOutput;
		const displayOutput = expanded ? (fullOutput ?? output) : output;
		const showingFullOutput = expanded && fullOutput !== undefined;

		const jsonOutputs = details?.jsonOutputs ?? [];
		const jsonLines = jsonOutputs.flatMap((value, index) => {
			const header = `JSON output ${index + 1}`;
			const treeLines = renderJsonTree(value, uiTheme, expanded);
			return [header, ...treeLines];
		});

		// Render status events
		const statusEvents = details?.statusEvents ?? [];
		const statusLines = renderStatusEvents(statusEvents, uiTheme, expanded);

		const combinedOutput = [displayOutput, ...jsonLines].filter(Boolean).join("\n");

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
						`Truncated: ${truncation.outputLines} lines shown (${ui.formatBytes(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit)`,
					);
				}
			}
			if (warnings.length > 0) {
				warningLine = uiTheme.fg("warning", ui.wrapBrackets(warnings.join(". ")));
			}
		}

		if (!combinedOutput && statusLines.length === 0) {
			const lines = [timeoutLine, warningLine].filter(Boolean) as string[];
			return new Text(lines.join("\n"), 0, 0);
		}

		// If only status events (no text output), show them directly
		if (!combinedOutput && statusLines.length > 0) {
			const lines = [...statusLines, timeoutLine, warningLine].filter(Boolean) as string[];
			return new Text(lines.join("\n"), 0, 0);
		}

		if (expanded) {
			const styledOutput = combinedOutput
				.split("\n")
				.map((line) => uiTheme.fg("toolOutput", line))
				.join("\n");
			const lines = [styledOutput, ...statusLines, timeoutLine, warningLine].filter(Boolean) as string[];
			return new Text(lines.join("\n"), 0, 0);
		}

		const styledOutput = combinedOutput
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
				// Add status events below the output
				for (const statusLine of statusLines) {
					outputLines.push(truncateToWidth(statusLine, width, uiTheme.fg("dim", uiTheme.format.ellipsis)));
				}
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
