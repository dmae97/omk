/**
 * Types for native find API.
 */

export interface FindOptions {
	/** Glob pattern to match (e.g., `*.ts`) */
	pattern: string;
	/** Directory to search */
	path: string;
	/** Filter by file type: "file", "dir", or "symlink" */
	fileType?: "file" | "dir" | "symlink";
	/** Include hidden files (default: false) */
	hidden?: boolean;
	/** Maximum number of results */
	maxResults?: number;
	/** Respect .gitignore files (default: true) */
	gitignore?: boolean;
	/** Sort results by mtime (most recent first) before applying limit */
	sortByMtime?: boolean;
}

export interface FindMatch {
	path: string;
	fileType: "file" | "dir" | "symlink";
	mtime?: number;
}

export interface FindResult {
	matches: FindMatch[];
	totalMatches: number;
}
