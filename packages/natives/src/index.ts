/**
 * Native utilities powered by N-API.
 */

import * as path from "node:path";
import type { FindMatch, FindOptions, FindResult } from "./find/types";
import { native } from "./native";

export type { RequestOptions } from "./request-options";

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
	hasMatch,
	searchContent,
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

	// napi-rs ThreadsafeFunction passes (error, value) - skip callback on error
	const cb = onMatch ? (err: Error | null, m: FindMatch) => !err && onMatch(m) : undefined;

	return native.find(
		{
			...options,
			path: searchPath,
			pattern: globPattern,
			hidden: options.hidden ?? false,
			gitignore: options.gitignore ?? true,
		},
		cb,
	);
}

// =====================================================	========================
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
	Ellipsis,
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
// Keyboard sequence helpers
// =============================================================================

export { matchesKittySequence } from "./keys/index";

// =============================================================================
// HTML to Markdown
// =============================================================================

export {
	type HtmlToMarkdownOptions,
	htmlToMarkdown,
} from "./html/index";

// =============================================================================
// Shell execution (brush-core)
// =============================================================================

export {
	abortShellExecution,
	executeShell,
	type ShellExecuteOptions,
	type ShellExecuteResult,
} from "./shell/index";
