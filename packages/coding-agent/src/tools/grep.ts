import nodePath from "node:path";
import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import { StringEnum } from "@oh-my-pi/pi-ai";
import type { Component } from "@oh-my-pi/pi-tui";
import { Text } from "@oh-my-pi/pi-tui";
import { ptree, readLines } from "@oh-my-pi/pi-utils";
import { Type } from "@sinclair/typebox";
import { $ } from "bun";
import { renderPromptTemplate } from "../config/prompt-templates";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import type { Theme } from "../modes/theme/theme";
import grepDescription from "../prompts/tools/grep.md" with { type: "text" };
import { renderFileList, renderStatusLine, renderTreeList } from "../tui";
import { ensureTool } from "../utils/tools-manager";
import { untilAborted } from "../utils/utils";
import type { ToolSession } from ".";
import { applyListLimit } from "./list-limit";
import type { OutputMeta } from "./output-meta";
import { resolveToCwd } from "./path-utils";
import { formatCount, formatEmptyMessage, formatErrorMessage, PREVIEW_LIMITS } from "./render-utils";
import { ToolAbortError, ToolError } from "./tool-errors";
import { toolResult } from "./tool-result";
import { DEFAULT_MAX_COLUMN, type TruncationResult, truncateHead, truncateLine } from "./truncate";

const grepSchema = Type.Object({
	pattern: Type.String({ description: "Search pattern (regex)" }),
	path: Type.Optional(Type.String({ description: "Directory or file to search (default: cwd)" })),
	glob: Type.Optional(Type.String({ description: "Glob filter, e.g. '*.ts', '**/*.spec.ts'" })),
	type: Type.Optional(Type.String({ description: "File type filter, e.g. 'ts', 'py', 'rust'" })),
	ignore_case: Type.Optional(Type.Boolean({ description: "Force case-insensitive (default: smart-case)" })),
	case_sensitive: Type.Optional(Type.Boolean({ description: "Force case-sensitive (default: smart-case)" })),
	literal: Type.Optional(Type.Boolean({ description: "Treat pattern as literal, not regex (default: false)" })),
	multiline: Type.Optional(Type.Boolean({ description: "Match across line boundaries (default: false)" })),
	context: Type.Optional(Type.Number({ description: "Lines of context before/after match (default: 0)" })),
	limit: Type.Optional(Type.Number({ description: "Max matches to return (default: 100)" })),
	output_mode: Type.Optional(
		StringEnum(["content", "files_with_matches", "count"], {
			description: "Output format (default: content)",
		}),
	),
	head_limit: Type.Optional(Type.Number({ description: "Truncate output to first N results" })),
	offset: Type.Optional(Type.Number({ description: "Skip first N results (default: 0)" })),
});

const DEFAULT_LIMIT = 100;

export interface GrepToolDetails {
	truncation?: TruncationResult;
	matchLimitReached?: number;
	headLimitReached?: number;
	linesTruncated?: boolean;
	meta?: OutputMeta;
	// Fields for TUI rendering
	scopePath?: string;
	matchCount?: number;
	fileCount?: number;
	files?: string[];
	fileMatches?: Array<{ path: string; count: number }>;
	mode?: "content" | "files_with_matches" | "count";
	truncated?: boolean;
	error?: string;
}

/**
 * Pluggable operations for the grep tool.
 * Override these to delegate search to remote systems (e.g., SSH).
 */
export interface GrepOperations {
	/** Check if path is a directory. Throws if path doesn't exist. */
	isDirectory: (absolutePath: string) => Promise<boolean> | boolean;
	/** Read file contents for context lines */
	readFile: (absolutePath: string) => Promise<string> | string;
}

const defaultGrepOperations: GrepOperations = {
	isDirectory: async p => (await Bun.file(p).stat()).isDirectory(),
	readFile: p => Bun.file(p).text(),
};

export interface GrepToolOptions {
	/** Custom operations for grep. Default: local filesystem + ripgrep */
	operations?: GrepOperations;
}

