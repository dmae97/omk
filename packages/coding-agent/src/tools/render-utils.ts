/**
 * Shared utilities and constants for tool renderers.
 *
 * Provides consistent formatting, truncation, and display patterns across all
 * tool renderers to ensure a unified TUI experience.
 */

import { homedir } from "node:os";
import type { Theme } from "$c/modes/theme/theme";
import { getTreeBranch } from "$c/tui/utils";

// =============================================================================
// Standardized Display Constants
// =============================================================================

/** Preview limits for collapsed/expanded views */
export const PREVIEW_LIMITS = {
	/** Lines shown in collapsed view */
	COLLAPSED_LINES: 3,
	/** Lines shown in expanded view */
	EXPANDED_LINES: 12,
	/** Items (files, results) shown in collapsed view */
	COLLAPSED_ITEMS: 8,
	/** Output preview lines in collapsed view */
	OUTPUT_COLLAPSED: 3,
	/** Output preview lines in expanded view */
	OUTPUT_EXPANDED: 10,
} as const;

/** Truncation lengths for different content types */
export const TRUNCATE_LENGTHS = {
	/** Short titles, labels */
	TITLE: 60,
	/** Medium-length content (messages, previews) */
	CONTENT: 80,
	/** Longer content (code, explanations) */
	LONG: 100,
	/** Full line content */
	LINE: 110,
	/** Very short (task previews, badges) */
	SHORT: 40,
} as const;

/** Standard expand hint text */
export const EXPAND_HINT = "(Ctrl+O for more)";

// =============================================================================
// Text Truncation Utilities
// =============================================================================

/**
 * Truncate text to max length with ellipsis.
 * The most commonly duplicated utility across renderers.
 */
export function truncate(text: string, maxLen: number, ellipsis: string): string {
	if (text.length <= maxLen) return text;
	const sliceLen = Math.max(0, maxLen - ellipsis.length);
	return `${text.slice(0, sliceLen)}${ellipsis}`;
}

/**
 * Get first N lines of text as preview, with each line truncated.
 */
export function getPreviewLines(text: string, maxLines: number, maxLineLen: number, ellipsis: string): string[] {
	const lines = text.split("\n").filter((l) => l.trim());
	return lines.slice(0, maxLines).map((l) => truncate(l.trim(), maxLineLen, ellipsis));
}

// =============================================================================
// URL Utilities
// =============================================================================

/**
 * Extract domain from URL, stripping www. prefix.
 */
export function getDomain(url: string): string {
	try {
		const u = new URL(url);
		return u.hostname.replace(/^www\./, "");
	} catch {
		return url;
	}
}

// =============================================================================
// Formatting Utilities
// =============================================================================

/**
 * Format byte count for display (e.g., "1.5KB", "2.3MB").
 */
export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Format token count for display (e.g., "1.5k", "25k").
 */
export function formatTokens(tokens: number): string {
	if (tokens >= 1000) {
		return `${(tokens / 1000).toFixed(1)}k`;
	}
	return String(tokens);
}

/**
 * Format duration for display (e.g., "500ms", "2.5s", "1.2m").
 */
export function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	return `${(ms / 60000).toFixed(1)}m`;
}

/**
 * Format count with pluralized label (e.g., "3 files", "1 error").
 */
export function formatCount(label: string, count: number): string {
	const safeCount = Number.isFinite(count) ? count : 0;
	return `${safeCount} ${pluralize(label, safeCount)}`;
}

/**
 * Format age from seconds to human-readable string.
 */
export function formatAge(ageSeconds: number | null | undefined): string {
	if (!ageSeconds) return "";
	const mins = Math.floor(ageSeconds / 60);
	const hours = Math.floor(mins / 60);
	const days = Math.floor(hours / 24);
	const weeks = Math.floor(days / 7);
	const months = Math.floor(days / 30);

	if (months > 0) return `${months}mo ago`;
	if (weeks > 0) return `${weeks}w ago`;
	if (days > 0) return `${days}d ago`;
	if (hours > 0) return `${hours}h ago`;
	if (mins > 0) return `${mins}m ago`;
	return "just now";
}

