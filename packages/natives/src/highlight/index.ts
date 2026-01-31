/**
 * Syntax highlighting powered by native syntect bindings.
 */

import { native } from "../native";

/**
 * Theme colors for syntax highlighting.
 * Each color should be an ANSI escape sequence (e.g., "\x1b[38;2;255;0;0m").
 */
export interface HighlightColors {
	comment: string;
	keyword: string;
	function: string;
	variable: string;
	string: string;
	number: string;
	type: string;
	operator: string;
	punctuation: string;
	/** Color for diff inserted lines (+). Optional, defaults to no coloring. */
	inserted?: string;
	/** Color for diff deleted lines (-). Optional, defaults to no coloring. */
	deleted?: string;
}

/**
 * Highlight code with syntax coloring.
 *
 * @param code - The source code to highlight
 * @param lang - Optional language identifier (e.g., "rust", "typescript", "python")
 * @param colors - Theme colors as ANSI escape sequences
 * @returns Highlighted code as a single string with ANSI color codes
 */
export function highlightCode(code: string, lang: string | undefined, colors: HighlightColors): string {
	return native.highlightCode(code, lang, colors);
}

/**
 * Check if a language is supported for highlighting.
 */
export function supportsLanguage(lang: string): boolean {
	return native.supportsLanguage(lang);
}

/**
 * Get list of all supported languages.
 */
export function getSupportedLanguages(): string[] {
	return native.getSupportedLanguages();
}
