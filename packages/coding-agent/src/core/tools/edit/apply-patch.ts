/**
 * Apply-patch implementation for the edit tool.
 *
 * Simplified format with explicit operation type and path as parameters.
 * The diff body contains either:
 * - Full file content (for create)
 * - Hunks with @@ markers, context lines, +/- lines (for update)
 */

import { mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { adjustNewTextIndentation, DEFAULT_FUZZY_THRESHOLD, findEditMatch, normalizeToLF } from "./diff";
import { seekSequence } from "./seek-sequence";

// ═══════════════════════════════════════════════════════════════════════════
// File System Abstraction
// ═══════════════════════════════════════════════════════════════════════════

/** Abstraction for file system operations to support LSP writethrough */
export interface FileSystem {
	/** Check if a file exists */
	exists(path: string): Promise<boolean>;
	/** Read file contents */
	read(path: string): Promise<string>;
	/** Write file contents (may include LSP formatting/diagnostics) */
	write(path: string, content: string): Promise<void>;
	/** Delete a file */
	delete(path: string): Promise<void>;
	/** Create directory (recursive) */
	mkdir(path: string): Promise<void>;
}

/** Default filesystem implementation using Bun APIs */
export const defaultFileSystem: FileSystem = {
	async exists(path: string): Promise<boolean> {
		return Bun.file(path).exists();
	},
	async read(path: string): Promise<string> {
		return Bun.file(path).text();
	},
	async write(path: string, content: string): Promise<void> {
		await Bun.write(path, content);
	},
	async delete(path: string): Promise<void> {
		unlinkSync(path);
	},
	async mkdir(path: string): Promise<void> {
		mkdirSync(path, { recursive: true });
	},
};

// ═══════════════════════════════════════════════════════════════════════════
// Error Types
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

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface UpdateChunk {
	/** Single line of context to narrow down position (e.g., class/method definition) */
	changeContext?: string;
	/** True if the chunk contains context lines (space-prefixed) */
	hasContextLines: boolean;
	/** Contiguous block of lines to be replaced */
	oldLines: string[];
	/** Lines to replace oldLines with */
	newLines: string[];
	/** If true, oldLines must occur at end of file */
	isEndOfFile: boolean;
}

export type Operation = "create" | "delete" | "update";

export interface PatchInput {
	/** File path (relative or absolute) */
	path: string;
	/** Operation type */
	operation: Operation;
	/** New path for rename (update only) */
	moveTo?: string;
	/** File content (create) or diff hunks (update) */
	diff?: string;
}

export interface FileChange {
	type: Operation;
	path: string;
	newPath?: string;
	oldContent?: string;
	newContent?: string;
}

export interface ApplyPatchResult {
	change: FileChange;
}

// ═══════════════════════════════════════════════════════════════════════════
// Parser Constants
// ═══════════════════════════════════════════════════════════════════════════

const EOF_MARKER = "*** End of File";
const CHANGE_CONTEXT_MARKER = "@@ ";
const EMPTY_CHANGE_CONTEXT_MARKER = "@@";

// ═══════════════════════════════════════════════════════════════════════════
// Diff Parser (for update operations)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parse diff hunks from a diff string.
 */
export function parseDiffHunks(diff: string): UpdateChunk[] {
	const lines = diff.split("\n");
	const chunks: UpdateChunk[] = [];
	let i = 0;

	while (i < lines.length) {
		// Skip blank lines between chunks
		if (lines[i].trim() === "") {
			i++;
			continue;
		}

		const { chunk, linesConsumed } = parseOneChunk(lines.slice(i), i + 1, chunks.length === 0);
		chunks.push(chunk);
		i += linesConsumed;
	}

	return chunks;
}

function parseOneChunk(
	lines: string[],
	lineNumber: number,
	allowMissingContext: boolean,
): { chunk: UpdateChunk; linesConsumed: number } {
	if (lines.length === 0) {
		throw new ParseError("Diff does not contain any lines", lineNumber);
	}

	let changeContext: string | undefined;
	let startIndex: number;

	// Check for context marker
	if (lines[0] === EMPTY_CHANGE_CONTEXT_MARKER) {
		changeContext = undefined;
		startIndex = 1;
	} else if (lines[0].startsWith(CHANGE_CONTEXT_MARKER)) {
		changeContext = lines[0].slice(CHANGE_CONTEXT_MARKER.length);
		startIndex = 1;
	} else {
		if (!allowMissingContext) {
			throw new ParseError(`Expected hunk to start with @@ context marker, got: '${lines[0]}'`, lineNumber);
		}
		changeContext = undefined;
		startIndex = 0;
	}

	if (startIndex >= lines.length) {
		throw new ParseError("Hunk does not contain any lines", lineNumber + 1);
	}

	const chunk: UpdateChunk = {
		changeContext,
		hasContextLines: false,
		oldLines: [],
		newLines: [],
		isEndOfFile: false,
	};

	let parsedLines = 0;

	for (let i = startIndex; i < lines.length; i++) {
		const line = lines[i];

		if (line === EOF_MARKER) {
			if (parsedLines === 0) {
				throw new ParseError("Hunk does not contain any lines", lineNumber + 1);
			}
			chunk.isEndOfFile = true;
			parsedLines++;
			break;
		}

		const firstChar = line[0];

		if (firstChar === undefined || firstChar === "") {
			// Empty line - treat as context
			chunk.hasContextLines = true;
			chunk.oldLines.push("");
			chunk.newLines.push("");
		} else if (firstChar === " ") {
			// Context line
			chunk.hasContextLines = true;
			chunk.oldLines.push(line.slice(1));
			chunk.newLines.push(line.slice(1));
		} else if (firstChar === "+") {
			// Added line
			chunk.newLines.push(line.slice(1));
		} else if (firstChar === "-") {
			// Removed line
			chunk.oldLines.push(line.slice(1));
		} else {
			if (parsedLines === 0) {
				throw new ParseError(
					`Unexpected line in hunk: '${line}'. Lines must start with ' ' (context), '+' (add), or '-' (remove)`,
					lineNumber + 1,
				);
			}
			// Assume start of next hunk
			break;
		}
		parsedLines++;
	}

	if (parsedLines === 0) {
		throw new ParseError("Hunk does not contain any lines", lineNumber + startIndex);
	}

	return { chunk, linesConsumed: parsedLines + startIndex };
}

// ═══════════════════════════════════════════════════════════════════════════
// Applicator
// ═══════════════════════════════════════════════════════════════════════════

interface Replacement {
	startIndex: number;
	oldLen: number;
	newLines: string[];
}

/**
 * Compute replacements needed to transform originalLines using the diff chunks.
 */
function computeReplacements(originalLines: string[], path: string, chunks: UpdateChunk[]): Replacement[] {
	const replacements: Replacement[] = [];
	let lineIndex = 0;

	for (const chunk of chunks) {
		// If chunk has a change_context, find it and adjust lineIndex
		if (chunk.changeContext !== undefined) {
			const idx = seekSequence(originalLines, [chunk.changeContext], lineIndex, false).index;
			if (idx === undefined) {
				throw new ApplyPatchError(`Failed to find context '${chunk.changeContext}' in ${path}`);
			}
			// If oldLines[0] matches changeContext, start search at idx (not idx+1)
			// This handles the common case where @@ scope and first context line are identical
			const firstOldLine = chunk.oldLines[0];
			if (firstOldLine !== undefined && firstOldLine.trim() === chunk.changeContext.trim()) {
				lineIndex = idx;
			} else {
				lineIndex = idx + 1;
			}
		}

		if (chunk.oldLines.length === 0) {
			// Pure addition - add at end or before final empty line
			const insertionIdx =
				originalLines.length > 0 && originalLines[originalLines.length - 1] === ""
					? originalLines.length - 1
					: originalLines.length;
			replacements.push({ startIndex: insertionIdx, oldLen: 0, newLines: [...chunk.newLines] });
			continue;
		}

		// Try to find the old lines in the file
		let pattern = [...chunk.oldLines];
		let found = seekSequence(originalLines, pattern, lineIndex, chunk.isEndOfFile).index;
		let newSlice = [...chunk.newLines];

		// Retry without trailing empty line if present
		if (found === undefined && pattern.length > 0 && pattern[pattern.length - 1] === "") {
			pattern = pattern.slice(0, -1);
			if (newSlice.length > 0 && newSlice[newSlice.length - 1] === "") {
				newSlice = newSlice.slice(0, -1);
			}
			found = seekSequence(originalLines, pattern, lineIndex, chunk.isEndOfFile).index;
		}

		if (found === undefined) {
			throw new ApplyPatchError(`Failed to find expected lines in ${path}:\n${chunk.oldLines.join("\n")}`);
		}

		replacements.push({ startIndex: found, oldLen: pattern.length, newLines: newSlice });
		lineIndex = found + pattern.length;
	}

	// Sort by start index
	replacements.sort((a, b) => a.startIndex - b.startIndex);

	return replacements;
}

/**
 * Apply replacements to lines, returning the modified content.
 */
function applyReplacements(lines: string[], replacements: Replacement[]): string[] {
	const result = [...lines];

	// Apply in reverse order to maintain indices
	for (let i = replacements.length - 1; i >= 0; i--) {
		const { startIndex, oldLen, newLines } = replacements[i];
		result.splice(startIndex, oldLen);
		result.splice(startIndex, 0, ...newLines);
	}

	return result;
}

/**
 * Apply a simple replacement using character-based fuzzy matching.
 * Used when the diff contains only -/+ lines without context or @@ markers.
 */
function applySimpleReplace(originalContent: string, path: string, chunk: UpdateChunk): string {
	const oldText = chunk.oldLines.join("\n");
	const newText = chunk.newLines.join("\n");

	// Normalize content for matching
	const normalizedContent = normalizeToLF(originalContent);
	const normalizedOldText = normalizeToLF(oldText);

	// Use character-based fuzzy matching from diff.ts
	const matchOutcome = findEditMatch(normalizedContent, normalizedOldText, {
		allowFuzzy: true,
		similarityThreshold: DEFAULT_FUZZY_THRESHOLD,
	});

	// Check for multiple exact occurrences
	if (matchOutcome.occurrences && matchOutcome.occurrences > 1) {
		throw new ApplyPatchError(
			`Found ${matchOutcome.occurrences} occurrences of the text in ${path}. ` +
				`The text must be unique. Please provide more context to make it unique.`,
		);
	}

	if (!matchOutcome.match) {
		const closest = matchOutcome.closest;
		if (closest) {
			const similarity = Math.round(closest.confidence * 100);
			throw new ApplyPatchError(
				`Could not find a close enough match in ${path}. ` +
					`Closest match (${similarity}% similar) at line ${closest.startLine}.`,
			);
		}
		throw new ApplyPatchError(`Failed to find expected lines in ${path}:\n${oldText}`);
	}

	// Adjust indentation to match what was actually found
	const adjustedNewText = adjustNewTextIndentation(normalizedOldText, matchOutcome.match.actualText, newText);

	// Apply the replacement
	const before = normalizedContent.substring(0, matchOutcome.match.startIndex);
	const after = normalizedContent.substring(matchOutcome.match.startIndex + matchOutcome.match.actualText.length);
	let result = before + adjustedNewText + after;

	// Ensure trailing newline
	if (!result.endsWith("\n")) {
		result += "\n";
	}

	return result;
}

/**
 * Apply diff chunks to file content.
 */
function applyDiffToContent(originalContent: string, path: string, chunks: UpdateChunk[]): string {
	// Detect simple replace pattern: single chunk, no @@ context, no context lines, has old lines to match
	if (chunks.length === 1) {
		const chunk = chunks[0];
		if (chunk.changeContext === undefined && !chunk.hasContextLines && chunk.oldLines.length > 0) {
			return applySimpleReplace(originalContent, path, chunk);
		}
	}

	let originalLines = originalContent.split("\n");

	// Drop trailing empty element from final newline (matches diff behavior)
	if (originalLines.length > 0 && originalLines[originalLines.length - 1] === "") {
		originalLines = originalLines.slice(0, -1);
	}

	const replacements = computeReplacements(originalLines, path, chunks);
	const newLines = applyReplacements(originalLines, replacements);

	// Ensure trailing newline
	if (newLines.length === 0 || newLines[newLines.length - 1] !== "") {
		newLines.push("");
	}

	return newLines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════

export interface ApplyPatchOptions {
	/** Working directory for resolving relative paths */
	cwd: string;
	/** Dry run - compute changes without writing */
	dryRun?: boolean;
	/** File system abstraction (defaults to Bun-based implementation) */
	fs?: FileSystem;
}

/**
 * Apply a patch operation to the filesystem.
 */
export async function applyPatch(input: PatchInput, options: ApplyPatchOptions): Promise<ApplyPatchResult> {
	const { cwd, dryRun = false, fs = defaultFileSystem } = options;

	const resolvePath = (p: string): string => (p.startsWith("/") ? p : `${cwd}/${p}`);
	const absolutePath = resolvePath(input.path);

	if (input.operation === "create") {
		if (!input.diff) {
			throw new ApplyPatchError("Create operation requires diff (file content)");
		}

		// Ensure content ends with newline
		const content = input.diff.endsWith("\n") ? input.diff : `${input.diff}\n`;

		if (!dryRun) {
			const parentDir = dirname(absolutePath);
			if (parentDir && parentDir !== ".") {
				await fs.mkdir(parentDir);
			}
			await fs.write(absolutePath, content);
		}

		return {
			change: {
				type: "create",
				path: absolutePath,
				newContent: content,
			},
		};
	}

	if (input.operation === "delete") {
		let oldContent: string | undefined;

		if (await fs.exists(absolutePath)) {
			oldContent = await fs.read(absolutePath);
			if (!dryRun) {
				await fs.delete(absolutePath);
			}
		}

		return {
			change: {
				type: "delete",
				path: absolutePath,
				oldContent,
			},
		};
	}

	// Update operation
	if (!input.diff) {
		throw new ApplyPatchError("Update operation requires diff (hunks)");
	}

	if (!(await fs.exists(absolutePath))) {
		throw new ApplyPatchError(`File not found: ${input.path}`);
	}

	const originalContent = await fs.read(absolutePath);
	const chunks = parseDiffHunks(input.diff);

	if (chunks.length === 0) {
		throw new ApplyPatchError("Diff contains no hunks");
	}

	const newContent = applyDiffToContent(originalContent, input.path, chunks);
	const destPath = input.moveTo ? resolvePath(input.moveTo) : absolutePath;

	if (!dryRun) {
		if (input.moveTo) {
			const parentDir = dirname(destPath);
			if (parentDir && parentDir !== ".") {
				await fs.mkdir(parentDir);
			}
			await fs.write(destPath, newContent);
			await fs.delete(absolutePath);
		} else {
			await fs.write(absolutePath, newContent);
		}
	}

	return {
		change: {
			type: "update",
			path: absolutePath,
			newPath: input.moveTo ? destPath : undefined,
			oldContent: originalContent,
			newContent,
		},
	};
}

/**
 * Preview what changes a patch would make without applying it.
 */
export async function previewPatch(input: PatchInput, options: ApplyPatchOptions): Promise<ApplyPatchResult> {
	return applyPatch(input, { ...options, dryRun: true });
}

// ═══════════════════════════════════════════════════════════════════════════
// Re-exports for backwards compatibility
// ═══════════════════════════════════════════════════════════════════════════

// Keep these types exported for the index.ts re-exports
export type { UpdateChunk as UpdateFileChunk };
