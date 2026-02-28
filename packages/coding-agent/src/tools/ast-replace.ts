import * as path from "node:path";
import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import { type AstReplaceChange, astReplace } from "@oh-my-pi/pi-natives";
import type { Component } from "@oh-my-pi/pi-tui";
import { Text } from "@oh-my-pi/pi-tui";
import { untilAborted } from "@oh-my-pi/pi-utils";
import { type Static, Type } from "@sinclair/typebox";
import { renderPromptTemplate } from "../config/prompt-templates";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import type { Theme } from "../modes/theme/theme";
import { computeLineHash } from "../patch/hashline";
import astReplaceDescription from "../prompts/tools/ast-replace.md" with { type: "text" };
import { Ellipsis, Hasher, type RenderCache, renderStatusLine, renderTreeList, truncateToWidth } from "../tui";
import { resolveFileDisplayMode } from "../utils/file-display-mode";
import type { ToolSession } from ".";
import type { OutputMeta } from "./output-meta";
import { hasGlobPathChars, parseSearchPath, resolveToCwd } from "./path-utils";
import { formatCount, formatEmptyMessage, formatErrorMessage, PREVIEW_LIMITS } from "./render-utils";
import { ToolError } from "./tool-errors";
import { toolResult } from "./tool-result";

const astReplaceOpSchema = Type.Object({
	pat: Type.String({ description: "AST pattern to match" }),
	out: Type.String({ description: "Replacement template" }),
});

