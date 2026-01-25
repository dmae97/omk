import path from "node:path";
import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import { StringEnum } from "@oh-my-pi/pi-ai";
import type { Component } from "@oh-my-pi/pi-tui";
import { Text } from "@oh-my-pi/pi-tui";
import { ptree, untilAborted } from "@oh-my-pi/pi-utils";
import type { Static } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";
import { renderPromptTemplate } from "../config/prompt-templates";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import type { Theme } from "../modes/theme/theme";
import findDescription from "../prompts/tools/find.md" with { type: "text" };
import { renderFileList, renderStatusLine, renderTreeList } from "../tui";
import { ensureTool } from "../utils/tools-manager";
import type { ToolSession } from ".";
import { applyListLimit } from "./list-limit";
import type { OutputMeta } from "./output-meta";
import { resolveToCwd } from "./path-utils";
import { formatCount, formatEmptyMessage, formatErrorMessage, PREVIEW_LIMITS } from "./render-utils";
import { ToolAbortError, ToolError, throwIfAborted } from "./tool-errors";
import { toolResult } from "./tool-result";
import { type TruncationResult, truncateHead } from "./truncate";

const findSchema = Type.Object({
	pattern: Type.String({ description: "Glob pattern, e.g. '*.ts', '**/*.json'" }),
	path: Type.Optional(Type.String({ description: "Directory to search (default: cwd)" })),
	limit: Type.Optional(Type.Number({ description: "Max results (default: 1000)" })),
	hidden: Type.Optional(Type.Boolean({ description: "Include hidden files (default: true)" })),
	type: Type.Optional(
		StringEnum(["file", "dir", "all"], {
			description: "Filter: file, dir, or all (default: all)",
		}),
	),
});

const DEFAULT_LIMIT = 1000;
const FD_TIMEOUT_MS = 5000;

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
	/** Find files matching glob pattern. Returns relative paths. */
	glob: (pattern: string, cwd: string, options: { ignore: string[]; limit: number }) => Promise<string[]> | string[];
}

export interface FindToolOptions {
	/** Custom operations for find. Default: local filesystem + fd */
	operations?: FindOperations;
}

export interface FdResult {
	stdout: string;
	stderr: string;
	exitCode: number | null;
}

/**
 * Run fd command and capture output.
 *
 * @throws ToolAbortError if signal is aborted
 */
