/**
 * Types for native find API.
 */

import type { TsFunc } from "../bindings";

/** Options for discovering files and directories. */
export interface FindOptions {
	/** Glob pattern to match (e.g., `*.ts`). */
	pattern: string;
	/** Directory to search. */
	path: string;
	/** Filter by file type: "file", "dir", or "symlink". */
	fileType?: "file" | "dir" | "symlink";
	/** Include hidden files (default: false). */
	hidden?: boolean;
	/** Maximum number of results to return. */
	maxResults?: number;
	/** Respect .gitignore files (default: true). */
	gitignore?: boolean;
	/** Sort results by mtime (most recent first) before applying limit. */
	sortByMtime?: boolean;
}

/** A single filesystem match. */
export interface FindMatch {
	/** Relative path from the search root. */
	path: string;
	/** Resolved filesystem type for the match. */
	fileType: "file" | "dir" | "symlink";
	/** Modification time in milliseconds since epoch, if available. */
	mtime?: number;
}

/** Result of a find operation. */
export interface FindResult {
	/** Matched filesystem entries. */
	matches: FindMatch[];
	/** Number of matches returned after limits are applied. */
	totalMatches: number;
}

declare module "../bindings" {
	interface NativeBindings {
		/**
		 * Find filesystem entries matching a glob pattern.
		 * @param options Search options that control globbing and filters.
		 * @param onMatch Optional callback for streaming matches as they are found.
		 */
		find(options: FindOptions, onMatch?: TsFunc<FindMatch>): Promise<FindResult>;
	}
}