// =============================================================================
// Theme Helper Utilities
// =============================================================================

/**
 * Get the appropriate status icon with color for a given state.
 * Standardizes status icon usage across all renderers.
 */
export function formatStatusIcon(status: ToolUIStatus, theme: Theme, spinnerFrame?: number): string {
	switch (status) {
		case "success":
			return theme.styledSymbol("status.success", "success");
		case "error":
			return theme.styledSymbol("status.error", "error");
		case "warning":
			return theme.styledSymbol("status.warning", "warning");
		case "info":
			return theme.styledSymbol("status.info", "accent");
		case "pending":
			return theme.styledSymbol("status.pending", "muted");
		case "running":
			if (spinnerFrame !== undefined) {
				const frames = theme.spinnerFrames;
				return frames[spinnerFrame % frames.length];
			}
			return theme.styledSymbol("status.running", "accent");
		case "aborted":
			return theme.styledSymbol("status.aborted", "error");
	}
}

/**
 * Format the expand hint with proper theming.
 * Returns empty string if already expanded or there is nothing more to show.
 */
export function formatExpandHint(theme: Theme, expanded?: boolean, hasMore?: boolean): string {
	if (expanded) return "";
	if (hasMore === false) return "";
	return theme.fg("dim", wrapBrackets(EXPAND_HINT, theme));
}

/**
 * Format a badge like [done] or [failed] with brackets and color.
 */
export function formatBadge(label: string, color: ToolUIColor, theme: Theme): string {
	const left = theme.format.bracketLeft;
	const right = theme.format.bracketRight;
	return theme.fg(color, `${left}${label}${right}`);
}

/**
 * Build a "more items" suffix line for truncated lists.
 * Uses consistent wording pattern.
 */
export function formatMoreItems(remaining: number, itemType: string, theme: Theme): string {
	const safeRemaining = Number.isFinite(remaining) ? remaining : 0;
	return `${theme.format.ellipsis} ${safeRemaining} more ${pluralize(itemType, safeRemaining)}`;
}

export function formatMeta(meta: string[], theme: Theme): string {
	return meta.length > 0 ? ` ${theme.fg("muted", meta.join(theme.sep.dot))}` : "";
}

export function formatScope(scopePath: string | undefined, theme: Theme): string {
	return scopePath ? ` ${theme.fg("muted", `in ${scopePath}`)}` : "";
}

export function formatTruncationSuffix(truncated: boolean, theme: Theme): string {
	return truncated ? theme.fg("warning", " (truncated)") : "";
}

export function formatErrorMessage(message: string | undefined, theme: Theme): string {
	const clean = (message ?? "").replace(/^Error:\s*/, "").trim();
	return `${theme.styledSymbol("status.error", "error")} ${theme.fg("error", `Error: ${clean || "Unknown error"}`)}`;
}

export function formatEmptyMessage(message: string, theme: Theme): string {
	return `${theme.styledSymbol("status.warning", "warning")} ${theme.fg("muted", message)}`;
}

// =============================================================================
// Tool UI Kit
// =============================================================================

export type ToolUIStatus = "success" | "error" | "warning" | "info" | "pending" | "running" | "aborted";
export type ToolUIColor = "success" | "error" | "warning" | "accent" | "muted";

export interface ToolUITitleOptions {
	bold?: boolean;
}

// =============================================================================
// Diagnostic Formatting
// =============================================================================

export class ToolUIKit {
	constructor(public theme: Theme) {}

	title(label: string, options?: ToolUITitleOptions): string {
		const content = options?.bold === false ? label : this.theme.bold(label);
		return this.theme.fg("toolTitle", content);
	}

	meta(meta: string[]): string {
		return formatMeta(meta, this.theme);
	}

	count(label: string, count: number): string {
		return formatCount(label, count);
	}

