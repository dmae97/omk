/**
 * Native utilities powered by N-API.
 */

// =============================================================================
// Clipboard
// =============================================================================

export { type ClipboardImage, copyToClipboard, readImageFromClipboard } from "./clipboard";

// =============================================================================
// AST (structural search and rewrite)
// =============================================================================

export {
	type AstFindMatch,
	type AstFindOptions,
	type AstFindResult,
	type AstReplaceChange,
	type AstReplaceFileChange,
	type AstReplaceOptions,
	type AstReplaceResult,
	type AstStrictness,
	astFind,
	astReplace,
} from "./ast";

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
} from "./grep";

// =============================================================================
// Glob (file discovery)
// =============================================================================

export {
	FileType,
	type GlobMatch,
	type GlobOptions,
	type GlobResult,
	glob,
	invalidateFsScanCache,
} from "./glob";

// =============================================================================
// Image processing (photon-compatible API)
// =============================================================================

export { ImageFormat, PhotonImage, SamplingFilter } from "./image";

// =============================================================================
// Text utilities
// =============================================================================

export {
	Ellipsis,
	type ExtractSegmentsResult,
	extractSegments,
	type SliceWithWidthResult,
	sanitizeText,
	sliceWithWidth,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "./text";

// =============================================================================
// Syntax highlighting
// =============================================================================

export {
	getSupportedLanguages,
	type HighlightColors,
	highlightCode,
	supportsLanguage,
} from "./highlight";

// =============================================================================
// Keyboard sequence helpers
// =============================================================================

export {
	type KeyEventType,
	matchesKey,
	matchesKittySequence,
	matchesLegacySequence,
	type ParsedKittyResult,
	parseKey,
	parseKittySequence,
} from "./keys";

// =============================================================================
// HTML to Markdown
// =============================================================================

export { type HtmlToMarkdownOptions, htmlToMarkdown } from "./html";

// =============================================================================
// Shell execution (brush-core)
// =============================================================================

export {
	executeShell,
	Shell,
	type ShellExecuteOptions,
	type ShellExecuteResult,
	type ShellOptions,
	type ShellRunOptions,
	type ShellRunResult,
} from "./shell";

// =============================================================================
// PTY execution
// =============================================================================

export { type PtyRunResult, PtySession, type PtyStartOptions } from "./pty";
// =============================================================================
// Process management
// =============================================================================

export { killTree, listDescendants } from "./ps";

// =============================================================================
// Work profiling
// =============================================================================

export { getWorkProfile, type WorkProfile } from "./work";
