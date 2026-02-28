import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import { type AstFindResult, astFind } from "@oh-my-pi/pi-natives";
import type { Component } from "@oh-my-pi/pi-tui";
import { Text } from "@oh-my-pi/pi-tui";
import { untilAborted } from "@oh-my-pi/pi-utils";
import { type Static, Type } from "@sinclair/typebox";
import { renderPromptTemplate } from "../config/prompt-templates";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import type { Theme } from "../modes/theme/theme";
import astFindDescription from "../prompts/tools/ast-find.md" with { type: "text" };
import { Ellipsis, Hasher, type RenderCache, renderStatusLine, renderTreeList, truncateToWidth } from "../tui";
import type { ToolSession } from ".";
import type { OutputMeta } from "./output-meta";
import { hasGlobPathChars, parseSearchPath, resolveToCwd } from "./path-utils";
import { formatCount, formatEmptyMessage, formatErrorMessage, PREVIEW_LIMITS } from "./render-utils";
import { ToolError } from "./tool-errors";
import { toolResult } from "./tool-result";

const astFindSchema = Type.Object({
	pattern: Type.String({ description: "AST pattern, e.g. 'foo($A)'" }),
	lang: Type.Optional(Type.String({ description: "Language override" })),
	path: Type.Optional(Type.String({ description: "File, directory, or glob pattern to search (default: cwd)" })),
	selector: Type.Optional(Type.String({ description: "Optional selector for contextual pattern mode" })),
	limit: Type.Optional(Type.Number({ description: "Max matches (default: 50)" })),
	offset: Type.Optional(Type.Number({ description: "Skip first N matches (default: 0)" })),
	context: Type.Optional(Type.Number({ description: "Context lines around each match" })),
	include_meta: Type.Optional(Type.Boolean({ description: "Include metavariable captures" })),
});

export interface AstFindToolDetails {
	matchCount: number;
	fileCount: number;
	filesSearched: number;
	limitReached: boolean;
	parseErrors?: string[];
	meta?: OutputMeta;
}

export class AstFindTool implements AgentTool<typeof astFindSchema, AstFindToolDetails> {
	readonly name = "ast_find";
	readonly label = "AST Find";
	readonly description: string;
	readonly parameters = astFindSchema;
	readonly strict = true;

	constructor(private readonly session: ToolSession) {
		this.description = renderPromptTemplate(astFindDescription);
	}

