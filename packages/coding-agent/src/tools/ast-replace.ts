import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import { astReplace } from "@oh-my-pi/pi-natives";
import type { Component } from "@oh-my-pi/pi-tui";
import { Text } from "@oh-my-pi/pi-tui";
import { untilAborted } from "@oh-my-pi/pi-utils";
import { type Static, Type } from "@sinclair/typebox";
import { renderPromptTemplate } from "../config/prompt-templates";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import type { Theme } from "../modes/theme/theme";
import astReplaceDescription from "../prompts/tools/ast-replace.md" with { type: "text" };
import { Ellipsis, Hasher, type RenderCache, renderStatusLine, renderTreeList, truncateToWidth } from "../tui";
import type { ToolSession } from ".";
import type { OutputMeta } from "./output-meta";
import { hasGlobPathChars, parseSearchPath, resolveToCwd } from "./path-utils";
import { formatCount, formatEmptyMessage, formatErrorMessage, PREVIEW_LIMITS } from "./render-utils";
import { ToolError } from "./tool-errors";
import { toolResult } from "./tool-result";

const astReplaceSchema = Type.Object({
	pattern: Type.String({ description: "AST pattern to match" }),
	rewrite: Type.String({ description: "Rewrite template" }),
	lang: Type.Optional(Type.String({ description: "Language override" })),
	path: Type.Optional(Type.String({ description: "File, directory, or glob pattern to rewrite (default: cwd)" })),
	selector: Type.Optional(Type.String({ description: "Optional selector for contextual pattern mode" })),
	dry_run: Type.Optional(Type.Boolean({ description: "Preview only (default: true)" })),
	max_replacements: Type.Optional(Type.Number({ description: "Safety cap on total replacements" })),
	max_files: Type.Optional(Type.Number({ description: "Safety cap on touched files" })),
});

export interface AstReplaceToolDetails {
	totalReplacements: number;
	filesTouched: number;
	filesSearched: number;
	applied: boolean;
	limitReached: boolean;
	parseErrors?: string[];
	meta?: OutputMeta;
}

export class AstReplaceTool implements AgentTool<typeof astReplaceSchema, AstReplaceToolDetails> {
	readonly name = "ast_replace";
	readonly label = "AST Replace";
	readonly description: string;
	readonly parameters = astReplaceSchema;
	readonly strict = true;

	constructor(private readonly session: ToolSession) {
		this.description = renderPromptTemplate(astReplaceDescription);
	}

	async execute(
		_toolCallId: string,
		params: Static<typeof astReplaceSchema>,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<AstReplaceToolDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<AstReplaceToolDetails>> {
		return untilAborted(signal, async () => {
			const pattern = params.pattern?.trim();
			if (!pattern) {
				throw new ToolError("`pattern` is required");
			}
			if (!params.rewrite?.trim()) {
				throw new ToolError("`rewrite` is required");
			}

			const maxReplacements =
				params.max_replacements === undefined ? undefined : Math.floor(params.max_replacements);
			if (maxReplacements !== undefined && (!Number.isFinite(maxReplacements) || maxReplacements < 1)) {
				throw new ToolError("max_replacements must be a positive number");
			}
			const maxFiles = params.max_files === undefined ? undefined : Math.floor(params.max_files);
			if (maxFiles !== undefined && (!Number.isFinite(maxFiles) || maxFiles < 1)) {
				throw new ToolError("max_files must be a positive number");
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
						throw new ToolError(`Cannot rewrite internal URL without backing file: ${rawPath}`);
					}
					searchPath = resource.sourcePath;
				} else {
					const parsedPath = parseSearchPath(rawPath);
					searchPath = resolveToCwd(parsedPath.basePath, this.session.cwd);
					globFilter = parsedPath.glob;
				}
			}

			const result = await astReplace({
				pattern,
				rewrite: params.rewrite?.trim(),
				lang: params.lang?.trim(),
				path: searchPath,
				glob: globFilter,
				selector: params.selector?.trim(),
				dryRun: params.dry_run,
				maxReplacements,
				maxFiles,
				failOnParseError: false,
				signal,
			});

			const details: AstReplaceToolDetails = {
				totalReplacements: result.totalReplacements,
				filesTouched: result.filesTouched,
				filesSearched: result.filesSearched,
				applied: result.applied,
				limitReached: result.limitReached,
				parseErrors: result.parseErrors,
			};

			const action = result.applied ? "Applied" : "Would apply";
			const lines = [
				`${action} ${result.totalReplacements} replacements across ${result.filesTouched} files (searched ${result.filesSearched})`,
			];
			if (result.fileChanges.length > 0) {
				lines.push("", "File changes:");
				for (const file of result.fileChanges) {
					lines.push(`- ${file.path}: ${file.count}`);
				}
			}
			if (result.changes.length > 0) {
				lines.push("", "Preview:");
				for (const change of result.changes.slice(0, 30)) {
					const before = (change.before.split("\n", 1)[0] ?? "").slice(0, 80);
					const after = (change.after.split("\n", 1)[0] ?? "").slice(0, 80);
					lines.push(`${change.path}:${change.startLine}:${change.startColumn} ${before} -> ${after}`);
				}
				if (result.changes.length > 30) {
					lines.push(`... ${result.changes.length - 30} more changes`);
				}
			}
			if (result.limitReached) {
				lines.push("", "Safety cap reached; narrow path pattern or increase max_files/max_replacements.");
			}
			if (result.parseErrors?.length) {
				lines.push("", "Parse issues:", ...result.parseErrors.map(err => `- ${err}`));
			}

			return toolResult(details).text(lines.join("\n")).done();
		});
	}
}

