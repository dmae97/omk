/**
 * Types for native find API.
 */

import type { Cancellable, TsFunc } from "../bindings";

export const enum FileType {
	/** A regular file. */
	File = 1,
	/** A directory. */
	Dir = 2,
	/** A symlink. */
	Symlink = 3,
}

/** Options for discovering files and directories. */
export interface GlobOptions extends Cancellable {
	/** Glob pattern to match (e.g., `*.ts`). */
	pattern: string;
	/** Directory to search. */
	path: string;
	/** Filter by file type: "file", "dir", or "symlink". Symlinks match file/dir filters when their target type matches. */
	fileType?: FileType;
	/** Match simple patterns recursively by default (example: *.ts -> recursive match). Set false to keep patterns relative to the search root only. */
	recursive?: boolean;
	/** Include hidden files (default: false). */
	hidden?: boolean;
	/** Maximum number of results to return. */
	maxResults?: number;
	/** Respect .gitignore files (default: true). */
	gitignore?: boolean;
	/** Enable shared filesystem scan cache (default: false). */
	cache?: boolean;
	/** Sort results by mtime (most recent first) before applying limit. */
	sortByMtime?: boolean;
	/** Include node_modules entries even when pattern does not mention node_modules. */
	includeNodeModules?: boolean;
}

/** A single filesystem match. */
export interface GlobMatch {
	/** Relative path from the search root. */
	path: string;
	/** Resolved filesystem type for the match (for fileType=file/dir filters, symlink targets are reported as file/dir). */
	fileType: FileType;
	/** Modification time in milliseconds since epoch, if available. */
	mtime?: number;
}

/** Result of a find operation. */
export interface GlobResult {
	/** Matched filesystem entries. */
	matches: GlobMatch[];
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
		glob(options: GlobOptions, onMatch?: TsFunc<GlobMatch>): Promise<GlobResult>;
		/** Invalidate the filesystem scan cache for the given path (or all caches if omitted). */
		invalidateFsScanCache(path?: string): void;
	}
}