export async function runFd(fdPath: string, args: string[], signal?: AbortSignal): Promise<FdResult> {
	const child = ptree.cspawn([fdPath, ...args], { signal });

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

export class FindTool implements AgentTool<typeof findSchema, FindToolDetails> {
	public readonly name = "find";
	public readonly label = "Find";
	public readonly description: string;
	public readonly parameters = findSchema;

	private readonly session: ToolSession;
	private readonly customOps?: FindOperations;

	constructor(session: ToolSession, options?: FindToolOptions) {
		this.session = session;
		this.customOps = options?.operations;
		this.description = renderPromptTemplate(findDescription);
	}

	public async execute(
		_toolCallId: string,
		params: Static<typeof findSchema>,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<FindToolDetails>,
		context?: AgentToolContext,
	): Promise<AgentToolResult<FindToolDetails>> {
		const { pattern, path: searchDir, limit, hidden, type } = params;

		return untilAborted(signal, async () => {
			const searchPath = resolveToCwd(searchDir || ".", this.session.cwd);

			if (searchPath === "/") {
				throw new ToolError("Searching from root directory '/' is not allowed");
			}

			const scopePath = (() => {
				const relative = path.relative(this.session.cwd, searchPath).replace(/\\/g, "/");
				return relative.length === 0 ? "." : relative;
			})();
			const effectiveLimit = limit ?? DEFAULT_LIMIT;
			const effectiveType = type ?? "all";
			const includeHidden = hidden ?? true;

			// If custom operations provided with glob, use that instead of fd
			if (this.customOps?.glob) {
				if (!(await this.customOps.exists(searchPath))) {
					throw new ToolError(`Path not found: ${searchPath}`);
				}

				const results = await this.customOps.glob(pattern, searchPath, {
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

			// Default: use fd
			const fdPath = await ensureTool("fd", {
				silent: true,
				notify: message => context?.ui?.notify(message, "info"),
			});
			if (!fdPath) {
				throw new ToolError("fd is not available and could not be downloaded");
			}

			// Build fd arguments
			// When pattern contains path separators (e.g. "reports/**"), use --full-path
			// so fd matches against the full path, not just the filename.
			// Also prepend **/ to anchor the pattern at any depth in the search path.
			// Note: "**/foo.rs" is a glob construct (filename at any depth), not a path.
			// Only patterns with real path components like "foo/bar" or "foo/**/bar" need --full-path.
			const patternWithoutLeadingStarStar = pattern.replace(/^\*\*\//, "");
			const hasPathSeparator =
				patternWithoutLeadingStarStar.includes("/") || patternWithoutLeadingStarStar.includes("\\");
			const effectivePattern = hasPathSeparator && !pattern.startsWith("**/") ? `**/${pattern}` : pattern;
			const args: string[] = [
				"--glob", // Use glob pattern
				...(hasPathSeparator ? ["--full-path"] : []),
				"--color=never", // No ANSI colors
				"--max-results",
				String(effectiveLimit),
			];

			if (includeHidden) {
				args.push("--hidden");
			}

			// Add type filter
			if (effectiveType === "file") {
				args.push("--type", "f");
			} else if (effectiveType === "dir") {
				args.push("--type", "d");
			}

			// Include .gitignore files (root + nested) so fd respects them even outside git repos
			const gitignoreFiles = new Set<string>();
			const rootGitignore = path.join(searchPath, ".gitignore");
			if (await Bun.file(rootGitignore).exists()) {
				gitignoreFiles.add(rootGitignore);
			}

			try {
				const gitignoreArgs = [
					"--hidden",
					"--no-ignore",
					"--type",
					"f",
					"--glob",
					".gitignore",
					"--exclude",
					".git",
					"--exclude",
					"node_modules",
					"--absolute-path",
					searchPath,
				];
				const timeoutSignal = AbortSignal.timeout(FD_TIMEOUT_MS);
				const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
				const { stdout: gitignoreStdout } = await runFd(fdPath, gitignoreArgs, combinedSignal);
				for (const rawLine of gitignoreStdout.split("\n")) {
					const file = rawLine.trim();
					if (!file) continue;
					gitignoreFiles.add(file);
				}
			} catch (err) {
				if (err instanceof ToolAbortError) {
					throw err;
				}
				// Ignore other lookup errors
			}

			for (const gitignorePath of gitignoreFiles) {
				args.push("--ignore-file", gitignorePath);
			}

			// Pattern and path
			args.push(effectivePattern, searchPath);

			// Run fd with timeout
			const mainTimeoutSignal = AbortSignal.timeout(FD_TIMEOUT_MS);
			const mainCombinedSignal = signal ? AbortSignal.any([signal, mainTimeoutSignal]) : mainTimeoutSignal;
			const { stdout, stderr, exitCode } = await runFd(fdPath, args, mainCombinedSignal);
			const output = stdout.trim();

			// fd exit codes: 0 = found files, 1 = no matches, other = error
			// Treat exit code 1 with no output as "no files found"
			if (!output) {
				if (exitCode !== 0 && exitCode !== 1) {
					throw new ToolError(stderr.trim() || `fd failed (exit ${exitCode})`);
				}
				const details: FindToolDetails = { scopePath, fileCount: 0, files: [], truncated: false };
				return toolResult(details).text("No files found matching pattern").done();
			}

			const lines = output.split("\n");
			const relativized: string[] = [];
			const mtimes: number[] = [];

			for (const rawLine of lines) {
				throwIfAborted(signal);
				const line = rawLine.replace(/\r$/, "").trim();
				if (!line) {
					continue;
				}

				const hadTrailingSlash = line.endsWith("/") || line.endsWith("\\");
				let relativePath = line;
				if (line.startsWith(searchPath)) {
					relativePath = line.slice(searchPath.length + 1); // +1 for the /
				} else {
					relativePath = path.relative(searchPath, line);
				}

				if (hadTrailingSlash && !relativePath.endsWith("/")) {
					relativePath += "/";
				}

				// Get mtime for sorting (files that fail to stat get mtime 0)
				try {
					const fullPath = path.join(searchPath, relativePath);
					const stat = await Bun.file(fullPath).stat();
					relativized.push(relativePath);
					mtimes.push(stat.mtimeMs);
				} catch {
					relativized.push(relativePath);
					mtimes.push(0);
				}
			}

			// Sort by mtime (most recent first)
			if (relativized.length > 0) {
				const indexed = relativized.map((path, idx) => ({ path, mtime: mtimes[idx] }));
				indexed.sort((a, b) => b.mtime - a.mtime);
				relativized.length = 0;
				relativized.push(...indexed.map(item => item.path));
			}

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
	path?: string;
	type?: string;
	hidden?: boolean;
	sortByMtime?: boolean;
	limit?: number;
}

const COLLAPSED_LIST_LIMIT = PREVIEW_LIMITS.COLLAPSED_ITEMS;

export const findToolRenderer = {
	inline: true,
	renderCall(args: FindRenderArgs, uiTheme: Theme): Component {
		const meta: string[] = [];
		if (args.path) meta.push(`in ${args.path}`);
		if (args.type && args.type !== "all") meta.push(`type:${args.type}`);
		if (args.hidden) meta.push("hidden");
		if (args.sortByMtime) meta.push("sort:mtime");
		if (args.limit !== undefined) meta.push(`limit:${args.limit}`);

		const text = renderStatusLine(
			{ icon: "pending", title: "Find", description: args.pattern || "*", meta },
			uiTheme,
		);
		return new Text(text, 0, 0);
	},

	renderResult(
		result: { content: Array<{ type: string; text?: string }>; details?: FindToolDetails; isError?: boolean },
		{ expanded }: RenderResultOptions,
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
			return new Text([header, ...listLines].join("\n"), 0, 0);
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

		const fileLines = renderFileList(
			{
				files: files.map(entry => ({ path: entry, isDirectory: entry.endsWith("/") })),
				expanded,
				maxCollapsed: COLLAPSED_LIST_LIMIT,
			},
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

		return new Text([header, ...fileLines, ...extraLines].join("\n"), 0, 0);
	},
	mergeCallAndResult: true,
};