	moreItems(remaining: number, itemType: string): string {
		return formatMoreItems(remaining, itemType, this.theme);
	}

	expandHint(expanded: boolean, hasMore: boolean): string {
		return formatExpandHint(this.theme, expanded, hasMore);
	}

	scope(scopePath?: string): string {
		return formatScope(scopePath, this.theme);
	}

	truncationSuffix(truncated: boolean): string {
		return formatTruncationSuffix(truncated, this.theme);
	}

	errorMessage(message: string | undefined): string {
		return formatErrorMessage(message, this.theme);
	}

	emptyMessage(message: string): string {
		return formatEmptyMessage(message, this.theme);
	}

	badge(label: string, color: ToolUIColor): string {
		return formatBadge(label, color, this.theme);
	}

	statusIcon(status: ToolUIStatus, spinnerFrame?: number): string {
		return formatStatusIcon(status, this.theme, spinnerFrame);
	}

	wrapBrackets(text: string): string {
		return wrapBrackets(text, this.theme);
	}

	truncate(text: string, maxLen: number): string {
		return truncate(text, maxLen, this.theme.format.ellipsis);
	}

	previewLines(text: string, maxLines: number, maxLineLen: number): string[] {
		return getPreviewLines(text, maxLines, maxLineLen, this.theme.format.ellipsis);
	}

	formatBytes(bytes: number): string {
		return formatBytes(bytes);
	}

	formatTokens(tokens: number): string {
		return formatTokens(tokens);
	}

	formatDuration(ms: number): string {
		return formatDuration(ms);
	}

	formatAge(ageSeconds: number | null | undefined): string {
		return formatAge(ageSeconds);
	}

	formatDiagnostics(
		diag: { errored: boolean; summary: string; messages: string[] },
		expanded: boolean,
		getLangIcon: (filePath: string) => string,
	): string {
		return formatDiagnostics(diag, expanded, this.theme, getLangIcon);
	}

	formatDiffStats(added: number, removed: number, hunks: number): string {
		return formatDiffStats(added, removed, hunks, this.theme);
	}
}

interface ParsedDiagnostic {
	filePath: string;
	line: number;
	col: number;
	severity: "error" | "warning" | "info" | "hint";
	source?: string;
	message: string;
	code?: string;
}

function parseDiagnosticMessage(msg: string): ParsedDiagnostic | null {
	const match = msg.match(/^(.+?):(\d+):(\d+)\s+\[(\w+)\]\s+(?:\[([^\]]+)\]\s+)?(.+?)(?:\s+\(([^)]+)\))?$/);
	if (!match) return null;
	return {
		filePath: match[1],
		line: parseInt(match[2], 10),
		col: parseInt(match[3], 10),
		severity: match[4] as ParsedDiagnostic["severity"],
		source: match[5],
		message: match[6],
		code: match[7],
	};
}

