import nodePath from "node:path";
import type { AgentTool, AgentToolResult } from "@oh-my-pi/pi-agent-core";
import { type Component, Text } from "@oh-my-pi/pi-tui";
import { untilAborted } from "@oh-my-pi/pi-utils";
import { Type } from "@sinclair/typebox";
import type { RenderResultOptions } from "$c/extensibility/custom-tools/types";
import type { Theme } from "$c/modes/theme/theme";
import type { OutputMeta } from "$c/tools/output-meta";
import { ToolError, throwIfAborted } from "$c/tools/tool-errors";
import { renderFileList, renderStatusLine } from "$c/tui";
import type { ToolSession } from "./index";
import { applyListLimit } from "./list-limit";
import { resolveToCwd } from "./path-utils";
import {
	formatAge,
	formatBytes,
	formatCount,
	formatEmptyMessage,
	formatErrorMessage,
	PREVIEW_LIMITS,
} from "./render-utils";
import { toolResult } from "./tool-result";
import { type TruncationResult, truncateHead } from "./truncate";

const lsSchema = Type.Object({
	path: Type.Optional(Type.String({ description: "Directory to list (default: current directory)" })),
	limit: Type.Optional(Type.Number({ description: "Maximum number of entries to return (default: 500)" })),
});

const DEFAULT_LIMIT = 500;

/**
 * Pluggable operations for the ls tool.
 * Override these to delegate directory listing to remote systems (e.g., SSH).
 */
export interface LsOperations {
	/** Check if path exists and return stats. Returns undefined if not found. */
	stat: (absolutePath: string) => Promise<{ isDirectory: () => boolean; mtimeMs: number } | undefined>;
	/** Read directory entries (names only) */
	readdir: (absolutePath: string) => Promise<string[]>;
}

export interface LsToolOptions {
	/** Custom operations for directory listing. Default: local filesystem via Bun */
	operations?: LsOperations;
}

export interface LsToolDetails {
	entries?: string[];
	/** Raw entry names (with / suffix for dirs) without age suffix, for icon detection */
	rawEntries?: string[];
	dirCount?: number;
	fileCount?: number;
	truncation?: TruncationResult;
	truncationReasons?: Array<"entryLimit" | "byteLimit">;
	entryLimitReached?: number;
	meta?: OutputMeta;
}

/** Default operations using Bun APIs */
const defaultLsOperations: LsOperations = {
	async stat(absolutePath: string) {
		try {
			const s = await Bun.file(absolutePath).stat();
			return { isDirectory: () => s.isDirectory(), mtimeMs: s.mtimeMs };
		} catch {
			return undefined;
		}
	},
	async readdir(absolutePath: string) {
		return Array.fromAsync(new Bun.Glob("*").scan({ cwd: absolutePath, dot: true, onlyFiles: false }));
	},
};

export class LsTool implements AgentTool<typeof lsSchema, LsToolDetails> {
	public readonly name = "ls";
	public readonly label = "Ls";
	public readonly description =
		'List directory contents with modification times. Returns entries sorted alphabetically, with \'/\' suffix for directories and relative age (e.g., "2d ago", "just now"). Includes dotfiles. Output is truncated to 500 entries or 50KB (whichever is hit first).';
	public readonly parameters = lsSchema;

	private readonly session: ToolSession;
	private readonly ops: LsOperations;

	constructor(session: ToolSession, options?: LsToolOptions) {
		this.session = session;
		this.ops = options?.operations ?? defaultLsOperations;
	}

