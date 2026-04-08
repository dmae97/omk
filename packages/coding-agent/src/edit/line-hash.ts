/**
 * Lightweight line-hash utilities extracted from hashline.ts to avoid
 * circular dependencies (prompt-templates → hashline → tools → edit).
 */

/** 16-char nibble alphabet (no digits); shared with chunk checksum suffixes. */
export const HASHLINE_NIBBLE_ALPHABET = "ZPMQVRWSNKTXJBYH";

const NIBBLE_STR = HASHLINE_NIBBLE_ALPHABET;

const DICT = Array.from({ length: 256 }, (_, i) => {
	const h = i >>> 4;
	const l = i & 0x0f;
	return `${NIBBLE_STR[h]}${NIBBLE_STR[l]}`;
});

const RE_SIGNIFICANT = /[\p{L}\p{N}]/u;

/**
 * Compute a short hexadecimal hash of a single line.
 *
 * Uses xxHash32 on a trailing-whitespace-trimmed, CR-stripped line, truncated to 2 chars from
 * {@link NIBBLE_STR}. For lines containing no alphanumeric characters (only
 * punctuation/symbols/whitespace), the line number is mixed in to reduce hash collisions.
 * The line input should not include a trailing newline.
 */
export function computeLineHash(idx: number, line: string): string {
	line = line.replace(/\r/g, "").trimEnd();

	let seed = 0;
	if (!RE_SIGNIFICANT.test(line)) {
		seed = idx;
	}
	return DICT[Bun.hash.xxHash32(line, seed) & 0xff];
}

/**
 * Formats a hash given the line number and text.
 */
export function formatLineHash(line: number, lines: string): string {
	return `${line}#${computeLineHash(line, lines)}`;
}

/**
 * Format file text with hashline prefixes for display.
 *
 * Each line becomes `LINENUM#HASH:TEXT` where LINENUM is 1-indexed.
 *
 * @param text - Raw file text string
 * @param startLine - First line number (1-indexed, defaults to 1)
 * @returns Formatted string with one hashline-prefixed line per input line
 *
 * @example
 * ```
 * formatHashLines("function hi() {\n  return;\n}")
 * // "1#HH:function hi() {\n2#HH:  return;\n3#HH:}"
 * ```
 */
export function formatHashLines(text: string, startLine = 1): string {
	const lines = text.split("\n");
	return lines
		.map((line, i) => {
			const num = startLine + i;
			return `${formatLineHash(num, line)}:${line}`;
		})
		.join("\n");
}
