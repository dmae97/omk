/**
 * Native ripgrep wrapper using N-API.
 */

import { native } from "../native";
import { wrapRequestOptions } from "../request-options";
import type {
	ContextLine,
	FuzzyFindMatch,
	FuzzyFindOptions,
	FuzzyFindResult,
	GrepMatch,
	GrepOptions,
	GrepResult,
	GrepSummary,
	SearchOptions,
	SearchResult,
} from "./types";

export type {
	ContextLine,
	FuzzyFindMatch,
	FuzzyFindOptions,
	FuzzyFindResult,
	GrepMatch,
	GrepOptions,
	GrepResult,
	GrepSummary,
	SearchOptions,
	SearchResult,
};

/**
 * Search files for a regex pattern with optional streaming callback.
 */
export async function grep(options: GrepOptions, onMatch?: (match: GrepMatch) => void): Promise<GrepResult> {
	return wrapRequestOptions(() => native.grep(options, onMatch), options);
}

/**
 * Search a single file's content for a pattern.
 * Lower-level API for when you already have file content.
 *
 * Accepts `Uint8Array`/`Buffer` for zero-copy when content is already UTF-8 encoded.
 */
export function searchContent(content: string | Uint8Array, options: SearchOptions): SearchResult {
	return native.search(content, options);
}

/**
 * Quick check if content contains a pattern match.
 *
 * Accepts `Uint8Array`/`Buffer` for zero-copy when content/pattern are already UTF-8 encoded.
 */
export function hasMatch(
	content: string | Uint8Array,
	pattern: string | Uint8Array,
	options?: { ignoreCase?: boolean; multiline?: boolean },
): boolean {
	return native.hasMatch(content, pattern, options?.ignoreCase ?? false, options?.multiline ?? false);
}

/**
 * Fuzzy file path search for autocomplete.
 *
 * Searches for files and directories whose paths contain the query substring
 * (case-insensitive). Respects .gitignore by default.
 */
export async function fuzzyFind(options: FuzzyFindOptions): Promise<FuzzyFindResult> {
	return wrapRequestOptions(() => native.fuzzyFind(options), options);
}