export function formatDiagnostics(
	diag: { errored: boolean; summary: string; messages: string[] },
	expanded: boolean,
	theme: Theme,
	getLangIcon: (filePath: string) => string,
): string {
	if (diag.messages.length === 0) return "";

	const byFile = new Map<string, ParsedDiagnostic[]>();
	const unparsed: string[] = [];

	for (const msg of diag.messages) {
		const parsed = parseDiagnosticMessage(msg);
		if (parsed) {
			const existing = byFile.get(parsed.filePath) ?? [];
			existing.push(parsed);
			byFile.set(parsed.filePath, existing);
		} else {
			unparsed.push(msg);
		}
	}

	const headerIcon = diag.errored
		? theme.styledSymbol("status.error", "error")
		: theme.styledSymbol("status.warning", "warning");
	let output = `\n\n${headerIcon} ${theme.fg("toolTitle", "Diagnostics")} ${theme.fg("dim", `(${diag.summary})`)}`;

	const maxDiags = expanded ? diag.messages.length : 5;
	let diagsShown = 0;

	const files = Array.from(byFile.entries());

	// Count total diagnostics for "... X more" calculation
	const totalParsedDiags = files.reduce((sum, [, diags]) => sum + diags.length, 0);
	const totalDiags = totalParsedDiags + unparsed.length;

	// Helper to check if this is the very last item in the tree
	const isTreeEnd = (fileIdx: number, diagIdx: number | null, unparsedIdx: number | null): boolean => {
		const willShowMore = totalDiags > diagsShown + 1;
		if (willShowMore) return false;

		if (unparsedIdx !== null) {
			return unparsedIdx === unparsed.length - 1;
		}
		if (diagIdx !== null) {
			const isLastDiagInFile = diagIdx === files[fileIdx][1].length - 1;
			const isLastFile = fileIdx === files.length - 1;
			return isLastDiagInFile && isLastFile && unparsed.length === 0;
		}
		// File node - never the tree end if it has diagnostics
		return false;
	};

	for (let fi = 0; fi < files.length && diagsShown < maxDiags; fi++) {
		const [filePath, diagnostics] = files[fi];
		// File is "last" only if no more files AND no unparsed AND we'll show all diags AND no "... X more"
		const remainingDiagsInFile = diagnostics.length;
		const remainingDiagsAfter = files.slice(fi + 1).reduce((sum, [, d]) => sum + d.length, 0) + unparsed.length;
		const willShowAllRemaining = diagsShown + remainingDiagsInFile + remainingDiagsAfter <= maxDiags;
		const isLastFileNode = fi === files.length - 1 && unparsed.length === 0 && willShowAllRemaining;
		const fileBranch = isLastFileNode ? theme.tree.last : theme.tree.branch;

		const fileIcon = theme.fg("muted", getLangIcon(filePath));
		output += `\n ${theme.fg("dim", fileBranch)} ${fileIcon} ${theme.fg("accent", filePath)}`;

		for (let di = 0; di < diagnostics.length && diagsShown < maxDiags; di++) {
			const d = diagnostics[di];
			const isLastDiagInFile = di === diagnostics.length - 1;
			// This is the last visible diag in file if it's actually last OR we're about to hit the limit
			const atDisplayLimit = diagsShown + 1 >= maxDiags;
			const isLastVisibleInFile = isLastDiagInFile || atDisplayLimit;
			// Check if this is the last visible item in the entire tree
			const isVeryLast = isTreeEnd(fi, di, null);
			const diagBranch = isLastFileNode
				? isLastVisibleInFile || isVeryLast
					? `  ${theme.tree.last}`
					: `  ${theme.tree.branch}`
				: isLastVisibleInFile || isVeryLast
					? `${theme.tree.vertical} ${theme.tree.last}`
					: `${theme.tree.vertical} ${theme.tree.branch}`;

			const sevIcon =
				d.severity === "error"
					? theme.styledSymbol("status.error", "error")
					: d.severity === "warning"
						? theme.styledSymbol("status.warning", "warning")
						: theme.styledSymbol("status.info", "muted");
			const location = theme.fg("dim", `:${d.line}:${d.col}`);
			const codeTag = d.code ? theme.fg("dim", ` (${d.code})`) : "";
			const msgColor = d.severity === "error" ? "error" : d.severity === "warning" ? "warning" : "toolOutput";

			output += `\n ${theme.fg("dim", diagBranch)} ${sevIcon}${location} ${theme.fg(msgColor, d.message)}${codeTag}`;
			diagsShown++;
		}
	}

	for (let ui = 0; ui < unparsed.length && diagsShown < maxDiags; ui++) {
		const msg = unparsed[ui];
		const isVeryLast = isTreeEnd(-1, null, ui);
		const branch = isVeryLast ? theme.tree.last : theme.tree.branch;
		const color = msg.includes("[error]") ? "error" : msg.includes("[warning]") ? "warning" : "dim";
		output += `\n ${theme.fg("dim", branch)} ${theme.fg(color, msg)}`;
		diagsShown++;
	}

	if (totalDiags > diagsShown) {
		const remaining = totalDiags - diagsShown;
		output += `\n ${theme.fg("dim", theme.tree.last)} ${theme.fg(
			"muted",
			`${theme.format.ellipsis} ${remaining} more`,
		)} ${formatExpandHint(theme)}`;
	}

	return output;
}

