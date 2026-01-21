/**
 * Text normalization utilities for the edit tool.
 *
 * Handles line endings, BOM, whitespace, and Unicode normalization.
 */

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
		.map((c) => {
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
	const oldMin = minIndent(oldText);
	const actualMin = minIndent(actualText);
	const newMin = minIndent(newText);
	const delta = actualMin - oldMin;

	if (delta === 0) {
		return newText;
	}

	if (newMin === actualMin) {
		return newText;
	}

	if (newMin !== oldMin) {
		return newText;
	}

	const indentChar = detectIndentChar(actualText);
	const lines = newText.split("\n");

	const adjusted = lines.map((line) => {
		if (line.trim().length === 0) {
			return line; // Preserve empty/whitespace-only lines as-is
		}

		if (delta > 0) {
			return indentChar.repeat(delta) + line;
		}

		// Remove indentation (delta < 0)
		const toRemove = Math.min(-delta, countLeadingWhitespace(line));
		return line.slice(toRemove);
	});

	return adjusted.join("\n");
}
