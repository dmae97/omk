/**
 * Native utilities powered by N-API.
 */

import * as path from "node:path";
import type { FindMatch, FindOptions, FindResult } from "./find/types";
import { native } from "./native";

// =============================================================================
// Grep (ripgrep-based regex search)
// =============================================================================

export {
	type ContextLine,
	type FuzzyFindMatch,
	type FuzzyFindOptions,
	type FuzzyFindResult,
	fuzzyFind,
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
// Find (file discovery)
// =============================================================================

export type { FindMatch, FindOptions, FindResult } from "./find/types";

/**
 * Find files matching a glob pattern.
 * Respects .gitignore by default.
 */
export async function find(options: FindOptions, onMatch?: (match: FindMatch) => void): Promise<FindResult> {
	const searchPath = path.resolve(options.path);
	const pattern = options.pattern || "*";

	// Convert simple patterns to recursive globs if needed
	const globPattern = pattern.includes("/") || pattern.startsWith("**") ? pattern : `**/${pattern}`;

	return native.find(
		{
			...options,
			path: searchPath,
			pattern: globPattern,
			hidden: options.hidden ?? false,
			gitignore: options.gitignore ?? true,
		},
		onMatch,
	);
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

export type { RequestOptions } from "./request-options";
