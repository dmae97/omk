/**
 * LSP Tool TUI Rendering
 *
 * Renders LSP tool calls and results in the TUI with:
 * - Syntax-highlighted hover information
 * - Color-coded diagnostics by severity
 * - Grouped references and symbols
 * - Collapsible/expandable views
 */

import type { AgentToolResult, RenderResultOptions } from "@oh-my-pi/pi-agent-core";
import { type Component, Text } from "@oh-my-pi/pi-tui";
import { highlight, supportsLanguage } from "cli-highlight";
import { getLanguageFromPath, type Theme } from "$c/modes/theme/theme";
import { formatExpandHint, formatMoreItems, TRUNCATE_LENGTHS, truncate } from "$c/tools/render-utils";
import { renderOutputBlock, renderStatusLine } from "$c/tui";
import type { LspParams, LspToolDetails } from "./types";

// =============================================================================
// Call Rendering
// =============================================================================

/**
 * Render the LSP tool call in the TUI.
 * Shows: "lsp <operation> <file/filecount>"
 */
export function renderCall(args: unknown, theme: Theme): Text {
	const p = args as LspParams & { file?: string; files?: string[] };
	const meta: string[] = [];
	if (p.file) {
		meta.push(p.file);
	} else if (p.files?.length) {
		meta.push(`${p.files.length} file(s)`);
	}
	const text = renderStatusLine({ icon: "pending", title: "LSP", description: p.action || "?", meta }, theme);
	return new Text(text, 0, 0);
}

// =============================================================================
// Result Rendering
// =============================================================================

/**
 * Render LSP tool result with intelligent formatting based on result type.
 * Detects hover, diagnostics, references, symbols, etc. and formats accordingly.
 */
export function renderResult(
	result: AgentToolResult<LspToolDetails>,
	options: RenderResultOptions,
	theme: Theme,
): Component {
	const content = result.content?.[0];
	if (!content || content.type !== "text" || !("text" in content) || !content.text) {
		return new Text(theme.fg("error", "No result"), 0, 0);
	}

	const text = content.text;
	const lines = text.split("\n").filter((l) => l.trim());
	const expanded = options.expanded;

	let label = "Result";
	let state: "success" | "warning" | "error" = "success";
	let bodyLines: string[] = [];

	const codeBlockMatch = text.match(/```(\w*)\n([\s\S]*?)```/);
	if (codeBlockMatch) {
		label = "Hover";
		bodyLines = renderHover(codeBlockMatch, text, lines, expanded, theme);
	} else {
		const errorMatch = text.match(/(\d+)\s+error\(s\)/);
		const warningMatch = text.match(/(\d+)\s+warning\(s\)/);
		if (errorMatch || warningMatch || text.includes(theme.status.error)) {
			label = "Diagnostics";
			const errorCount = errorMatch ? Number.parseInt(errorMatch[1], 10) : 0;
			const warnCount = warningMatch ? Number.parseInt(warningMatch[1], 10) : 0;
			state = errorCount > 0 ? "error" : warnCount > 0 ? "warning" : "success";
			bodyLines = renderDiagnostics(errorMatch, warningMatch, lines, expanded, theme);
		} else {
			const refMatch = text.match(/(\d+)\s+reference\(s\)/);
			if (refMatch) {
				label = "References";
				bodyLines = renderReferences(refMatch, lines, expanded, theme);
			} else {
				const symbolsMatch = text.match(/Symbols in (.+):/);
				if (symbolsMatch) {
					label = "Symbols";
					bodyLines = renderSymbols(symbolsMatch, lines, expanded, theme);
				} else {
					label = "Response";
					bodyLines = renderGeneric(text, lines, expanded, theme);
				}
			}
		}
	}

	const header = renderStatusLine({ icon: state, title: "LSP", description: label }, theme);
	return {
		render: (width: number) =>
			renderOutputBlock(
				{
					header,
					state,
					sections: [{ label: theme.fg("toolTitle", label), lines: bodyLines }],
					width,
				},
				theme,
			),
		invalidate: () => {},
	};
}

