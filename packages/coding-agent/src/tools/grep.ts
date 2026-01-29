import * as nodePath from "node:path";
import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import { StringEnum } from "@oh-my-pi/pi-ai";
import { type GrepMatch as WasmGrepMatch, grep as wasmGrep } from "@oh-my-pi/pi-natives";
import type { Component } from "@oh-my-pi/pi-tui";
import { Text } from "@oh-my-pi/pi-tui";
import { untilAborted } from "@oh-my-pi/pi-utils";
import { type Static, Type } from "@sinclair/typebox";
import { renderPromptTemplate } from "../config/prompt-templates";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import type { Theme } from "../modes/theme/theme";
import grepDescription from "../prompts/tools/grep.md" with { type: "text" };
import { renderFileList, renderStatusLine, renderTreeList } from "../tui";
import type { ToolSession } from ".";
import type { OutputMeta } from "./output-meta";
import { resolveToCwd } from "./path-utils";
import { formatCount, formatEmptyMessage, formatErrorMessage, PREVIEW_LIMITS } from "./render-utils";
import { ToolError } from "./tool-errors";
import { toolResult } from "./tool-result";
import { DEFAULT_MAX_COLUMN, type TruncationResult, truncateHead } from "./truncate";

const grepSchema = Type.Object({
	pattern: Type.String({ description: "Regex pattern to search for" }),
	path: Type.Optional(Type.String({ description: "File or directory to search (default: cwd)" })),
	glob: Type.Optional(Type.String({ description: "Filter files by glob pattern (e.g., '*.js')" })),
	type: Type.Optional(Type.String({ description: "Filter by file type (e.g., js, py, rust)" })),
	output_mode: Type.Optional(
		StringEnum(["filesWithMatches", "content", "count"], {
			description: "Output format (default: files_with_matches)",
		}),
	),
	i: Type.Optional(Type.Boolean({ description: "Case-insensitive search (default: false)" })),
	n: Type.Optional(Type.Boolean({ description: "Show line numbers (default: true)" })),
	context: Type.Optional(Type.Number({ description: "Lines of context (default: 5)" })),
	multiline: Type.Optional(Type.Boolean({ description: "Enable multiline matching (default: false)" })),
	limit: Type.Optional(Type.Number({ description: "Limit output to first N matches (default: 100 in content mode)" })),
	offset: Type.Optional(Type.Number({ description: "Skip first N entries before applying limit (default: 0)" })),
});

const DEFAULT_MATCH_LIMIT = 100;

export interface GrepToolDetails {
	truncation?: TruncationResult;
	matchLimitReached?: number;
	resultLimitReached?: number;
	linesTruncated?: boolean;
	meta?: OutputMeta;
	scopePath?: string;
	matchCount?: number;
	fileCount?: number;
	files?: string[];
	fileMatches?: Array<{ path: string; count: number }>;
	mode?: "content" | "filesWithMatches" | "count";
	truncated?: boolean;
	error?: string;
}

export interface GrepOperations {
	isDirectory: (absolutePath: string) => Promise<boolean> | boolean;
	readFile: (absolutePath: string) => Promise<string> | string;
}

export interface GrepToolOptions {
	operations?: GrepOperations;
}

type GrepParams = Static<typeof grepSchema>;

export class GrepTool implements AgentTool<typeof grepSchema, GrepToolDetails> {
	public readonly name = "grep";
	public readonly label = "Grep";
	public readonly description: string;
	public readonly parameters = grepSchema;

	private readonly session: ToolSession;

	constructor(session: ToolSession, _options?: GrepToolOptions) {
		this.session = session;
		this.description = renderPromptTemplate(grepDescription);
	}

