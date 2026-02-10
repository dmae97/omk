import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import { FileType, type GlobMatch, glob } from "@oh-my-pi/pi-natives";
import type { Component } from "@oh-my-pi/pi-tui";
import { Text } from "@oh-my-pi/pi-tui";
import { isEnoent, untilAborted } from "@oh-my-pi/pi-utils";
import type { Static } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";
import { renderPromptTemplate } from "../config/prompt-templates";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import type { Theme } from "../modes/theme/theme";
import findDescription from "../prompts/tools/find.md" with { type: "text" };
import {
	Ellipsis,
	Hasher,
	type RenderCache,
	renderFileList,
	renderStatusLine,
	renderTreeList,
	truncateToWidth,
} from "../tui";
import type { ToolSession } from ".";
import { applyListLimit } from "./list-limit";
import type { OutputMeta } from "./output-meta";
import { resolveToCwd } from "./path-utils";
import { formatCount, formatEmptyMessage, formatErrorMessage, PREVIEW_LIMITS } from "./render-utils";
import { ToolAbortError, ToolError, throwIfAborted } from "./tool-errors";
import { toolResult } from "./tool-result";
import { type TruncationResult, truncateHead } from "./truncate";

const findSchema = Type.Object({
	pattern: Type.String({ description: "Glob pattern, e.g. '*.ts', 'src/**/*.json', 'lib/*.tsx'" }),
	hidden: Type.Optional(Type.Boolean({ description: "Include hidden files and directories (default: true)" })),
	limit: Type.Optional(Type.Number({ description: "Max results (default: 1000)" })),
});

export type FindToolInput = Static<typeof findSchema>;

const DEFAULT_LIMIT = 1000;
const GLOB_TIMEOUT_MS = 5000;

/**
 * Parse a pattern to extract the base directory path and glob pattern.
 * Examples:
 *   "src/app/**\/*.tsx" → { basePath: "src/app", globPattern: "**\/*.tsx" }
 *   "src/app/*.tsx" → { basePath: "src/app", globPattern: "*.tsx" }
 *   "*.ts" → { basePath: ".", globPattern: "**\/*.ts" }
 *   "**\/*.json" → { basePath: ".", globPattern: "**\/*.json" }
 *   "/abs/path/**\/*.ts" → { basePath: "/abs/path", globPattern: "**\/*.ts" }
 */
function parsePatternPath(pattern: string): { basePath: string; globPattern: string } {
	// Find the first segment containing glob characters
	const segments = pattern.split("/");
	const globChars = ["*", "?", "[", "{"];

	let firstGlobIndex = -1;
	for (let i = 0; i < segments.length; i++) {
		if (globChars.some(c => segments[i].includes(c))) {
			firstGlobIndex = i;
			break;
		}
	}

	// No glob characters found - treat as literal path with implicit **/*
	if (firstGlobIndex === -1) {
		// Pattern is a directory path like "src/app" - search recursively in it
		return { basePath: pattern, globPattern: "**/*" };
	}

	// Glob starts at first segment - no base path
	if (firstGlobIndex === 0) {
		// Simple pattern like "*.ts" needs **/ prefix for recursive search
		const needsRecursive = !pattern.startsWith("**/");
		return {
			basePath: ".",
			globPattern: needsRecursive ? `**/${pattern}` : pattern,
		};
	}

	// Split at the glob boundary
	const basePath = segments.slice(0, firstGlobIndex).join("/");
	const globPattern = segments.slice(firstGlobIndex).join("/");

	return { basePath, globPattern };
}

function hasGlobChars(pattern: string): boolean {
	const globChars = ["*", "?", "[", "{"];
	return globChars.some(char => pattern.includes(char));
}

export interface FindToolDetails {
	truncation?: TruncationResult;
	resultLimitReached?: number;
	meta?: OutputMeta;
	// Fields for TUI rendering
	scopePath?: string;
	fileCount?: number;
	files?: string[];
	truncated?: boolean;
	error?: string;
}

/**
 * Pluggable operations for the find tool.
 * Override these to delegate file search to remote systems (e.g., SSH).
 */
export interface FindOperations {
	/** Check if path exists */
	exists: (absolutePath: string) => Promise<boolean> | boolean;
	/** Optional stat for distinguishing files vs directories. */
	stat?: (
		absolutePath: string,
	) => Promise<{ isFile(): boolean; isDirectory(): boolean }> | { isFile(): boolean; isDirectory(): boolean };
	/** Find files matching glob pattern. Returns relative paths. */
	glob: (pattern: string, cwd: string, options: { ignore: string[]; limit: number }) => Promise<string[]> | string[];
}