// =============================================================================
// Hover Rendering
// =============================================================================

/**
 * Render hover information with syntax-highlighted code blocks.
 */
function renderHover(
	codeBlockMatch: RegExpMatchArray,
	fullText: string,
	_lines: string[],
	expanded: boolean,
	theme: Theme,
): string[] {
	const lang = codeBlockMatch[1] || "";
	const code = codeBlockMatch[2].trim();
	const afterCode = fullText.slice(fullText.indexOf("```", 3) + 3).trim();

	const codeLines = highlightCode(code, lang, theme);
	const icon = theme.styledSymbol("status.info", "accent");
	const langLabel = lang ? theme.fg("mdCodeBlockBorder", ` ${lang}`) : "";

	if (expanded) {
		const h = theme.boxSharp.horizontal;
		const v = theme.boxSharp.vertical;
		const top = `${theme.boxSharp.topLeft}${h.repeat(3)}`;
		const bottom = `${theme.boxSharp.bottomLeft}${h.repeat(3)}`;
		let output = `${icon}${langLabel}`;
		output += `\n ${theme.fg("mdCodeBlockBorder", top)}`;
		for (const line of codeLines) {
			output += `\n ${theme.fg("mdCodeBlockBorder", v)} ${line}`;
		}
		output += `\n ${theme.fg("mdCodeBlockBorder", bottom)}`;
		if (afterCode) {
			output += `\n ${theme.fg("muted", afterCode)}`;
		}
		return output.split("\n");
	}

	// Collapsed view
	const firstCodeLine = codeLines[0] || "";
	const hasMore = codeLines.length > 1 || Boolean(afterCode);
	const expandHint = formatExpandHint(theme, expanded, hasMore);

	let output = `${icon}${langLabel}${expandHint}`;
	const h = theme.boxSharp.horizontal;
	const v = theme.boxSharp.vertical;
	const bottom = `${theme.boxSharp.bottomLeft}${h.repeat(3)}`;
	output += `\n ${theme.fg("mdCodeBlockBorder", v)} ${firstCodeLine}`;

	if (codeLines.length > 1) {
		output += `\n ${theme.fg("mdCodeBlockBorder", v)} ${theme.fg(
			"muted",
			`${theme.format.ellipsis} ${codeLines.length - 1} more lines`,
		)}`;
	}

	if (afterCode) {
		const docPreview = truncate(afterCode, TRUNCATE_LENGTHS.TITLE, theme.format.ellipsis);
		output += `\n ${theme.fg("dim", theme.tree.last)} ${theme.fg("muted", docPreview)}`;
	} else {
		output += `\n ${theme.fg("mdCodeBlockBorder", bottom)}`;
	}

	return output.split("\n");
}

/**
 * Syntax highlight code using highlight.ts.
 */
function highlightCode(codeText: string, language: string, theme: Theme): string[] {
	const validLang = language && supportsLanguage(language) ? language : undefined;
	try {
		const cliTheme = {
			keyword: (s: string) => theme.fg("syntaxKeyword", s),
			built_in: (s: string) => theme.fg("syntaxType", s),
			literal: (s: string) => theme.fg("syntaxNumber", s),
			number: (s: string) => theme.fg("syntaxNumber", s),
			string: (s: string) => theme.fg("syntaxString", s),
			comment: (s: string) => theme.fg("syntaxComment", s),
			function: (s: string) => theme.fg("syntaxFunction", s),
			title: (s: string) => theme.fg("syntaxFunction", s),
			class: (s: string) => theme.fg("syntaxType", s),
			type: (s: string) => theme.fg("syntaxType", s),
			attr: (s: string) => theme.fg("syntaxVariable", s),
			variable: (s: string) => theme.fg("syntaxVariable", s),
			params: (s: string) => theme.fg("syntaxVariable", s),
			operator: (s: string) => theme.fg("syntaxOperator", s),
			punctuation: (s: string) => theme.fg("syntaxPunctuation", s),
		};
		return highlight(codeText, { language: validLang, ignoreIllegals: true, theme: cliTheme }).split("\n");
	} catch {
		return codeText.split("\n");
	}
}