	async execute(
		_toolCallId: string,
		params: Static<typeof astFindSchema>,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<AstFindToolDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<AstFindToolDetails>> {
		return untilAborted(signal, async () => {
			const pattern = params.pattern?.trim();
			if (!pattern) {
				throw new ToolError("`pattern` is required");
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

			const result = await astFind({
				pattern,
				lang: params.lang?.trim(),
				path: searchPath,
				glob: globFilter,
				selector: params.selector?.trim(),
				limit,
				offset,
				context,
				includeMeta: params.include_meta,
				signal,
			});

			const details: AstFindToolDetails = {
				matchCount: result.totalMatches,
				fileCount: result.filesWithMatches,
				filesSearched: result.filesSearched,
				limitReached: result.limitReached,
				parseErrors: result.parseErrors,
			};

			if (result.matches.length === 0) {
				const parseMessage = result.parseErrors?.length
					? `\nParse issues:\n${result.parseErrors.map(err => `- ${err}`).join("\n")}`
					: "";
				return toolResult(details).text(`No matches found${parseMessage}`).done();
			}

			const lines: string[] = [
				`${result.totalMatches} matches in ${result.filesWithMatches} files (searched ${result.filesSearched})`,
			];
			const grouped = new Map<string, AstFindResult["matches"]>();
			for (const match of result.matches) {
				const entry = grouped.get(match.path);
				if (entry) {
					entry.push(match);
				} else {
					grouped.set(match.path, [match]);
				}
			}
			for (const [filePath, matches] of grouped) {
				lines.push("", `# ${filePath}`);
				for (const match of matches) {
					const firstLine = match.text.split("\n", 1)[0] ?? "";
					const preview = firstLine.length > 140 ? `${firstLine.slice(0, 137)}...` : firstLine;
					lines.push(`${match.startLine}:${match.startColumn}-${match.endLine}:${match.endColumn}: ${preview}`);
					if (match.metaVariables && Object.keys(match.metaVariables).length > 0) {
						const serializedMeta = Object.entries(match.metaVariables)
							.sort(([left], [right]) => left.localeCompare(right))
							.map(([key, value]) => `${key}=${value}`)
							.join(", ");
						lines.push(`  meta: ${serializedMeta}`);
					}
				}
			}
			if (result.limitReached) {
				lines.push("", "Result limit reached; narrow path pattern or increase limit.");
			}
			if (result.parseErrors?.length) {
				lines.push("", "Parse issues:", ...result.parseErrors.map(err => `- ${err}`));
			}

			const output = lines.join("\n");
			return toolResult(details).text(output).done();
		});
	}
}

// =============================================================================
// TUI Renderer
// =============================================================================

interface AstFindRenderArgs {
	pattern?: string;
	lang?: string;
	path?: string;
	selector?: string;
	limit?: number;
	offset?: number;
	context?: number;
	include_meta?: boolean;
}

const COLLAPSED_MATCH_LIMIT = PREVIEW_LIMITS.COLLAPSED_LINES * 2;

export const astFindToolRenderer = {
	inline: true,
	renderCall(args: AstFindRenderArgs, _options: RenderResultOptions, uiTheme: Theme): Component {
		const meta: string[] = [];
		if (args.lang) meta.push(`lang:${args.lang}`);
		if (args.path) meta.push(`in ${args.path}`);
		if (args.selector) meta.push("selector");
		if (args.limit !== undefined && args.limit > 0) meta.push(`limit:${args.limit}`);
		if (args.offset !== undefined && args.offset > 0) meta.push(`offset:${args.offset}`);
		if (args.context !== undefined) meta.push(`context:${args.context}`);
		if (args.include_meta) meta.push("meta");

		const description = args.pattern || "?";
		const text = renderStatusLine({ icon: "pending", title: "AST Find", description, meta }, uiTheme);
		return new Text(text, 0, 0);
	},

	renderResult(
		result: { content: Array<{ type: string; text?: string }>; details?: AstFindToolDetails; isError?: boolean },
		options: RenderResultOptions,
		uiTheme: Theme,
		args?: AstFindRenderArgs,
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
			const description = args?.pattern;
			const meta = ["0 matches"];
			if (filesSearched > 0) meta.push(`searched ${filesSearched}`);
			const header = renderStatusLine({ icon: "warning", title: "AST Find", description, meta }, uiTheme);
			const lines = [header, formatEmptyMessage("No matches found", uiTheme)];
			if (details?.parseErrors?.length) {
				for (const err of details.parseErrors) {
					lines.push(uiTheme.fg("warning", `  - ${err}`));
				}
			}
			return new Text(lines.join("\n"), 0, 0);
		}

		const summaryParts = [formatCount("match", matchCount), formatCount("file", fileCount)];
		const meta = [...summaryParts, `searched ${filesSearched}`];
		if (limitReached) meta.push(uiTheme.fg("warning", "limit reached"));
		const description = args?.pattern;
		const header = renderStatusLine(
			{ icon: limitReached ? "warning" : "success", title: "AST Find", description, meta },
			uiTheme,
		);

		// Parse text content into match groups (grouped by file, separated by blank lines)
		const textContent = result.content?.find(c => c.type === "text")?.text ?? "";
		const rawLines = textContent.split("\n");
		// Skip the summary line and group by blank-line separators
		const contentLines = rawLines.slice(1);
		const allGroups: string[][] = [];
		let current: string[] = [];
		for (const line of contentLines) {
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

		// Keep only file match groups (starting with "# ")
		const matchGroups = allGroups.filter(group => group[0]?.startsWith("# "));

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
								if (line.startsWith("# ")) return uiTheme.fg("accent", line);
								if (line.startsWith("  meta:")) return uiTheme.fg("dim", line);
								return uiTheme.fg("toolOutput", line);
							}),
					},
					uiTheme,
				);
				const result = [header, ...matchLines, ...extraLines].map(l => truncateToWidth(l, width, Ellipsis.Omit));
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