export interface FindToolOptions {
	/** Custom operations for find. Default: local filesystem + rg */
	operations?: FindOperations;
}

export class FindTool implements AgentTool<typeof findSchema, FindToolDetails> {
	readonly name = "find";
	readonly label = "Find";
	readonly description: string;
	readonly parameters = findSchema;

	readonly #customOps?: FindOperations;

	constructor(
		private readonly session: ToolSession,
		options?: FindToolOptions,
	) {
		this.#customOps = options?.operations;
		this.description = renderPromptTemplate(findDescription);
	}

	async execute(
		_toolCallId: string,
		params: Static<typeof findSchema>,
		signal?: AbortSignal,
		onUpdate?: AgentToolUpdateCallback<FindToolDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<FindToolDetails>> {
		const { pattern, limit, hidden } = params;

		return untilAborted(signal, async () => {
			// Parse pattern to extract base directory and glob pattern
			// e.g., "src/app/**/*.tsx" → basePath: "src/app", globPattern: "**/*.tsx"
			// e.g., "*.ts" → basePath: ".", globPattern: "**/*.ts"
			const normalizedPattern = pattern.trim().replace(/\\/g, "/");
			if (!normalizedPattern) {
				throw new ToolError("Pattern must not be empty");
			}

			const hasGlob = hasGlobChars(normalizedPattern);
			const { basePath, globPattern } = parsePatternPath(normalizedPattern);
			const searchPath = resolveToCwd(basePath, this.session.cwd);

			if (searchPath === "/") {
				throw new ToolError("Searching from root directory '/' is not allowed");
			}

			const scopePath = (() => {
				const relative = path.relative(this.session.cwd, searchPath).replace(/\\/g, "/");
				return relative.length === 0 ? "." : relative;
			})();

			const rawLimit = limit ?? DEFAULT_LIMIT;
			const effectiveLimit = Number.isFinite(rawLimit) ? Math.floor(rawLimit) : Number.NaN;
			if (!Number.isFinite(effectiveLimit) || effectiveLimit <= 0) {
				throw new ToolError("Limit must be a positive number");
			}
			const includeHidden = hidden ?? true;

			// If custom operations provided with glob, use that instead of fd
			if (this.#customOps?.glob) {
				if (!(await this.#customOps.exists(searchPath))) {
					throw new ToolError(`Path not found: ${searchPath}`);
				}

				if (!hasGlob && this.#customOps.stat) {
					const stat = await this.#customOps.stat(searchPath);
					if (stat.isFile()) {
						const files = [scopePath];
						const details: FindToolDetails = {
							scopePath,
							fileCount: 1,
							files,
							truncated: false,
						};
						return toolResult(details).text(files.join("\n")).done();
					}
				}

				const results = await this.#customOps.glob(globPattern, searchPath, {
					ignore: ["**/node_modules/**", "**/.git/**"],
					limit: effectiveLimit,
				});

				if (results.length === 0) {
					const details: FindToolDetails = { scopePath, fileCount: 0, files: [], truncated: false };
					return toolResult(details).text("No files found matching pattern").done();
				}

				// Relativize paths
				const relativized = results.map(p => {
					if (p.startsWith(searchPath)) {
						return p.slice(searchPath.length + 1);
					}
					return path.relative(searchPath, p);
				});

				const listLimit = applyListLimit(relativized, { limit: effectiveLimit });
				const limited = listLimit.items;
				const limitMeta = listLimit.meta;
				const rawOutput = limited.join("\n");
				const truncation = truncateHead(rawOutput, { maxLines: Number.MAX_SAFE_INTEGER });

				const details: FindToolDetails = {
					scopePath,
					fileCount: limited.length,
					files: limited,
					truncated: Boolean(limitMeta.resultLimit || truncation.truncated),
					resultLimitReached: limitMeta.resultLimit?.reached,
					truncation: truncation.truncated ? truncation : undefined,
				};

				const resultBuilder = toolResult(details)
					.text(truncation.content)
					.limits({ resultLimit: limitMeta.resultLimit?.reached });
				if (truncation.truncated) {
					resultBuilder.truncation(truncation, { direction: "head" });
				}

				return resultBuilder.done();
			}

			let searchStat: fs.Stats;
			try {
				searchStat = await fs.promises.stat(searchPath);
			} catch (err) {
				if (isEnoent(err)) {
					throw new ToolError(`Path not found: ${searchPath}`);
				}
				throw err;
			}

			if (!hasGlob && searchStat.isFile()) {
				const files = [scopePath];
				const details: FindToolDetails = {
					scopePath,
					fileCount: 1,
					files,
					truncated: false,
				};
				return toolResult(details).text(files.join("\n")).done();
			}
			if (!searchStat.isDirectory()) {
				throw new ToolError(`Path is not a directory: ${searchPath}`);
			}

			let matches: GlobMatch[];
			const onUpdateMatches: string[] = [];
			const updateIntervalMs = 200;
			let lastUpdate = 0;
			const emitUpdate = () => {
				if (!onUpdate) return;
				const now = Date.now();
				if (now - lastUpdate < updateIntervalMs) return;
				lastUpdate = now;
				const details: FindToolDetails = {
					scopePath,
					fileCount: onUpdateMatches.length,
					files: onUpdateMatches.slice(),
					truncated: false,
				};
				onUpdate({
					content: [{ type: "text", text: onUpdateMatches.join("\n") }],
					details,
				});
			};
			const onMatch = onUpdate
				? (match: GlobMatch | null) => {
						if (signal?.aborted || !match) return;
						let relativePath = match.path;
						if (!relativePath) return;
						if (match.fileType === FileType.Dir && !relativePath.endsWith("/")) {
							relativePath += "/";
						}
						onUpdateMatches.push(relativePath);
						emitUpdate();
					}
				: undefined;
			const timeoutSignal = AbortSignal.timeout(GLOB_TIMEOUT_MS);
			const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

			const doGlob = async (useGitignore: boolean) =>
				untilAborted(combinedSignal, () =>
					glob(
						{
							pattern: globPattern,
							path: searchPath,
							fileType: FileType.File,
							hidden: includeHidden,
							maxResults: effectiveLimit,
							sortByMtime: true,
							gitignore: useGitignore,
						},
						onMatch,
					),
				);

			try {
				let result = await doGlob(true);
				// If gitignore filtering yielded nothing, retry without it
				if (result.matches.length === 0) {
					result = await doGlob(false);
				}
				matches = result.matches;
			} catch (error) {
				if (error instanceof Error && error.name === "AbortError") {
					if (timeoutSignal.aborted && !signal?.aborted) {
						const timeoutSeconds = Math.max(1, Math.round(GLOB_TIMEOUT_MS / 1000));
						throw new ToolError(`find timed out after ${timeoutSeconds}s`);
					}
					throw new ToolAbortError();
				}
				throw error;
			}

			if (matches.length === 0) {
				const details: FindToolDetails = { scopePath, fileCount: 0, files: [], truncated: false };
				return toolResult(details).text("No files found matching pattern").done();
			}
			const relativized: string[] = [];

			for (const match of matches) {
				throwIfAborted(signal);
				const line = match.path;
				if (!line) {
					continue;
				}

				const hadTrailingSlash = line.endsWith("/") || line.endsWith("\\");
				let relativePath = line;

				const isDirectory = match.fileType === FileType.Dir;

				if ((isDirectory || hadTrailingSlash) && !relativePath.endsWith("/")) {
					relativePath += "/";
				}

				relativized.push(relativePath);
			}

			if (relativized.length === 0) {
				const details: FindToolDetails = { scopePath, fileCount: 0, files: [], truncated: false };
				return toolResult(details).text("No files found matching pattern").done();
			}

			// Results are already sorted by mtime from native (sortByMtime: true)

			const listLimit = applyListLimit(relativized, { limit: effectiveLimit });
			const limited = listLimit.items;
			const limitMeta = listLimit.meta;

			// Apply byte truncation (no line limit since we already have result limit)
			const rawOutput = limited.join("\n");
			const truncation = truncateHead(rawOutput, { maxLines: Number.MAX_SAFE_INTEGER });

			const resultOutput = truncation.content;
			const details: FindToolDetails = {
				scopePath,
				fileCount: limited.length,
				files: limited,
				truncated: Boolean(limitMeta.resultLimit || truncation.truncated),
				resultLimitReached: limitMeta.resultLimit?.reached,
				truncation: truncation.truncated ? truncation : undefined,
			};

			const resultBuilder = toolResult(details)
				.text(resultOutput)
				.limits({ resultLimit: limitMeta.resultLimit?.reached });
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

interface FindRenderArgs {
	pattern: string;
	limit?: number;
}

const COLLAPSED_LIST_LIMIT = PREVIEW_LIMITS.COLLAPSED_ITEMS;

export const findToolRenderer = {
	inline: true,
	renderCall(args: FindRenderArgs, uiTheme: Theme): Component {
		const meta: string[] = [];
		if (args.limit !== undefined) meta.push(`limit:${args.limit}`);

		const text = renderStatusLine(
			{ icon: "pending", title: "Find", description: args.pattern || "*", meta },
			uiTheme,
		);
		return new Text(text, 0, 0);
	},

	renderResult(
		result: { content: Array<{ type: string; text?: string }>; details?: FindToolDetails; isError?: boolean },
		options: RenderResultOptions,
		uiTheme: Theme,
		args?: FindRenderArgs,
	): Component {
		const details = result.details;

		if (result.isError || details?.error) {
			const errorText = details?.error || result.content?.find(c => c.type === "text")?.text || "Unknown error";
			return new Text(formatErrorMessage(errorText, uiTheme), 0, 0);
		}

		const hasDetailedData = details?.fileCount !== undefined;
		const textContent = result.content?.find(c => c.type === "text")?.text;

		if (!hasDetailedData) {
			if (
				!textContent ||
				textContent.includes("No files matching") ||
				textContent.includes("No files found") ||
				textContent.trim() === ""
			) {
				return new Text(formatEmptyMessage("No files found", uiTheme), 0, 0);
			}

			const lines = textContent.split("\n").filter(l => l.trim());
			const header = renderStatusLine(
				{
					icon: "success",
					title: "Find",
					description: args?.pattern,
					meta: [formatCount("file", lines.length)],
				},
				uiTheme,
			);
			let cached: RenderCache | undefined;
			return {
				render(width: number): string[] {
					const { expanded } = options;
					const key = new Hasher().bool(expanded).u32(width).digest();
					if (cached?.key === key) return cached.lines;
					const listLines = renderTreeList(
						{
							items: lines,
							expanded,
							maxCollapsed: COLLAPSED_LIST_LIMIT,
							itemType: "file",
							renderItem: line => uiTheme.fg("accent", line),
						},
						uiTheme,
					);
					const result = [header, ...listLines].map(l => truncateToWidth(l, width, Ellipsis.Omit));
					cached = { key, lines: result };
					return result;
				},
				invalidate() {
					cached = undefined;
				},
			};
		}

		const fileCount = details?.fileCount ?? 0;
		const truncation = details?.truncation ?? details?.meta?.truncation;
		const limits = details?.meta?.limits;
		const truncated = Boolean(details?.truncated || truncation || details?.resultLimitReached || limits?.resultLimit);
		const files = details?.files ?? [];

		if (fileCount === 0) {
			const header = renderStatusLine(
				{ icon: "warning", title: "Find", description: args?.pattern, meta: ["0 files"] },
				uiTheme,
			);
			return new Text([header, formatEmptyMessage("No files found", uiTheme)].join("\n"), 0, 0);
		}
		const meta: string[] = [formatCount("file", fileCount)];
		if (details?.scopePath) meta.push(`in ${details.scopePath}`);
		if (truncated) meta.push(uiTheme.fg("warning", "truncated"));
		const header = renderStatusLine(
			{ icon: truncated ? "warning" : "success", title: "Find", description: args?.pattern, meta },
			uiTheme,
		);

		const truncationReasons: string[] = [];
		if (details?.resultLimitReached) truncationReasons.push(`limit ${details.resultLimitReached} results`);
		if (limits?.resultLimit) truncationReasons.push(`limit ${limits.resultLimit.reached} results`);
		if (truncation) truncationReasons.push(truncation.truncatedBy === "lines" ? "line limit" : "size limit");
		const artifactId = truncation && "artifactId" in truncation ? truncation.artifactId : undefined;
		if (artifactId) truncationReasons.push(`full output: artifact://${artifactId}`);

		const extraLines: string[] = [];
		if (truncationReasons.length > 0) {
			extraLines.push(uiTheme.fg("warning", `truncated: ${truncationReasons.join(", ")}`));
		}

		let cached: RenderCache | undefined;
		return {
			render(width: number): string[] {
				const { expanded } = options;
				const key = new Hasher().bool(expanded).u32(width).digest();
				if (cached?.key === key) return cached.lines;
				const fileLines = renderFileList(
					{
						files: files.map(entry => ({ path: entry, isDirectory: entry.endsWith("/") })),
						expanded,
						maxCollapsed: COLLAPSED_LIST_LIMIT,
					},
					uiTheme,
				);
				const result = [header, ...fileLines, ...extraLines].map(l => truncateToWidth(l, width, Ellipsis.Omit));
				cached = { key, lines: result };
				return result;
			},
			invalidate() {
				cached = undefined;
			},
		};
	},
	mergeCallAndResult: true,
};