// =============================================================================
// Diagnostics Rendering
// =============================================================================

function formatDiagnosticLocation(file: string, line: string | number, col: string | number, theme: Theme): string {
	const lang = getLanguageFromPath(file);
	const icon = theme.fg("muted", theme.getLangIcon(lang));
	return `${icon} ${file}:${line}:${col}`;
}

/**
 * Render diagnostics with color-coded severity.
 */
function renderDiagnostics(
	errorMatch: RegExpMatchArray | null,
	warningMatch: RegExpMatchArray | null,
	lines: string[],
	expanded: boolean,
	theme: Theme,
): string[] {
	const errorCount = errorMatch ? Number.parseInt(errorMatch[1], 10) : 0;
	const warnCount = warningMatch ? Number.parseInt(warningMatch[1], 10) : 0;

	const icon =
		errorCount > 0
			? theme.styledSymbol("status.error", "error")
			: warnCount > 0
				? theme.styledSymbol("status.warning", "warning")
				: theme.styledSymbol("status.success", "success");

	const meta: string[] = [];
	if (errorCount > 0) meta.push(`${errorCount} error${errorCount !== 1 ? "s" : ""}`);
	if (warnCount > 0) meta.push(`${warnCount} warning${warnCount !== 1 ? "s" : ""}`);
	if (meta.length === 0) meta.push("No issues");

	const diagLines = lines.filter((l) => l.includes(theme.status.error) || /:\d+:\d+/.test(l));
	const parsedDiagnostics = diagLines
		.map((line) => parseDiagnosticLine(line))
		.filter((diag): diag is ParsedDiagnostic => diag !== null);
	const fallbackDiagnostics: RawDiagnostic[] = diagLines.map((line) => ({ raw: line.trim() }));

	if (expanded) {
		let output = `${icon} ${theme.fg("dim", meta.join(theme.sep.dot))}`;
		const items: DiagnosticItem[] = parsedDiagnostics.length > 0 ? parsedDiagnostics : fallbackDiagnostics;
		for (let i = 0; i < items.length; i++) {
			const item = items[i];
			const isLast = i === items.length - 1;
			const branch = isLast ? theme.tree.last : theme.tree.branch;
			const detailPrefix = isLast ? "   " : `${theme.tree.vertical}  `;
			if ("raw" in item) {
				output += `\n ${theme.fg("dim", branch)} ${theme.fg("muted", item.raw)}`;
				continue;
			}
			const severityColor = severityToColor(item.severity);
			const location = formatDiagnosticLocation(item.file, item.line, item.col, theme);
			output += `\n ${theme.fg("dim", branch)} ${theme.fg(severityColor, location)} ${theme.fg(
				"dim",
				`[${item.severity}]`,
			)}`;
			if (item.message) {
				output += `\n ${theme.fg("dim", detailPrefix)}${theme.fg(
					"muted",
					truncate(item.message, TRUNCATE_LENGTHS.LINE, theme.format.ellipsis),
				)}`;
			}
		}
		return output.split("\n");
	}

	// Collapsed view
	const previewItems: DiagnosticItem[] =
		parsedDiagnostics.length > 0 ? parsedDiagnostics.slice(0, 3) : fallbackDiagnostics.slice(0, 3);
	const remaining =
		(parsedDiagnostics.length > 0 ? parsedDiagnostics.length : fallbackDiagnostics.length) - previewItems.length;
	const expandHint = formatExpandHint(theme, expanded, remaining > 0);
	let output = `${icon} ${theme.fg("dim", meta.join(theme.sep.dot))}${expandHint}`;
	for (let i = 0; i < previewItems.length; i++) {
		const item = previewItems[i];
		const isLast = i === previewItems.length - 1 && remaining <= 0;
		const branch = isLast ? theme.tree.last : theme.tree.branch;
		if ("raw" in item) {
			output += `\n ${theme.fg("dim", branch)} ${theme.fg("muted", item.raw)}`;
			continue;
		}
		const severityColor = severityToColor(item.severity);
		const location = formatDiagnosticLocation(item.file, item.line, item.col, theme);
		const message = item.message
			? ` ${theme.fg("muted", truncate(item.message, TRUNCATE_LENGTHS.CONTENT, theme.format.ellipsis))}`
			: "";
		output += `\n ${theme.fg("dim", branch)} ${theme.fg(severityColor, location)}${message}`;
	}
	if (remaining > 0) {
		output += `\n ${theme.fg("dim", theme.tree.last)} ${theme.fg(
			"muted",
			`${theme.format.ellipsis} ${remaining} more`,
		)}`;
	}

	return output.split("\n");
}