interface GrepParams {
	pattern: string;
	path?: string;
	glob?: string;
	type?: string;
	ignore_case?: boolean;
	case_sensitive?: boolean;
	literal?: boolean;
	multiline?: boolean;
	context?: number;
	limit?: number;
	output_mode?: "content" | "files_with_matches" | "count";
	head_limit?: number;
	offset?: number;
}

export class GrepTool implements AgentTool<typeof grepSchema, GrepToolDetails> {
	public readonly name = "grep";
	public readonly label = "Grep";
	public readonly description: string;
	public readonly parameters = grepSchema;

	private readonly session: ToolSession;
	private readonly ops: GrepOperations;

	constructor(session: ToolSession, options?: GrepToolOptions) {
		this.session = session;
		this.ops = options?.operations ?? defaultGrepOperations;
		this.description = renderPromptTemplate(grepDescription);
	}

	/**
	 * Validates a pattern against ripgrep's regex engine.
	 * Uses a quick dry-run against /dev/null to check for parse errors.
	 */
	private async validateRegexPattern(pattern: string, rgPath?: string): Promise<{ valid: boolean; error?: string }> {
		if (!rgPath) {
			return { valid: true }; // Can't validate, assume valid
		}

		// Run ripgrep against /dev/null with the pattern - this validates regex syntax
		// without searching any files
		const result = await $`${rgPath} --no-config --quiet -- ${pattern} /dev/null`.quiet().nothrow();
		const stderr = result.stderr?.toString() ?? "";
		const exitCode = result.exitCode ?? 0;

		// Exit code 1 = no matches (pattern is valid), 0 = matches found
		// Exit code 2 = error (often regex parse error)
		if (exitCode === 2 && stderr.includes("regex parse error")) {
			return { valid: false, error: stderr.trim() };
		}

		return { valid: true };
	}

