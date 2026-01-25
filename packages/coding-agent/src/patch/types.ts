/**
 * Shared types for the edit tool module.
 */

// ═══════════════════════════════════════════════════════════════════════════
// File System Abstraction
// ═══════════════════════════════════════════════════════════════════════════

/** Abstraction for file system operations to support LSP writethrough */
export interface FileSystem {
	exists(path: string): Promise<boolean>;
	read(path: string): Promise<string>;
	readBinary?: (path: string) => Promise<Uint8Array>;
	write(path: string, content: string): Promise<void>;
	delete(path: string): Promise<void>;
	mkdir(path: string): Promise<void>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Fuzzy Matching Types
// ═══════════════════════════════════════════════════════════════════════════

/** Result of a fuzzy match operation */
export interface FuzzyMatch {
	/** The actual text that was matched */
	actualText: string;
	/** Character index where the match starts */
	startIndex: number;
	/** Line number where the match starts (1-indexed) */
	startLine: number;
	/** Confidence score (0-1, where 1 is exact match) */
	confidence: number;
}

/** Outcome of attempting to find a match */
export interface MatchOutcome {
	/** The match if found with sufficient confidence */
	match?: FuzzyMatch;
	/** The closest match found (may be below threshold) */
	closest?: FuzzyMatch;
	/** Number of occurrences if multiple exact matches found */
	occurrences?: number;
	/** Line numbers where occurrences were found (1-indexed) */
	occurrenceLines?: number[];
	/** Preview snippets for each occurrence (up to 5) */
	occurrencePreviews?: string[];
	/** Number of fuzzy matches above threshold */
	fuzzyMatches?: number;
	/** True when a dominant fuzzy match was accepted despite multiple candidates */
	dominantFuzzy?: boolean;
}

/** Result of a sequence search */
export type SequenceMatchStrategy =
	| "exact"
	| "trim-trailing"
	| "trim"
	| "comment-prefix"
	| "unicode"
	| "prefix"
	| "substring"
	| "fuzzy"
	| "fuzzy-dominant"
	| "character";

export interface SequenceSearchResult {
	/** Starting line index of the match (0-indexed) */
	index: number | undefined;
	/** Confidence score (1.0 for exact match, lower for fuzzy) */
	confidence: number;
	/** Number of matches at the same confidence level (for ambiguity detection) */
	matchCount?: number;
	/** Sample of matching indices (0-indexed, up to a small limit) */
	matchIndices?: number[];
	/** Matching strategy used */
	strategy?: SequenceMatchStrategy;
}

/** Result of a context line search */
export type ContextMatchStrategy = "exact" | "trim" | "unicode" | "prefix" | "substring" | "fuzzy";

export interface ContextLineResult {
	/** Index of the matching line (0-indexed) */
	index: number | undefined;
	/** Confidence score (1.0 for exact match, lower for fuzzy) */
	confidence: number;
	/** Number of matches at the same confidence level (for ambiguity detection) */
	matchCount?: number;
	/** Sample of matching indices (0-indexed, up to a small limit) */
	matchIndices?: number[];
	/** Matching strategy used */
	strategy?: ContextMatchStrategy;
}

// ═══════════════════════════════════════════════════════════════════════════
// Patch Types
// ═══════════════════════════════════════════════════════════════════════════

export type Operation = "create" | "delete" | "update";

/** Input for a patch operation */
export interface PatchInput {
	/** File path (relative or absolute) */
	path: string;
	/** Operation type */
	op: Operation;
	/** New path for rename (update only) */
	rename?: string;
	/** File content (create) or diff hunks (update) */
	diff?: string;
}

/** Normalized patch input used internally by the applicator. */
export interface NormalizedPatchInput {
	path: string;
	op: Operation;
	rename?: string;
	diff?: string;
}

export function normalizePatchInput(input: PatchInput): NormalizedPatchInput {
	return {
		path: input.path,
		op: input.op ?? "update",
		rename: input.rename,
		diff: input.diff,
	};
}

/** A single hunk/chunk in a diff */
export interface DiffHunk {
	/** Context line to narrow down position (e.g., class/method definition) */
	changeContext?: string;
	/** 1-based line hint from unified diff headers (old file) */
	oldStartLine?: number;
	/** 1-based line hint from unified diff headers (new file) */
	newStartLine?: number;
	/** True if the hunk contains context lines (space-prefixed) */
	hasContextLines: boolean;
	/** Lines to be replaced (old content) */
	oldLines: string[];
	/** Lines to replace with (new content) */
	newLines: string[];
	/** If true, oldLines must occur at end of file */
	isEndOfFile: boolean;
}

/** Describes a change made to a file */
export interface FileChange {
	type: Operation;
	path: string;
	newPath?: string;
	oldContent?: string;
	newContent?: string;
}

/** Result of applying a patch */
export interface ApplyPatchResult {
	change: FileChange;
	warnings?: string[];
}

/** Options for applying a patch */
export interface ApplyPatchOptions {
	/** Working directory for resolving relative paths */
	cwd: string;
	/** Dry run - compute changes without writing */
	dryRun?: boolean;
	/** Similarity threshold for fuzzy matching */
	fuzzyThreshold?: number;
	/** Allow fuzzy/partial matching when applying hunks */
	allowFuzzy?: boolean;
	/** File system abstraction (defaults to Bun-based implementation) */
	fs?: FileSystem;
}

// ═══════════════════════════════════════════════════════════════════════════
// Diff Generation Types
// ═══════════════════════════════════════════════════════════════════════════

/** Result of generating a diff */
export interface DiffResult {
	/** The unified diff string */
	diff: string;
	/** Line number of the first change in the new file */
	firstChangedLine: number | undefined;
}

/** Error from diff computation */
export interface DiffError {
	error: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Error Classes
// ═══════════════════════════════════════════════════════════════════════════

export class ParseError extends Error {
	constructor(
		message: string,
		public readonly lineNumber?: number,
	) {
		super(lineNumber !== undefined ? `Line ${lineNumber}: ${message}` : message);
		this.name = "ParseError";
	}
}

export class ApplyPatchError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ApplyPatchError";
	}
}

