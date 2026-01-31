/**
 * Syntax highlighting powered by WASM (syntect).
 */

import * as wasm from "../../wasm/pi_natives";

type WasmHighlightExports = typeof wasm & {
	highlight_code: (code: string, lang: string | null | undefined, colors: HighlightColors) => string;
	supports_language: (lang: string) => boolean;
	get_supported_languages: () => string[];
};

const wasmHighlight = wasm as WasmHighlightExports;

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
	return wasmHighlight.highlight_code(code, lang, colors);
}

/**
 * Check if a language is supported for highlighting.
 */
export function supportsLanguage(lang: string): boolean {
	return wasmHighlight.supports_language(lang);
}

/**
 * Get list of all supported languages.
 */
export function getSupportedLanguages(): string[] {
	return wasmHighlight.get_supported_languages();
}
