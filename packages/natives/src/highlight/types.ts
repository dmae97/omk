/**
 * Types for syntax highlighting.
 */

/**
 * Theme colors for syntax highlighting.
 * Each color should be an ANSI escape sequence (e.g., "\x1b[38;2;255;0;0m").
 */
export interface HighlightColors {
	/** ANSI color for comments. */
	comment: string;
	/** ANSI color for keywords. */
	keyword: string;
	/** ANSI color for function names. */
	function: string;
	/** ANSI color for variables and identifiers. */
	variable: string;
	/** ANSI color for string literals. */
	string: string;
	/** ANSI color for numeric literals. */
	number: string;
	/** ANSI color for type identifiers. */
	type: string;
	/** ANSI color for operators. */
	operator: string;
	/** ANSI color for punctuation tokens. */
	punctuation: string;
	/** Color for diff inserted lines (+). */
	inserted?: string;
	/** Color for diff deleted lines (-). */
	deleted?: string;
}

declare module "../bindings" {
	interface NativeBindings {
		/**
		 * Highlight code with syntax coloring.
		 * @param code Source code to highlight.
		 * @param lang Language name, extension, or null for plain text.
		 * @param colors ANSI color palette for semantic scopes.
		 * @returns Highlighted code with ANSI color codes.
		 */
		highlightCode(code: string, lang: string | null | undefined, colors: HighlightColors): string;
		/**
		 * Check if a language is supported for highlighting.
		 * @param lang Language name or extension to test.
		 * @returns True when highlighting is available.
		 */
		supportsLanguage(lang: string): boolean;
		/**
		 * Get list of all supported languages.
		 * @returns Syntect language names supported by the native highlighter.
		 */
		getSupportedLanguages(): string[];
	}
}