export class EditMatchError extends Error {
	constructor(
		public readonly path: string,
		public readonly searchText: string,
		public readonly closest: FuzzyMatch | undefined,
		public readonly options: { allowFuzzy: boolean; threshold: number; fuzzyMatches?: number },
	) {
		super(EditMatchError.formatMessage(path, searchText, closest, options));
		this.name = "EditMatchError";
	}

	static formatMessage(
		path: string,
		searchText: string,
		closest: FuzzyMatch | undefined,
		options: { allowFuzzy: boolean; threshold: number; fuzzyMatches?: number },
	): string {
		if (!closest) {
			return options.allowFuzzy
				? `Could not find a close enough match in ${path}.`
				: `Could not find the exact text in ${path}. The old text must match exactly including all whitespace and newlines.`;
		}

		const similarity = Math.round(closest.confidence * 100);
		const searchLines = searchText.split("\n");
		const actualLines = closest.actualText.split("\n");
		const { oldLine, newLine } = findFirstDifferentLine(searchLines, actualLines);
		const thresholdPercent = Math.round(options.threshold * 100);

		const hint = options.allowFuzzy
			? options.fuzzyMatches && options.fuzzyMatches > 1
				? `Found ${options.fuzzyMatches} high-confidence matches. Provide more context to make it unique.`
				: `Closest match was below the ${thresholdPercent}% similarity threshold.`
			: "Fuzzy matching is disabled. Enable 'Edit fuzzy match' in settings to accept high-confidence matches.";

		return [
			options.allowFuzzy
				? `Could not find a close enough match in ${path}.`
				: `Could not find the exact text in ${path}.`,
			``,
			`Closest match (${similarity}% similar) at line ${closest.startLine}:`,
			`  - ${oldLine}`,
			`  + ${newLine}`,
			hint,
		].join("\n");
	}
}

function findFirstDifferentLine(oldLines: string[], newLines: string[]): { oldLine: string; newLine: string } {
	const max = Math.max(oldLines.length, newLines.length);
	for (let i = 0; i < max; i++) {
		const oldLine = oldLines[i] ?? "";
		const newLine = newLines[i] ?? "";
		if (oldLine !== newLine) {
			return { oldLine, newLine };
		}
	}
	return { oldLine: oldLines[0] ?? "", newLine: newLines[0] ?? "" };
}