	public async execute(
		_toolCallId: string,
		params: GrepParams,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<GrepToolDetails>,
		_toolContext?: AgentToolContext,
	): Promise<AgentToolResult<GrepToolDetails>> {
		const { pattern, path: searchDir, glob, type, output_mode, i, n, context, multiline, limit, offset } = params;

		return untilAborted(signal, async () => {
			const normalizedPattern = pattern.trim();
			if (!normalizedPattern) {
				throw new ToolError("Pattern must not be empty");
			}

			const normalizedOffset = offset === undefined ? 0 : Number.isFinite(offset) ? Math.floor(offset) : Number.NaN;
			if (normalizedOffset < 0 || !Number.isFinite(normalizedOffset)) {
				throw new ToolError("Offset must be a non-negative number");
			}

			const rawLimit = limit === undefined ? undefined : Number.isFinite(limit) ? Math.floor(limit) : Number.NaN;
			if (rawLimit !== undefined && (!Number.isFinite(rawLimit) || rawLimit < 0)) {
				throw new ToolError("Limit must be a non-negative number");
			}
			const normalizedLimit = rawLimit !== undefined && rawLimit > 0 ? rawLimit : undefined;

			const normalizedContext = context ?? 5;
			const showLineNumbers = n ?? true;
			const ignoreCase = i ?? false;
			const hasContentHints = limit !== undefined || context !== undefined;

			const searchPath = resolveToCwd(searchDir || ".", this.session.cwd);
			const scopePath = (() => {
				const relative = nodePath.relative(this.session.cwd, searchPath).replace(/\\/g, "/");
				return relative.length === 0 ? "." : relative;
			})();

			let isDirectory: boolean;
			try {
				const stat = await Bun.file(searchPath).stat();
				isDirectory = stat.isDirectory();
			} catch {
				throw new ToolError(`Path not found: ${searchPath}`);
			}

			const effectiveOutputMode = output_mode ?? (!isDirectory || hasContentHints ? "content" : "filesWithMatches");
			const effectiveLimit =
				effectiveOutputMode === "content" ? (normalizedLimit ?? DEFAULT_MATCH_LIMIT) : normalizedLimit;

			// Run WASM grep
			let result: Awaited<ReturnType<typeof wasmGrep>>;
			try {
				result = await wasmGrep({
					pattern: normalizedPattern,
					path: searchPath,
					glob: glob?.trim() || undefined,
					type: type?.trim() || undefined,
					ignoreCase,
					multiline: multiline ?? false,
					hidden: true,
					maxCount: effectiveLimit,
					offset: normalizedOffset > 0 ? normalizedOffset : undefined,
					context: effectiveOutputMode === "content" ? normalizedContext : undefined,
					maxColumns: DEFAULT_MAX_COLUMN,
					mode: effectiveOutputMode,
				});
			} catch (err) {
				if (err instanceof Error && err.message.startsWith("regex parse error")) {
					throw new ToolError(err.message);
				}
				throw err;
			}

			const formatPath = (filePath: string): string => {
				// WASM returns paths starting with / (the virtual root)
				const cleanPath = filePath.startsWith("/") ? filePath.slice(1) : filePath;
				if (isDirectory) {
					return cleanPath.replace(/\\/g, "/");
				}
				return nodePath.basename(cleanPath);
			};

			// Build output
			const files = new Set<string>();
			const fileList: string[] = [];
			const fileMatchCounts = new Map<string, number>();

			const recordFile = (filePath: string) => {
				const relative = formatPath(filePath);
				if (!files.has(relative)) {
					files.add(relative);
					fileList.push(relative);
				}
			};

			if (result.totalMatches === 0) {
				const details: GrepToolDetails = {
					scopePath,
					matchCount: 0,
					fileCount: 0,
					files: [],
					mode: effectiveOutputMode,
					truncated: false,
				};
				return toolResult(details).text("No matches found").done();
			}

			let outputLines: string[] = [];
			let linesTruncated = false;

			for (const match of result.matches) {
				recordFile(match.path);
				const relativePath = formatPath(match.path);

				if (effectiveOutputMode === "content") {
					// Add context before
					if (match.contextBefore) {
						for (const ctx of match.contextBefore) {
							outputLines.push(
								showLineNumbers
									? `${relativePath}-${ctx.lineNumber}- ${ctx.line}`
									: `${relativePath}- ${ctx.line}`,
							);
						}
					}

					// Add match line
					outputLines.push(
						showLineNumbers
							? `${relativePath}:${match.lineNumber}: ${match.line}`
							: `${relativePath}: ${match.line}`,
					);

					if (match.truncated) {
						linesTruncated = true;
					}

					// Add context after
					if (match.contextAfter) {
						for (const ctx of match.contextAfter) {
							outputLines.push(
								showLineNumbers
									? `${relativePath}-${ctx.lineNumber}- ${ctx.line}`
									: `${relativePath}- ${ctx.line}`,
							);
						}
					}

					// Track per-file counts
					fileMatchCounts.set(relativePath, (fileMatchCounts.get(relativePath) ?? 0) + 1);
				} else if (effectiveOutputMode === "filesWithMatches") {
					// One line per file
					const matchWithCount = match as WasmGrepMatch & { matchCount?: number };
					fileMatchCounts.set(relativePath, matchWithCount.matchCount ?? 1);
				} else {
					// count mode
					const matchWithCount = match as WasmGrepMatch & { matchCount?: number };
					fileMatchCounts.set(relativePath, matchWithCount.matchCount ?? 0);
				}
			}

			// Format output based on mode
			if (effectiveOutputMode === "filesWithMatches") {
				outputLines = fileList;
			} else if (effectiveOutputMode === "count") {
				outputLines = fileList.map(f => `${f}:${fileMatchCounts.get(f) ?? 0}`);
			}

			const rawOutput = outputLines.join("\n");
			const truncation = truncateHead(rawOutput, { maxLines: Number.MAX_SAFE_INTEGER });
			const output = truncation.content;

			const truncated = Boolean(result.limitReached || truncation.truncated || linesTruncated);
			const details: GrepToolDetails = {
				scopePath,
				matchCount: result.totalMatches,
				fileCount: result.filesWithMatches,
				files: fileList,
				fileMatches: fileList.map(path => ({
					path,
					count: fileMatchCounts.get(path) ?? 0,
				})),
				mode: effectiveOutputMode,
				truncated,
				matchLimitReached: result.limitReached ? effectiveLimit : undefined,
			};

			if (truncation.truncated) details.truncation = truncation;
			if (linesTruncated) details.linesTruncated = true;

			const resultBuilder = toolResult(details)
				.text(output)
				.limits({
					matchLimit: result.limitReached ? effectiveLimit : undefined,
					columnMax: linesTruncated ? DEFAULT_MAX_COLUMN : undefined,
				});

			if (truncation.truncated) {
				resultBuilder.truncation(truncation, { direction: "head" });
			}

			return resultBuilder.done();
		});
	}
}