// =============================================================================
// References Rendering
// =============================================================================

/**
 * Render references grouped by file.
 */
function renderReferences(refMatch: RegExpMatchArray, lines: string[], expanded: boolean, theme: Theme): string[] {
	const refCount = Number.parseInt(refMatch[1], 10);
	const icon =
		refCount > 0 ? theme.styledSymbol("status.success", "success") : theme.styledSymbol("status.warning", "warning");

	const locLines = lines.filter((l) => /^\s*\S+:\d+:\d+/.test(l));

	// Group by file
	const byFile = new Map<string, Array<[string, string]>>();
	for (const loc of locLines) {
		const match = loc.trim().match(/^(.+):(\d+):(\d+)$/);
		if (match) {
			const [, file, line, col] = match;
			if (!byFile.has(file)) byFile.set(file, []);
			byFile.get(file)!.push([line, col]);
		}
	}

	const files = Array.from(byFile.keys());

	const renderGrouped = (maxFiles: number, maxLocsPerFile: number, showHint: boolean): string => {
		const expandHint = formatExpandHint(theme, undefined, showHint);
		let output = `${icon} ${theme.fg("dim", `${refCount} found`)}${expandHint}`;

		const filesToShow = files.slice(0, maxFiles);
		for (let fi = 0; fi < filesToShow.length; fi++) {
			const file = filesToShow[fi];
			const locs = byFile.get(file)!;
			const isLastFile = fi === filesToShow.length - 1 && files.length <= maxFiles;
			const fileBranch = isLastFile ? theme.tree.last : theme.tree.branch;
			const fileCont = isLastFile ? "   " : `${theme.tree.vertical}  `;

			const fileMeta = `${locs.length} reference${locs.length !== 1 ? "s" : ""}`;
			output += `\n ${theme.fg("dim", fileBranch)} ${theme.fg("accent", file)} ${theme.fg("dim", fileMeta)}`;

			if (maxLocsPerFile > 0) {
				const locsToShow = locs.slice(0, maxLocsPerFile);
				for (let li = 0; li < locsToShow.length; li++) {
					const [line, col] = locsToShow[li];
					const isLastLoc = li === locsToShow.length - 1 && locs.length <= maxLocsPerFile;
					const locBranch = isLastLoc ? theme.tree.last : theme.tree.branch;
					const locCont = isLastLoc ? "   " : `${theme.tree.vertical}  `;
					output += `\n ${theme.fg("dim", fileCont)}${theme.fg("dim", locBranch)} ${theme.fg(
						"muted",
						`line ${line}, col ${col}`,
					)}`;
					if (expanded) {
						const context = `at ${file}:${line}:${col}`;
						output += `\n ${theme.fg("dim", fileCont)}${theme.fg("dim", locCont)}${theme.fg(
							"muted",
							truncate(context, TRUNCATE_LENGTHS.LINE, theme.format.ellipsis),
						)}`;
					}
				}
				if (locs.length > maxLocsPerFile) {
					output += `\n ${theme.fg("dim", fileCont)}${theme.fg("dim", theme.tree.last)} ${theme.fg(
						"muted",
						`${theme.format.ellipsis} ${locs.length - maxLocsPerFile} more`,
					)}`;
				}
			}
		}

		if (files.length > maxFiles) {
			output += `\n ${theme.fg("dim", theme.tree.last)} ${theme.fg(
				"muted",
				formatMoreItems(files.length - maxFiles, "file", theme),
			)}`;
		}

		return output;
	};

	if (expanded) {
		return renderGrouped(files.length, 3, false).split("\n");
	}

	return renderGrouped(3, 1, true).split("\n");
}

