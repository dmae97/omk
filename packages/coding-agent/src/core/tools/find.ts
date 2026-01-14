import path from "node:path";
import type { AgentTool } from "@oh-my-pi/pi-agent-core";
import { StringEnum } from "@oh-my-pi/pi-ai";
import type { Component } from "@oh-my-pi/pi-tui";
import { Text } from "@oh-my-pi/pi-tui";
import { Type } from "@sinclair/typebox";
import { getLanguageFromPath, type Theme } from "../../modes/interactive/theme/theme";
import findDescription from "../../prompts/tools/find.md" with { type: "text" };
import { ensureTool } from "../../utils/tools-manager";
import type { RenderResultOptions } from "../custom-tools/types";
import { renderPromptTemplate } from "../prompt-templates";
import { ScopeSignal, untilAborted } from "../utils";
import type { ToolSession } from "./index";
import { resolveToCwd } from "./path-utils";
import { createToolUIKit, PREVIEW_LIMITS } from "./render-utils";
import { DEFAULT_MAX_BYTES, formatSize, type TruncationResult, truncateHead } from "./truncate";

const findSchema = Type.Object({
	pattern: Type.String({
		description: "Glob pattern to match files, e.g. '*.ts', '**/*.json', or 'src/**/*.spec.ts'",
	}),
	path: Type.Optional(Type.String({ description: "Directory to search in (default: current directory)" })),
	limit: Type.Optional(Type.Number({ description: "Maximum number of results (default: 1000)" })),
	hidden: Type.Optional(Type.Boolean({ description: "Include hidden files (default: true)" })),
	sortByMtime: Type.Optional(
		Type.Boolean({ description: "Sort results by modification time, most recent first (default: false)" }),
	),
	type: Type.Optional(
		StringEnum(["file", "dir", "all"], {
			description:
				"Filter by type: 'file' for files only, 'dir' for directories only, 'all' for both (default: 'all')",
		}),
	),
});

const DEFAULT_LIMIT = 1000;