const astReplaceSchema = Type.Object({
	ops: Type.Array(astReplaceOpSchema, {
		description: "Rewrite ops as [{ pat, out }]",
	}),
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
	scopePath?: string;
	files?: string[];
	fileReplacements?: Array<{ path: string; count: number }>;
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
			const ops = params.ops.map((entry, index) => {
				if (entry.pat.length === 0) {
					throw new ToolError(`\`ops[${index}].pat\` must be a non-empty pattern`);
				}
				return [entry.pat, entry.out] as const;
			});
			if (ops.length === 0) {
				throw new ToolError("`ops` must include at least one op entry");
			}
			const seenPatterns = new Set<string>();
			for (const [pat] of ops) {
				if (seenPatterns.has(pat)) {
					throw new ToolError(`Duplicate rewrite pattern: ${pat}`);
				}
				seenPatterns.add(pat);
			}
			const normalizedRewrites = Object.fromEntries(ops);
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

			const resolvedSearchPath = searchPath ?? resolveToCwd(".", this.session.cwd);
			const scopePath = path.relative(this.session.cwd, resolvedSearchPath).replace(/\\/g, "/") || ".";
			let isDirectory: boolean;
			try {
				const stat = await Bun.file(resolvedSearchPath).stat();
				isDirectory = stat.isDirectory();
			} catch {
				throw new ToolError(`Path not found: ${resolvedSearchPath}`);
			}

			const result = await astReplace({
				rewrites: normalizedRewrites,
				lang: params.lang?.trim(),
				path: resolvedSearchPath,
				glob: globFilter,
				selector: params.selector?.trim(),
				dryRun: params.dry_run,
				maxReplacements,
				maxFiles,
				failOnParseError: false,
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
			const fileReplacementCounts = new Map<string, number>();
			const changesByFile = new Map<string, AstReplaceChange[]>();
			const recordFile = (relativePath: string) => {
				if (!files.has(relativePath)) {
					files.add(relativePath);
					fileList.push(relativePath);
				}
			};
			for (const fileChange of result.fileChanges) {
				const relativePath = formatPath(fileChange.path);
				recordFile(relativePath);
				fileReplacementCounts.set(relativePath, (fileReplacementCounts.get(relativePath) ?? 0) + fileChange.count);
			}
			for (const change of result.changes) {
				const relativePath = formatPath(change.path);
				recordFile(relativePath);
				if (!changesByFile.has(relativePath)) {
					changesByFile.set(relativePath, []);
				}
				changesByFile.get(relativePath)!.push(change);
			}

			const baseDetails: AstReplaceToolDetails = {
				totalReplacements: result.totalReplacements,
				filesTouched: result.filesTouched,
				filesSearched: result.filesSearched,
				applied: result.applied,
				limitReached: result.limitReached,
				parseErrors: result.parseErrors,
				scopePath,
				files: fileList,
				fileReplacements: [],
			};

			if (result.totalReplacements === 0) {
				const parseMessage = result.parseErrors?.length
					? `\nParse issues:\n${result.parseErrors.map(err => `- ${err}`).join("\n")}`
					: "";
				return toolResult(baseDetails).text(`No replacements made${parseMessage}`).done();
			}

			const useHashLines = resolveFileDisplayMode(this.session).hashLines;
			const outputLines: string[] = [];
			const renderChangesForFile = (relativePath: string) => {
				const fileChanges = changesByFile.get(relativePath) ?? [];
				const lineWidth =
					fileChanges.length > 0 ? Math.max(...fileChanges.map(change => change.startLine.toString().length)) : 1;
				for (const change of fileChanges) {
					const beforeFirstLine = change.before.split("\n", 1)[0] ?? "";
					const afterFirstLine = change.after.split("\n", 1)[0] ?? "";
					const beforeLine = beforeFirstLine.slice(0, 120);
					const afterLine = afterFirstLine.slice(0, 120);
					const beforeRef = useHashLines
						? `${change.startLine}#${computeLineHash(change.startLine, beforeFirstLine)}`
						: `${change.startLine.toString().padStart(lineWidth, " ")}:${change.startColumn}`;
					const afterRef = useHashLines
						? `${change.startLine}#${computeLineHash(change.startLine, afterFirstLine)}`
						: `${change.startLine.toString().padStart(lineWidth, " ")}:${change.startColumn}`;
					const lineSeparator = useHashLines ? ":" : " ";
					outputLines.push(`-${beforeRef}${lineSeparator}${beforeLine}`);
					outputLines.push(`+${afterRef}${lineSeparator}${afterLine}`);
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
							const count = fileReplacementCounts.get(relativePath) ?? 0;
							outputLines.push(`# ${path.basename(relativePath)} (${formatCount("replacement", count)})`);
							renderChangesForFile(relativePath);
						}
						continue;
					}
					if (outputLines.length > 0) {
						outputLines.push("");
					}
					outputLines.push(`# ${directory}`);
					for (const relativePath of directoryFiles) {
						const count = fileReplacementCounts.get(relativePath) ?? 0;
						outputLines.push(`## └─ ${path.basename(relativePath)} (${formatCount("replacement", count)})`);
						renderChangesForFile(relativePath);
					}
				}
			} else {
				for (const relativePath of fileList) {
					renderChangesForFile(relativePath);
				}
			}

			const details: AstReplaceToolDetails = {
				...baseDetails,
				fileReplacements: fileList.map(filePath => ({
					path: filePath,
					count: fileReplacementCounts.get(filePath) ?? 0,
				})),
			};
			if (result.limitReached) {
				outputLines.push("", "Safety cap reached; narrow path pattern or increase max_files/max_replacements.");
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

interface AstReplaceRenderArgs {
	ops?: Array<{ pat?: string; out?: string }>;
	lang?: string;
	path?: string;
	selector?: string;
	dry_run?: boolean;
	max_replacements?: number;
	max_files?: number;
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
		const rewriteCount = args.ops?.length ?? 0;
		if (rewriteCount > 1) meta.push(`${rewriteCount} rewrites`);

		const description = rewriteCount === 1 ? args.ops?.[0]?.pat : rewriteCount ? `${rewriteCount} rewrites` : "?";
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
			const rewriteCount = args?.ops?.length ?? 0;
			const description = rewriteCount === 1 ? args?.ops?.[0]?.pat : undefined;
			const meta = ["0 replacements"];
			if (details?.scopePath) meta.push(`in ${details.scopePath}`);
			if (filesSearched > 0) meta.push(`searched ${filesSearched}`);
			const header = renderStatusLine({ icon: "warning", title: "AST Replace", description, meta }, uiTheme);
			const lines = [header, formatEmptyMessage("No replacements made", uiTheme)];
			if (details?.parseErrors?.length) {
				for (const err of details.parseErrors) {
					lines.push(uiTheme.fg("warning", `  - ${err}`));
				}
			}
			return new Text(lines.join("\n"), 0, 0);
		}

		const summaryParts = [formatCount("replacement", totalReplacements), formatCount("file", filesTouched)];
		const meta = [...summaryParts];
		if (details?.scopePath) meta.push(`in ${details.scopePath}`);
		meta.push(`searched ${filesSearched}`);
		if (limitReached) meta.push(uiTheme.fg("warning", "limit reached"));
		const rewriteCount = args?.ops?.length ?? 0;
		const description = rewriteCount === 1 ? args?.ops?.[0]?.pat : undefined;
		const badge = applied
			? { label: "applied", color: "success" as const }
			: { label: "dry run", color: "warning" as const };
		const header = renderStatusLine(
			{ icon: limitReached ? "warning" : "success", title: "AST Replace", description, badge, meta },
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
		const changeGroups = allGroups.filter(
			group => !group[0]?.startsWith("Safety cap reached") && !group[0]?.startsWith("Parse issues:"),
		);

		const getCollapsedChangeLimit = (groups: string[][], maxLines: number): number => {
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
				const maxCollapsed = expanded
					? changeGroups.length
					: getCollapsedChangeLimit(changeGroups, COLLAPSED_CHANGE_LIMIT);
				const changeLines = renderTreeList(
					{
						items: changeGroups,
						expanded,
						maxCollapsed,
						itemType: "change",
						renderItem: group =>
							group.map(line => {
								if (line.startsWith("## ")) return uiTheme.fg("dim", line);
								if (line.startsWith("# ")) return uiTheme.fg("accent", line);
								if (line.startsWith("+")) return uiTheme.fg("toolDiffAdded", line);
								if (line.startsWith("-")) return uiTheme.fg("toolDiffRemoved", line);
								return uiTheme.fg("toolOutput", line);
							}),
					},
					uiTheme,
				);
				const rendered = [header, ...changeLines, ...extraLines].map(l => truncateToWidth(l, width, Ellipsis.Omit));
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
