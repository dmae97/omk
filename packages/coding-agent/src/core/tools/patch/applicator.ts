/**
 * Patch application logic for the edit tool.
 *
 * Applies parsed diff hunks to file content using fuzzy matching
 * for robust handling of whitespace and formatting differences.
 */

import { mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_FUZZY_THRESHOLD, findContextLine, findMatch, seekSequence } from "./fuzzy";
import { adjustIndentation, countLeadingWhitespace, getLeadingWhitespace, normalizeToLF } from "./normalize";
import { normalizeCreateContent, parseHunks } from "./parser";
import type { ApplyPatchOptions, ApplyPatchResult, DiffHunk, FileSystem, PatchInput } from "./types";
import { ApplyPatchError } from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// Default File System
// ═══════════════════════════════════════════════════════════════════════════

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
// Internal Types
// ═══════════════════════════════════════════════════════════════════════════

interface Replacement {
	startIndex: number;
	oldLen: number;
	newLines: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Replacement Computation
// ═══════════════════════════════════════════════════════════════════════════

/** Adjust indentation of newLines to match the delta between patternLines and actualLines */
function adjustLinesIndentation(patternLines: string[], actualLines: string[], newLines: string[]): string[] {
	if (patternLines.length === 0 || actualLines.length === 0 || newLines.length === 0) {
		return newLines;
	}

	let patternMin = Infinity;
	for (const line of patternLines) {
		if (line.trim().length > 0) {
			patternMin = Math.min(patternMin, countLeadingWhitespace(line));
		}
	}
	if (patternMin === Infinity) patternMin = 0;

	let actualMin = Infinity;
	for (const line of actualLines) {
		if (line.trim().length > 0) {
			actualMin = Math.min(actualMin, countLeadingWhitespace(line));
		}
	}
	if (actualMin === Infinity) actualMin = 0;

	const delta = actualMin - patternMin;
	if (delta === 0) {
		return newLines;
	}

	let indentChar = " ";
	for (const line of actualLines) {
		const ws = getLeadingWhitespace(line);
		if (ws.length > 0) {
			indentChar = ws[0];
			break;
		}
	}

	return newLines.map((line) => {
		if (line.trim().length === 0) {
			return line;
		}
		if (delta > 0) {
			return indentChar.repeat(delta) + line;
		}
		const toRemove = Math.min(-delta, countLeadingWhitespace(line));
		return line.slice(toRemove);
	});
}

/** Get hint index from hunk's line number */
function getHunkHintIndex(hunk: DiffHunk, currentIndex: number): number | undefined {
	if (hunk.oldStartLine === undefined) return undefined;
	const hintIndex = Math.max(0, hunk.oldStartLine - 1);
	return hintIndex >= currentIndex ? hintIndex : undefined;
}

/** Find sequence with optional hint position */
function findSequenceWithHint(
	lines: string[],
	pattern: string[],
	currentIndex: number,
	hintIndex: number | undefined,
	eof: boolean,
): number | undefined {
	const primaryStart = hintIndex ?? currentIndex;
	let found = seekSequence(lines, pattern, primaryStart, eof).index;

	// Retry from currentIndex if hint failed
	if (found === undefined && hintIndex !== undefined && hintIndex !== currentIndex) {
		found = seekSequence(lines, pattern, currentIndex, eof).index;
	}

	return found;
}

/**
 * Apply a hunk using character-based fuzzy matching.
 * Used when the hunk contains only -/+ lines without context.
 */
function applyCharacterMatch(originalContent: string, path: string, hunk: DiffHunk): string {
	const oldText = hunk.oldLines.join("\n");
	const newText = hunk.newLines.join("\n");

	const normalizedContent = normalizeToLF(originalContent);
	const normalizedOldText = normalizeToLF(oldText);

	const matchOutcome = findMatch(normalizedContent, normalizedOldText, {
		allowFuzzy: true,
		threshold: DEFAULT_FUZZY_THRESHOLD,
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
	const adjustedNewText = adjustIndentation(normalizedOldText, matchOutcome.match.actualText, newText);

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
 * Compute replacements needed to transform originalLines using the diff hunks.
 */
function computeReplacements(originalLines: string[], path: string, hunks: DiffHunk[]): Replacement[] {
	const replacements: Replacement[] = [];
	let lineIndex = 0;

	for (const hunk of hunks) {
		const _hintIndex = getHunkHintIndex(hunk, lineIndex);

		// Use line number hints if available from unified diff format
		const lineHint = hunk.oldStartLine;
		if (lineHint !== undefined && hunk.changeContext === undefined) {
			lineIndex = Math.max(0, Math.min(lineHint - 1, originalLines.length - 1));
		}

		// If hunk has a changeContext, find it and adjust lineIndex
		if (hunk.changeContext !== undefined) {
			// Use findContextLine for robust matching with substring/fuzzy fallback
			const searchStart = lineHint !== undefined ? Math.max(0, lineHint - 1) : lineIndex;
			const result = findContextLine(originalLines, hunk.changeContext, searchStart);

			// If hint-based search failed and hint was different from lineIndex, try from lineIndex
			let idx = result.index;
			if (idx === undefined && lineHint !== undefined && searchStart !== lineIndex) {
				const fallbackResult = findContextLine(originalLines, hunk.changeContext, lineIndex);
				idx = fallbackResult.index;
			}

			if (idx === undefined) {
				throw new ApplyPatchError(`Failed to find context '${hunk.changeContext}' in ${path}`);
			}

			// If oldLines[0] matches changeContext, start search at idx (not idx+1)
			// This handles the common case where @@ scope and first context line are identical
			const firstOldLine = hunk.oldLines[0];
			if (firstOldLine !== undefined && firstOldLine.trim() === hunk.changeContext.trim()) {
				lineIndex = idx;
			} else {
				lineIndex = idx + 1;
			}
		}

		if (hunk.oldLines.length === 0) {
			// Pure addition - use line hint (oldStartLine or newStartLine) or append at end
			const lineHintForInsertion = hunk.oldStartLine ?? hunk.newStartLine;
			const insertionIdx =
				lineHintForInsertion !== undefined
					? Math.max(0, Math.min(lineHintForInsertion - 1, originalLines.length))
					: originalLines.length > 0 && originalLines[originalLines.length - 1] === ""
						? originalLines.length - 1
						: originalLines.length;

			replacements.push({ startIndex: insertionIdx, oldLen: 0, newLines: [...hunk.newLines] });
			continue;
		}

		// Try to find the old lines in the file
		let pattern = [...hunk.oldLines];
		const matchHint = getHunkHintIndex(hunk, lineIndex);
		let found = findSequenceWithHint(originalLines, pattern, lineIndex, matchHint, hunk.isEndOfFile);
		let newSlice = [...hunk.newLines];

		// Retry without trailing empty line if present
		if (found === undefined && pattern.length > 0 && pattern[pattern.length - 1] === "") {
			pattern = pattern.slice(0, -1);
			if (newSlice.length > 0 && newSlice[newSlice.length - 1] === "") {
				newSlice = newSlice.slice(0, -1);
			}
			found = findSequenceWithHint(originalLines, pattern, lineIndex, matchHint, hunk.isEndOfFile);
		}

		if (found === undefined) {
			throw new ApplyPatchError(`Failed to find expected lines in ${path}:\n${hunk.oldLines.join("\n")}`);
		}

		// For simple diffs (no context marker, no context lines), check for multiple occurrences
		// This ensures ambiguous replacements are rejected
		if (hunk.changeContext === undefined && !hunk.hasContextLines) {
			const secondMatch = seekSequence(originalLines, pattern, found + 1, false);
			if (secondMatch.index !== undefined) {
				throw new ApplyPatchError(
					`Found 2 occurrences of the text in ${path}. ` +
						`The text must be unique. Please provide more context to make it unique.`,
				);
			}
		}

		// Adjust indentation if needed (handles fuzzy matches where indentation differs)
		const actualMatchedLines = originalLines.slice(found, found + pattern.length);
		const adjustedNewLines = adjustLinesIndentation(pattern, actualMatchedLines, newSlice);

		replacements.push({ startIndex: found, oldLen: pattern.length, newLines: adjustedNewLines });
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
 * Apply diff hunks to file content.
 */
function applyHunksToContent(originalContent: string, path: string, hunks: DiffHunk[]): string {
	// Detect simple replace pattern: single hunk, no @@ context, no context lines, has old lines to match
	// Only use character-based matching when there are no hints to disambiguate
	if (hunks.length === 1) {
		const hunk = hunks[0];
		if (
			hunk.changeContext === undefined &&
			!hunk.hasContextLines &&
			hunk.oldLines.length > 0 &&
			hunk.oldStartLine === undefined && // No line hint to use for positioning
			!hunk.isEndOfFile // No EOF targeting (prefer end of file)
		) {
			return applyCharacterMatch(originalContent, path, hunk);
		}
	}

	let originalLines = originalContent.split("\n");

	// Drop trailing empty element from final newline (matches diff behavior)
	if (originalLines.length > 0 && originalLines[originalLines.length - 1] === "") {
		originalLines = originalLines.slice(0, -1);
	}

	const replacements = computeReplacements(originalLines, path, hunks);
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

/**
 * Apply a patch operation to the filesystem.
 */
export async function applyPatch(input: PatchInput, options: ApplyPatchOptions): Promise<ApplyPatchResult> {
	const { cwd, dryRun = false, fs = defaultFileSystem } = options;

	const resolvePath = (p: string): string => (p.startsWith("/") ? p : `${cwd}/${p}`);
	const absolutePath = resolvePath(input.path);

	// Handle CREATE operation
	if (input.operation === "create") {
		if (!input.diff) {
			throw new ApplyPatchError("Create operation requires diff (file content)");
		}

		// Strip + prefixes if present (handles diffs formatted as additions)
		const normalizedContent = normalizeCreateContent(input.diff);
		// Ensure content ends with newline
		const content = normalizedContent.endsWith("\n") ? normalizedContent : `${normalizedContent}\n`;

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

	// Handle DELETE operation
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

	// Handle UPDATE operation
	if (!input.diff) {
		throw new ApplyPatchError("Update operation requires diff (hunks)");
	}

	if (!(await fs.exists(absolutePath))) {
		throw new ApplyPatchError(`File not found: ${input.path}`);
	}

	const originalContent = await fs.read(absolutePath);
	const hunks = parseHunks(input.diff);

	if (hunks.length === 0) {
		throw new ApplyPatchError("Diff contains no hunks");
	}

	const newContent = applyHunksToContent(originalContent, input.path, hunks);
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
