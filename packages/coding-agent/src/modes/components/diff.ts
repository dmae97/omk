import { getIndentation } from "@oh-my-pi/pi-utils";
import * as Diff from "diff";
import { theme } from "../../modes/theme/theme";
import { replaceTabs } from "../../tools/render-utils";

/** SGR dim on / normal intensity — additive, preserves fg/bg colors. */
const DIM = "\x1b[2m";
const DIM_OFF = "\x1b[22m";

/**
 * Visualize leading whitespace (indentation) with dim glyphs.
 * Tabs become ` → ` and spaces become `·`. Only affects whitespace
 * before the first non-whitespace character; remaining tabs in code
 * content are replaced with spaces (like replaceTabs).
 */
function visualizeIndent(text: string, filePath?: string): string {
	const match = text.match(/^([ \t]+)/);
	if (!match) return replaceTabs(text, filePath);
	const indent = match[1];
	const rest = text.slice(indent.length);
	const indentation = getIndentation(filePath);
	const tabWidth = indentation.length;
	const leftPadding = Math.floor(tabWidth / 2);
	const rightPadding = Math.max(0, tabWidth - leftPadding - 1);
	const tabMarker = `${DIM}${" ".repeat(leftPadding)}→${" ".repeat(rightPadding)}${DIM_OFF}`;
	// Normalize: collapse configured tab-width groups into tab markers, then handle remaining spaces.
	const normalized = indent.replaceAll("\t", indentation);
	let visible = "";
	let pos = 0;
	while (pos < normalized.length) {
		if (pos + tabWidth <= normalized.length && normalized.slice(pos, pos + tabWidth) === indentation) {
			visible += tabMarker;
			pos += tabWidth;
		} else {
			visible += `${DIM}·${DIM_OFF}`;
			pos++;
		}
	}
	return `${visible}${replaceTabs(rest, filePath)}`;
}

/**
 * Parse diff line to extract prefix, line number, and content.
 * Supported formats: "+123|content" (canonical) and "+123 content" (legacy).
 */
function parseDiffLine(line: string): { prefix: string; lineNum: string; content: string } | null {
	const canonical = line.match(/^([+-\s])(\s*\d+)\|(.*)$/);
	if (canonical) {
		return { prefix: canonical[1], lineNum: canonical[2], content: canonical[3] };
	}
	const legacy = line.match(/^([+-\s])(?:(\s*\d+)\s)?(.*)$/);
	if (!legacy) return null;
	return { prefix: legacy[1], lineNum: legacy[2] ?? "", content: legacy[3] };
}

/**
 * Compute word-level diff and render with inverse on changed parts.
 * Uses diffWords which groups whitespace with adjacent words for cleaner highlighting.
 * Strips leading whitespace from inverse to avoid highlighting indentation.
 */
function renderIntraLineDiff(oldContent: string, newContent: string): { removedLine: string; addedLine: string } {
	const wordDiff = Diff.diffWords(oldContent, newContent);

	let removedLine = "";
	let addedLine = "";
	let isFirstRemoved = true;
	let isFirstAdded = true;

	for (const part of wordDiff) {
		if (part.removed) {
			let value = part.value;
			// Strip leading whitespace from the first removed part
			if (isFirstRemoved) {
				const leadingWs = value.match(/^(\s*)/)?.[1] || "";
				value = value.slice(leadingWs.length);
				removedLine += leadingWs;
				isFirstRemoved = false;
			}
			if (value) {
				removedLine += theme.inverse(value);
			}
		} else if (part.added) {
			let value = part.value;
			// Strip leading whitespace from the first added part
			if (isFirstAdded) {
				const leadingWs = value.match(/^(\s*)/)?.[1] || "";
				value = value.slice(leadingWs.length);
				addedLine += leadingWs;
				isFirstAdded = false;
			}
			if (value) {
				addedLine += theme.inverse(value);
			}
		} else {
			removedLine += part.value;
			addedLine += part.value;
		}
	}

	return { removedLine, addedLine };
}

export interface RenderDiffOptions {
	/** File path used to resolve indentation (.editorconfig + defaults) */
	filePath?: string;
}

/**
 * Render a diff string with colored lines and intra-line change highlighting.
 * - Context lines: dim/gray
 * - Removed lines: red, with inverse on changed tokens
 * - Added lines: green, with inverse on changed tokens
 */
export function renderDiff(diffText: string, options: RenderDiffOptions = {}): string {
	const lines = diffText.split("\n");
	const result: string[] = [];

	const formatLine = (prefix: string, lineNum: string, content: string): string => {
		if (lineNum.trim().length === 0) {
			return `${prefix}${content}`;
		}
		return `${prefix}${lineNum}|${content}`;
	};

	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		const parsed = parseDiffLine(line);

		if (!parsed) {
			result.push(theme.fg("toolDiffContext", line));
			i++;
			continue;
		}

		if (parsed.prefix === "-") {
			// Collect consecutive removed lines
			const removedLines: { lineNum: string; content: string }[] = [];
			while (i < lines.length) {
				const p = parseDiffLine(lines[i]);
				if (!p || p.prefix !== "-") break;
				removedLines.push({ lineNum: p.lineNum, content: p.content });
				i++;
			}

			// Collect consecutive added lines
			const addedLines: { lineNum: string; content: string }[] = [];
			while (i < lines.length) {
				const p = parseDiffLine(lines[i]);
				if (!p || p.prefix !== "+") break;
				addedLines.push({ lineNum: p.lineNum, content: p.content });
				i++;
			}

			// Only do intra-line diffing when there's exactly one removed and one added line
			// (indicating a single line modification). Otherwise, show lines as-is.
			if (removedLines.length === 1 && addedLines.length === 1) {
				const removed = removedLines[0];
				const added = addedLines[0];

				const { removedLine, addedLine } = renderIntraLineDiff(
					replaceTabs(removed.content, options.filePath),
					replaceTabs(added.content, options.filePath),
				);

				result.push(
					theme.fg(
						"toolDiffRemoved",
						formatLine("-", removed.lineNum, visualizeIndent(removedLine, options.filePath)),
					),
				);
				result.push(
					theme.fg("toolDiffAdded", formatLine("+", added.lineNum, visualizeIndent(addedLine, options.filePath))),
				);
			} else {
				// Show all removed lines first, then all added lines
				for (const removed of removedLines) {
					result.push(
						theme.fg(
							"toolDiffRemoved",
							formatLine("-", removed.lineNum, visualizeIndent(removed.content, options.filePath)),
						),
					);
				}
				for (const added of addedLines) {
					result.push(
						theme.fg(
							"toolDiffAdded",
							formatLine("+", added.lineNum, visualizeIndent(added.content, options.filePath)),
						),
					);
				}
			}
		} else if (parsed.prefix === "+") {
			// Standalone added line
			result.push(
				theme.fg(
					"toolDiffAdded",
					formatLine("+", parsed.lineNum, visualizeIndent(parsed.content, options.filePath)),
				),
			);
			i++;
		} else {
			// Context line
			result.push(
				theme.fg(
					"toolDiffContext",
					formatLine(" ", parsed.lineNum, visualizeIndent(parsed.content, options.filePath)),
				),
			);
			i++;
		}
	}

	return result.join("\n");
}
