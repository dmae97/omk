import nodePath from "node:path";
import type { AgentTool } from "@oh-my-pi/pi-agent-core";
import type { Component } from "@oh-my-pi/pi-tui";
import { Text } from "@oh-my-pi/pi-tui";
import { Type } from "@sinclair/typebox";
import { getLanguageFromPath, type Theme } from "../../modes/interactive/theme/theme";
import type { RenderResultOptions } from "../custom-tools/types";
import { untilAborted } from "../utils";
import type { ToolSession } from "./index";
import { resolveToCwd } from "./path-utils";
import {
	formatAge,
	formatBytes,
	formatCount,
	formatEmptyMessage,
	formatErrorMessage,
	formatExpandHint,
	formatMeta,
	formatMoreItems,
	formatTruncationSuffix,
	PREVIEW_LIMITS,
} from "./render-utils";
import { DEFAULT_MAX_BYTES, formatSize, type TruncationResult, truncateHead } from "./truncate";

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
	dirCount?: number;
	fileCount?: number;
	truncation?: TruncationResult;
	truncationReasons?: Array<"entryLimit" | "byteLimit">;
	entryLimitReached?: number;
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

export function createLsTool(session: ToolSession, options?: LsToolOptions): AgentTool<typeof lsSchema> {
	const ops = options?.operations ?? defaultLsOperations;

	return {
		name: "ls",
		label: "Ls",
		description: `List directory contents with modification times. Returns entries sorted alphabetically, with '/' suffix for directories and relative age (e.g., "2d ago", "just now"). Includes dotfiles. Output is truncated to 500 entries or 50KB (whichever is hit first).`,
		parameters: lsSchema,
		execute: async (
			_toolCallId: string,
			{ path, limit }: { path?: string; limit?: number },
			signal?: AbortSignal,
		) => {
			return untilAborted(signal, async () => {
				const dirPath = resolveToCwd(path || ".", session.cwd);
				const effectiveLimit = limit ?? DEFAULT_LIMIT;

				// Check if path exists and is a directory
				const dirStat = await ops.stat(dirPath);
				if (!dirStat) {
					throw new Error(`Path not found: ${dirPath}`);
				}

				if (!dirStat.isDirectory()) {
					throw new Error(`Not a directory: ${dirPath}`);
				}

				// Read directory entries
				let entries: string[];
				try {
					entries = await ops.readdir(dirPath);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					throw new Error(`Cannot read directory: ${message}`);
				}

				// Sort alphabetically (case-insensitive)
				entries.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

				// Format entries with directory indicators
				const results: string[] = [];
				let entryLimitReached = false;
				let dirCount = 0;
				let fileCount = 0;

				for (const entry of entries) {
					signal?.throwIfAborted();
					if (results.length >= effectiveLimit) {
						entryLimitReached = true;
						break;
					}

					const fullPath = nodePath.join(dirPath, entry);
					let suffix = "";
					let age = "";

					const entryStat = await ops.stat(fullPath);
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
				}

				if (results.length === 0) {
					return { content: [{ type: "text", text: "(empty directory)" }], details: undefined };
				}

				// Apply byte truncation (no line limit since we already have entry limit)
				const rawOutput = results.join("\n");
				const truncation = truncateHead(rawOutput, { maxLines: Number.MAX_SAFE_INTEGER });

				let output = truncation.content;
				const details: LsToolDetails = {
					entries: results,
					dirCount,
					fileCount,
				};
				const truncationReasons: Array<"entryLimit" | "byteLimit"> = [];

				// Build notices
				const notices: string[] = [];

				if (entryLimitReached) {
					notices.push(`${effectiveLimit} entries limit reached. Use limit=${effectiveLimit * 2} for more`);
					details.entryLimitReached = effectiveLimit;
					truncationReasons.push("entryLimit");
				}

				if (truncation.truncated) {
					notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
					details.truncation = truncation;
					truncationReasons.push("byteLimit");
				}

				if (truncationReasons.length > 0) {
					details.truncationReasons = truncationReasons;
				}

				if (notices.length > 0) {
					output += `\n\n[${notices.join(". ")}]`;
				}

				return {
					content: [{ type: "text", text: output }],
					details,
				};
			});
		},
	};
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
		const label = uiTheme.fg("toolTitle", uiTheme.bold("Ls"));
		let text = `${uiTheme.format.bullet} ${label} ${uiTheme.fg("accent", args.path || ".")}`;

		const meta: string[] = [];
		if (args.limit !== undefined) meta.push(`limit:${args.limit}`);
		text += formatMeta(meta, uiTheme);

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
			return new Text(`  ${formatErrorMessage(textContent, uiTheme)}`, 0, 0);
		}

		if (
			(!textContent || textContent.trim() === "" || textContent.trim() === "(empty directory)") &&
			(!details?.entries || details.entries.length === 0)
		) {
			return new Text(`  ${formatEmptyMessage("Empty directory", uiTheme)}`, 0, 0);
		}

		let entries: string[] = details?.entries ? [...details.entries] : [];
		if (entries.length === 0) {
			const rawLines = textContent.split("\n").filter((l: string) => l.trim());
			entries = rawLines.filter((line) => !/^\[.*\]$/.test(line.trim()));
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

		const truncated = Boolean(details?.truncation?.truncated || details?.entryLimitReached);
		const icon = truncated
			? uiTheme.styledSymbol("status.warning", "warning")
			: uiTheme.styledSymbol("status.success", "success");

		const summaryText = [formatCount("dir", dirCount ?? 0), formatCount("file", fileCount ?? 0)].join(
			uiTheme.sep.dot,
		);
		const maxEntries = expanded ? entries.length : Math.min(entries.length, COLLAPSED_LIST_LIMIT);
		const hasMoreEntries = entries.length > maxEntries;
		const expandHint = formatExpandHint(uiTheme, expanded, hasMoreEntries);

		let text = `  ${icon} ${uiTheme.fg("dim", summaryText)}${formatTruncationSuffix(truncated, uiTheme)}${expandHint}`;

		const truncationReasons: string[] = [];
		if (details?.entryLimitReached) {
			truncationReasons.push(`entry limit ${details.entryLimitReached}`);
		}
		if (details?.truncation?.truncated) {
			truncationReasons.push(`output cap ${formatBytes(details.truncation.maxBytes)}`);
		}

		const hasTruncation = truncationReasons.length > 0;

		for (let i = 0; i < maxEntries; i++) {
			const entry = entries[i];
			const isLast = i === maxEntries - 1 && !hasMoreEntries && !hasTruncation;
			const branch = isLast ? uiTheme.tree.last : uiTheme.tree.branch;
			const isDir = entry.endsWith("/");
			const entryPath = isDir ? entry.slice(0, -1) : entry;
			const lang = isDir ? undefined : getLanguageFromPath(entryPath);
			const entryIcon = isDir
				? uiTheme.fg("accent", uiTheme.icon.folder)
				: uiTheme.fg("muted", uiTheme.getLangIcon(lang));
			const entryColor = isDir ? "accent" : "toolOutput";
			text += `\n  ${uiTheme.fg("dim", branch)} ${entryIcon} ${uiTheme.fg(entryColor, entry)}`;
		}

		if (hasMoreEntries) {
			const moreEntriesBranch = hasTruncation ? uiTheme.tree.branch : uiTheme.tree.last;
			text += `\n  ${uiTheme.fg("dim", moreEntriesBranch)} ${uiTheme.fg(
				"muted",
				formatMoreItems(entries.length - maxEntries, "entry", uiTheme),
			)}`;
		}

		if (hasTruncation) {
			text += `\n  ${uiTheme.fg("dim", uiTheme.tree.last)} ${uiTheme.fg(
				"warning",
				`truncated: ${truncationReasons.join(", ")}`,
			)}`;
		}

		return new Text(text, 0, 0);
	},
};
