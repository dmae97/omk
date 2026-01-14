import nodePath from "node:path";
import type { AgentTool } from "@oh-my-pi/pi-agent-core";
import { StringEnum } from "@oh-my-pi/pi-ai";
import type { Component } from "@oh-my-pi/pi-tui";
import { Text } from "@oh-my-pi/pi-tui";
import { Type } from "@sinclair/typebox";
import type { Subprocess } from "bun";
import { getLanguageFromPath, type Theme } from "../../modes/interactive/theme/theme";
import grepDescription from "../../prompts/tools/grep.md" with { type: "text" };
import { ensureTool } from "../../utils/tools-manager";
import type { RenderResultOptions } from "../custom-tools/types";
import { renderPromptTemplate } from "../prompt-templates";
import { ScopeSignal, untilAborted } from "../utils";
import type { ToolSession } from "./index";
import { resolveToCwd } from "./path-utils";
import { createToolUIKit, PREVIEW_LIMITS } from "./render-utils";
import {
	DEFAULT_MAX_BYTES,
	formatSize,
	GREP_MAX_LINE_LENGTH,
	type TruncationResult,
	truncateHead,
	truncateLine,
} from "./truncate";

const grepSchema = Type.Object({
	pattern: Type.String({ description: "Search pattern (regex or literal string)" }),
	path: Type.Optional(Type.String({ description: "Directory or file to search (default: current directory)" })),
	glob: Type.Optional(Type.String({ description: "Filter files by glob pattern, e.g. '*.ts' or '**/*.spec.ts'" })),
	type: Type.Optional(Type.String({ description: "File type filter (e.g., 'ts', 'rust', 'py')" })),
	ignoreCase: Type.Optional(
		Type.Boolean({ description: "Force case-insensitive search (default: false, uses smart-case otherwise)" }),
	),
	caseSensitive: Type.Optional(
		Type.Boolean({ description: "Force case-sensitive search (default: false, disables smart-case)" }),
	),
	literal: Type.Optional(
		Type.Boolean({ description: "Treat pattern as literal string instead of regex (default: false)" }),
	),
	multiline: Type.Optional(
		Type.Boolean({ description: "Enable multiline matching for cross-line patterns (default: false)" }),
	),
	context: Type.Optional(
		Type.Number({ description: "Number of lines to show before and after each match (default: 0)" }),
	),
	limit: Type.Optional(Type.Number({ description: "Maximum number of matches to return (default: 100)" })),
	outputMode: Type.Optional(
		StringEnum(["content", "files_with_matches", "count"], {
			description:
				"Output mode: 'content' shows matching lines, 'files_with_matches' shows only file paths, 'count' shows match counts per file (default: 'content')",
		}),
	),
	headLimit: Type.Optional(Type.Number({ description: "Limit output to first N results (default: unlimited)" })),
	offset: Type.Optional(Type.Number({ description: "Skip first N results before applying headLimit (default: 0)" })),
});

const DEFAULT_LIMIT = 100;

export interface GrepToolDetails {
	truncation?: TruncationResult;
	matchLimitReached?: number;
	headLimitReached?: number;
	linesTruncated?: boolean;
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
	isDirectory: async (p) => (await Bun.file(p).stat()).isDirectory(),
	readFile: (p) => Bun.file(p).text(),
};

export interface GrepToolOptions {
	/** Custom operations for grep. Default: local filesystem + ripgrep */
	operations?: GrepOperations;
}

