import * as nodePath from "node:path";
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
	pattern: Type.String({ description: "Regex pattern to search for" }),
	path: Type.Optional(Type.String({ description: "File or directory to search (default: cwd)" })),
	glob: Type.Optional(Type.String({ description: "Filter files by glob pattern (e.g., '*.js')" })),
	type: Type.Optional(Type.String({ description: "Filter by file type (e.g., js, py, rust)" })),
	output_mode: Type.Optional(
		StringEnum(["files_with_matches", "content", "count"], {
			description: "Output format (default: files_with_matches)",
		}),
	),
	i: Type.Optional(Type.Boolean({ description: "Case-insensitive search (default: false)" })),
	n: Type.Optional(Type.Boolean({ description: "Show line numbers (default: true)" })),
	a: Type.Optional(Type.Number({ description: "Lines to show after each match (default: 0)" })),
	b: Type.Optional(Type.Number({ description: "Lines to show before each match (default: 0)" })),
	c: Type.Optional(Type.Number({ description: "Lines of context (before and after) (default: 0)" })),
	context: Type.Optional(Type.Number({ description: "Lines of context (alias for c)" })),
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

export interface RgResult {
	stdout: string;
	stderr: string;
	exitCode: number | null;
}

/**
 * Run rg command and capture output.
 *
 * @throws ToolAbortError if signal is aborted
 */