// =============================================================================
// Symbols Rendering
// =============================================================================

/**
 * Render document symbols in a hierarchical tree.
 */
function renderSymbols(symbolsMatch: RegExpMatchArray, lines: string[], expanded: boolean, theme: Theme): string[] {
	const fileName = symbolsMatch[1];
	const icon = theme.styledSymbol("status.info", "accent");

	interface SymbolInfo {
		name: string;
		line: string;
		indent: number;
		icon: string;
	}

	const symbolLines = lines.filter((l) => l.includes("@") && l.includes("line"));
	const symbols: SymbolInfo[] = [];

	for (const line of symbolLines) {
		const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
		const symMatch = line.trim().match(/^(\S+)\s+(.+?)\s*@\s*line\s*(\d+)/);
		if (symMatch) {
			symbols.push({ icon: symMatch[1], name: symMatch[2], line: symMatch[3], indent });
		}
	}

	const isLastSibling = (i: number): boolean => {
		const myIndent = symbols[i].indent;
		for (let j = i + 1; j < symbols.length; j++) {
			const nextIndent = symbols[j].indent;
			if (nextIndent === myIndent) return false;
			if (nextIndent < myIndent) return true;
		}
		return true;
	};

	const getPrefix = (i: number): string => {
		const myIndent = symbols[i].indent;
		if (myIndent === 0) return " ";

		let prefix = " ";
		for (let level = 2; level <= myIndent; level += 2) {
			let ancestorIdx = -1;
			for (let j = i - 1; j >= 0; j--) {
				if (symbols[j].indent === level - 2) {
					ancestorIdx = j;
					break;
				}
			}
			if (ancestorIdx >= 0 && isLastSibling(ancestorIdx)) {
				prefix += "   ";
			} else {
				prefix += `${theme.tree.vertical}  `;
			}
		}
		return prefix;
	};

	const topLevelCount = symbols.filter((s) => s.indent === 0).length;

	if (expanded) {
		let output = `${icon} ${theme.fg("dim", `in ${fileName}`)}`;

		for (let i = 0; i < symbols.length; i++) {
			const sym = symbols[i];
			const prefix = getPrefix(i);
			const isLast = isLastSibling(i);
			const branch = isLast ? theme.tree.last : theme.tree.branch;
			const detailPrefix = isLast ? "   " : `${theme.tree.vertical}  `;
			output += `\n${prefix}${theme.fg("dim", branch)} ${theme.fg("accent", sym.icon)} ${theme.fg("accent", sym.name)}`;
			output += `\n${prefix}${theme.fg("dim", detailPrefix)}${theme.fg("muted", `line ${sym.line}`)}`;
		}
		return output.split("\n");
	}

	// Collapsed: show first 3 top-level symbols
	const topLevel = symbols.filter((s) => s.indent === 0).slice(0, 3);
	const hasMoreSymbols = symbols.length > topLevel.length;
	const expandHint = formatExpandHint(theme, expanded, hasMoreSymbols);
	let output = `${icon} ${theme.fg("dim", `in ${fileName}`)}${expandHint}`;
	for (let i = 0; i < topLevel.length; i++) {
		const sym = topLevel[i];
		const isLast = i === topLevel.length - 1 && topLevelCount <= 3;
		const branch = isLast ? theme.tree.last : theme.tree.branch;
		output += `\n ${theme.fg("dim", branch)} ${theme.fg("accent", sym.icon)} ${theme.fg("accent", sym.name)} ${theme.fg(
			"muted",
			`line ${sym.line}`,
		)}`;
	}
	if (topLevelCount > 3) {
		output += `\n ${theme.fg("dim", theme.tree.last)} ${theme.fg(
			"muted",
			`${theme.format.ellipsis} ${topLevelCount - 3} more`,
		)}`;
	}

	return output.split("\n");
}