// =============================================================================
// TUI Renderer
// =============================================================================

interface AstReplaceRenderArgs {
	pattern?: string;
	rewrite?: string;
	lang?: string;
	path?: string;
	selector?: string;
	dry_run?: boolean;
	max_replacements?: number;
	max_files?: number;
	fail_on_parse_error?: boolean;
}

const COLLAPSED_CHANGE_LIMIT = PREVIEW_LIMITS.COLLAPSED_LINES * 2;

export const astReplaceToolRenderer = {
	inline: true,
	renderCall(args: AstReplaceRenderArgs, _options: RenderResultOptions, uiTheme: Theme): Component {
		const meta: string[] = [];
		if (args.lang) meta.push(`lang:${args.lang}`);
		if (args.path) meta.push(`in ${args.path}`);
		if (args.dry_run !== false) meta.push("dry run");
		if (args.max_replacements !== undefined) meta.push(`max:${args.max_replacements}`);
		if (args.max_files !== undefined) meta.push(`max files:${args.max_files}`);

		const description = args.pattern || "?";
		const text = renderStatusLine({ icon: "pending", title: "AST Replace", description, meta }, uiTheme);
		return new Text(text, 0, 0);
	},

	renderResult(
		result: { content: Array<{ type: string; text?: string }>; details?: AstReplaceToolDetails; isError?: boolean },
		options: RenderResultOptions,
		uiTheme: Theme,
		args?: AstReplaceRenderArgs,
	): Component {
		const details = result.details;

		if (result.isError) {
			const errorText = result.content?.find(c => c.type === "text")?.text || "Unknown error";
			return new Text(formatErrorMessage(errorText, uiTheme), 0, 0);
		}

		const totalReplacements = details?.totalReplacements ?? 0;
		const filesTouched = details?.filesTouched ?? 0;
		const filesSearched = details?.filesSearched ?? 0;
		const applied = details?.applied ?? false;
		const limitReached = details?.limitReached ?? false;

		if (totalReplacements === 0) {
			const description = args?.pattern;
			const meta = ["0 replacements"];
			if (filesSearched > 0) meta.push(`searched ${filesSearched}`);
			const header = renderStatusLine({ icon: "warning", title: "AST Replace", description, meta }, uiTheme);
			return new Text([header, formatEmptyMessage("No replacements made", uiTheme)].join("\n"), 0, 0);
		}

		const summaryParts = [
			formatCount("replacement", totalReplacements),
			formatCount("file", filesTouched),
			`searched ${filesSearched}`,
		];
		const meta = [...summaryParts];
		if (limitReached) meta.push(uiTheme.fg("warning", "limit reached"));
		const description = args?.pattern;
		const badge = applied
			? { label: "applied", color: "success" as const }
			: { label: "dry run", color: "warning" as const };
		const header = renderStatusLine(
			{ icon: limitReached ? "warning" : "success", title: "AST Replace", description, badge, meta },
			uiTheme,
		);

		// Parse text content into display groups
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

		// Filter out trailing metadata groups (safety cap / parse issues) — shown via details
		const displayGroups = allGroups.filter(
			group => !group[0]?.startsWith("Safety cap") && !group[0]?.startsWith("Parse issues"),
		);

		const extraLines: string[] = [];
		if (limitReached) {
			extraLines.push(uiTheme.fg("warning", "safety cap reached; narrow scope or increase limits"));
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
				const matchLines = renderTreeList(
					{
						items: displayGroups,
						expanded,
						maxCollapsed: expanded ? displayGroups.length : COLLAPSED_CHANGE_LIMIT,
						itemType: "section",
						renderItem: group =>
							group.map(line => {
								if (line === "File changes:" || line === "Preview:") return uiTheme.fg("accent", line);
								if (line.startsWith("- ")) return uiTheme.fg("toolOutput", line);
								if (line.startsWith("...")) return uiTheme.fg("dim", line);
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