export async function runRg(rgPath: string, args: string[], signal?: AbortSignal): Promise<RgResult> {
	const child = ptree.cspawn([rgPath, ...args], { signal });

	let stdout: string;
	try {
		stdout = await child.nothrow().text();
	} catch (err) {
		if (err instanceof ptree.Exception && err.aborted) {
			throw new ToolAbortError();
		}
		throw err;
	}

	let exitError: unknown;
	try {
		await child.exited;
	} catch (err) {
		exitError = err;
		if (err instanceof ptree.Exception && err.aborted) {
			throw new ToolAbortError();
		}
	}

	const exitCode = child.exitCode ?? (exitError instanceof ptree.Exception ? exitError.exitCode : null);

	return {
		stdout,
		stderr: child.peekStderr(),
		exitCode,
	};
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
	output_mode?: "content" | "files_with_matches" | "count";
	i?: boolean;
	n?: boolean;
	a?: number;
	b?: number;
	c?: number;
	context?: number;
	multiline?: boolean;
	limit?: number;
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
			output_mode,
			i,
			n,
			a,
			b,
			c,
			context,
			multiline,
			limit,
			offset,
		} = params;

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

			const normalizeContext = (value: number | undefined, label: string): number => {
				if (value === undefined) return 0;
				const normalized = Number.isFinite(value) ? Math.floor(value) : Number.NaN;
				if (!Number.isFinite(normalized) || normalized < 0) {
					throw new ToolError(`${label} must be a non-negative number`);
				}
				return normalized;
			};

			const normalizedAfter = normalizeContext(a, "After context");
			const normalizedBefore = normalizeContext(b, "Before context");
			const hasContextParam = context !== undefined;
			const hasCParam = c !== undefined;
			if (hasContextParam && hasCParam) {
				throw new ToolError("Cannot combine context with c");
			}
			const normalizedContext = normalizeContext(hasContextParam ? context : c, "Context");
			if (normalizedContext > 0 && (normalizedAfter > 0 || normalizedBefore > 0)) {
				throw new ToolError("Cannot combine context with a or b");
			}
			const contextAfterValue = normalizedContext > 0 ? normalizedContext : normalizedAfter;
			const contextBeforeValue = normalizedContext > 0 ? normalizedContext : normalizedBefore;
			const showLineNumbers = n ?? true;
			const ignoreCase = i ?? false;
			const normalizedGlob = glob?.trim() ?? "";
			const normalizedType = type?.trim() ?? "";
			const hasContentHints =
				limit !== undefined || context !== undefined || c !== undefined || a !== undefined || b !== undefined;

			// Validate regex patterns early to surface parse errors before running rg
			const rgPath = await ensureTool("rg", {
				silent: true,
				notify: message => toolContext?.ui?.notify(message, "info"),
			});

			if (!rgPath) {
				throw new ToolError("rg is not available and could not be downloaded");
			}

			const validation = await this.validateRegexPattern(normalizedPattern, rgPath);
			if (!validation.valid) {
				throw new ToolError(validation.error ?? "Invalid regex pattern");
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
			const effectiveOutputMode =
				output_mode ?? (!isDirectory || hasContentHints ? "content" : "files_with_matches");
			const effectiveOffset = normalizedOffset > 0 ? normalizedOffset : 0;
			const effectiveLimit =
				effectiveOutputMode === "content" ? (normalizedLimit ?? DEFAULT_MATCH_LIMIT) : normalizedLimit;

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
				args.push("--files-with-matches", "--color=never");
			} else if (effectiveOutputMode === "count") {
				args.push("--count", "--color=never");
			} else {
				args.push("--json", "--color=never");
				if (showLineNumbers) {
					args.push("--line-number");
				}
			}

			args.push("--hidden");

			if (ignoreCase) {
				args.push("--ignore-case");
			} else {
				args.push("--case-sensitive");
			}

			if (multiline) {
				args.push("--multiline");
			}

			if (normalizedGlob) {
				args.push("--glob", normalizedGlob);
			}

			args.push("--glob", "!**/.git/**");
			args.push("--glob", "!**/node_modules/**");

			if (normalizedType) {
				args.push("--type", normalizedType);
			}

			if (effectiveOutputMode === "content") {
				if (normalizedContext > 0) {
					args.push("-C", String(normalizedContext));
				}
			}

			args.push("--", normalizedPattern, searchPath);

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
					limit: normalizedLimit,
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
					for (const line of processedLines) {
						recordSimpleFile(line);
					}
					fileCount = simpleFiles.size;
					simpleMatchCount = fileCount;
				} else {
					for (const line of processedLines) {
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

				const truncatedByLimit = Boolean(limitMeta.resultLimit);

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
						resultLimitReached: limitMeta.resultLimit?.reached,
					};
					return toolResult(details)
						.text(output)
						.limits({
							resultLimit: limitMeta.resultLimit?.reached,
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
					resultLimitReached: limitMeta.resultLimit?.reached,
				};
				return toolResult(details)
					.text(output)
					.limits({
						resultLimit: limitMeta.resultLimit?.reached,
					})
					.done();
			}

			// Content mode - existing JSON processing
			const formatBlock = async (filePath: string, lineNumber: number): Promise<string[]> => {
				const relativePath = formatPath(filePath);
				const lines = await getFileLines(filePath);
				if (!lines.length) {
					return showLineNumbers
						? [`${relativePath}:${lineNumber}: (unable to read file)`]
						: [`${relativePath}: (unable to read file)`];
				}

				const block: string[] = [];
				const start = contextBeforeValue > 0 ? Math.max(1, lineNumber - contextBeforeValue) : lineNumber;
				const end = contextAfterValue > 0 ? Math.min(lines.length, lineNumber + contextAfterValue) : lineNumber;

				for (let current = start; current <= end; current++) {
					const lineText = lines[current - 1] ?? "";
					const sanitized = lineText.replace(/\r/g, "");
					const isMatchLine = current === lineNumber;

					const { text: truncatedText, wasTruncated } = truncateLine(sanitized);
					if (wasTruncated) {
						linesTruncated = true;
					}

					if (isMatchLine) {
						block.push(
							showLineNumbers
								? `${relativePath}:${current}: ${truncatedText}`
								: `${relativePath}: ${truncatedText}`,
						);
					} else {
						block.push(
							showLineNumbers
								? `${relativePath}-${current}- ${truncatedText}`
								: `${relativePath}- ${truncatedText}`,
						);
					}
				}

				return block;
			};

			const maxMatches = effectiveLimit !== undefined ? effectiveLimit + effectiveOffset : undefined;
			const processLine = async (line: string): Promise<void> => {
				if (!line.trim()) {
					return;
				}

				let event: { type: string; data?: { path?: { text?: string }; line_number?: number } };
				try {
					event = JSON.parse(line);
				} catch {
					return;
				}

				if (event.type === "match") {
					const nextIndex = matchCount + 1;
					if (maxMatches !== undefined && nextIndex > maxMatches) {
						matchLimitReached = true;
						killedDueToLimit = true;
						child.kill("SIGKILL");
						return;
					}

					matchCount = nextIndex;
					const filePath = event.data?.path?.text;
					const lineNumber = event.data?.line_number;

					if (filePath && typeof lineNumber === "number") {
						if (matchCount <= effectiveOffset) {
							return;
						}
						recordFile(filePath);
						recordFileMatch(filePath);
						const block = await formatBlock(filePath, lineNumber);
						outputLines.push(...block);
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

			const limitMeta =
				matchLimitReached && effectiveLimit !== undefined
					? { matchLimit: { reached: effectiveLimit, suggestion: effectiveLimit * 2 } }
					: {};

			// Apply byte truncation (no line limit since we already have match limit)
			const rawOutput = outputLines.join("\n");
			const truncation = truncateHead(rawOutput, { maxLines: Number.MAX_SAFE_INTEGER });

			const output = truncation.content;
			const truncated = Boolean(matchLimitReached || truncation.truncated || limitMeta.matchLimit || linesTruncated);
			const details: GrepToolDetails = {
				scopePath,
				matchCount: effectiveOffset > 0 ? Math.max(0, matchCount - effectiveOffset) : matchCount,
				fileCount: files.size,
				files: fileList,
				fileMatches: fileList.map(path => ({
					path,
					count: fileMatchCounts.get(path) ?? 0,
				})),
				mode: effectiveOutputMode,
				truncated,
				matchLimitReached: limitMeta.matchLimit?.reached,
			};

			// Keep TUI compatibility fields
			if (matchLimitReached && effectiveLimit !== undefined) {
				details.matchLimitReached = effectiveLimit;
			}
			if (truncation.truncated) details.truncation = truncation;
			if (linesTruncated) details.linesTruncated = true;

			const resultBuilder = toolResult(details)
				.text(output)
				.limits({
					matchLimit: limitMeta.matchLimit?.reached,
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
	a?: number;
	b?: number;
	c?: number;
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
		if (args.output_mode && args.output_mode !== "files_with_matches") meta.push(`mode:${args.output_mode}`);
		if (args.i) meta.push("case:insensitive");
		if (args.n === false) meta.push("no-line-numbers");
		const contextValue = args.context ?? args.c;
		if (contextValue !== undefined && contextValue > 0) meta.push(`context:${contextValue}`);
		if (args.a !== undefined && args.a > 0) meta.push(`after:${args.a}`);
		if (args.b !== undefined && args.b > 0) meta.push(`before:${args.b}`);
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
		const mode = details?.mode ?? "files_with_matches";
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
		if (truncation) truncationReasons.push(truncation.truncatedBy === "lines" ? "line limit" : "size limit");
		if (limits?.columnTruncated) truncationReasons.push(`line length ${limits.columnTruncated.maxColumn}`);
		if (truncation?.artifactId) truncationReasons.push(`full output: artifact://${truncation.artifactId}`);

		const extraLines =
			truncationReasons.length > 0 ? [uiTheme.fg("warning", `truncated: ${truncationReasons.join(", ")}`)] : [];

		return new Text([header, ...fileLines, ...extraLines].join("\n"), 0, 0);
	},
	mergeCallAndResult: true,
};
