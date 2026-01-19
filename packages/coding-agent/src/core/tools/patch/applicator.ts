/**
 * Patch application logic for the edit tool.
 *
 * Applies parsed diff hunks to file content using fuzzy matching
 * for robust handling of whitespace and formatting differences.
 */

import { mkdirSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DEFAULT_FUZZY_THRESHOLD, findContextLine, findMatch, seekSequence } from "./fuzzy";
import {
	adjustIndentation,
	countLeadingWhitespace,
	detectLineEnding,
	getLeadingWhitespace,
	normalizeToLF,
	restoreLineEndings,
	stripBom,
} from "./normalize";
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
	async readBinary(path: string): Promise<Uint8Array> {
		const buffer = await Bun.file(path).arrayBuffer();
		return new Uint8Array(buffer);
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

/** Find sequence with optional hint position, returning full search result */
function findSequenceWithHint(
	lines: string[],
	pattern: string[],
	currentIndex: number,
	hintIndex: number | undefined,
	eof: boolean,
): import("./types").SequenceSearchResult {
	// Prefer content-based search starting from currentIndex
	const primaryResult = seekSequence(lines, pattern, currentIndex, eof);
	if (primaryResult.index !== undefined || (primaryResult.matchCount && primaryResult.matchCount > 1)) {
		return primaryResult;
	}

	// Use line hint as a secondary bias only if needed
	if (hintIndex !== undefined && hintIndex !== currentIndex) {
		const hintedResult = seekSequence(lines, pattern, hintIndex, eof);
		if (hintedResult.index !== undefined || (hintedResult.matchCount && hintedResult.matchCount > 1)) {
			return hintedResult;
		}
	}

	// Last resort: search from beginning (handles out-of-order hunks)
	if (currentIndex !== 0) {
		const fromStartResult = seekSequence(lines, pattern, 0, eof);
		if (fromStartResult.index !== undefined || (fromStartResult.matchCount && fromStartResult.matchCount > 1)) {
			return fromStartResult;
		}
	}

	return primaryResult;
}

/**
 * Apply a hunk using character-based fuzzy matching.
 * Used when the hunk contains only -/+ lines without context.
 */
function applyCharacterMatch(originalContent: string, path: string, hunk: DiffHunk, fuzzyThreshold: number): string {
	const oldText = hunk.oldLines.join("\n");
	const newText = hunk.newLines.join("\n");

	const normalizedContent = normalizeToLF(originalContent);
	const normalizedOldText = normalizeToLF(oldText);

	const matchOutcome = findMatch(normalizedContent, normalizedOldText, {
		allowFuzzy: true,
		threshold: fuzzyThreshold,
	});

	// Check for multiple exact occurrences
	if (matchOutcome.occurrences && matchOutcome.occurrences > 1) {
		throw new ApplyPatchError(
			`Found ${matchOutcome.occurrences} occurrences of the text in ${path}. ` +
				`The text must be unique. Please provide more context to make it unique.`,
		);
	}

	if (matchOutcome.fuzzyMatches && matchOutcome.fuzzyMatches > 1) {
		throw new ApplyPatchError(
			`Found ${matchOutcome.fuzzyMatches} high-confidence matches in ${path}. ` +
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
	return before + adjustedNewText + after;
}

function applyTrailingNewlinePolicy(content: string, hadFinalNewline: boolean): string {
	if (hadFinalNewline) {
		return content.endsWith("\n") ? content : `${content}\n`;
	}
	return content.replace(/\n+$/u, "");
}

/**
 * Compute replacements needed to transform originalLines using the diff hunks.
 */
function computeReplacements(originalLines: string[], path: string, hunks: DiffHunk[]): Replacement[] {
	const replacements: Replacement[] = [];
	let lineIndex = 0;

	for (const hunk of hunks) {
		const lineHint = hunk.oldStartLine;
		if (lineHint !== undefined && hunk.changeContext === undefined && !hunk.hasContextLines) {
			lineIndex = Math.max(0, Math.min(lineHint - 1, originalLines.length - 1));
		}

		// If hunk has a changeContext, find it and adjust lineIndex
		if (hunk.changeContext !== undefined) {
			// Use findContextLine for robust matching with substring/fuzzy fallback
			let result = findContextLine(originalLines, hunk.changeContext, lineIndex);
			let usedLineHint = false;

			// If ambiguous or missing and a line hint exists, bias using the hint
			if ((result.index === undefined || (result.matchCount ?? 0) > 1) && lineHint !== undefined) {
				const hintStart = Math.max(0, lineHint - 1);
				const hintedResult = findContextLine(originalLines, hunk.changeContext, hintStart);
				if (hintedResult.index !== undefined) {
					result = hintedResult;
					usedLineHint = true;
				}
			}

			if (!usedLineHint && result.matchCount !== undefined && result.matchCount > 1) {
				throw new ApplyPatchError(
					`Found ${result.matchCount} matches for context '${hunk.changeContext}' in ${path}. ` +
						`Add more surrounding context or additional @@ anchors to make it unique.`,
				);
			}

			// If search failed, try fallback strategies
			let idx = result.index;
			if (idx === undefined && lineIndex !== 0) {
				// Last resort: search from beginning (handles out-of-order hunks)
				const fromStartResult = findContextLine(originalLines, hunk.changeContext, 0);
				if (fromStartResult.matchCount !== undefined && fromStartResult.matchCount > 1) {
					throw new ApplyPatchError(
						`Found ${fromStartResult.matchCount} matches for context '${hunk.changeContext}' in ${path}. ` +
							`Add more surrounding context or additional @@ anchors to make it unique.`,
					);
				}
				idx = fromStartResult.index;
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
			// Pure addition - prefer changeContext position, then line hint, then end of file
			let insertionIdx: number;
			if (hunk.changeContext !== undefined) {
				// changeContext was processed above; lineIndex is set to the context line or after it
				insertionIdx = lineIndex;
			} else {
				const lineHintForInsertion = hunk.oldStartLine ?? hunk.newStartLine;
				if (lineHintForInsertion !== undefined) {
					// Reject if line hint is out of range for insertion
					// Valid insertion points are 1 to (file length + 1) for 1-indexed hints
					if (lineHintForInsertion > originalLines.length + 1) {
						throw new ApplyPatchError(
							`Line hint ${lineHintForInsertion} is out of range for insertion in ${path} ` +
								`(file has ${originalLines.length} lines)`,
						);
					}
					insertionIdx = Math.max(0, lineHintForInsertion - 1);
				} else {
					insertionIdx =
						originalLines.length > 0 && originalLines[originalLines.length - 1] === ""
							? originalLines.length - 1
							: originalLines.length;
				}
			}

			replacements.push({ startIndex: insertionIdx, oldLen: 0, newLines: [...hunk.newLines] });
			continue;
		}

		// Try to find the old lines in the file
		let pattern = [...hunk.oldLines];
		const matchHint = getHunkHintIndex(hunk, lineIndex);
		let searchResult = findSequenceWithHint(originalLines, pattern, lineIndex, matchHint, hunk.isEndOfFile);
		let newSlice = [...hunk.newLines];

		// Retry without trailing empty line if present
		if (searchResult.index === undefined && pattern.length > 0 && pattern[pattern.length - 1] === "") {
			pattern = pattern.slice(0, -1);
			if (newSlice.length > 0 && newSlice[newSlice.length - 1] === "") {
				newSlice = newSlice.slice(0, -1);
			}
			searchResult = findSequenceWithHint(originalLines, pattern, lineIndex, matchHint, hunk.isEndOfFile);
		}

		if (searchResult.index === undefined) {
			throw new ApplyPatchError(`Failed to find expected lines in ${path}:\n${hunk.oldLines.join("\n")}`);
		}

		const found = searchResult.index;

		// Reject if match is ambiguous (prefix/substring matching found multiple matches)
		if (searchResult.matchCount !== undefined && searchResult.matchCount > 1) {
			throw new ApplyPatchError(
				`Found ${searchResult.matchCount} matches for the text in ${path}. ` +
					`Add more surrounding context or additional @@ anchors to make it unique.`,
			);
		}

		// For simple diffs (no context marker, no context lines), check for multiple occurrences
		// This ensures ambiguous replacements are rejected
		// Skip this check if isEndOfFile is set (EOF marker provides disambiguation)
		if (hunk.changeContext === undefined && !hunk.hasContextLines && !hunk.isEndOfFile && lineHint === undefined) {
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
function applyHunksToContent(originalContent: string, path: string, hunks: DiffHunk[], fuzzyThreshold: number): string {
	const hadFinalNewline = originalContent.endsWith("\n");

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
			const content = applyCharacterMatch(originalContent, path, hunk, fuzzyThreshold);
			return applyTrailingNewlinePolicy(content, hadFinalNewline);
		}
	}

	let originalLines = originalContent.split("\n");

	// Track if we have a trailing empty element from the final newline
	// Only strip ONE trailing empty (the newline marker), preserve actual blank lines
	let strippedTrailingEmpty = false;
	if (hadFinalNewline && originalLines.length > 0 && originalLines[originalLines.length - 1] === "") {
		// Check if the second-to-last is also empty (actual blank line) - if so, only strip one
		originalLines = originalLines.slice(0, -1);
		strippedTrailingEmpty = true;
	}

	const replacements = computeReplacements(originalLines, path, hunks);
	const newLines = applyReplacements(originalLines, replacements);

	// Restore the trailing empty element if we stripped it
	if (strippedTrailingEmpty) {
		newLines.push("");
	}

	const content = newLines.join("\n");

	// Preserve original trailing newline behavior
	if (hadFinalNewline && !content.endsWith("\n")) {
		return `${content}\n`;
	}
	if (!hadFinalNewline && content.endsWith("\n")) {
		return content.slice(0, -1);
	}
	return content;
}

// ═══════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Apply a patch operation to the filesystem.
 */
export async function applyPatch(input: PatchInput, options: ApplyPatchOptions): Promise<ApplyPatchResult> {
	const { cwd, dryRun = false, fs = defaultFileSystem, fuzzyThreshold = DEFAULT_FUZZY_THRESHOLD } = options;

	const resolvePath = (p: string): string => resolve(cwd, p);
	const absolutePath = resolvePath(input.path);

	if (input.moveTo) {
		const destPath = resolvePath(input.moveTo);
		if (destPath === absolutePath) {
			throw new ApplyPatchError("moveTo path is the same as source path");
		}
	}

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
	const { bom: bomFromText, text: strippedContent } = stripBom(originalContent);
	let bom = bomFromText;
	if (!bom && fs.readBinary) {
		const bytes = await fs.readBinary(absolutePath);
		if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
			bom = "\uFEFF";
		}
	}
	const lineEnding = detectLineEnding(strippedContent);
	const normalizedContent = normalizeToLF(strippedContent);
	const hunks = parseHunks(input.diff);

	if (hunks.length === 0) {
		throw new ApplyPatchError("Diff contains no hunks");
	}

	const newContent = applyHunksToContent(normalizedContent, input.path, hunks, fuzzyThreshold);
	const finalContent = bom + restoreLineEndings(newContent, lineEnding);
	const destPath = input.moveTo ? resolvePath(input.moveTo) : absolutePath;
	const isMove = Boolean(input.moveTo) && destPath !== absolutePath;

	if (!dryRun) {
		if (isMove) {
			const parentDir = dirname(destPath);
			if (parentDir && parentDir !== ".") {
				await fs.mkdir(parentDir);
			}
			await fs.write(destPath, finalContent);
			await fs.delete(absolutePath);
		} else {
			await fs.write(absolutePath, finalContent);
		}
	}

	return {
		change: {
			type: "update",
			path: absolutePath,
			newPath: isMove ? destPath : undefined,
			oldContent: originalContent,
			newContent: finalContent,
		},
	};
}

/**
 * Preview what changes a patch would make without applying it.
 */
export async function previewPatch(input: PatchInput, options: ApplyPatchOptions): Promise<ApplyPatchResult> {
	return applyPatch(input, { ...options, dryRun: true });
}
