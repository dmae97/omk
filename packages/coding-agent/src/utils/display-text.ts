import { stripVTControlCharacters } from "node:util";

/**
 * Unpaired UTF-16 surrogates. stdout encodes each one as U+FFFD, a visible cell, while width counting
 * sees none, so they become U+FFFD here and are counted as the terminal will draw them.
 */
const LONE_SURROGATES = /[\ud800-\udfff]/gu;
const LINE_BREAKS = /[\t\n\v\f\r\u0085\u2028\u2029]+/g;
/**
 * C0/C1 controls, DEL, and bidi marks/embeddings/overrides/isolates (Trojan Source).
 * ZWJ/ZWNJ (U+200C/U+200D) stay: emoji sequences and Persian text depend on them.
 */
const UNSAFE_DISPLAY_CHARS = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/**
 * One printable line for a terminal status row. VT/ANSI sequences are removed, line breaks become
 * spaces, remaining controls and bidi marks are dropped, and whitespace is collapsed, so text from a
 * session, run journal, model, or file system can neither drive the terminal nor split the row.
 */
export function singleLineDisplayText(text: string): string {
	return stripVTControlCharacters(text.replace(LONE_SURROGATES, "\ufffd"))
		.replace(LINE_BREAKS, " ")
		.replace(UNSAFE_DISPLAY_CHARS, "")
		.replace(/\s+/g, " ")
		.trim();
}
