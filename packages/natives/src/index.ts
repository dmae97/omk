/**
 * Native utilities powered by WASM.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { globPaths } from "@oh-my-pi/pi-utils";

// =============================================================================
// Grep (ripgrep-based regex search)
// =============================================================================

export {
	type ContextLine,
	type GrepMatch,
	type GrepOptions,
	type GrepResult,
	type GrepSummary,
	grep,
	grepDirect,
	grepPool,
	hasMatch,
	searchContent,
	terminate,
} from "./grep/index";

// =============================================================================
// WASI implementation
// =============================================================================

export { WASI1, WASIError, WASIExitError, type WASIOptions } from "./wasix";

// =============================================================================
// Find (file discovery)
// =============================================================================

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
}

export interface FindMatch {
	path: string;
	fileType: "file" | "dir" | "symlink";
}

export interface FindResult {
	matches: FindMatch[];
	totalMatches: number;
}

/**
 * Find files matching a glob pattern.
 * Respects .gitignore by default.
 */
export async function find(options: FindOptions, onMatch?: (match: FindMatch) => void): Promise<FindResult> {
	const searchPath = path.resolve(options.path);
	const pattern = options.pattern || "*";

	// Convert simple patterns to recursive globs if needed
	const globPattern = pattern.includes("/") || pattern.startsWith("**") ? pattern : `**/${pattern}`;

	const paths = await globPaths(globPattern, {
		cwd: searchPath,
		dot: options.hidden ?? false,
		onlyFiles: options.fileType === "file",
		gitignore: options.gitignore ?? true,
	});

	const matches: FindMatch[] = [];
	const maxResults = options.maxResults ?? Number.MAX_SAFE_INTEGER;

	for (const p of paths) {
		if (matches.length >= maxResults) {
			break;
		}

		const normalizedPath = p.replace(/\\/g, "/");
		if (!normalizedPath) {
			continue;
		}

		let stats: Awaited<ReturnType<typeof fs.lstat>>;
		try {
			stats = await fs.lstat(path.join(searchPath, normalizedPath));
		} catch {
			continue;
		}

		const fileType: "file" | "dir" | "symlink" = stats.isSymbolicLink()
			? "symlink"
			: stats.isDirectory()
				? "dir"
				: "file";

		if (options.fileType && options.fileType !== fileType) {
			continue;
		}

		const match: FindMatch = {
			path: normalizedPath,
			fileType,
		};

		matches.push(match);
		onMatch?.(match);
	}

	return {
		matches,
		totalMatches: matches.length,
	};
}

// =============================================================================
// Image processing (photon-compatible API)
// =============================================================================

export {
	PhotonImage,
	resize,
	SamplingFilter,
	terminate as terminateImageWorker,
} from "./image/index";

// =============================================================================
// Text utilities
// =============================================================================

export {
	type ExtractSegmentsResult,
	extractSegments,
	type SliceWithWidthResult,
	sliceWithWidth,
	truncateToWidth,
	visibleWidth,
} from "./text/index";

// =============================================================================
// Syntax highlighting
// =============================================================================

export {
	getSupportedLanguages,
	type HighlightColors,
	highlightCode,
	supportsLanguage,
} from "./highlight/index";

// =============================================================================
// HTML to Markdown
// =============================================================================

export {
	type HtmlToMarkdownOptions,
	htmlToMarkdown,
	terminate as terminateHtmlWorker,
} from "./html/index";

// =============================================================================
// Worker Pool (shared infrastructure)
// =============================================================================

export { type BaseRequest, type BaseResponse, WorkerPool, type WorkerPoolOptions } from "./pool";