// =============================================================================
// TUI Renderer
// =============================================================================

interface GrepRenderArgs {
	pattern: string;
	path?: string;
	glob?: string;
	type?: string;
	i?: boolean;
	n?: boolean;
	context?: number;
	multiline?: boolean;
	output_mode?: string;
	limit?: number;
	offset?: number;
}

const COLLAPSED_LIST_LIMIT = PREVIEW_LIMITS.COLLAPSED_ITEMS;
const COLLAPSED_TEXT_LIMIT = PREVIEW_LIMITS.COLLAPSED_LINES * 2;

export const grepToolRenderer = {
	inline: true,
	renderCall(args: GrepRenderArgs, uiTheme: Theme): Component {
		const meta: string[] = [];
		if (args.path) meta.push(`in ${args.path}`);
		if (args.glob) meta.push(`glob:${args.glob}`);
		if (args.type) meta.push(`type:${args.type}`);
		if (args.output_mode && args.output_mode !== "filesWithMatches") meta.push(`mode:${args.output_mode}`);
		if (args.i) meta.push("case:insensitive");
		if (args.n === false) meta.push("no-line-numbers");
		if (args.context !== undefined && args.context > 0) meta.push(`context:${args.context}`);
		if (args.multiline) meta.push("multiline");
		if (args.limit !== undefined && args.limit > 0) meta.push(`limit:${args.limit}`);
		if (args.offset !== undefined && args.offset > 0) meta.push(`offset:${args.offset}`);

		const text = renderStatusLine(
			{ icon: "pending", title: "Grep", description: args.pattern || "?", meta },
			uiTheme,
		);
		return new Text(text, 0, 0);
	},

	renderResult(
		result: { content: Array<{ type: string; text?: string }>; details?: GrepToolDetails; isError?: boolean },
		{ expanded }: RenderResultOptions,
		uiTheme: Theme,
		args?: GrepRenderArgs,
	): Component {
		const details = result.details;

		if (result.isError || details?.error) {
			const errorText = details?.error || result.content?.find(c => c.type === "text")?.text || "Unknown error";
			return new Text(formatErrorMessage(errorText, uiTheme), 0, 0);
		}

		const hasDetailedData = details?.matchCount !== undefined || details?.fileCount !== undefined;

		if (!hasDetailedData) {
			const textContent = result.content?.find(c => c.type === "text")?.text;
			if (!textContent || textContent === "No matches found") {
				return new Text(formatEmptyMessage("No matches found", uiTheme), 0, 0);
			}
			const lines = textContent.split("\n").filter(line => line.trim() !== "");
			const description = args?.pattern ?? undefined;
			const header = renderStatusLine(
				{ icon: "success", title: "Grep", description, meta: [formatCount("item", lines.length)] },
				uiTheme,
			);
			const listLines = renderTreeList(
				{
					items: lines,
					expanded,
					maxCollapsed: COLLAPSED_TEXT_LIMIT,
					itemType: "item",
					renderItem: line => uiTheme.fg("toolOutput", line),
				},
				uiTheme,
			);
			return new Text([header, ...listLines].join("\n"), 0, 0);
		}

		const matchCount = details?.matchCount ?? 0;
		const fileCount = details?.fileCount ?? 0;
		const mode = details?.mode ?? "filesWithMatches";
		const truncation = details?.meta?.truncation;
		const limits = details?.meta?.limits;
		const truncated = Boolean(
			details?.truncated || truncation || limits?.matchLimit || limits?.resultLimit || limits?.columnTruncated,
		);
		const files = details?.files ?? [];

		if (matchCount === 0) {
			const header = renderStatusLine(
				{ icon: "warning", title: "Grep", description: args?.pattern, meta: ["0 matches"] },
				uiTheme,
			);
			return new Text([header, formatEmptyMessage("No matches found", uiTheme)].join("\n"), 0, 0);
		}

		const summaryParts =
			mode === "filesWithMatches"
				? [formatCount("file", fileCount)]
				: [formatCount("match", matchCount), formatCount("file", fileCount)];
		const meta = [...summaryParts];
		if (details?.scopePath) meta.push(`in ${details.scopePath}`);
		if (truncated) meta.push(uiTheme.fg("warning", "truncated"));
		const description = args?.pattern ?? undefined;
		const header = renderStatusLine(
			{ icon: truncated ? "warning" : "success", title: "Grep", description, meta },
			uiTheme,
		);

		if (mode === "content") {
			const textContent = result.content?.find(c => c.type === "text")?.text ?? "";
			const contentLines = textContent.split("\n").filter(line => line.trim().length > 0);
			const matchLines = renderTreeList(
				{
					items: contentLines,
					expanded,
					maxCollapsed: COLLAPSED_TEXT_LIMIT,
					itemType: "match",
					renderItem: line => uiTheme.fg("toolOutput", line),
				},
				uiTheme,
			);
			return new Text([header, ...matchLines].join("\n"), 0, 0);
		}

		const fileEntries: Array<{ path: string; count?: number }> = details?.fileMatches?.length
			? details.fileMatches.map(entry => ({ path: entry.path, count: entry.count }))
			: files.map(path => ({ path }));
		const fileLines = renderFileList(
			{
				files: fileEntries.map(entry => ({
					path: entry.path,
					isDirectory: entry.path.endsWith("/"),
					meta: entry.count !== undefined ? `(${entry.count} match${entry.count !== 1 ? "es" : ""})` : undefined,
				})),
				expanded,
				maxCollapsed: COLLAPSED_LIST_LIMIT,
			},
			uiTheme,
		);

		const truncationReasons: string[] = [];
		if (limits?.matchLimit) truncationReasons.push(`limit ${limits.matchLimit.reached} matches`);
		if (limits?.resultLimit) truncationReasons.push(`limit ${limits.resultLimit.reached} results`);
		if (truncation) truncationReasons.push(truncation.truncatedBy === "lines" ? "line limit" : "size limit");
		if (limits?.columnTruncated) truncationReasons.push(`line length ${limits.columnTruncated.maxColumn}`);
		if (truncation?.artifactId) truncationReasons.push(`full output: artifact://${truncation.artifactId}`);

		const extraLines =
			truncationReasons.length > 0 ? [uiTheme.fg("warning", `truncated: ${truncationReasons.join(", ")}`)] : [];

		return new Text([header, ...fileLines, ...extraLines].join("\n"), 0, 0);
	},
	mergeCallAndResult: true,
};
