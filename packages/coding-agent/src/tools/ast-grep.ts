import * as path from "node:path";
import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import { type AstFindMatch, astGrep } from "@oh-my-pi/pi-natives";
import type { Component } from "@oh-my-pi/pi-tui";
import { Text } from "@oh-my-pi/pi-tui";
import { untilAborted } from "@oh-my-pi/pi-utils";
import { type Static, Type } from "@sinclair/typebox";
import { renderPromptTemplate } from "../config/prompt-templates";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import type { Theme } from "../modes/theme/theme";
import { computeLineHash } from "../patch/hashline";
import astGrepDescription from "../prompts/tools/ast-grep.md" with { type: "text" };
import { Ellipsis, Hasher, type RenderCache, renderStatusLine, renderTreeList, truncateToWidth } from "../tui";
import { resolveFileDisplayMode } from "../utils/file-display-mode";
import type { ToolSession } from ".";
import type { OutputMeta } from "./output-meta";
import { hasGlobPathChars, parseSearchPath, resolveToCwd } from "./path-utils";
import { formatCount, formatEmptyMessage, formatErrorMessage, PREVIEW_LIMITS } from "./render-utils";
import { ToolError } from "./tool-errors";
import { toolResult } from "./tool-result";

const astGrepSchema = Type.Object({
	patterns: Type.Array(Type.String(), { minItems: 1, description: "AST patterns to match" }),
	lang: Type.Optional(Type.String({ description: "Language override" })),
	path: Type.Optional(Type.String({ description: "File, directory, or glob pattern to search (default: cwd)" })),
	selector: Type.Optional(Type.String({ description: "Optional selector for contextual pattern mode" })),
	limit: Type.Optional(Type.Number({ description: "Max matches (default: 50)" })),
	offset: Type.Optional(Type.Number({ description: "Skip first N matches (default: 0)" })),
	context: Type.Optional(Type.Number({ description: "Context lines around each match" })),
	include_meta: Type.Optional(Type.Boolean({ description: "Include metavariable captures" })),
});

export interface AstGrepToolDetails {
	matchCount: number;
	fileCount: number;
	filesSearched: number;
	limitReached: boolean;
	parseErrors?: string[];
	scopePath?: string;
	files?: string[];
	fileMatches?: Array<{ path: string; count: number }>;
	meta?: OutputMeta;
}

export class AstGrepTool implements AgentTool<typeof astGrepSchema, AstGrepToolDetails> {
	readonly name = "ast_grep";
	readonly label = "AST Grep";
	readonly description: string;
	readonly parameters = astGrepSchema;
	readonly strict = true;

	constructor(private readonly session: ToolSession) {
		this.description = renderPromptTemplate(astGrepDescription);
	}