// =============================================================================
// Generic Rendering
// =============================================================================

/**
 * Generic fallback rendering for unknown result types.
 */
function renderGeneric(text: string, lines: string[], expanded: boolean, theme: Theme): string[] {
	const hasError = text.includes("Error:") || text.includes(theme.status.error);
	const hasSuccess = text.includes(theme.status.success) || text.includes("Applied");

	const icon =
		hasError && !hasSuccess
			? theme.styledSymbol("status.error", "error")
			: hasSuccess && !hasError
				? theme.styledSymbol("status.success", "success")
				: theme.styledSymbol("status.info", "accent");

	if (expanded) {
		let output = `${icon} ${theme.fg("dim", "Output")}`;
		for (let i = 0; i < lines.length; i++) {
			const isLast = i === lines.length - 1;
			const branch = isLast ? theme.tree.last : theme.tree.branch;
			output += `\n ${theme.fg("dim", branch)} ${lines[i]}`;
		}
		return output.split("\n");
	}

	const firstLine = lines[0] || "No output";
	const expandHint = formatExpandHint(theme, expanded, lines.length > 1);
	let output = `${icon} ${theme.fg(
		"dim",
		truncate(firstLine, TRUNCATE_LENGTHS.TITLE, theme.format.ellipsis),
	)}${expandHint}`;

	if (lines.length > 1) {
		const previewLines = lines.slice(1, 4);
		for (let i = 0; i < previewLines.length; i++) {
			const isLast = i === previewLines.length - 1 && lines.length <= 4;
			const branch = isLast ? theme.tree.last : theme.tree.branch;
			output += `\n ${theme.fg("dim", branch)} ${theme.fg(
				"dim",
				truncate(previewLines[i].trim(), TRUNCATE_LENGTHS.CONTENT, theme.format.ellipsis),
			)}`;
		}
		if (lines.length > 4) {
			output += `\n ${theme.fg("dim", theme.tree.last)} ${theme.fg(
				"muted",
				formatMoreItems(lines.length - 4, "line", theme),
			)}`;
		}
	}

	return output.split("\n");
}

// =============================================================================
// Parsing Helpers
// =============================================================================

interface ParsedDiagnostic {
	file: string;
	line: string;
	col: string;
	severity: string;
	message: string;
}

interface RawDiagnostic {
	raw: string;
}

type DiagnosticItem = ParsedDiagnostic | RawDiagnostic;

function parseDiagnosticLine(line: string): ParsedDiagnostic | null {
	const match = line.trim().match(/^(.*):(\d+):(\d+)\s+\[(\w+)\]\s*(.*)$/);
	if (!match) return null;
	const [, file, lineNum, colNum, severity, message] = match;
	return { file, line: lineNum, col: colNum, severity: severity.toLowerCase(), message };
}

function severityToColor(severity: string): "error" | "warning" | "accent" | "dim" {
	switch (severity) {
		case "error":
			return "error";
		case "warning":
			return "warning";
		case "info":
			return "accent";
		default:
			return "dim";
	}
}

export const lspToolRenderer = {
	renderCall,
	renderResult,
};