export function createGrepTool(session: ToolSession, options?: GrepToolOptions): AgentTool<typeof grepSchema> {
	const ops = options?.operations ?? defaultGrepOperations;
	return {
		name: "grep",
		label: "Grep",
		description: renderPromptTemplate(grepDescription),
		parameters: grepSchema,
		execute: async (
			_toolCallId: string,
			{
				pattern,
				path: searchDir,
				glob,
				type,
				ignoreCase,
				caseSensitive,
				literal,
				multiline,
				context,
				limit,
				outputMode,
				headLimit,
				offset,
			}: {
				pattern: string;
				path?: string;
				glob?: string;
				type?: string;
				ignoreCase?: boolean;
				caseSensitive?: boolean;
				literal?: boolean;
				multiline?: boolean;
				context?: number;
				limit?: number;
				outputMode?: "content" | "files_with_matches" | "count";
				headLimit?: number;
				offset?: number;
			},
			signal?: AbortSignal,
		) => {
			return untilAborted(signal, async () => {
				const rgPath = await ensureTool("rg", true);
				if (!rgPath) {
					throw new Error("ripgrep (rg) is not available and could not be downloaded");
				}

				const searchPath = resolveToCwd(searchDir || ".", session.cwd);
				const scopePath = (() => {
					const relative = nodePath.relative(session.cwd, searchPath).replace(/\\/g, "/");
					return relative.length === 0 ? "." : relative;
				})();

				let isDirectory: boolean;
				try {
					isDirectory = await ops.isDirectory(searchPath);
				} catch {
					throw new Error(`Path not found: ${searchPath}`);
				}
				const contextValue = context && context > 0 ? context : 0;
				const effectiveLimit = Math.max(1, limit ?? DEFAULT_LIMIT);
				const effectiveOutputMode = outputMode ?? "content";
				const effectiveOffset = offset && offset > 0 ? offset : 0;
				const hasHeadLimit = headLimit !== undefined && headLimit > 0;

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
								const content = await ops.readFile(filePath);
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

				if (caseSensitive) {
					args.push("--case-sensitive");
				} else if (ignoreCase) {
					args.push("--ignore-case");
				} else {
					args.push("--smart-case");
				}

				if (multiline) {
					args.push("--multiline");
				}

				if (literal) {
					args.push("--fixed-strings");
				}

				if (glob) {
					args.push("--glob", glob);
				}

				if (type) {
					args.push("--type", type);
				}

				args.push("--", pattern, searchPath);

				const child: Subprocess = Bun.spawn([rgPath, ...args], {
					stdin: "ignore",
					stdout: "pipe",
					stderr: "pipe",
				});

				let stderr = "";
				let matchCount = 0;
				let matchLimitReached = false;
				let linesTruncated = false;
				let aborted = false;
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

				const stopChild = (dueToLimit: boolean = false) => {
					killedDueToLimit = dueToLimit;
					child.kill();
				};

				using signalScope = new ScopeSignal(signal ? { signal } : undefined);
				signalScope.catch(() => {
					aborted = true;
					stopChild();
				});

				// For simple output modes (files_with_matches, count), process text directly
				if (effectiveOutputMode === "files_with_matches" || effectiveOutputMode === "count") {
					const stdoutReader = (child.stdout as ReadableStream<Uint8Array>).getReader();
					const stderrReader = (child.stderr as ReadableStream<Uint8Array>).getReader();
					const decoder = new TextDecoder();
					let stdout = "";

					await Promise.all([
						(async () => {
							while (true) {
								const { done, value } = await stdoutReader.read();
								if (done) break;
								stdout += decoder.decode(value, { stream: true });
							}
						})(),
						(async () => {
							while (true) {
								const { done, value } = await stderrReader.read();
								if (done) break;
								stderr += decoder.decode(value, { stream: true });
							}
						})(),
					]);

					const exitCode = await child.exited;

					if (aborted) {
						throw new Error("Operation aborted");
					}

					if (exitCode !== 0 && exitCode !== 1) {
						const errorMsg = stderr.trim() || `ripgrep exited with code ${exitCode}`;
						throw new Error(errorMsg);
					}

					const lines = stdout
						.trim()
						.split("\n")
						.filter((line) => line.length > 0);

					if (lines.length === 0) {
						return {
							content: [{ type: "text", text: "No matches found" }],
							details: {
								scopePath,
								matchCount: 0,
								fileCount: 0,
								files: [],
								mode: effectiveOutputMode,
								truncated: false,
							},
						};
					}

					// Apply offset and headLimit
					let processedLines = lines;
					if (effectiveOffset > 0) {
						processedLines = processedLines.slice(effectiveOffset);
					}
					if (hasHeadLimit) {
						processedLines = processedLines.slice(0, headLimit);
					}

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

					const truncatedByHeadLimit = hasHeadLimit && processedLines.length < lines.length;

					// For count mode, format as "path:count"
					if (effectiveOutputMode === "count") {
						const formatted = processedLines.map((line) => {
							const separatorIndex = line.lastIndexOf(":");
							const relative = formatPath(separatorIndex === -1 ? line : line.slice(0, separatorIndex));
							const count = separatorIndex === -1 ? "0" : line.slice(separatorIndex + 1);
							return `${relative}:${count}`;
						});
						const output = formatted.join("\n");
						return {
							content: [{ type: "text", text: output }],
							details: {
								scopePath,
								matchCount: simpleMatchCount,
								fileCount,
								files: simpleFileList,
								fileMatches: simpleFileList.map((path) => ({
									path,
									count: simpleFileMatchCounts.get(path) ?? 0,
								})),
								mode: effectiveOutputMode,
								truncated: truncatedByHeadLimit,
								headLimitReached: truncatedByHeadLimit ? headLimit : undefined,
							},
						};
					}

					// For files_with_matches, format paths
					const formatted = processedLines.map((line) => formatPath(line));
					const output = formatted.join("\n");
					return {
						content: [{ type: "text", text: output }],
						details: {
							scopePath,
							matchCount: simpleMatchCount,
							fileCount,
							files: simpleFileList,
							mode: effectiveOutputMode,
							truncated: truncatedByHeadLimit,
							headLimitReached: truncatedByHeadLimit ? headLimit : undefined,
						},
					};
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
							stopChild(true);
						}
					}
				};

				// Read streams using Bun's ReadableStream API
				const stdoutReader = (child.stdout as ReadableStream<Uint8Array>).getReader();
				const stderrReader = (child.stderr as ReadableStream<Uint8Array>).getReader();
				const decoder = new TextDecoder();
				let stdoutBuffer = "";

				await Promise.all([
					// Process stdout line by line
					(async () => {
						while (true) {
							const { done, value } = await stdoutReader.read();
							if (done) break;

							stdoutBuffer += decoder.decode(value, { stream: true });
							const lines = stdoutBuffer.split("\n");
							// Keep the last incomplete line in the buffer
							stdoutBuffer = lines.pop() ?? "";

							for (const line of lines) {
								await processLine(line);
							}
						}
						// Process any remaining content
						if (stdoutBuffer.trim()) {
							await processLine(stdoutBuffer);
						}
					})(),
					// Collect stderr
					(async () => {
						while (true) {
							const { done, value } = await stderrReader.read();
							if (done) break;
							stderr += decoder.decode(value, { stream: true });
						}
					})(),
				]);

				const exitCode = await child.exited;

				if (aborted) {
					throw new Error("Operation aborted");
				}

				if (!killedDueToLimit && exitCode !== 0 && exitCode !== 1) {
					const errorMsg = stderr.trim() || `ripgrep exited with code ${exitCode}`;
					throw new Error(errorMsg);
				}

				if (matchCount === 0) {
					return {
						content: [{ type: "text", text: "No matches found" }],
						details: {
							scopePath,
							matchCount: 0,
							fileCount: 0,
							files: [],
							mode: effectiveOutputMode,
							truncated: false,
						},
					};
				}

				// Apply offset and headLimit to output lines
				let processedLines = outputLines;
				if (effectiveOffset > 0) {
					processedLines = processedLines.slice(effectiveOffset);
				}
				if (hasHeadLimit) {
					processedLines = processedLines.slice(0, headLimit);
				}

				// Apply byte truncation (no line limit since we already have match limit)
				const rawOutput = processedLines.join("\n");
				const truncation = truncateHead(rawOutput, { maxLines: Number.MAX_SAFE_INTEGER });

				let output = truncation.content;
				const truncatedByHeadLimit = hasHeadLimit && processedLines.length < outputLines.length;
				const details: GrepToolDetails = {
					scopePath,
					matchCount,
					fileCount: files.size,
					files: fileList,
					fileMatches: fileList.map((path) => ({
						path,
						count: fileMatchCounts.get(path) ?? 0,
					})),
					mode: effectiveOutputMode,
					truncated: matchLimitReached || truncation.truncated || truncatedByHeadLimit,
					headLimitReached: truncatedByHeadLimit ? headLimit : undefined,
				};

				// Build notices
				const notices: string[] = [];

				if (matchLimitReached) {
					notices.push(
						`${effectiveLimit} matches limit reached. Use limit=${effectiveLimit * 2} for more, or refine pattern`,
					);
					details.matchLimitReached = effectiveLimit;
				}

				if (truncation.truncated) {
					notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
					details.truncation = truncation;
				}

				if (linesTruncated) {
					notices.push(`Some lines truncated to ${GREP_MAX_LINE_LENGTH} chars. Use read tool to see full lines`);
					details.linesTruncated = true;
				}

				if (notices.length > 0) {
					output += `\n\n[${notices.join(". ")}]`;
				}

				return {
					content: [{ type: "text", text: output }],
					details: Object.keys(details).length > 0 ? details : undefined,
				};
			});
		},
	};
}

