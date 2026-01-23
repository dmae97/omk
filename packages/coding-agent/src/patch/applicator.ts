/**
 * Patch application logic for the edit tool.
 *
 * Applies parsed diff hunks to file content using fuzzy matching
 * for robust handling of whitespace and formatting differences.
 */

import { mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { resolveToCwd } from "$c/tools/path-utils";
import { DEFAULT_FUZZY_THRESHOLD, findContextLine, findMatch, seekSequence } from "./fuzzy";
import {
	adjustIndentation,
	convertLeadingTabsToSpaces,
	countLeadingWhitespace,
	detectLineEnding,
	getLeadingWhitespace,
	normalizeToLF,
	restoreLineEndings,
	stripBom,
} from "./normalize";
import { normalizeCreateContent, parseHunks } from "./parser";
import type {
	ApplyPatchOptions,
	ApplyPatchResult,
	ContextLineResult,
	DiffHunk,
	FileSystem,
	NormalizedPatchInput,
	PatchInput,
} from "./types";
import { ApplyPatchError, normalizePatchInput } from "./types";

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

interface HunkVariant {
	oldLines: string[];
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

	// If pattern already matches actual exactly (including indentation), preserve agent's intended changes
	if (patternLines.length === actualLines.length) {
		let exactMatch = true;
		for (let i = 0; i < patternLines.length; i++) {
			if (patternLines[i] !== actualLines[i]) {
				exactMatch = false;
				break;
			}
		}
		if (exactMatch) {
			return newLines;
		}
	}

	// If the patch is purely an indentation change (same trimmed content), apply exactly as specified
	if (patternLines.length === newLines.length) {
		let indentationOnly = true;
		for (let i = 0; i < patternLines.length; i++) {
			if (patternLines[i].trim() !== newLines[i].trim()) {
				indentationOnly = false;
				break;
			}
		}
		if (indentationOnly) {
			return newLines;
		}
	}

	// Detect indent character from actual content
	let indentChar = " ";
	for (const line of actualLines) {
		const ws = getLeadingWhitespace(line);
		if (ws.length > 0) {
			indentChar = ws[0];
			break;
		}
	}

	let patternTabOnly = true;
	let actualSpaceOnly = true;
	let patternMixed = false;
	let actualMixed = false;

	for (const line of patternLines) {
		if (line.trim().length === 0) continue;
		const ws = getLeadingWhitespace(line);
		if (ws.includes(" ")) patternTabOnly = false;
		if (ws.includes(" ") && ws.includes("\t")) patternMixed = true;
	}

	for (const line of actualLines) {
		if (line.trim().length === 0) continue;
		const ws = getLeadingWhitespace(line);
		if (ws.includes("\t")) actualSpaceOnly = false;
		if (ws.includes(" ") && ws.includes("\t")) actualMixed = true;
	}

	if (!patternMixed && !actualMixed && patternTabOnly && actualSpaceOnly) {
		let ratio: number | undefined;
		const lineCount = Math.min(patternLines.length, actualLines.length);
		let consistent = true;
		for (let i = 0; i < lineCount; i++) {
			const patternLine = patternLines[i];
			const actualLine = actualLines[i];
			if (patternLine.trim().length === 0 || actualLine.trim().length === 0) continue;
			const patternIndent = countLeadingWhitespace(patternLine);
			const actualIndent = countLeadingWhitespace(actualLine);
			if (patternIndent === 0) continue;
			if (actualIndent % patternIndent !== 0) {
				consistent = false;
				break;
			}
			const nextRatio = actualIndent / patternIndent;
			if (!ratio) {
				ratio = nextRatio;
			} else if (ratio !== nextRatio) {
				consistent = false;
				break;
			}
		}

		if (consistent && ratio) {
			const converted = convertLeadingTabsToSpaces(newLines.join("\n"), ratio).split("\n");
			return converted;
		}
	}

	// Build a map from trimmed content to actual lines (by content, not position)
	// This handles fuzzy matches where pattern and actual may not be positionally aligned
	const contentToActualLines = new Map<string, string[]>();
	for (const line of actualLines) {
		const trimmed = line.trim();
		if (trimmed.length === 0) continue;
		const arr = contentToActualLines.get(trimmed);
		if (arr) {
			arr.push(line);
		} else {
			contentToActualLines.set(trimmed, [line]);
		}
	}

	let patternMin = Infinity;
	for (const line of patternLines) {
		if (line.trim().length === 0) continue;
		patternMin = Math.min(patternMin, countLeadingWhitespace(line));
	}
	if (patternMin === Infinity) {
		patternMin = 0;
	}

	let delta: number | undefined;
	const deltas: number[] = [];
	for (let i = 0; i < Math.min(patternLines.length, actualLines.length); i++) {
		const patternLine = patternLines[i];
		const actualLine = actualLines[i];
		if (patternLine.trim().length === 0 || actualLine.trim().length === 0) continue;
		const pIndent = countLeadingWhitespace(patternLine);
		const aIndent = countLeadingWhitespace(actualLine);
		deltas.push(aIndent - pIndent);
	}

	if (deltas.length > 0 && deltas.every((value) => value === deltas[0])) {
		delta = deltas[0];
	}

	// Track which actual lines we've used to handle duplicate content correctly
	const usedActualLines = new Map<string, number>(); // trimmed content -> count used

	return newLines.map((newLine) => {
		if (newLine.trim().length === 0) {
			return newLine;
		}

		const trimmed = newLine.trim();
		const matchingActualLines = contentToActualLines.get(trimmed);

		// Check if this is a context line (same trimmed content exists in actual)
		if (matchingActualLines && matchingActualLines.length > 0) {
			if (matchingActualLines.length === 1) {
				return matchingActualLines[0];
			}
			if (matchingActualLines.includes(newLine)) {
				return newLine;
			}
			const usedCount = usedActualLines.get(trimmed) ?? 0;
			if (usedCount < matchingActualLines.length) {
				usedActualLines.set(trimmed, usedCount + 1);
				// Use actual file content directly for context lines
				return matchingActualLines[usedCount];
			}
		}

		// This is a new/added line - apply consistent delta if safe
		if (delta && delta !== 0) {
			const newIndent = countLeadingWhitespace(newLine);
			if (newIndent === patternMin) {
				if (delta > 0) {
					return indentChar.repeat(delta) + newLine;
				}
				const toRemove = Math.min(-delta, newIndent);
				return newLine.slice(toRemove);
			}
		}
		return newLine;
	});
}

function trimCommonContext(oldLines: string[], newLines: string[]): HunkVariant | undefined {
	let start = 0;
	let endOld = oldLines.length;
	let endNew = newLines.length;

	while (start < endOld && start < endNew && oldLines[start] === newLines[start]) {
		start++;
	}

	while (endOld > start && endNew > start && oldLines[endOld - 1] === newLines[endNew - 1]) {
		endOld--;
		endNew--;
	}

	if (start === 0 && endOld === oldLines.length && endNew === newLines.length) {
		return undefined;
	}

	const trimmedOld = oldLines.slice(start, endOld);
	const trimmedNew = newLines.slice(start, endNew);
	if (trimmedOld.length === 0 && trimmedNew.length === 0) {
		return undefined;
	}
	return { oldLines: trimmedOld, newLines: trimmedNew };
}

function collapseConsecutiveSharedLines(oldLines: string[], newLines: string[]): HunkVariant | undefined {
	const shared = new Set(oldLines.filter((line) => newLines.includes(line)));
	const collapse = (lines: string[]): string[] => {
		const out: string[] = [];
		let i = 0;
		while (i < lines.length) {
			const line = lines[i];
			out.push(line);
			let j = i + 1;
			while (j < lines.length && lines[j] === line && shared.has(line)) {
				j++;
			}
			i = j;
		}
		return out;
	};

	const collapsedOld = collapse(oldLines);
	const collapsedNew = collapse(newLines);
	if (collapsedOld.length === oldLines.length && collapsedNew.length === newLines.length) {
		return undefined;
	}
	return { oldLines: collapsedOld, newLines: collapsedNew };
}

function collapseRepeatedBlocks(oldLines: string[], newLines: string[]): HunkVariant | undefined {
	const shared = new Set(oldLines.filter((line) => newLines.includes(line)));
	const collapse = (lines: string[]): string[] => {
		const output = [...lines];
		let changed = false;
		let i = 0;
		while (i < output.length) {
			let collapsed = false;
			for (let size = Math.floor((output.length - i) / 2); size >= 2; size--) {
				const first = output.slice(i, i + size);
				const second = output.slice(i + size, i + size * 2);
				if (first.length !== second.length || first.length === 0) continue;
				if (!first.every((line) => shared.has(line))) continue;
				let same = true;
				for (let idx = 0; idx < size; idx++) {
					if (first[idx] !== second[idx]) {
						same = false;
						break;
					}
				}
				if (same) {
					output.splice(i + size, size);
					changed = true;
					collapsed = true;
					break;
				}
			}
			if (!collapsed) {
				i++;
			}
		}
		return changed ? output : lines;
	};

	const collapsedOld = collapse(oldLines);
	const collapsedNew = collapse(newLines);
	if (collapsedOld.length === oldLines.length && collapsedNew.length === newLines.length) {
		return undefined;
	}
	return { oldLines: collapsedOld, newLines: collapsedNew };
}

function reduceToSingleLineChange(oldLines: string[], newLines: string[]): HunkVariant | undefined {
	if (oldLines.length !== newLines.length || oldLines.length === 0) return undefined;
	let changedIndex: number | undefined;
	for (let i = 0; i < oldLines.length; i++) {
		if (oldLines[i] !== newLines[i]) {
			if (changedIndex !== undefined) return undefined;
			changedIndex = i;
		}
	}
	if (changedIndex === undefined) return undefined;
	return { oldLines: [oldLines[changedIndex]], newLines: [newLines[changedIndex]] };
}

function buildFallbackVariants(hunk: DiffHunk): HunkVariant[] {
	const variants: HunkVariant[] = [];
	const base: HunkVariant = { oldLines: hunk.oldLines, newLines: hunk.newLines };

	const trimmed = trimCommonContext(base.oldLines, base.newLines);
	if (trimmed) variants.push(trimmed);

	const deduped = collapseConsecutiveSharedLines(
		trimmed?.oldLines ?? base.oldLines,
		trimmed?.newLines ?? base.newLines,
	);
	if (deduped) variants.push(deduped);

	const collapsed = collapseRepeatedBlocks(
		deduped?.oldLines ?? trimmed?.oldLines ?? base.oldLines,
		deduped?.newLines ?? trimmed?.newLines ?? base.newLines,
	);
	if (collapsed) variants.push(collapsed);

	const singleLine = reduceToSingleLineChange(trimmed?.oldLines ?? base.oldLines, trimmed?.newLines ?? base.newLines);
	if (singleLine) variants.push(singleLine);

	const seen = new Set<string>();
	return variants.filter((variant) => {
		if (variant.oldLines.length === 0 && variant.newLines.length === 0) return false;
		const key = `${variant.oldLines.join("\n")}||${variant.newLines.join("\n")}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function findContextRelativeMatch(
	lines: string[],
	patternLine: string,
	contextIndex: number,
	preferSecondForwardMatch: boolean,
): number | undefined {
	const trimmed = patternLine.trim();
	const forwardMatches: number[] = [];
	for (let i = contextIndex + 1; i < lines.length; i++) {
		if (lines[i].trim() === trimmed) {
			forwardMatches.push(i);
		}
	}
	if (forwardMatches.length > 0) {
		if (preferSecondForwardMatch && forwardMatches.length > 1) {
			return forwardMatches[1];
		}
		return forwardMatches[0];
	}
	for (let i = contextIndex - 1; i >= 0; i--) {
		if (lines[i].trim() === trimmed) {
			return i;
		}
	}
	return undefined;
}

/** Get hint index from hunk's line number */
function getHunkHintIndex(hunk: DiffHunk, currentIndex: number): number | undefined {
	if (hunk.oldStartLine === undefined) return undefined;
	const hintIndex = Math.max(0, hunk.oldStartLine - 1);
	return hintIndex >= currentIndex ? hintIndex : undefined;
}

/**
 * Find hierarchical context in file lines.
 *
 * Handles three formats:
 * 1. Simple context: "function foo" - find this line
 * 2. Hierarchical (newline): "class Foo\nmethod" - find class, then method after it
 * 3. Hierarchical (space): "class Foo method" - try as literal first, then split and search
 *
 * @returns The result from finding the final (innermost) context, or undefined if not found
 */
function findHierarchicalContext(
	lines: string[],
	context: string,
	startFrom: number,
	lineHint: number | undefined,
	allowFuzzy: boolean,
): ContextLineResult {
	// Check for newline-separated hierarchical contexts (from nested @@ anchors)
	if (context.includes("\n")) {
		const parts = context
			.split("\n")
			.map((p) => p.trim())
			.filter((p) => p.length > 0);
		let currentStart = startFrom;

		for (let i = 0; i < parts.length; i++) {
			const part = parts[i];
			const isLast = i === parts.length - 1;

			const result = findContextLine(lines, part, currentStart, { allowFuzzy });

			if (result.matchCount !== undefined && result.matchCount > 1) {
				if (isLast && lineHint !== undefined) {
					const hintStart = Math.max(0, lineHint - 1);
					if (hintStart >= currentStart) {
						const hintedResult = findContextLine(lines, part, hintStart, { allowFuzzy });
						if (hintedResult.index !== undefined) {
							return { ...hintedResult, matchCount: 1 };
						}
					}
				}
				return { index: undefined, confidence: result.confidence, matchCount: result.matchCount };
			}

			if (result.index === undefined) {
				if (isLast && lineHint !== undefined) {
					const hintStart = Math.max(0, lineHint - 1);
					if (hintStart >= currentStart) {
						const hintedResult = findContextLine(lines, part, hintStart, { allowFuzzy });
						if (hintedResult.index !== undefined) {
							return { ...hintedResult, matchCount: 1 };
						}
					}
				}
				return { index: undefined, confidence: result.confidence };
			}

			if (isLast) {
				return result;
			}
			currentStart = result.index + 1;
		}
		return { index: undefined, confidence: 0 };
	}

	// Try literal context first
	const spaceParts = context.split(/\s+/).filter((p) => p.length > 0);
	const hasSignatureChars = /[(){}[\]]/.test(context);
	if (!hasSignatureChars && spaceParts.length > 2) {
		const outer = spaceParts.slice(0, -1).join(" ");
		const inner = spaceParts[spaceParts.length - 1];
		const outerResult = findContextLine(lines, outer, startFrom, { allowFuzzy });
		if (outerResult.matchCount !== undefined && outerResult.matchCount > 1) {
			return { index: undefined, confidence: outerResult.confidence, matchCount: outerResult.matchCount };
		}
		if (outerResult.index !== undefined) {
			const innerResult = findContextLine(lines, inner, outerResult.index + 1, { allowFuzzy });
			if (innerResult.index !== undefined) {
				return innerResult.matchCount && innerResult.matchCount > 1
					? { ...innerResult, matchCount: 1 }
					: innerResult;
			}
			if (innerResult.matchCount !== undefined && innerResult.matchCount > 1) {
				return { ...innerResult, matchCount: 1 };
			}
		}
	}

	const result = findContextLine(lines, context, startFrom, { allowFuzzy });

	// If line hint exists and result is ambiguous or missing, try from hint
	if ((result.index === undefined || (result.matchCount ?? 0) > 1) && lineHint !== undefined) {
		const hintStart = Math.max(0, lineHint - 1);
		const hintedResult = findContextLine(lines, context, hintStart, { allowFuzzy });
		if (hintedResult.index !== undefined) {
			return { ...hintedResult, matchCount: 1 };
		}
	}

	// If found uniquely, return it
	if (result.index !== undefined && (result.matchCount ?? 0) <= 1) {
		return result;
	}
	if (result.matchCount !== undefined && result.matchCount > 1) {
		return result;
	}

	// Try from beginning if not found from current position
	if (result.index === undefined && startFrom !== 0) {
		const fromStartResult = findContextLine(lines, context, 0, { allowFuzzy });
		if (fromStartResult.index !== undefined && (fromStartResult.matchCount ?? 0) <= 1) {
			return fromStartResult;
		}
		if (fromStartResult.matchCount !== undefined && fromStartResult.matchCount > 1) {
			return fromStartResult;
		}
	}

	// Fallback: try space-separated hierarchical matching
	// e.g., "class PatchTool constructor" -> find "class PatchTool", then "constructor" after it
	if (!hasSignatureChars && spaceParts.length > 1) {
		const outer = spaceParts.slice(0, -1).join(" ");
		const inner = spaceParts[spaceParts.length - 1];
		const outerResult = findContextLine(lines, outer, startFrom, { allowFuzzy });

		if (outerResult.matchCount !== undefined && outerResult.matchCount > 1) {
			return { index: undefined, confidence: outerResult.confidence, matchCount: outerResult.matchCount };
		}

		if (outerResult.index === undefined) {
			return { index: undefined, confidence: outerResult.confidence };
		}

		const innerResult = findContextLine(lines, inner, outerResult.index + 1, { allowFuzzy });
		if (innerResult.index !== undefined) {
			return innerResult.matchCount && innerResult.matchCount > 1 ? { ...innerResult, matchCount: 1 } : innerResult;
		}
		if (innerResult.matchCount !== undefined && innerResult.matchCount > 1) {
			return { ...innerResult, matchCount: 1 };
		}
	}

	return result;
}

/** Find sequence with optional hint position, returning full search result */
function findSequenceWithHint(
	lines: string[],
	pattern: string[],
	currentIndex: number,
	hintIndex: number | undefined,
	eof: boolean,
	allowFuzzy: boolean,
): import("./types").SequenceSearchResult {
	// Prefer content-based search starting from currentIndex
	const primaryResult = seekSequence(lines, pattern, currentIndex, eof, { allowFuzzy });
	if (
		primaryResult.matchCount &&
		primaryResult.matchCount > 1 &&
		hintIndex !== undefined &&
		hintIndex !== currentIndex
	) {
		const hintedResult = seekSequence(lines, pattern, hintIndex, eof, { allowFuzzy });
		if (hintedResult.index !== undefined && (hintedResult.matchCount ?? 1) <= 1) {
			return hintedResult;
		}
		if (hintedResult.matchCount && hintedResult.matchCount > 1) {
			return hintedResult;
		}
	}
	if (primaryResult.index !== undefined || (primaryResult.matchCount && primaryResult.matchCount > 1)) {
		return primaryResult;
	}

	// Use line hint as a secondary bias only if needed
	if (hintIndex !== undefined && hintIndex !== currentIndex) {
		const hintedResult = seekSequence(lines, pattern, hintIndex, eof, { allowFuzzy });
		if (hintedResult.index !== undefined || (hintedResult.matchCount && hintedResult.matchCount > 1)) {
			return hintedResult;
		}
	}

	// Last resort: search from beginning (handles out-of-order hunks)
	if (currentIndex !== 0) {
		const fromStartResult = seekSequence(lines, pattern, 0, eof, { allowFuzzy });
		if (fromStartResult.index !== undefined || (fromStartResult.matchCount && fromStartResult.matchCount > 1)) {
			return fromStartResult;
		}
	}

	return primaryResult;
}

function attemptSequenceFallback(
	lines: string[],
	hunk: DiffHunk,
	currentIndex: number,
	lineHint: number | undefined,
	allowFuzzy: boolean,
): number | undefined {
	if (hunk.oldLines.length === 0) return undefined;
	const matchHint = getHunkHintIndex(hunk, currentIndex);
	const fallbackResult = findSequenceWithHint(
		lines,
		hunk.oldLines,
		currentIndex,
		matchHint ?? lineHint,
		false,
		allowFuzzy,
	);
	if (fallbackResult.index !== undefined && (fallbackResult.matchCount ?? 1) <= 1) {
		const nextIndex = fallbackResult.index + 1;
		if (nextIndex <= lines.length - hunk.oldLines.length) {
			const secondMatch = seekSequence(lines, hunk.oldLines, nextIndex, false, { allowFuzzy });
			if (secondMatch.index !== undefined) {
				return undefined;
			}
		}
		return fallbackResult.index;
	}

	for (const variant of buildFallbackVariants(hunk)) {
		if (variant.oldLines.length === 0) continue;
		const variantResult = findSequenceWithHint(
			lines,
			variant.oldLines,
			currentIndex,
			matchHint ?? lineHint,
			false,
			allowFuzzy,
		);
		if (variantResult.index !== undefined && (variantResult.matchCount ?? 1) <= 1) {
			return variantResult.index;
		}
	}
	return undefined;
}

/**
 * Apply a hunk using character-based fuzzy matching.
 * Used when the hunk contains only -/+ lines without context.
 */
function applyCharacterMatch(
	originalContent: string,
	path: string,
	hunk: DiffHunk,
	fuzzyThreshold: number,
	allowFuzzy: boolean,
): string {
	const oldText = hunk.oldLines.join("\n");
	const newText = hunk.newLines.join("\n");

	const normalizedContent = normalizeToLF(originalContent);
	const normalizedOldText = normalizeToLF(oldText);

	let matchOutcome = findMatch(normalizedContent, normalizedOldText, {
		allowFuzzy,
		threshold: fuzzyThreshold,
	});
	if (!matchOutcome.match && allowFuzzy) {
		const relaxedThreshold = Math.min(fuzzyThreshold, 0.92);
		if (relaxedThreshold < fuzzyThreshold) {
			const relaxedOutcome = findMatch(normalizedContent, normalizedOldText, {
				allowFuzzy,
				threshold: relaxedThreshold,
			});
			if (relaxedOutcome.match) {
				matchOutcome = relaxedOutcome;
			}
		}
	}

	// Check for multiple exact occurrences
	if (matchOutcome.occurrences && matchOutcome.occurrences > 1) {
		const previews = matchOutcome.occurrencePreviews?.join("\n\n") ?? "";
		const moreMsg = matchOutcome.occurrences > 5 ? ` (showing first 5 of ${matchOutcome.occurrences})` : "";
		throw new ApplyPatchError(
			`Found ${matchOutcome.occurrences} occurrences in ${path}${moreMsg}:\n\n${previews}\n\n` +
				`Add more context lines to disambiguate.`,
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
function computeReplacements(
	originalLines: string[],
	path: string,
	hunks: DiffHunk[],
	allowFuzzy: boolean,
): Replacement[] {
	const replacements: Replacement[] = [];
	let lineIndex = 0;

	for (const hunk of hunks) {
		let contextIndex: number | undefined;
		if (hunk.oldStartLine !== undefined && hunk.oldStartLine < 1) {
			throw new ApplyPatchError(
				`Line hint ${hunk.oldStartLine} is out of range for ${path} (line numbers start at 1)`,
			);
		}
		if (hunk.newStartLine !== undefined && hunk.newStartLine < 1) {
			throw new ApplyPatchError(
				`Line hint ${hunk.newStartLine} is out of range for ${path} (line numbers start at 1)`,
			);
		}
		const lineHint = hunk.oldStartLine;
		if (lineHint !== undefined && hunk.changeContext === undefined && !hunk.hasContextLines) {
			lineIndex = Math.max(0, Math.min(lineHint - 1, originalLines.length - 1));
		}

		// If hunk has a changeContext, find it and adjust lineIndex
		if (hunk.changeContext !== undefined) {
			// Use hierarchical context matching for nested @@ anchors and space-separated contexts
			const result = findHierarchicalContext(originalLines, hunk.changeContext, lineIndex, lineHint, allowFuzzy);
			const idx = result.index;
			contextIndex = idx;

			if (idx === undefined || (result.matchCount !== undefined && result.matchCount > 1)) {
				const fallback = attemptSequenceFallback(originalLines, hunk, lineIndex, lineHint, allowFuzzy);
				if (fallback !== undefined) {
					lineIndex = fallback;
				} else if (result.matchCount !== undefined && result.matchCount > 1) {
					const displayContext = hunk.changeContext.includes("\n")
						? hunk.changeContext.split("\n").pop()
						: hunk.changeContext;
					throw new ApplyPatchError(
						`Found ${result.matchCount} matches for context '${displayContext}' in ${path}. ` +
							`Add more surrounding context or additional @@ anchors to make it unique.`,
					);
				} else {
					const displayContext = hunk.changeContext.includes("\n")
						? hunk.changeContext.split("\n").join(" > ")
						: hunk.changeContext;
					throw new ApplyPatchError(`Failed to find context '${displayContext}' in ${path}`);
				}
			} else {
				// If oldLines[0] matches the final context, start search at idx (not idx+1)
				// This handles the common case where @@ scope and first context line are identical
				const firstOldLine = hunk.oldLines[0];
				const finalContext = hunk.changeContext.includes("\n")
					? hunk.changeContext.split("\n").pop()?.trim()
					: hunk.changeContext.trim();
				const isHierarchicalContext =
					hunk.changeContext.includes("\n") || hunk.changeContext.trim().split(/\s+/).length > 2;
				if (firstOldLine !== undefined && (firstOldLine.trim() === finalContext || isHierarchicalContext)) {
					lineIndex = idx;
				} else {
					lineIndex = idx + 1;
				}
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
					if (lineHintForInsertion < 1) {
						throw new ApplyPatchError(
							`Line hint ${lineHintForInsertion} is out of range for insertion in ${path} ` +
								`(line numbers start at 1)`,
						);
					}
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
		let searchResult = findSequenceWithHint(
			originalLines,
			pattern,
			lineIndex,
			matchHint,
			hunk.isEndOfFile,
			allowFuzzy,
		);
		let newSlice = [...hunk.newLines];

		// Retry without trailing empty line if present
		if (searchResult.index === undefined && pattern.length > 0 && pattern[pattern.length - 1] === "") {
			pattern = pattern.slice(0, -1);
			if (newSlice.length > 0 && newSlice[newSlice.length - 1] === "") {
				newSlice = newSlice.slice(0, -1);
			}
			searchResult = findSequenceWithHint(
				originalLines,
				pattern,
				lineIndex,
				matchHint,
				hunk.isEndOfFile,
				allowFuzzy,
			);
		}

		if (searchResult.index === undefined || (searchResult.matchCount ?? 0) > 1) {
			for (const variant of buildFallbackVariants(hunk)) {
				if (variant.oldLines.length === 0) continue;
				const variantResult = findSequenceWithHint(
					originalLines,
					variant.oldLines,
					lineIndex,
					matchHint,
					hunk.isEndOfFile,
					allowFuzzy,
				);
				if (variantResult.index !== undefined && (variantResult.matchCount ?? 1) <= 1) {
					pattern = variant.oldLines;
					newSlice = variant.newLines;
					searchResult = variantResult;
					break;
				}
			}
		}

		if (searchResult.index === undefined && contextIndex !== undefined) {
			for (const variant of buildFallbackVariants(hunk)) {
				if (variant.oldLines.length !== 1 || variant.newLines.length !== 1) continue;
				const removedLine = variant.oldLines[0];
				const hasSharedDuplicate = hunk.newLines.some((line) => line.trim() === removedLine.trim());
				const adjacentIndex = findContextRelativeMatch(
					originalLines,
					removedLine,
					contextIndex,
					hasSharedDuplicate,
				);
				if (adjacentIndex !== undefined) {
					pattern = variant.oldLines;
					newSlice = variant.newLines;
					searchResult = { index: adjacentIndex, confidence: 0.95 };
					break;
				}
			}
		}

		if (searchResult.index !== undefined && contextIndex !== undefined && pattern.length === 1) {
			const trimmed = pattern[0].trim();
			let occurrenceCount = 0;
			for (const line of originalLines) {
				if (line.trim() === trimmed) occurrenceCount++;
			}
			if (occurrenceCount > 1) {
				const hasSharedDuplicate = hunk.newLines.some((line) => line.trim() === trimmed);
				const contextMatch = findContextRelativeMatch(originalLines, pattern[0], contextIndex, hasSharedDuplicate);
				if (contextMatch !== undefined) {
					searchResult = { index: contextMatch, confidence: searchResult.confidence ?? 0.95 };
				}
			}
		}

		if (searchResult.index === undefined) {
			if (searchResult.matchCount !== undefined && searchResult.matchCount > 1) {
				throw new ApplyPatchError(
					`Found ${searchResult.matchCount} matches for the text in ${path}. ` +
						`Add more surrounding context or additional @@ anchors to make it unique.`,
				);
			}
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
			const secondMatch = seekSequence(originalLines, pattern, found + 1, false, { allowFuzzy });
			if (secondMatch.index !== undefined) {
				// Extract 3-line previews for each match
				const formatPreview = (startIdx: number) => {
					const lines = originalLines.slice(startIdx, startIdx + 3);
					return lines
						.map((line, i) => {
							const num = startIdx + i + 1;
							const truncated = line.length > 60 ? `${line.slice(0, 57)}...` : line;
							return `  ${num} | ${truncated}`;
						})
						.join("\n");
				};
				const preview1 = formatPreview(found);
				const preview2 = formatPreview(secondMatch.index);
				throw new ApplyPatchError(
					`Found 2 occurrences in ${path}:\n\n${preview1}\n\n${preview2}\n\n` +
						`Add more context lines to disambiguate.`,
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
function applyHunksToContent(
	originalContent: string,
	path: string,
	hunks: DiffHunk[],
	fuzzyThreshold: number,
	allowFuzzy: boolean,
): string {
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
			const content = applyCharacterMatch(originalContent, path, hunk, fuzzyThreshold, allowFuzzy);
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

	const replacements = computeReplacements(originalLines, path, hunks, allowFuzzy);
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
	const normalized = normalizePatchInput(input);
	return applyNormalizedPatch(normalized, options);
}

/**
 * Apply a normalized patch operation to the filesystem.
 * @internal
 */
async function applyNormalizedPatch(
	input: NormalizedPatchInput,
	options: ApplyPatchOptions,
): Promise<ApplyPatchResult> {
	const {
		cwd,
		dryRun = false,
		fs = defaultFileSystem,
		fuzzyThreshold = DEFAULT_FUZZY_THRESHOLD,
		allowFuzzy = true,
	} = options;

	const resolvePath = (p: string): string => resolveToCwd(p, cwd);
	const absolutePath = resolvePath(input.path);

	if (input.rename) {
		const destPath = resolvePath(input.rename);
		if (destPath === absolutePath) {
			throw new ApplyPatchError("rename path is the same as source path");
		}
	}

	// Handle CREATE operation
	if (input.op === "create") {
		if (!input.diff) {
			throw new ApplyPatchError("Create operation requires diff (file content)");
		}
		// Strip + prefixes if present (handles diffs formatted as additions)
		const normalizedContent = normalizeCreateContent(input.diff);
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
	if (input.op === "delete") {
		if (!(await fs.exists(absolutePath))) {
			throw new ApplyPatchError(`File not found: ${input.path}`);
		}

		const oldContent = await fs.read(absolutePath);
		if (!dryRun) {
			await fs.delete(absolutePath);
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

	const newContent = applyHunksToContent(normalizedContent, input.path, hunks, fuzzyThreshold, allowFuzzy);
	const finalContent = bom + restoreLineEndings(newContent, lineEnding);
	const destPath = input.rename ? resolvePath(input.rename) : absolutePath;
	const isMove = Boolean(input.rename) && destPath !== absolutePath;

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
