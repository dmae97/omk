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
function visualizeIndent(text: string): string {
	const match = text.match(/^([ \t]+)/);
	if (!match) return replaceTabs(text);
	const indent = match[1];
	const rest = text.slice(indent.length);
	// Normalize: collapse 3-space groups (tab-width) into tab arrows,
	// then handle remaining tabs and lone spaces.
	const normalized = indent.replaceAll("\t", "   ");
	let visible = "";
	let pos = 0;
	while (pos < normalized.length) {
		if (pos + 3 <= normalized.length && normalized.slice(pos, pos + 3) === "   ") {
			visible += `${DIM} → ${DIM_OFF}`;
			pos += 3;
		} else {
			visible += `${DIM}·${DIM_OFF}`;
			pos++;
		}
	}
	return `${visible}${replaceTabs(rest)}`;
}

/**
 * Parse diff line to extract prefix, line number, and content.
 * Format: "+123 content" or "-123 content" or " 123 content" or "     ..."
 */
function parseDiffLine(line: string): { prefix: string; lineNum: string; content: string } | null {
	const match = line.match(/^([+-\s])(?:(\s*\d+)\s)?(.*)$/);
	if (!match) return null;
	return { prefix: match[1], lineNum: match[2] ?? "", content: match[3] };
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
	/** File path (unused, kept for API compatibility) */
	filePath?: string;
}

/**
 * Render a diff string with colored lines and intra-line change highlighting.
 * - Context lines: dim/gray
 * - Removed lines: red, with inverse on changed tokens
 * - Added lines: green, with inverse on changed tokens
 */
export function renderDiff(diffText: string, _options: RenderDiffOptions = {}): string {
	const lines = diffText.split("\n");
	const result: string[] = [];

	const formatLine = (prefix: string, lineNum: string, content: string): string => {
		if (lineNum.trim().length === 0) {
			return `${prefix}${content}`;
		}
		return `${prefix}${lineNum} ${content}`;
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
					replaceTabs(removed.content),
					replaceTabs(added.content),
				);

				result.push(theme.fg("toolDiffRemoved", formatLine("-", removed.lineNum, visualizeIndent(removedLine))));
				result.push(theme.fg("toolDiffAdded", formatLine("+", added.lineNum, visualizeIndent(addedLine))));
			} else {
				// Show all removed lines first, then all added lines
				for (const removed of removedLines) {
					result.push(
						theme.fg("toolDiffRemoved", formatLine("-", removed.lineNum, visualizeIndent(removed.content))),
					);
				}
				for (const added of addedLines) {
					result.push(theme.fg("toolDiffAdded", formatLine("+", added.lineNum, visualizeIndent(added.content))));
				}
			}
		} else if (parsed.prefix === "+") {
			// Standalone added line
			result.push(theme.fg("toolDiffAdded", formatLine("+", parsed.lineNum, visualizeIndent(parsed.content))));
			i++;
		} else {
			// Context line
			result.push(theme.fg("toolDiffContext", formatLine(" ", parsed.lineNum, visualizeIndent(parsed.content))));
			i++;
		}
	}

	return result.join("\n");
}