// =============================================================================
// TUI Renderer
// =============================================================================

interface GrepRenderArgs {
	pattern: string;
	path?: string;
	glob?: string;
	type?: string;
	ignoreCase?: boolean;
	caseSensitive?: boolean;
	literal?: boolean;
	multiline?: boolean;
	context?: number;
	limit?: number;
	outputMode?: string;
}

const COLLAPSED_LIST_LIMIT = PREVIEW_LIMITS.COLLAPSED_ITEMS;
const COLLAPSED_TEXT_LIMIT = PREVIEW_LIMITS.COLLAPSED_LINES * 2;

export const grepToolRenderer = {
	inline: true,
	renderCall(args: GrepRenderArgs, uiTheme: Theme): Component {
		const ui = createToolUIKit(uiTheme);
		const label = ui.title("Grep");
		let text = `${uiTheme.format.bullet} ${label} ${uiTheme.fg("accent", args.pattern || "?")}`;

		const meta: string[] = [];
		if (args.path) meta.push(`in ${args.path}`);
		if (args.glob) meta.push(`glob:${args.glob}`);
		if (args.type) meta.push(`type:${args.type}`);
		if (args.outputMode && args.outputMode !== "files_with_matches") meta.push(`mode:${args.outputMode}`);
		if (args.caseSensitive) {
			meta.push("case:sensitive");
		} else if (args.ignoreCase) {
			meta.push("case:insensitive");
		}
		if (args.literal) meta.push("literal");
		if (args.multiline) meta.push("multiline");
		if (args.context !== undefined) meta.push(`context:${args.context}`);
		if (args.limit !== undefined) meta.push(`limit:${args.limit}`);

		text += ui.meta(meta);

		return new Text(text, 0, 0);
	},

	renderResult(
		result: { content: Array<{ type: string; text?: string }>; details?: GrepToolDetails; isError?: boolean },
		{ expanded }: RenderResultOptions,
		uiTheme: Theme,
	): Component {
		const ui = createToolUIKit(uiTheme);
		const details = result.details;

		if (result.isError || details?.error) {
			const errorText = details?.error || result.content?.find((c) => c.type === "text")?.text || "Unknown error";
			return new Text(`  ${ui.errorMessage(errorText)}`, 0, 0);
		}

		const hasDetailedData = details?.matchCount !== undefined || details?.fileCount !== undefined;

		if (!hasDetailedData) {
			const textContent = result.content?.find((c) => c.type === "text")?.text;
			if (!textContent || textContent === "No matches found") {
				return new Text(`  ${ui.emptyMessage("No matches found")}`, 0, 0);
			}

			const lines = textContent.split("\n").filter((line) => line.trim() !== "");
			const maxLines = expanded ? lines.length : Math.min(lines.length, COLLAPSED_TEXT_LIMIT);
			const displayLines = lines.slice(0, maxLines);
			const remaining = lines.length - maxLines;
			const hasMore = remaining > 0;

			const icon = uiTheme.styledSymbol("status.success", "success");
			const summary = ui.count("item", lines.length);
			const expandHint = ui.expandHint(expanded, hasMore);
			let text = `  ${icon} ${uiTheme.fg("dim", summary)}${expandHint}`;

			for (let i = 0; i < displayLines.length; i++) {
				const isLast = i === displayLines.length - 1 && remaining === 0;
				const branch = isLast ? uiTheme.tree.last : uiTheme.tree.branch;
				text += `\n  ${uiTheme.fg("dim", branch)} ${uiTheme.fg("toolOutput", displayLines[i])}`;
			}

			if (remaining > 0) {
				text += `\n  ${uiTheme.fg("dim", uiTheme.tree.last)} ${uiTheme.fg("muted", ui.moreItems(remaining, "item"))}`;
			}

			return new Text(text, 0, 0);
		}

		const matchCount = details?.matchCount ?? 0;
		const fileCount = details?.fileCount ?? 0;
		const mode = details?.mode ?? "files_with_matches";
		const truncated = details?.truncated ?? details?.truncation?.truncated ?? false;
		const files = details?.files ?? [];

		if (matchCount === 0) {
			return new Text(`  ${ui.emptyMessage("No matches found")}`, 0, 0);
		}

		const icon = uiTheme.styledSymbol("status.success", "success");
		const summaryParts =
			mode === "files_with_matches"
				? [ui.count("file", fileCount)]
				: [ui.count("match", matchCount), ui.count("file", fileCount)];
		const summaryText = summaryParts.join(uiTheme.sep.dot);
		const scopeLabel = ui.scope(details?.scopePath);

		const fileEntries: Array<{ path: string; count?: number }> = details?.fileMatches?.length
			? details.fileMatches.map((entry) => ({ path: entry.path, count: entry.count }))
			: files.map((path) => ({ path }));
		const maxFiles = expanded ? fileEntries.length : Math.min(fileEntries.length, COLLAPSED_LIST_LIMIT);
		const hasMoreFiles = fileEntries.length > maxFiles;
		const expandHint = ui.expandHint(expanded, hasMoreFiles);

		let text = `  ${icon} ${uiTheme.fg("dim", summaryText)}${ui.truncationSuffix(truncated)}${scopeLabel}${expandHint}`;

		const truncationReasons: string[] = [];
		if (details?.matchLimitReached) {
			truncationReasons.push(`limit ${details.matchLimitReached} matches`);
		}
		if (details?.headLimitReached) {
			truncationReasons.push(`head limit ${details.headLimitReached}`);
		}
		if (details?.truncation?.truncated) {
			truncationReasons.push("size limit");
		}
		if (details?.linesTruncated) {
			truncationReasons.push("line length");
		}

		const hasTruncation = truncationReasons.length > 0;

		if (fileEntries.length > 0) {
			for (let i = 0; i < maxFiles; i++) {
				const entry = fileEntries[i];
				const isLast = i === maxFiles - 1 && !hasMoreFiles && !hasTruncation;
				const branch = isLast ? uiTheme.tree.last : uiTheme.tree.branch;
				const isDir = entry.path.endsWith("/");
				const entryPath = isDir ? entry.path.slice(0, -1) : entry.path;
				const lang = isDir ? undefined : getLanguageFromPath(entryPath);
				const entryIcon = isDir
					? uiTheme.fg("accent", uiTheme.icon.folder)
					: uiTheme.fg("muted", uiTheme.getLangIcon(lang));
				const countLabel =
					entry.count !== undefined
						? ` ${uiTheme.fg("dim", `(${entry.count} match${entry.count !== 1 ? "es" : ""})`)}`
						: "";
				text += `\n  ${uiTheme.fg("dim", branch)} ${entryIcon} ${uiTheme.fg("accent", entry.path)}${countLabel}`;
			}

			if (hasMoreFiles) {
				const moreFilesBranch = hasTruncation ? uiTheme.tree.branch : uiTheme.tree.last;
				text += `\n  ${uiTheme.fg("dim", moreFilesBranch)} ${uiTheme.fg(
					"muted",
					ui.moreItems(fileEntries.length - maxFiles, "file"),
				)}`;
			}
		}

		if (hasTruncation) {
			text += `\n  ${uiTheme.fg("dim", uiTheme.tree.last)} ${uiTheme.fg("warning", `truncated: ${truncationReasons.join(", ")}`)}`;
		}

		return new Text(text, 0, 0);
	},
};