	public async execute(
		_toolCallId: string,
		{ path, limit }: { path?: string; limit?: number },
		signal?: AbortSignal,
	): Promise<AgentToolResult<LsToolDetails>> {
		return untilAborted(signal, async () => {
			const dirPath = resolveToCwd(path || ".", this.session.cwd);
			const effectiveLimit = limit ?? DEFAULT_LIMIT;

			// Check if path exists and is a directory
			const dirStat = await this.ops.stat(dirPath);
			if (!dirStat) {
				throw new ToolError(`Path not found: ${dirPath}`);
			}

			if (!dirStat.isDirectory()) {
				throw new ToolError(`Not a directory: ${dirPath}`);
			}

			// Read directory entries
			let entries: string[];
			try {
				entries = await this.ops.readdir(dirPath);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				throw new ToolError(`Cannot read directory: ${message}`);
			}

			// Sort alphabetically (case-insensitive)
			entries.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

			const listLimit = applyListLimit(entries, { limit: effectiveLimit });
			const limitedEntries = listLimit.items;
			const limitMeta = listLimit.meta;

			// Format entries with directory indicators
			const results: string[] = [];
			const rawResults: string[] = [];
			let dirCount = 0;
			let fileCount = 0;

			for (const entry of limitedEntries) {
				throwIfAborted(signal);
				const fullPath = nodePath.join(dirPath, entry);
				let suffix = "";
				let age = "";

				const entryStat = await this.ops.stat(fullPath);
				if (!entryStat) {
					// Skip entries we can't stat
					continue;
				}

				if (entryStat.isDirectory()) {
					suffix = "/";
					dirCount += 1;
				} else {
					fileCount += 1;
				}
				// Calculate age from mtime
				const ageSeconds = Math.floor((Date.now() - entryStat.mtimeMs) / 1000);
				age = formatAge(ageSeconds);

				// Format: "name/ (2d ago)" or "name (just now)"
				const line = age ? `${entry}${suffix} (${age})` : entry + suffix;
				results.push(line);
				rawResults.push(entry + suffix);
			}

			if (results.length === 0) {
				return { content: [{ type: "text", text: "(empty directory)" }], details: {} };
			}

			// Apply byte truncation (no line limit since we already have entry limit)
			const rawOutput = results.join("\n");
			const truncation = truncateHead(rawOutput, { maxLines: Number.MAX_SAFE_INTEGER });

			const output = truncation.content;
			const details: LsToolDetails = {
				entries: results,
				rawEntries: rawResults,
				dirCount,
				fileCount,
			};
			const truncationReasons: Array<"entryLimit" | "byteLimit"> = [];

			if (limitMeta.resultLimit) {
				details.entryLimitReached = limitMeta.resultLimit.reached;
				truncationReasons.push("entryLimit");
			}

			if (truncation.truncated) {
				details.truncation = truncation;
				truncationReasons.push("byteLimit");
			}

			if (truncationReasons.length > 0) {
				details.truncationReasons = truncationReasons;
			}

			const resultBuilder = toolResult(details).text(output).limits({ resultLimit: limitMeta.resultLimit?.reached });
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

interface LsRenderArgs {
	path?: string;
	limit?: number;
}

const COLLAPSED_LIST_LIMIT = PREVIEW_LIMITS.COLLAPSED_ITEMS;

export const lsToolRenderer = {
	inline: true,
	renderCall(args: LsRenderArgs, uiTheme: Theme): Component {
		const meta: string[] = [];
		if (args.limit !== undefined) meta.push(`limit:${args.limit}`);
		const text = renderStatusLine({ icon: "pending", title: "Ls", description: args.path || ".", meta }, uiTheme);
		return new Text(text, 0, 0);
	},

	renderResult(
		result: { content: Array<{ type: string; text?: string }>; details?: LsToolDetails; isError?: boolean },
		{ expanded }: RenderResultOptions,
		uiTheme: Theme,
	): Component {
		const details = result.details;
		const textContent = result.content?.find((c) => c.type === "text")?.text ?? "";

		if (result.isError) {
			return new Text(formatErrorMessage(textContent, uiTheme), 0, 0);
		}

		if (
			(!textContent || textContent.trim() === "" || textContent.trim() === "(empty directory)") &&
			(!details?.entries || details.entries.length === 0)
		) {
			return new Text(formatEmptyMessage("Empty directory", uiTheme), 0, 0);
		}

		let entries: string[] = details?.entries ? [...details.entries] : [];
		let rawEntries: string[] | undefined = details?.rawEntries;
		if (entries.length === 0) {
			const rawLines = textContent.split("\n").filter((l: string) => l.trim());
			entries = rawLines.filter((line) => !/^\[.*\]$/.test(line.trim()));
			rawEntries = undefined; // Can't reliably extract raw paths from text
		}

		if (entries.length === 0) {
			return new Text(`  ${formatEmptyMessage("Empty directory", uiTheme)}`, 0, 0);
		}

		let dirCount = details?.dirCount;
		let fileCount = details?.fileCount;
		if (dirCount === undefined || fileCount === undefined) {
			dirCount = 0;
			fileCount = 0;
			for (const entry of entries) {
				if (entry.endsWith("/")) {
					dirCount += 1;
				} else {
					fileCount += 1;
				}
			}
		}

		const truncation = details?.meta?.truncation;
		const limits = details?.meta?.limits;
		const truncated = Boolean(details?.entryLimitReached || truncation || limits?.resultLimit || limits?.headLimit);
		const summaryText = [formatCount("dir", dirCount ?? 0), formatCount("file", fileCount ?? 0)].join(
			uiTheme.sep.dot,
		);
		const meta = truncated ? [summaryText, uiTheme.fg("warning", "truncated")] : [summaryText];
		const header = renderStatusLine({ icon: truncated ? "warning" : "success", title: "Ls", meta }, uiTheme);

		const fileLines = renderFileList(
			{
				files: entries.map((entry, index) => ({
					path: entry,
					isDirectory: (rawEntries?.[index] ?? entry).endsWith("/"),
				})),
				expanded,
				maxCollapsed: COLLAPSED_LIST_LIMIT,
			},
			uiTheme,
		);

		const truncationReasons: string[] = [];
		if (limits?.resultLimit) truncationReasons.push(`entry limit ${limits.resultLimit.reached}`);
		if (truncation) truncationReasons.push(`output cap ${formatBytes(truncation.outputBytes)}`);
		if (truncation?.artifactId) truncationReasons.push(`full output: artifact://${truncation.artifactId}`);

		const extraLines =
			truncationReasons.length > 0 ? [uiTheme.fg("warning", `truncated: ${truncationReasons.join(", ")}`)] : [];

		return new Text([header, ...fileLines, ...extraLines].join("\n"), 0, 0);
	},
};
