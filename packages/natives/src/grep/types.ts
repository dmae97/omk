/**
 * Types for grep/search operations.
 */

import type { Cancellable, TsFunc } from "../bindings";

/** Options for searching files. */
export interface GrepOptions extends Cancellable {
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
	/** Enable shared filesystem scan cache (default: false). */
	cache?: boolean;
	/** Maximum number of matches to return */
	maxCount?: number;
	/** Skip first N matches */
	offset?: number;
	/** Lines of context before matches */
	contextBefore?: number;
	/** Lines of context after matches */
	contextAfter?: number;
	/** Lines of context before/after matches (legacy) */
	context?: number;
	/** Truncate lines longer than this (characters) */
	maxColumns?: number;
	/** Output mode */
	mode?: "content" | "filesWithMatches" | "count";
}

/** A context line returned around a match. */
export interface ContextLine {
	/** 1-indexed line number. */
	lineNumber: number;
	/** Line content (trimmed line ending). */
	line: string;
}

/** A single grep match or per-file count entry. */
export interface GrepMatch {
	/** File path for the match (relative for directory searches). */
	path: string;
	/** 1-indexed line number (0 for count-only entries). */
	lineNumber: number;
	/** Matched line content (empty for count-only entries). */
	line: string;
	/** Context lines before the match. */
	contextBefore?: ContextLine[];
	/** Context lines after the match. */
	contextAfter?: ContextLine[];
	/** Whether the line was truncated. */
	truncated?: boolean;
	/** Per-file match count (count mode only). */
	matchCount?: number;
}

/** Summary stats for a grep run. */
export interface GrepSummary {
	/** Total matches across all files. */
	totalMatches: number;
	/** Number of files with at least one match. */
	filesWithMatches: number;
	/** Number of files searched. */
	filesSearched: number;
	/** Whether the limit/offset stopped the search early. */
	limitReached?: boolean;
}

/** Full grep result including matches and summary counts. */
export interface GrepResult extends GrepSummary {
	/** Matches or per-file counts, depending on mode. */
	matches: GrepMatch[];
}

/** Options for searching in-memory content. */
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
	/** Lines of context before matches */
	contextBefore?: number;
	/** Lines of context after matches */
	contextAfter?: number;
	/** Lines of context before/after matches (legacy) */
	context?: number;
	/** Truncate lines longer than this (characters) */
	maxColumns?: number;
	/** Output mode */
	mode?: "content" | "count";
}

/** A single content match. */
export interface SearchMatch {
	/** 1-indexed line number. */
	lineNumber: number;
	/** Matched line content. */
	line: string;
	/** Context lines before the match. */
	contextBefore?: ContextLine[];
	/** Context lines after the match. */
	contextAfter?: ContextLine[];
	/** Whether the line was truncated. */
	truncated?: boolean;
}

/** Result of searching in-memory content. */
export interface SearchResult {
	/** All matches found. */
	matches: SearchMatch[];
	/** Total number of matches (may exceed `matches.length`). */
	matchCount: number;
	/** Whether the limit was reached. */
	limitReached: boolean;
	/** Error message, if any. */
	error?: string;
}

/** Options for fuzzy file path search. */
export interface FuzzyFindOptions extends Cancellable {
	/** Fuzzy query to match against file paths (case-insensitive). */
	query: string;
	/** Directory to search. */
	path: string;
	/** Include hidden files (default: false). */
	hidden?: boolean;
	/** Respect .gitignore (default: true). */
	gitignore?: boolean;
	/** Enable shared filesystem scan cache (default: false). */
	cache?: boolean;
	/** Maximum number of matches to return (default: 100). */
	maxResults?: number;
}

/** A single match in fuzzy find results. */
export interface FuzzyFindMatch {
	/** Relative path from the search root (uses `/` separators). */
	path: string;
	/** Whether this entry is a directory. */
	isDirectory: boolean;
	/** Match quality score (higher is better). */
	score: number;
}

/** Result of fuzzy file path search. */
export interface FuzzyFindResult {
	/** Matched entries (up to `maxResults`). */
	matches: FuzzyFindMatch[];
	/** Total number of matches found (may exceed `matches.length`). */
	totalMatches: number;
}

declare module "../bindings" {
	interface NativeBindings {
		/** Fuzzy file path search for autocomplete. */
		fuzzyFind(options: FuzzyFindOptions): Promise<FuzzyFindResult>;
		/** Search files for a regex pattern. */
		grep(options: GrepOptions, onMatch?: TsFunc<GrepMatch>): Promise<GrepResult>;
		/** Search in-memory content for a regex pattern. */
		search(content: string | Uint8Array, options: SearchOptions): SearchResult;
		/** Quick check if content matches a pattern. */
		hasMatch(
			content: string | Uint8Array,
			pattern: string | Uint8Array,
			ignoreCase: boolean,
			multiline: boolean,
		): boolean;
	}
}