	async execute(
		_toolCallId: string,
		params: Static<typeof astGrepSchema>,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<AstGrepToolDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<AstGrepToolDetails>> {
		return untilAborted(signal, async () => {
			const patterns = [
				...new Set(params.patterns.map(pattern => pattern.trim()).filter(pattern => pattern.length > 0)),
			];
			if (patterns.length === 0) {
				throw new ToolError("`patterns` must include at least one non-empty pattern");
			}
			const limit = params.limit === undefined ? 50 : Math.floor(params.limit);
			if (!Number.isFinite(limit) || limit < 1) {
				throw new ToolError("Limit must be a positive number");
			}
			const offset = params.offset === undefined ? 0 : Math.floor(params.offset);
			if (!Number.isFinite(offset) || offset < 0) {
				throw new ToolError("Offset must be a non-negative number");
			}
			const context = params.context === undefined ? undefined : Math.floor(params.context);
			if (context !== undefined && (!Number.isFinite(context) || context < 0)) {
				throw new ToolError("Context must be a non-negative number");
			}

			let searchPath: string | undefined;
			let globFilter: string | undefined;
			const rawPath = params.path?.trim();
			if (rawPath) {
				const internalRouter = this.session.internalRouter;
				if (internalRouter?.canHandle(rawPath)) {
					if (hasGlobPathChars(rawPath)) {
						throw new ToolError(`Glob patterns are not supported for internal URLs: ${rawPath}`);
					}
					const resource = await internalRouter.resolve(rawPath);
					if (!resource.sourcePath) {
						throw new ToolError(`Cannot search internal URL without backing file: ${rawPath}`);
					}
					searchPath = resource.sourcePath;
				} else {
					const parsedPath = parseSearchPath(rawPath);
					searchPath = resolveToCwd(parsedPath.basePath, this.session.cwd);
					globFilter = parsedPath.glob;
				}
			}

			const resolvedSearchPath = searchPath ?? resolveToCwd(".", this.session.cwd);
			const scopePath = (() => {
				const relative = path.relative(this.session.cwd, resolvedSearchPath).replace(/\\/g, "/");
				return relative.length === 0 ? "." : relative;
			})();
			let isDirectory: boolean;
			try {
				const stat = await Bun.file(resolvedSearchPath).stat();
				isDirectory = stat.isDirectory();
			} catch {
				throw new ToolError(`Path not found: ${resolvedSearchPath}`);
			}

			const result = await astGrep({
				patterns,
				lang: params.lang?.trim(),
				path: resolvedSearchPath,
				glob: globFilter,
				selector: params.selector?.trim(),
				limit,
				offset,
				context,
				includeMeta: params.include_meta,
				signal,
			});

			const formatPath = (filePath: string): string => {
				const cleanPath = filePath.startsWith("/") ? filePath.slice(1) : filePath;
				if (isDirectory) {
					return cleanPath.replace(/\\/g, "/");
				}
				return path.basename(cleanPath);
			};

			const files = new Set<string>();
			const fileList: string[] = [];
			const fileMatchCounts = new Map<string, number>();
			const matchesByFile = new Map<string, AstFindMatch[]>();
			const recordFile = (relativePath: string) => {
				if (!files.has(relativePath)) {
					files.add(relativePath);
					fileList.push(relativePath);
				}
			};
			for (const match of result.matches) {
				const relativePath = formatPath(match.path);
				recordFile(relativePath);
				if (!matchesByFile.has(relativePath)) {
					matchesByFile.set(relativePath, []);
				}
				matchesByFile.get(relativePath)!.push(match);
			}

			const baseDetails: AstGrepToolDetails = {
				matchCount: result.totalMatches,
				fileCount: result.filesWithMatches,
				filesSearched: result.filesSearched,
				limitReached: result.limitReached,
				parseErrors: result.parseErrors,
				scopePath,
				files: fileList,
				fileMatches: [],
			};

			if (result.matches.length === 0) {
				const parseMessage = result.parseErrors?.length
					? `\nParse issues:\n${result.parseErrors.map(err => `- ${err}`).join("\n")}`
					: "";
				return toolResult(baseDetails).text(`No matches found${parseMessage}`).done();
			}

			const useHashLines = resolveFileDisplayMode(this.session).hashLines;
			const outputLines: string[] = [];
			const renderMatchesForFile = (relativePath: string) => {
				const fileMatches = matchesByFile.get(relativePath) ?? [];
				for (const match of fileMatches) {
					const matchLines = match.text.split("\n");
					const lineNumbers = matchLines.map((_, index) => match.startLine + index);
					const lineWidth = Math.max(...lineNumbers.map(value => value.toString().length));
					const formatLine = (lineNumber: number, line: string, isMatch: boolean): string => {
						if (useHashLines) {
							const ref = `${lineNumber}#${computeLineHash(lineNumber, line)}`;
							return isMatch ? `>>${ref}:${line}` : `  ${ref}:${line}`;
						}
						const padded = lineNumber.toString().padStart(lineWidth, " ");
						return isMatch ? `>>${padded}:${line}` : `  ${padded}:${line}`;
					};
					for (let index = 0; index < matchLines.length; index++) {
						outputLines.push(formatLine(match.startLine + index, matchLines[index], index === 0));
					}
					if (match.metaVariables && Object.keys(match.metaVariables).length > 0) {
						const serializedMeta = Object.entries(match.metaVariables)
							.sort(([left], [right]) => left.localeCompare(right))
							.map(([key, value]) => `${key}=${value}`)
							.join(", ");
						outputLines.push(`  meta: ${serializedMeta}`);
					}
					fileMatchCounts.set(relativePath, (fileMatchCounts.get(relativePath) ?? 0) + 1);
				}
			};

			if (isDirectory) {
				const filesByDirectory = new Map<string, string[]>();
				for (const relativePath of fileList) {
					const directory = path.dirname(relativePath).replace(/\\/g, "/");
					if (!filesByDirectory.has(directory)) {
						filesByDirectory.set(directory, []);
					}
					filesByDirectory.get(directory)!.push(relativePath);
				}
				for (const [directory, directoryFiles] of filesByDirectory) {
					if (directory === ".") {
						for (const relativePath of directoryFiles) {
							if (outputLines.length > 0) {
								outputLines.push("");
							}
							outputLines.push(`# ${path.basename(relativePath)}`);
							renderMatchesForFile(relativePath);
						}
						continue;
					}
					if (outputLines.length > 0) {
						outputLines.push("");
					}
					outputLines.push(`# ${directory}`);
					for (const relativePath of directoryFiles) {
						outputLines.push(`## └─ ${path.basename(relativePath)}`);
						renderMatchesForFile(relativePath);
					}
				}
			} else {
				for (const relativePath of fileList) {
					renderMatchesForFile(relativePath);
				}
			}

			const details: AstGrepToolDetails = {
				...baseDetails,
				fileMatches: fileList.map(filePath => ({
					path: filePath,
					count: fileMatchCounts.get(filePath) ?? 0,
				})),
			};
			if (result.limitReached) {
				outputLines.push("", "Result limit reached; narrow path pattern or increase limit.");
			}
			if (result.parseErrors?.length) {
				outputLines.push("", "Parse issues:", ...result.parseErrors.map(err => `- ${err}`));
			}

			return toolResult(details).text(outputLines.join("\n")).done();
		});
	}
}

// =============================================================================
// TUI Renderer
// =============================================================================

interface AstGrepRenderArgs {
	patterns?: string[];
	lang?: string;
	path?: string;
	selector?: string;
	limit?: number;
	offset?: number;
	context?: number;
	include_meta?: boolean;
}

const COLLAPSED_MATCH_LIMIT = PREVIEW_LIMITS.COLLAPSED_LINES * 2;

export const astGrepToolRenderer = {
	inline: true,
	renderCall(args: AstGrepRenderArgs, _options: RenderResultOptions, uiTheme: Theme): Component {
		const meta: string[] = [];
		if (args.lang) meta.push(`lang:${args.lang}`);
		if (args.path) meta.push(`in ${args.path}`);
		if (args.selector) meta.push("selector");
		if (args.limit !== undefined && args.limit > 0) meta.push(`limit:${args.limit}`);
		if (args.offset !== undefined && args.offset > 0) meta.push(`offset:${args.offset}`);
		if (args.context !== undefined) meta.push(`context:${args.context}`);
		if (args.include_meta) meta.push("meta");
		if (args.patterns && args.patterns.length > 1) meta.push(`${args.patterns.length} patterns`);

		const description =
			args.patterns?.length === 1 ? args.patterns[0] : args.patterns ? `${args.patterns.length} patterns` : "?";
		const text = renderStatusLine({ icon: "pending", title: "AST Grep", description, meta }, uiTheme);
		return new Text(text, 0, 0);
	},

	renderResult(
		result: { content: Array<{ type: string; text?: string }>; details?: AstGrepToolDetails; isError?: boolean },
		options: RenderResultOptions,
		uiTheme: Theme,
		args?: AstGrepRenderArgs,
	): Component {
		const details = result.details;

		if (result.isError) {
			const errorText = result.content?.find(c => c.type === "text")?.text || "Unknown error";
			return new Text(formatErrorMessage(errorText, uiTheme), 0, 0);
		}

		const matchCount = details?.matchCount ?? 0;
		const fileCount = details?.fileCount ?? 0;
		const filesSearched = details?.filesSearched ?? 0;
		const limitReached = details?.limitReached ?? false;

		if (matchCount === 0) {
			const description = args?.patterns?.length === 1 ? args.patterns[0] : undefined;
			const meta = ["0 matches"];
			if (details?.scopePath) meta.push(`in ${details.scopePath}`);
			if (filesSearched > 0) meta.push(`searched ${filesSearched}`);
			const header = renderStatusLine({ icon: "warning", title: "AST Grep", description, meta }, uiTheme);
			const lines = [header, formatEmptyMessage("No matches found", uiTheme)];
			if (details?.parseErrors?.length) {
				for (const err of details.parseErrors) {
					lines.push(uiTheme.fg("warning", `  - ${err}`));
				}
			}
			return new Text(lines.join("\n"), 0, 0);
		}

		const summaryParts = [formatCount("match", matchCount), formatCount("file", fileCount)];
		const meta = [...summaryParts];
		if (details?.scopePath) meta.push(`in ${details.scopePath}`);
		meta.push(`searched ${filesSearched}`);
		if (limitReached) meta.push(uiTheme.fg("warning", "limit reached"));
		const description = args?.patterns?.length === 1 ? args.patterns[0] : undefined;
		const header = renderStatusLine(
			{ icon: limitReached ? "warning" : "success", title: "AST Grep", description, meta },
			uiTheme,
		);

		const textContent = result.content?.find(c => c.type === "text")?.text ?? "";
		const rawLines = textContent.split("\n");
		const hasSeparators = rawLines.some(line => line.trim().length === 0);
		const allGroups: string[][] = [];
		if (hasSeparators) {
			let current: string[] = [];
			for (const line of rawLines) {
				if (line.trim().length === 0) {
					if (current.length > 0) {
						allGroups.push(current);
						current = [];
					}
					continue;
				}
				current.push(line);
			}
			if (current.length > 0) allGroups.push(current);
		} else {
			const nonEmpty = rawLines.filter(line => line.trim().length > 0);
			if (nonEmpty.length > 0) {
				allGroups.push(nonEmpty);
			}
		}
		const matchGroups = allGroups.filter(
			group => !group[0]?.startsWith("Result limit reached") && !group[0]?.startsWith("Parse issues:"),
		);

		const getCollapsedMatchLimit = (groups: string[][], maxLines: number): number => {
			if (groups.length === 0) return 0;
			let usedLines = 0;
			let count = 0;
			for (const group of groups) {
				if (count > 0 && usedLines + group.length > maxLines) break;
				usedLines += group.length;
				count += 1;
				if (usedLines >= maxLines) break;
			}
			return count;
		};

		const extraLines: string[] = [];
		if (limitReached) {
			extraLines.push(uiTheme.fg("warning", "limit reached; narrow path pattern or increase limit"));
		}
		if (details?.parseErrors?.length) {
			extraLines.push(uiTheme.fg("warning", `${details.parseErrors.length} parse issue(s)`));
		}

		let cached: RenderCache | undefined;
		return {
			render(width: number): string[] {
				const { expanded } = options;
				const key = new Hasher().bool(expanded).u32(width).digest();
				if (cached?.key === key) return cached.lines;
				const maxCollapsed = expanded
					? matchGroups.length
					: getCollapsedMatchLimit(matchGroups, COLLAPSED_MATCH_LIMIT);
				const matchLines = renderTreeList(
					{
						items: matchGroups,
						expanded,
						maxCollapsed,
						itemType: "match",
						renderItem: group =>
							group.map(line => {
								if (line.startsWith("## ")) return uiTheme.fg("dim", line);
								if (line.startsWith("# ")) return uiTheme.fg("accent", line);
								if (line.startsWith("  meta:")) return uiTheme.fg("dim", line);
								return uiTheme.fg("toolOutput", line);
							}),
					},
					uiTheme,
				);
				const rendered = [header, ...matchLines, ...extraLines].map(l => truncateToWidth(l, width, Ellipsis.Omit));
				cached = { key, lines: rendered };
				return rendered;
			},
			invalidate() {
				cached = undefined;
			},
		};
	},
	mergeCallAndResult: true,
};