export interface FindToolDetails {
	truncation?: TruncationResult;
	resultLimitReached?: number;
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

async function captureCommandOutput(
	command: string,
	args: string[],
	signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string; exitCode: number | null; aborted: boolean }> {
	const child = Bun.spawn([command, ...args], {
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});

	using scope = new ScopeSignal(signal ? { signal } : undefined);
	scope.catch(() => {
		child.kill();
	});

	const stdoutReader = (child.stdout as ReadableStream<Uint8Array>).getReader();
	const stderrReader = (child.stderr as ReadableStream<Uint8Array>).getReader();
	const stdoutDecoder = new TextDecoder();
	const stderrDecoder = new TextDecoder();
	let stdout = "";
	let stderr = "";

	await Promise.all([
		(async () => {
			while (true) {
				const { done, value } = await stdoutReader.read();
				if (done) break;
				stdout += stdoutDecoder.decode(value, { stream: true });
			}
			stdout += stdoutDecoder.decode();
		})(),
		(async () => {
			while (true) {
				const { done, value } = await stderrReader.read();
				if (done) break;
				stderr += stderrDecoder.decode(value, { stream: true });
			}
			stderr += stderrDecoder.decode();
		})(),
	]);

	const exitCode = await child.exited;

	return { stdout, stderr, exitCode, aborted: scope.aborted };
}

export function createFindTool(session: ToolSession, options?: FindToolOptions): AgentTool<typeof findSchema> {
	const customOps = options?.operations;

	return {
		name: "find",
		label: "Find",
		description: renderPromptTemplate(findDescription),
		parameters: findSchema,
		execute: async (
			_toolCallId: string,
			{
				pattern,
				path: searchDir,
				limit,
				hidden,
				sortByMtime,
				type,
			}: {
				pattern: string;
				path?: string;
				limit?: number;
				hidden?: boolean;
				sortByMtime?: boolean;
				type?: "file" | "dir" | "all";
			},
			signal?: AbortSignal,
		) => {
			return untilAborted(signal, async () => {
				const searchPath = resolveToCwd(searchDir || ".", session.cwd);
				const scopePath = (() => {
					const relative = path.relative(session.cwd, searchPath).replace(/\\/g, "/");
					return relative.length === 0 ? "." : relative;
				})();
				const effectiveLimit = limit ?? DEFAULT_LIMIT;
				const effectiveType = type ?? "all";
				const includeHidden = hidden ?? true;
				const shouldSortByMtime = sortByMtime ?? false;

				// If custom operations provided with glob, use that instead of fd
				if (customOps?.glob) {
					if (!(await customOps.exists(searchPath))) {
						throw new Error(`Path not found: ${searchPath}`);
					}

					const results = await customOps.glob(pattern, searchPath, {
						ignore: ["**/node_modules/**", "**/.git/**"],
						limit: effectiveLimit,
					});

					if (results.length === 0) {
						return {
							content: [{ type: "text", text: "No files found matching pattern" }],
							details: { scopePath, fileCount: 0, files: [], truncated: false },
						};
					}

					// Relativize paths
					const relativized = results.map((p) => {
						if (p.startsWith(searchPath)) {
							return p.slice(searchPath.length + 1);
						}
						return path.relative(searchPath, p);
					});

					const resultLimitReached = relativized.length >= effectiveLimit;
					const rawOutput = relativized.join("\n");
					const truncation = truncateHead(rawOutput, { maxLines: Number.MAX_SAFE_INTEGER });

					let resultOutput = truncation.content;
					const details: FindToolDetails = {
						scopePath,
						fileCount: relativized.length,
						files: relativized,
						truncated: resultLimitReached || truncation.truncated,
					};
					const notices: string[] = [];

					if (resultLimitReached) {
						notices.push(
							`${effectiveLimit} results limit reached. Use limit=${effectiveLimit * 2} for more, or refine pattern`,
						);
						details.resultLimitReached = effectiveLimit;
					}

					if (truncation.truncated) {
						notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
						details.truncation = truncation;
					}

					if (notices.length > 0) {
						resultOutput += `\n\n[${notices.join(". ")}]`;
					}

					return {
						content: [{ type: "text", text: resultOutput }],
						details: Object.keys(details).length > 0 ? details : undefined,
					};
				}

				// Default: use fd
				const fdPath = await ensureTool("fd", true);
				if (!fdPath) {
					throw new Error("fd is not available and could not be downloaded");
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
						"--name",
						".gitignore",
						"--exclude",
						".git",
						"--exclude",
						"node_modules",
						"--absolute-path",
						searchPath,
					];
					const { stdout: gitignoreStdout, aborted: gitignoreAborted } = await captureCommandOutput(
						fdPath,
						gitignoreArgs,
						signal,
					);
					if (gitignoreAborted) {
						throw new Error("Operation aborted");
					}
					for (const rawLine of gitignoreStdout.split("\n")) {
						const file = rawLine.trim();
						if (!file) continue;
						gitignoreFiles.add(file);
					}
				} catch (err) {
					if (signal?.aborted) {
						throw err instanceof Error ? err : new Error("Operation aborted");
					}
					// Ignore lookup errors
				}

				for (const gitignorePath of gitignoreFiles) {
					args.push("--ignore-file", gitignorePath);
				}

				// Pattern and path
				args.push(effectivePattern, searchPath);

				// Run fd
				const { stdout, stderr, exitCode, aborted } = await captureCommandOutput(fdPath, args, signal);

				if (aborted) {
					throw new Error("Operation aborted");
				}

				const output = stdout.trim();

				if (exitCode !== 0) {
					const errorMsg = stderr.trim() || `fd exited with code ${exitCode ?? -1}`;
					// fd returns non-zero for some errors but may still have partial output
					if (!output) {
						throw new Error(errorMsg);
					}
				}

				if (!output) {
					return {
						content: [{ type: "text", text: "No files found matching pattern" }],
						details: { scopePath, fileCount: 0, files: [], truncated: false },
					};
				}

				const lines = output.split("\n");
				const relativized: string[] = [];
				const mtimes: number[] = [];

				for (const rawLine of lines) {
					signal?.throwIfAborted();
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

					// When sorting by mtime, keep files that fail to stat with mtime 0
					if (shouldSortByMtime) {
						try {
							const fullPath = path.join(searchPath, relativePath);
							const stat = await Bun.file(fullPath).stat();
							relativized.push(relativePath);
							mtimes.push(stat.mtimeMs);
						} catch {
							relativized.push(relativePath);
							mtimes.push(0);
						}
					} else {
						relativized.push(relativePath);
					}
				}

				// Sort by mtime if requested (most recent first)
				if (shouldSortByMtime && relativized.length > 0) {
					const indexed = relativized.map((path, idx) => ({ path, mtime: mtimes[idx] }));
					indexed.sort((a, b) => b.mtime - a.mtime);
					relativized.length = 0;
					relativized.push(...indexed.map((item) => item.path));
				}

				// Check if we hit the result limit
				const resultLimitReached = relativized.length >= effectiveLimit;

				// Apply byte truncation (no line limit since we already have result limit)
				const rawOutput = relativized.join("\n");
				const truncation = truncateHead(rawOutput, { maxLines: Number.MAX_SAFE_INTEGER });

				let resultOutput = truncation.content;
				const details: FindToolDetails = {
					scopePath,
					fileCount: relativized.length,
					files: relativized,
					truncated: resultLimitReached || truncation.truncated,
				};

				// Build notices
				const notices: string[] = [];

				if (resultLimitReached) {
					notices.push(
						`${effectiveLimit} results limit reached. Use limit=${effectiveLimit * 2} for more, or refine pattern`,
					);
					details.resultLimitReached = effectiveLimit;
				}

				if (truncation.truncated) {
					notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
					details.truncation = truncation;
				}

				if (notices.length > 0) {
					resultOutput += `\n\n[${notices.join(". ")}]`;
				}

				return {
					content: [{ type: "text", text: resultOutput }],
					details: Object.keys(details).length > 0 ? details : undefined,
				};
			});
		},
	};
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
		const ui = createToolUIKit(uiTheme);
		const label = ui.title("Find");
		let text = `${uiTheme.format.bullet} ${label} ${uiTheme.fg("accent", args.pattern || "*")}`;

