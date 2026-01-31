/**
 * Text normalization utilities for the edit tool.
 *
 * Handles line endings, BOM, whitespace, and Unicode normalization.
 */

import { padding } from "@oh-my-pi/pi-tui";

// ═══════════════════════════════════════════════════════════════════════════
// Line Ending Utilities
// ═══════════════════════════════════════════════════════════════════════════

export type LineEnding = "\r\n" | "\n";

/** Detect the predominant line ending in content */
export function detectLineEnding(content: string): LineEnding {
	const crlfIdx = content.indexOf("\r\n");
	const lfIdx = content.indexOf("\n");
	if (lfIdx === -1) return "\n";
	if (crlfIdx === -1) return "\n";
	return crlfIdx < lfIdx ? "\r\n" : "\n";
}

/** Normalize all line endings to LF */
export function normalizeToLF(text: string): string {
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/** Restore line endings to the specified type */
export function restoreLineEndings(text: string, ending: LineEnding): string {
	return ending === "\r\n" ? text.replace(/\n/g, "\r\n") : text;
}

// ═══════════════════════════════════════════════════════════════════════════
// BOM Handling
// ═══════════════════════════════════════════════════════════════════════════

export interface BomResult {
	/** The BOM character if present, empty string otherwise */
	bom: string;
	/** The text without the BOM */
	text: string;
}

/** Strip UTF-8 BOM if present */
export function stripBom(content: string): BomResult {
	return content.startsWith("\uFEFF") ? { bom: "\uFEFF", text: content.slice(1) } : { bom: "", text: content };
}

// ═══════════════════════════════════════════════════════════════════════════
// Whitespace Utilities
// ═══════════════════════════════════════════════════════════════════════════

/** Count leading whitespace characters in a line */
export function countLeadingWhitespace(line: string): number {
	let count = 0;
	for (let i = 0; i < line.length; i++) {
		const char = line[i];
		if (char === " " || char === "\t") {
			count++;
		} else {
			break;
		}
	}
	return count;
}

/** Get the leading whitespace string from a line */
export function getLeadingWhitespace(line: string): string {
	return line.slice(0, countLeadingWhitespace(line));
}

/** Compute minimum indentation of non-empty lines */
export function minIndent(text: string): number {
	const lines = text.split("\n");
	let min = Infinity;
	for (const line of lines) {
		if (line.trim().length > 0) {
			min = Math.min(min, countLeadingWhitespace(line));
		}
	}
	return min === Infinity ? 0 : min;
}

/** Detect the indentation character used in text (space or tab) */
export function detectIndentChar(text: string): string {
	const lines = text.split("\n");
	for (const line of lines) {
		const ws = getLeadingWhitespace(line);
		if (ws.length > 0) {
			return ws[0];
		}
	}
	return " ";
}

function gcd(a: number, b: number): number {
	let x = Math.abs(a);
	let y = Math.abs(b);
	while (y !== 0) {
		const temp = y;
		y = x % y;
		x = temp;
	}
	return x;
}

interface IndentProfile {
	lines: string[];
	indentStrings: string[];
	indentCounts: number[];
	min: number;
	char: " " | "\t" | undefined;
	spaceOnly: boolean;
	tabOnly: boolean;
	mixed: boolean;
	unit: number;
	nonEmptyCount: number;
}

function buildIndentProfile(text: string): IndentProfile {
	const lines = text.split("\n");
	const indentStrings: string[] = [];
	const indentCounts: number[] = [];
	let min = Infinity;
	let char: " " | "\t" | undefined;
	let spaceOnly = true;
	let tabOnly = true;
	let mixed = false;
	let nonEmptyCount = 0;
	let unit = 0;

	for (const line of lines) {
		if (line.trim().length === 0) continue;
		nonEmptyCount++;
		const indent = getLeadingWhitespace(line);
		indentStrings.push(indent);
		indentCounts.push(indent.length);
		min = Math.min(min, indent.length);
		if (indent.includes(" ")) {
			tabOnly = false;
		}
		if (indent.includes("\t")) {
			spaceOnly = false;
		}
		if (indent.includes(" ") && indent.includes("\t")) {
			mixed = true;
		}
		if (indent.length > 0) {
			const currentChar = indent[0] as " " | "\t";
			if (!char) {
				char = currentChar;
			} else if (char !== currentChar) {
				mixed = true;
			}
		}
	}

	if (min === Infinity) {
		min = 0;
	}

	if (spaceOnly && nonEmptyCount > 0) {
		let current = 0;
		for (const count of indentCounts) {
			if (count === 0) continue;
			current = current === 0 ? count : gcd(current, count);
		}
		unit = current;
	}

	if (tabOnly && nonEmptyCount > 0) {
		unit = 1;
	}

	return {
		lines,
		indentStrings,
		indentCounts,
		min,
		char,
		spaceOnly,
		tabOnly,
		mixed,
		unit,
		nonEmptyCount,
	};
}

export function convertLeadingTabsToSpaces(text: string, spacesPerTab: number): string {
	if (spacesPerTab <= 0) return text;
	return text
		.split("\n")
		.map(line => {
			const trimmed = line.trimStart();
			if (trimmed.length === 0) return line;
			const leading = getLeadingWhitespace(line);
			if (!leading.includes("\t") || leading.includes(" ")) return line;
			const converted = padding(leading.length * spacesPerTab);
			return converted + trimmed;
		})
		.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════
// Unicode Normalization
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Normalize common Unicode punctuation to ASCII equivalents.
 * Allows diffs with ASCII characters to match source files with typographic punctuation.
 */
export function normalizeUnicode(s: string): string {
	return s
		.trim()
		.split("")
		.map(c => {
			const code = c.charCodeAt(0);

			// Various dash/hyphen code-points → ASCII '-'
			if (
				code === 0x2010 || // HYPHEN
				code === 0x2011 || // NON-BREAKING HYPHEN
				code === 0x2012 || // FIGURE DASH
				code === 0x2013 || // EN DASH
				code === 0x2014 || // EM DASH
				code === 0x2015 || // HORIZONTAL BAR
				code === 0x2212 // MINUS SIGN
			) {
				return "-";
			}

			// Fancy single quotes → '
			if (
				code === 0x2018 || // LEFT SINGLE QUOTATION MARK
				code === 0x2019 || // RIGHT SINGLE QUOTATION MARK
				code === 0x201a || // SINGLE LOW-9 QUOTATION MARK
				code === 0x201b // SINGLE HIGH-REVERSED-9 QUOTATION MARK
			) {
				return "'";
			}

			// Fancy double quotes → "
			if (
				code === 0x201c || // LEFT DOUBLE QUOTATION MARK
				code === 0x201d || // RIGHT DOUBLE QUOTATION MARK
				code === 0x201e || // DOUBLE LOW-9 QUOTATION MARK
				code === 0x201f // DOUBLE HIGH-REVERSED-9 QUOTATION MARK
			) {
				return '"';
			}

			// Non-breaking space and other odd spaces → normal space
			if (
				code === 0x00a0 || // NO-BREAK SPACE
				code === 0x2002 || // EN SPACE
				code === 0x2003 || // EM SPACE
				code === 0x2004 || // THREE-PER-EM SPACE
				code === 0x2005 || // FOUR-PER-EM SPACE
				code === 0x2006 || // SIX-PER-EM SPACE
				code === 0x2007 || // FIGURE SPACE
				code === 0x2008 || // PUNCTUATION SPACE
				code === 0x2009 || // THIN SPACE
				code === 0x200a || // HAIR SPACE
				code === 0x202f || // NARROW NO-BREAK SPACE
				code === 0x205f || // MEDIUM MATHEMATICAL SPACE
				code === 0x3000 // IDEOGRAPHIC SPACE
			) {
				return " ";
			}

			return c;
		})
		.join("");
}

/**
 * Normalize a line for fuzzy comparison.
 * Trims, collapses whitespace, and normalizes punctuation.
 */
export function normalizeForFuzzy(line: string): string {
	const trimmed = line.trim();
	if (trimmed.length === 0) return "";

	return trimmed
		.replace(/[""„‟«»]/g, '"')
		.replace(/[''‚‛`´]/g, "'")
		.replace(/[‐‑‒–—−]/g, "-")
		.replace(/[ \t]+/g, " ");
}

// ═══════════════════════════════════════════════════════════════════════════
// Indentation Adjustment
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Adjust newText indentation to match the indentation delta between
 * what was provided (oldText) and what was actually matched (actualText).
 *
 * If oldText has 0 indent but actualText has 12 spaces, we add 12 spaces
 * to each line in newText.
 */
export function adjustIndentation(oldText: string, actualText: string, newText: string): string {
	// If old text already matches actual text exactly, preserve agent's intended indentation
	if (oldText === actualText) {
		return newText;
	}

	// If the patch is purely an indentation change (same trimmed content), apply exactly as specified
	const oldLines = oldText.split("\n");
	const newLines = newText.split("\n");
	if (oldLines.length === newLines.length) {
		let indentationOnly = true;
		for (let i = 0; i < oldLines.length; i++) {
			if (oldLines[i].trim() !== newLines[i].trim()) {
				indentationOnly = false;
				break;
			}
		}
		if (indentationOnly) {
			return newText;
		}
	}

	const oldProfile = buildIndentProfile(oldText);
	const actualProfile = buildIndentProfile(actualText);
	const newProfile = buildIndentProfile(newText);

	if (newProfile.nonEmptyCount === 0 || oldProfile.nonEmptyCount === 0 || actualProfile.nonEmptyCount === 0) {
		return newText;
	}

	if (oldProfile.mixed || actualProfile.mixed || newProfile.mixed) {
		return newText;
	}

	if (oldProfile.char && actualProfile.char && oldProfile.char !== actualProfile.char) {
		if (actualProfile.spaceOnly && oldProfile.tabOnly && newProfile.tabOnly && actualProfile.unit > 0) {
			let consistent = true;
			const lineCount = Math.min(oldProfile.lines.length, actualProfile.lines.length);
			for (let i = 0; i < lineCount; i++) {
				const oldLine = oldProfile.lines[i];
				const actualLine = actualProfile.lines[i];
				if (oldLine.trim().length === 0 || actualLine.trim().length === 0) continue;
				const oldIndent = getLeadingWhitespace(oldLine);
				const actualIndent = getLeadingWhitespace(actualLine);
				if (oldIndent.length === 0) continue;
				if (actualIndent.length !== oldIndent.length * actualProfile.unit) {
					consistent = false;
					break;
				}
			}
			return consistent ? convertLeadingTabsToSpaces(newText, actualProfile.unit) : newText;
		}
		return newText;
	}

	const lineCount = Math.min(oldProfile.lines.length, actualProfile.lines.length);
	const deltas: number[] = [];
	for (let i = 0; i < lineCount; i++) {
		const oldLine = oldProfile.lines[i];
		const actualLine = actualProfile.lines[i];
		if (oldLine.trim().length === 0 || actualLine.trim().length === 0) continue;
		deltas.push(countLeadingWhitespace(actualLine) - countLeadingWhitespace(oldLine));
	}

	if (deltas.length === 0) {
		return newText;
	}

	const delta = deltas[0];
	if (!deltas.every(value => value === delta)) {
		return newText;
	}

	if (delta === 0) {
		return newText;
	}

	if (newProfile.char && actualProfile.char && newProfile.char !== actualProfile.char) {
		return newText;
	}

	const indentChar = actualProfile.char ?? oldProfile.char ?? detectIndentChar(actualText);
	const adjusted = newText.split("\n").map(line => {
		if (line.trim().length === 0) {
			return line;
		}
		if (delta > 0) {
			return indentChar.repeat(delta) + line;
		}
		const toRemove = Math.min(-delta, countLeadingWhitespace(line));
		return line.slice(toRemove);
	});

	return adjusted.join("\n");
}