// =============================================================================
// Diff Utilities
// =============================================================================

export interface DiffStats {
	added: number;
	removed: number;
	hunks: number;
	lines: number;
}

export function getDiffStats(diffText: string): DiffStats {
	const lines = diffText ? diffText.split("\n") : [];
	let added = 0;
	let removed = 0;
	let hunks = 0;
	let inHunk = false;

	for (const line of lines) {
		const isAdded = line.startsWith("+");
		const isRemoved = line.startsWith("-");
		const isChange = isAdded || isRemoved;

		if (isAdded) added++;
		if (isRemoved) removed++;

		if (isChange && !inHunk) {
			hunks++;
			inHunk = true;
		} else if (!isChange) {
			inHunk = false;
		}
	}

	return { added, removed, hunks, lines: lines.length };
}

export function formatDiffStats(added: number, removed: number, hunks: number, theme: Theme): string {
	const parts: string[] = [];
	if (added > 0) parts.push(theme.fg("success", `+${added}`));
	if (removed > 0) parts.push(theme.fg("error", `-${removed}`));
	if (hunks > 0) parts.push(theme.fg("dim", `${hunks} hunk${hunks !== 1 ? "s" : ""}`));
	return parts.join(theme.fg("dim", " / "));
}

interface DiffSegment {
	lines: string[];
	isChange: boolean;
	isEllipsis: boolean;
}

function parseDiffSegments(lines: string[]): DiffSegment[] {
	const segments: DiffSegment[] = [];
	let current: DiffSegment | null = null;

	for (const line of lines) {
		const isChange = line.startsWith("+") || line.startsWith("-");
		const isEllipsis = line.trimStart().startsWith("...");

		if (isEllipsis) {
			if (current) segments.push(current);
			segments.push({ lines: [line], isChange: false, isEllipsis: true });
			current = null;
		} else if (!current || current.isChange !== isChange) {
			if (current) segments.push(current);
			current = { lines: [line], isChange, isEllipsis: false };
		} else {
			current.lines.push(line);
		}
	}

	if (current) segments.push(current);
	return segments;
}