		const meta: string[] = [];
		if (args.path) meta.push(`in ${args.path}`);
		if (args.type && args.type !== "all") meta.push(`type:${args.type}`);
		if (args.hidden) meta.push("hidden");
		if (args.sortByMtime) meta.push("sort:mtime");
		if (args.limit !== undefined) meta.push(`limit:${args.limit}`);

		text += ui.meta(meta);

		return new Text(text, 0, 0);
	},

	renderResult(
		result: { content: Array<{ type: string; text?: string }>; details?: FindToolDetails; isError?: boolean },
		{ expanded }: RenderResultOptions,
		uiTheme: Theme,
	): Component {
		const ui = createToolUIKit(uiTheme);
		const details = result.details;

		if (result.isError || details?.error) {
			const errorText = details?.error || result.content?.find((c) => c.type === "text")?.text || "Unknown error";
			return new Text(`  ${ui.errorMessage(errorText)}`, 0, 0);
		}

		const hasDetailedData = details?.fileCount !== undefined;
		const textContent = result.content?.find((c) => c.type === "text")?.text;

		if (!hasDetailedData) {
			if (!textContent || textContent.includes("No files matching") || textContent.trim() === "") {
				return new Text(`  ${ui.emptyMessage("No files found")}`, 0, 0);
			}

			const lines = textContent.split("\n").filter((l) => l.trim());
			const maxLines = expanded ? lines.length : Math.min(lines.length, COLLAPSED_LIST_LIMIT);
			const displayLines = lines.slice(0, maxLines);
			const remaining = lines.length - maxLines;
			const hasMore = remaining > 0;

			const icon = uiTheme.styledSymbol("status.success", "success");
			const summary = ui.count("file", lines.length);
			const expandHint = ui.expandHint(expanded, hasMore);
			let text = `  ${icon} ${uiTheme.fg("dim", summary)}${expandHint}`;

			for (let i = 0; i < displayLines.length; i++) {
				const isLast = i === displayLines.length - 1 && remaining === 0;
				const branch = isLast ? uiTheme.tree.last : uiTheme.tree.branch;
				text += `\n  ${uiTheme.fg("dim", branch)} ${uiTheme.fg("accent", displayLines[i])}`;
			}
			if (remaining > 0) {
				text += `\n  ${uiTheme.fg("dim", uiTheme.tree.last)} ${uiTheme.fg("muted", ui.moreItems(remaining, "file"))}`;
			}
			return new Text(text, 0, 0);
		}

		const fileCount = details?.fileCount ?? 0;
		const truncated = details?.truncated ?? details?.truncation?.truncated ?? false;
		const files = details?.files ?? [];

		if (fileCount === 0) {
			return new Text(`  ${ui.emptyMessage("No files found")}`, 0, 0);
		}

		const icon = uiTheme.styledSymbol("status.success", "success");
		const summaryText = ui.count("file", fileCount);
		const scopeLabel = ui.scope(details?.scopePath);
		const maxFiles = expanded ? files.length : Math.min(files.length, COLLAPSED_LIST_LIMIT);
		const hasMoreFiles = files.length > maxFiles;
		const expandHint = ui.expandHint(expanded, hasMoreFiles);

		let text = `  ${icon} ${uiTheme.fg("dim", summaryText)}${ui.truncationSuffix(truncated)}${scopeLabel}${expandHint}`;

		const truncationReasons: string[] = [];
		if (details?.resultLimitReached) {
			truncationReasons.push(`limit ${details.resultLimitReached} results`);
		}
		if (details?.truncation?.truncated) {
			truncationReasons.push("size limit");
		}

		const hasTruncation = truncationReasons.length > 0;

		if (files.length > 0) {
			for (let i = 0; i < maxFiles; i++) {
				const isLast = i === maxFiles - 1 && !hasMoreFiles && !hasTruncation;
				const branch = isLast ? uiTheme.tree.last : uiTheme.tree.branch;
				const entry = files[i];
				const isDir = entry.endsWith("/");
				const entryPath = isDir ? entry.slice(0, -1) : entry;
				const lang = isDir ? undefined : getLanguageFromPath(entryPath);
				const entryIcon = isDir
					? uiTheme.fg("accent", uiTheme.icon.folder)
					: uiTheme.fg("muted", uiTheme.getLangIcon(lang));
				text += `\n  ${uiTheme.fg("dim", branch)} ${entryIcon} ${uiTheme.fg("accent", entry)}`;
			}

			if (hasMoreFiles) {
				const moreFilesBranch = hasTruncation ? uiTheme.tree.branch : uiTheme.tree.last;
				text += `\n  ${uiTheme.fg("dim", moreFilesBranch)} ${uiTheme.fg(
					"muted",
					ui.moreItems(files.length - maxFiles, "file"),
				)}`;
			}
		}

		if (hasTruncation) {
			text += `\n  ${uiTheme.fg("dim", uiTheme.tree.last)} ${uiTheme.fg("warning", `truncated: ${truncationReasons.join(", ")}`)}`;
		}

		return new Text(text, 0, 0);
	},
};
