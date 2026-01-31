/** Options for searching files. */
export interface GrepOptions {
	/** Regex pattern to search for */
	pattern: string;
	/** Directory or file to search */
	path: string;
	/** Glob filter for filenames (e.g., "*.ts") */
	glob?: string;
	/** Filter by file type (e.g., "js", "py", "rust") */
	type?: string;
	/** Case-insensitive search */
	ignoreCase?: boolean;
	/** Enable multiline matching */
	multiline?: boolean;
	/** Include hidden files (default: true) */
	hidden?: boolean;
	/** Maximum number of matches to return */
	maxCount?: number;
	/** Skip first N matches */
	offset?: number;
	/** Lines of context before/after matches */
	context?: number;
	/** Truncate lines longer than this (characters) */
	maxColumns?: number;
	/** Output mode */
	mode?: "content" | "filesWithMatches" | "count";
}

export interface ContextLine {
	lineNumber: number;
	line: string;
}

export interface GrepMatch {
	path: string;
	lineNumber: number;
	line: string;
	contextBefore?: ContextLine[];
	contextAfter?: ContextLine[];
	truncated?: boolean;
	matchCount?: number;
}

export interface GrepSummary {
	totalMatches: number;
	filesWithMatches: number;
	filesSearched: number;
	limitReached?: boolean;
}

export interface GrepResult extends GrepSummary {
	matches: GrepMatch[];
}

export interface SearchOptions {
	/** Regex pattern to search for */
	pattern: string;
	/** Case-insensitive search */
	ignoreCase?: boolean;
	/** Enable multiline matching */
	multiline?: boolean;
	/** Maximum number of matches to return */
	maxCount?: number;
	/** Skip first N matches */
	offset?: number;
	/** Lines of context before/after matches */
	context?: number;
	/** Truncate lines longer than this (characters) */
	maxColumns?: number;
	/** Output mode */
	mode?: "content" | "count";
}

export interface SearchMatch {
	lineNumber: number;
	line: string;
	contextBefore?: ContextLine[];
	contextAfter?: ContextLine[];
	truncated?: boolean;
}

export interface SearchResult {
	matches: SearchMatch[];
	matchCount: number;
	limitReached: boolean;
	error?: string;
}

export type WasmMatch = SearchMatch;
export type WasmSearchResult = SearchResult;