export function truncateDiffByHunk(
	diffText: string,
	maxHunks: number,
	maxLines: number,
): { text: string; hiddenHunks: number; hiddenLines: number } {
	const lines = diffText ? diffText.split("\n") : [];
	const totalStats = getDiffStats(diffText);

	if (lines.length <= maxLines && totalStats.hunks <= maxHunks) {
		return { text: diffText, hiddenHunks: 0, hiddenLines: 0 };
	}

	const segments = parseDiffSegments(lines);

	const changeSegments = segments.filter((s) => s.isChange);
	const changeLineCount = changeSegments.reduce((sum, s) => sum + s.lines.length, 0);

	if (changeLineCount > maxLines) {
		const kept: string[] = [];
		let keptHunks = 0;

		for (const seg of segments) {
			if (seg.isChange) {
				keptHunks++;
				if (keptHunks > maxHunks) break;
			}
			kept.push(...seg.lines);
			if (kept.length >= maxLines) break;
		}

		const keptStats = getDiffStats(kept.join("\n"));
		return {
			text: kept.join("\n"),
			hiddenHunks: Math.max(0, totalStats.hunks - keptStats.hunks),
			hiddenLines: Math.max(0, lines.length - kept.length),
		};
	}

	const contextBudget = maxLines - changeLineCount;
	const contextSegments = segments.filter((s) => !s.isChange && !s.isEllipsis);
	const totalContextLines = contextSegments.reduce((sum, s) => sum + s.lines.length, 0);

	const kept: string[] = [];
	let keptHunks = 0;

	if (totalContextLines <= contextBudget) {
		for (const seg of segments) {
			if (seg.isChange) {
				keptHunks++;
				if (keptHunks > maxHunks) break;
			}
			kept.push(...seg.lines);
		}
	} else {
		const contextRatio = contextSegments.length > 0 ? contextBudget / totalContextLines : 0;

		for (let i = 0; i < segments.length; i++) {
			const seg = segments[i];

			if (seg.isChange) {
				keptHunks++;
				if (keptHunks > maxHunks) break;
				kept.push(...seg.lines);
			} else if (seg.isEllipsis) {
				kept.push(...seg.lines);
			} else {
				const allowedLines = Math.max(1, Math.floor(seg.lines.length * contextRatio));
				const isBeforeChange = segments[i + 1]?.isChange;
				const isAfterChange = segments[i - 1]?.isChange;

				if (isBeforeChange && isAfterChange) {
					const half = Math.ceil(allowedLines / 2);
					if (seg.lines.length > allowedLines) {
						kept.push(...seg.lines.slice(0, half));
						kept.push(seg.lines[0].replace(/^(\s*\d*\s*).*/, "$1..."));
						kept.push(...seg.lines.slice(-half));
					} else {
						kept.push(...seg.lines);
					}
				} else if (isBeforeChange) {
					kept.push(...seg.lines.slice(-allowedLines));
				} else if (isAfterChange) {
					kept.push(...seg.lines.slice(0, allowedLines));
				} else {
					kept.push(...seg.lines.slice(0, Math.min(allowedLines, 2)));
				}
			}
		}
	}

	const keptStats = getDiffStats(kept.join("\n"));
	return {
		text: kept.join("\n"),
		hiddenHunks: Math.max(0, totalStats.hunks - keptStats.hunks),
		hiddenLines: Math.max(0, lines.length - kept.length),
	};
}

// =============================================================================
// Path Utilities
// =============================================================================

export function shortenPath(filePath: string, homeDir?: string): string {
	const home = homeDir ?? homedir();
	if (home && filePath.startsWith(home)) {
		return `~${filePath.slice(home.length)}`;
	}
	return filePath;
}

export function wrapBrackets(text: string, theme: Theme): string {
	return `${theme.format.bracketLeft}${text}${theme.format.bracketRight}`;
}

export function replaceTabs(text: string): string {
	return text.replace(/\t/g, "   ");
}

function pluralize(label: string, count: number): string {
	if (count === 1) return label;
	if (/(?:ch|sh|s|x|z)$/i.test(label)) return `${label}es`;
	if (/[^aeiou]y$/i.test(label)) return `${label.slice(0, -1)}ies`;
	return `${label}s`;
}

// =============================================================================
// Tree Rendering Utilities
// =============================================================================
/**
 * Render a list of items with tree branches, handling truncation.
 *
 * @param items - Full list of items to render
 * @param expanded - Whether view is expanded
 * @param maxCollapsed - Max items to show when collapsed
 * @param renderItem - Function to render a single item
 * @param itemType - Type name for "more X" message (e.g., "file", "entry")
 * @param theme - Theme instance
 * @returns Array of formatted lines
 */
export function renderTreeList<T>(
	items: T[],
	expanded: boolean,
	maxCollapsed: number,
	renderItem: (item: T, branch: string, isLast: boolean, theme: Theme) => string,
	itemType: string,
	theme: Theme,
): string[] {
	const lines: string[] = [];
	const maxItems = expanded ? items.length : Math.min(items.length, maxCollapsed);

	for (let i = 0; i < maxItems; i++) {
		const isLast = i === maxItems - 1 && (expanded || items.length <= maxCollapsed);
		const branch = getTreeBranch(isLast, theme);
		lines.push(renderItem(items[i], branch, isLast, theme));
	}

	if (!expanded && items.length > maxCollapsed) {
		const remaining = items.length - maxCollapsed;
		lines.push(
			` ${theme.fg("dim", theme.tree.last)} ${theme.fg("muted", formatMoreItems(remaining, itemType, theme))}`,
		);
	}

	return lines;
}