	public async execute(
		_toolCallId: string,
		params: GrepParams,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<GrepToolDetails>,
		toolContext?: AgentToolContext,
	): Promise<AgentToolResult<GrepToolDetails>> {
		const {
			pattern,
			path: searchDir,
			glob,
			type,
			ignore_case,
			case_sensitive,
			literal,
			multiline,
			context,
			limit,
			output_mode,
			head_limit,
			offset,
		} = params;

		return untilAborted(signal, async () => {
			// Auto-detect invalid regex patterns and switch to literal mode
			// This handles cases like "abort(" which would cause ripgrep regex parse errors
			const rgPath = await ensureTool("rg", {
				silent: true,
				notify: message => toolContext?.ui?.notify(message, "info"),
			});

			if (!rgPath) {
				throw new ToolError("rg is not available and could not be downloaded");
			}

			let useLiteral = literal ?? false;
			if (!useLiteral) {
				const validation = await this.validateRegexPattern(pattern, rgPath);
				if (!validation.valid) {
					useLiteral = true;
				}
			}

			// rgPath resolved earlier
			const searchPath = resolveToCwd(searchDir || ".", this.session.cwd);
			const scopePath = (() => {
				const relative = nodePath.relative(this.session.cwd, searchPath).replace(/\\/g, "/");
				return relative.length === 0 ? "." : relative;
			})();

			let isDirectory: boolean;
			try {
				isDirectory = await this.ops.isDirectory(searchPath);
			} catch {
				throw new ToolError(`Path not found: ${searchPath}`);
			}
			const contextValue = context && context > 0 ? context : 0;
			const effectiveLimit = Math.max(1, limit ?? DEFAULT_LIMIT);
			const effectiveOutputMode = output_mode ?? "content";
			const effectiveOffset = offset && offset > 0 ? offset : 0;

			const formatPath = (filePath: string): string => {
				if (isDirectory) {
					const relative = nodePath.relative(searchPath, filePath);
					if (relative && !relative.startsWith("..")) {
						return relative.replace(/\\/g, "/");
					}
				}
				return nodePath.basename(filePath);
			};

			const fileCache = new Map<string, Promise<string[]>>();
			const getFileLines = async (filePath: string): Promise<string[]> => {
				let linesPromise = fileCache.get(filePath);
				if (!linesPromise) {
					linesPromise = (async () => {
						try {
							const content = await this.ops.readFile(filePath);
							return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
						} catch {
							return [];
						}
					})();
					fileCache.set(filePath, linesPromise);
				}
				return linesPromise;
			};

			const args: string[] = [];

			// Base arguments depend on output mode
			if (effectiveOutputMode === "files_with_matches") {
				args.push("--files-with-matches", "--color=never", "--hidden");
			} else if (effectiveOutputMode === "count") {
				args.push("--count", "--color=never", "--hidden");
			} else {
				args.push("--json", "--line-number", "--color=never", "--hidden");
			}

			if (case_sensitive) {
				args.push("--case-sensitive");
			} else if (ignore_case) {
				args.push("--ignore-case");
			} else {
				args.push("--smart-case");
			}

			if (multiline) {
				args.push("--multiline");
			}

			if (useLiteral) {
				args.push("--fixed-strings");
			}

			if (glob) {
				args.push("--glob", glob);
			}

			if (type) {
				args.push("--type", type);
			}

			args.push("--", pattern, searchPath);

			const child = ptree.cspawn([rgPath, ...args], { signal });

			let matchCount = 0;
			let matchLimitReached = false;
			let linesTruncated = false;
			let killedDueToLimit = false;
			const outputLines: string[] = [];
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

			const recordFileMatch = (filePath: string) => {
				const relative = formatPath(filePath);
				fileMatchCounts.set(relative, (fileMatchCounts.get(relative) ?? 0) + 1);
			};

			// For simple output modes (files_with_matches, count), process text directly
			if (effectiveOutputMode === "files_with_matches" || effectiveOutputMode === "count") {
				const stdout = await child.text().catch(x => {
					if (x instanceof ptree.Exception && x.exitCode === 1) {
						return "";
					}
					return Promise.reject(x);
				});

				const exitCode = child.exitCode ?? 0;
				if (exitCode !== 0 && exitCode !== 1) {
					const errorMsg = child.peekStderr().trim() || `ripgrep exited with code ${exitCode}`;
					throw new ToolError(errorMsg);
				}

				const lines = stdout
					.trim()
					.split("\n")
					.filter(line => line.length > 0);

				if (lines.length === 0) {
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

				const offsetLines = effectiveOffset > 0 ? lines.slice(effectiveOffset) : lines;
				const listLimit = applyListLimit(offsetLines, {
					limit: effectiveLimit,
					headLimit: head_limit,
					limitType: "result",
				});
				const processedLines = listLimit.items;
				const limitMeta = listLimit.meta;

				let simpleMatchCount = 0;
				let fileCount = 0;
				const simpleFiles = new Set<string>();
				const simpleFileList: string[] = [];
				const simpleFileMatchCounts = new Map<string, number>();

				const recordSimpleFile = (filePath: string) => {
					const relative = formatPath(filePath);
					if (!simpleFiles.has(relative)) {
						simpleFiles.add(relative);
						simpleFileList.push(relative);
					}
				};

				// Count mode: ripgrep provides total count per file, so we set directly (not increment)
				const setFileMatchCount = (filePath: string, count: number) => {
					const relative = formatPath(filePath);
					simpleFileMatchCounts.set(relative, count);
				};

				if (effectiveOutputMode === "files_with_matches") {
					for (const line of lines) {
						recordSimpleFile(line);
					}
					fileCount = simpleFiles.size;
					simpleMatchCount = fileCount;
				} else {
					for (const line of lines) {
						const separatorIndex = line.lastIndexOf(":");
						const filePart = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
						const countPart = separatorIndex === -1 ? "" : line.slice(separatorIndex + 1);
						const count = Number.parseInt(countPart, 10);
						recordSimpleFile(filePart);
						if (!Number.isNaN(count)) {
							simpleMatchCount += count;
							setFileMatchCount(filePart, count);
						}
					}
					fileCount = simpleFiles.size;
				}

				const truncatedByLimit = Boolean(limitMeta.resultLimit || limitMeta.headLimit);

				// For count mode, format as "path:count"
				if (effectiveOutputMode === "count") {
					const formatted = processedLines.map(line => {
						const separatorIndex = line.lastIndexOf(":");
						const relative = formatPath(separatorIndex === -1 ? line : line.slice(0, separatorIndex));
						const count = separatorIndex === -1 ? "0" : line.slice(separatorIndex + 1);
						return `${relative}:${count}`;
					});
					const output = formatted.join("\n");
					const details: GrepToolDetails = {
						scopePath,
						matchCount: simpleMatchCount,
						fileCount,
						files: simpleFileList,
						fileMatches: simpleFileList.map(path => ({
							path,
							count: simpleFileMatchCounts.get(path) ?? 0,
						})),
						mode: effectiveOutputMode,
						truncated: truncatedByLimit,
						headLimitReached: limitMeta.headLimit?.reached,
					};
					return toolResult(details)
						.text(output)
						.limits({
							resultLimit: limitMeta.resultLimit?.reached,
							headLimit: limitMeta.headLimit?.reached,
						})
						.done();
				}

				// For files_with_matches, format paths
				const formatted = processedLines.map(line => formatPath(line));
				const output = formatted.join("\n");
				const details: GrepToolDetails = {
					scopePath,
					matchCount: simpleMatchCount,
					fileCount,
					files: simpleFileList,
					mode: effectiveOutputMode,
					truncated: truncatedByLimit,
					headLimitReached: limitMeta.headLimit?.reached,
				};
				return toolResult(details)
					.text(output)
					.limits({
						resultLimit: limitMeta.resultLimit?.reached,
						headLimit: limitMeta.headLimit?.reached,
					})
					.done();
			}

			// Content mode - existing JSON processing
			const formatBlock = async (filePath: string, lineNumber: number): Promise<string[]> => {
				const relativePath = formatPath(filePath);
				const lines = await getFileLines(filePath);
				if (!lines.length) {
					return [`${relativePath}:${lineNumber}: (unable to read file)`];
				}

				const block: string[] = [];
				const start = contextValue > 0 ? Math.max(1, lineNumber - contextValue) : lineNumber;
				const end = contextValue > 0 ? Math.min(lines.length, lineNumber + contextValue) : lineNumber;

				for (let current = start; current <= end; current++) {
					const lineText = lines[current - 1] ?? "";
					const sanitized = lineText.replace(/\r/g, "");
					const isMatchLine = current === lineNumber;

					const { text: truncatedText, wasTruncated } = truncateLine(sanitized);
					if (wasTruncated) {
						linesTruncated = true;
					}

					if (isMatchLine) {
						block.push(`${relativePath}:${current}: ${truncatedText}`);
					} else {
						block.push(`${relativePath}-${current}- ${truncatedText}`);
					}
				}

				return block;
			};

			const processLine = async (line: string): Promise<void> => {
				if (!line.trim() || matchCount >= effectiveLimit) {
					return;
				}

				let event: { type: string; data?: { path?: { text?: string }; line_number?: number } };
				try {
					event = JSON.parse(line);
				} catch {
					return;
				}

				if (event.type === "match") {
					matchCount++;
					const filePath = event.data?.path?.text;
					const lineNumber = event.data?.line_number;

					if (filePath && typeof lineNumber === "number") {
						recordFile(filePath);
						recordFileMatch(filePath);
						const block = await formatBlock(filePath, lineNumber);
						outputLines.push(...block);
					}

					if (matchCount >= effectiveLimit) {
						matchLimitReached = true;
						killedDueToLimit = true;
						child.kill("SIGKILL");
					}
				}
			};

			// Process stdout line by line
			try {
				for await (const line of readLines(child.stdout)) {
					await processLine(line);
				}
			} catch (err) {
				if (err instanceof ptree.Exception && err.aborted) {
					throw new ToolAbortError();
				}
				// Stream may close early if we killed due to limit - that's ok
				if (!killedDueToLimit) {
					throw err;
				}
			}

			// Wait for process to exit
			try {
				await child.exited;
			} catch (err) {
				if (err instanceof ptree.Exception) {
					if (err.aborted) {
						throw new ToolAbortError();
					}
					// Non-zero exit is ok if we killed due to limit or exit code 1 (no matches)
					if (!killedDueToLimit && err.exitCode !== 1) {
						const errorMsg = child.peekStderr().trim() || `ripgrep exited with code ${err.exitCode}`;
						throw new ToolError(errorMsg);
					}
				} else {
					throw err;
				}
			}

			if (matchCount === 0) {
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

			// Apply offset and head_limit to output lines
			let processedLines = effectiveOffset > 0 ? outputLines.slice(effectiveOffset) : outputLines;
			const listLimit = applyListLimit(processedLines, { headLimit: head_limit });
			processedLines = listLimit.items;
			const limitMeta = listLimit.meta;

			// Apply byte truncation (no line limit since we already have match limit)
			const rawOutput = processedLines.join("\n");
			const truncation = truncateHead(rawOutput, { maxLines: Number.MAX_SAFE_INTEGER });

			const output = truncation.content;
			const truncated = Boolean(matchLimitReached || truncation.truncated || limitMeta.headLimit || linesTruncated);
			const details: GrepToolDetails = {
				scopePath,
				matchCount,
				fileCount: files.size,
				files: fileList,
				fileMatches: fileList.map(path => ({
					path,
					count: fileMatchCounts.get(path) ?? 0,
				})),
				mode: effectiveOutputMode,
				truncated,
				headLimitReached: limitMeta.headLimit?.reached,
			};

			// Keep TUI compatibility fields
			if (matchLimitReached) details.matchLimitReached = effectiveLimit;
			if (truncation.truncated) details.truncation = truncation;
			if (linesTruncated) details.linesTruncated = true;

			const resultBuilder = toolResult(details)
				.text(output)
				.limits({
					matchLimit: matchLimitReached ? effectiveLimit : undefined,
					headLimit: limitMeta.headLimit?.reached,
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
	ignore_case?: boolean;
	case_sensitive?: boolean;
	literal?: boolean;
	multiline?: boolean;
	context?: number;
	limit?: number;
	output_mode?: string;
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
		if (args.output_mode && args.output_mode !== "files_with_matches") meta.push(`mode:${args.output_mode}`);
		if (args.case_sensitive) {
			meta.push("case:sensitive");
		} else if (args.ignore_case) {
			meta.push("case:insensitive");
		}
		if (args.literal) meta.push("literal");
		if (args.multiline) meta.push("multiline");
		if (args.context !== undefined) meta.push(`context:${args.context}`);
		if (args.limit !== undefined) meta.push(`limit:${args.limit}`);

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
		const mode = details?.mode ?? "files_with_matches";
		const truncation = details?.meta?.truncation;
		const limits = details?.meta?.limits;
		const truncated = Boolean(
			details?.truncated ||
				truncation ||
				limits?.matchLimit ||
				limits?.resultLimit ||
				limits?.headLimit ||
				limits?.columnTruncated,
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
			mode === "files_with_matches"
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
		if (limits?.headLimit) truncationReasons.push(`head limit ${limits.headLimit.reached}`);
		if (truncation) truncationReasons.push(truncation.truncatedBy === "lines" ? "line limit" : "size limit");
		if (limits?.columnTruncated) truncationReasons.push(`line length ${limits.columnTruncated.maxColumn}`);
		if (truncation?.artifactId) truncationReasons.push(`full output: artifact://${truncation.artifactId}`);

		const extraLines =
			truncationReasons.length > 0 ? [uiTheme.fg("warning", `truncated: ${truncationReasons.join(", ")}`)] : [];

		return new Text([header, ...fileLines, ...extraLines].join("\n"), 0, 0);
	},
	mergeCallAndResult: true,
};
