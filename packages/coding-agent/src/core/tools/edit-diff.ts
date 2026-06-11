/**
 * Shared diff computation utilities for the edit tool.
 * Used by both edit.ts (for execution) and tool-execution.ts (for preview rendering).
 */

import * as Diff from "diff";
import { constants } from "fs";
import { access, readFile } from "fs/promises";
import { resolveToCwd } from "./path-utils.ts";

export function detectLineEnding(content: string): "\r\n" | "\n" {
	const crlfIdx = content.indexOf("\r\n");
	const lfIdx = content.indexOf("\n");
	if (lfIdx === -1) return "\n";
	if (crlfIdx === -1) return "\n";
	return crlfIdx < lfIdx ? "\r\n" : "\n";
}

export function normalizeToLF(text: string): string {
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function restoreLineEndings(text: string, ending: "\r\n" | "\n"): string {
	return ending === "\r\n" ? text.replace(/\n/g, "\r\n") : text;
}

/**
 * Normalize text for fuzzy matching. Applies progressive transformations:
 * - Strip trailing whitespace from each line
 * - Normalize smart quotes to ASCII equivalents
 * - Normalize Unicode dashes/hyphens to ASCII hyphen
 * - Normalize special Unicode spaces to regular space
 */
export function normalizeForFuzzyMatch(text: string): string {
	return (
		text
			.normalize("NFKC")
			// Strip trailing whitespace per line
			.split("\n")
			.map((line) => line.trimEnd())
			.join("\n")
			// Smart single quotes → '
			.replace(/[\u2018\u2019\u201A\u201B]/g, "'")
			// Smart double quotes → "
			.replace(/[\u201C\u201D\u201E\u201F]/g, '"')
			// Various dashes/hyphens → -
			// U+2010 hyphen, U+2011 non-breaking hyphen, U+2012 figure dash,
			// U+2013 en-dash, U+2014 em-dash, U+2015 horizontal bar, U+2212 minus
			.replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
			// Special spaces → regular space
			// U+00A0 NBSP, U+2002-U+200A various spaces, U+202F narrow NBSP,
			// U+205F medium math space, U+3000 ideographic space
			.replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ")
	);
}

export interface FuzzyMatchResult {
	/** Whether a match was found */
	found: boolean;
	/** The index where the match starts, as an offset into the original content */
	index: number;
	/** Length of the matched text in the original content */
	matchLength: number;
	/** Whether fuzzy matching was used (false = exact match) */
	usedFuzzyMatch: boolean;
	/**
	 * The content to use for replacement operations. Always the original
	 * content: fuzzy matches are located in normalized space but mapped back to
	 * offsets in the original content, so replacements never rewrite anything
	 * outside the matched region.
	 */
	contentForReplacement: string;
}

/**
 * A fuzzy-normalized copy of some original content together with a
 * per-code-unit map back to offsets in that original content.
 *
 * `normalized` is equivalent to `normalizeForFuzzyMatch(original)`, but built
 * incrementally so every code unit of the normalized text records which span
 * of the original produced it. This lets matches found in normalized space be
 * spliced into the original content, leaving every byte outside the matched
 * region untouched (NFKC folds, smart quotes, Unicode dashes/spaces, and
 * trailing whitespace elsewhere in the file are preserved exactly).
 */
export interface NormalizedContentMap {
	/** The fuzzy-normalized content (equivalent to normalizeForFuzzyMatch output). */
	normalized: string;
	/** For each code unit of `normalized`, the offset in the original content where its source span begins. */
	startOffsets: number[];
	/** For each code unit of `normalized`, the offset in the original content just past its source span. */
	endOffsets: number[];
	/** Length of the original content. */
	originalLength: number;
}

const COMBINING_MARK = /\p{M}/u;
// Non-global versions of the character classes used by normalizeForFuzzyMatch,
// applied per code unit while building the offset map (all folds are 1:1).
const SMART_SINGLE_QUOTE = /[\u2018\u2019\u201A\u201B]/;
const SMART_DOUBLE_QUOTE = /[\u201C\u201D\u201E\u201F]/;
const UNICODE_DASH = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/;
const UNICODE_SPACE = /[\u00A0\u2002-\u200A\u202F\u205F\u3000]/;

function foldFuzzyChar(char: string): string {
	if (SMART_SINGLE_QUOTE.test(char)) return "'";
	if (SMART_DOUBLE_QUOTE.test(char)) return '"';
	if (UNICODE_DASH.test(char)) return "-";
	if (UNICODE_SPACE.test(char)) return " ";
	return char;
}

/**
 * Whether a code point can interact with the preceding code point under NFKC,
 * meaning the two must be normalized together in one chunk:
 * - combining marks attach to the preceding base character
 * - halfwidth voiced/semi-voiced sound marks (U+FF9E/U+FF9F) decompose to
 *   combining marks that can compose with the preceding kana
 * - Hangul jamo vowels/trailing consonants (U+1160-U+11FF) compose with a
 *   preceding jamo or precomposed syllable
 */
function joinsPreviousChunk(codePoint: number, previousCodePoint: number): boolean {
	if (previousCodePoint === 0x0a) return false; // \n never composes; keep it a standalone chunk
	if (COMBINING_MARK.test(String.fromCodePoint(codePoint))) return true;
	if (codePoint === 0xff9e || codePoint === 0xff9f) return true;
	if (codePoint >= 0x1160 && codePoint <= 0x11ff) {
		return (
			(previousCodePoint >= 0x1100 && previousCodePoint <= 0x11ff) ||
			(previousCodePoint >= 0xac00 && previousCodePoint <= 0xd7a3)
		);
	}
	return false;
}

/**
 * Build the fuzzy-normalized version of `text` along with a per-code-unit map
 * back to offsets in `text`. Mirrors normalizeForFuzzyMatch exactly: NFKC,
 * per-line trailing-whitespace strip, then 1:1 quote/dash/space folds.
 */
export function buildNormalizedContentMap(text: string): NormalizedContentMap {
	// Phase 1: NFKC, applied chunk by chunk so each normalized code unit can be
	// traced back to the original span that produced it. Chunks are split at
	// normalization boundaries (a base code point plus any code points that can
	// combine with it), so concatenated chunk-wise NFKC output matches
	// whole-string NFKC output.
	const nfkcChars: string[] = [];
	const nfkcStarts: number[] = [];
	const nfkcEnds: number[] = [];

	let i = 0;
	while (i < text.length) {
		const startCodePoint = text.codePointAt(i) as number;
		let j = i + (startCodePoint > 0xffff ? 2 : 1);
		let previousCodePoint = startCodePoint;
		while (j < text.length) {
			const codePoint = text.codePointAt(j) as number;
			if (!joinsPreviousChunk(codePoint, previousCodePoint)) break;
			j += codePoint > 0xffff ? 2 : 1;
			previousCodePoint = codePoint;
		}
		const normalizedChunk = text.slice(i, j).normalize("NFKC");
		for (let k = 0; k < normalizedChunk.length; k++) {
			nfkcChars.push(normalizedChunk[k]);
			nfkcStarts.push(i);
			nfkcEnds.push(j);
		}
		i = j;
	}

	// Phases 2+3: strip trailing whitespace per line (dropping the map entries
	// of removed code units) and fold smart quotes/dashes/spaces to ASCII
	// (1:1 folds, so offsets are unaffected).
	const chars: string[] = [];
	const startOffsets: number[] = [];
	const endOffsets: number[] = [];
	let lineStart = 0;
	for (let k = 0; k <= nfkcChars.length; k++) {
		if (k < nfkcChars.length && nfkcChars[k] !== "\n") continue;
		const line = nfkcChars.slice(lineStart, k).join("");
		const keepLength = line.trimEnd().length;
		for (let m = lineStart; m < lineStart + keepLength; m++) {
			chars.push(foldFuzzyChar(nfkcChars[m]));
			startOffsets.push(nfkcStarts[m]);
			endOffsets.push(nfkcEnds[m]);
		}
		if (k < nfkcChars.length) {
			chars.push("\n");
			startOffsets.push(nfkcStarts[k]);
			endOffsets.push(nfkcEnds[k]);
		}
		lineStart = k + 1;
	}

	return { normalized: chars.join(""), startOffsets, endOffsets, originalLength: text.length };
}

/** Map a span found in normalized space back to a span in the original content. */
function mapNormalizedSpanToOriginal(
	map: NormalizedContentMap,
	index: number,
	length: number,
): { index: number; matchLength: number } {
	const start = index < map.startOffsets.length ? map.startOffsets[index] : map.originalLength;
	const end = length > 0 ? map.endOffsets[index + length - 1] : start;
	return { index: start, matchLength: end - start };
}

export interface Edit {
	oldText: string;
	newText: string;
}

interface MatchedEdit {
	editIndex: number;
	matchIndex: number;
	matchLength: number;
	newText: string;
}

export interface AppliedEditsResult {
	baseContent: string;
	newContent: string;
}

/**
 * Find oldText in content, trying exact match first, then fuzzy match.
 * Fuzzy matches are located in normalized space (trailing whitespace stripped,
 * NFKC, Unicode quotes/dashes/spaces folded to ASCII) and mapped back to a
 * span in the original content, so the reported index/matchLength always
 * refer to the original content and replacements never alter anything outside
 * the matched region.
 *
 * Callers performing several lookups against the same content can pass a
 * prebuilt map from buildNormalizedContentMap to avoid rebuilding it.
 */
export function fuzzyFindText(content: string, oldText: string, contentMap?: NormalizedContentMap): FuzzyMatchResult {
	// Try exact match first
	const exactIndex = content.indexOf(oldText);
	if (exactIndex !== -1) {
		return {
			found: true,
			index: exactIndex,
			matchLength: oldText.length,
			usedFuzzyMatch: false,
			contentForReplacement: content,
		};
	}

	// Try fuzzy match: search in normalized space, then map the matched span
	// back to offsets in the original content.
	const map = contentMap ?? buildNormalizedContentMap(content);
	const fuzzyOldText = normalizeForFuzzyMatch(oldText);
	const fuzzyIndex = map.normalized.indexOf(fuzzyOldText);

	if (fuzzyIndex === -1) {
		return {
			found: false,
			index: -1,
			matchLength: 0,
			usedFuzzyMatch: false,
			contentForReplacement: content,
		};
	}

	const { index, matchLength } = mapNormalizedSpanToOriginal(map, fuzzyIndex, fuzzyOldText.length);
	return {
		found: true,
		index,
		matchLength,
		usedFuzzyMatch: true,
		contentForReplacement: content,
	};
}

/** Strip UTF-8 BOM if present, return both the BOM (if any) and the text without it */
export function stripBom(content: string): { bom: string; text: string } {
	return content.startsWith("\uFEFF") ? { bom: "\uFEFF", text: content.slice(1) } : { bom: "", text: content };
}

function countOccurrences(content: string, oldText: string): number {
	const fuzzyContent = normalizeForFuzzyMatch(content);
	const fuzzyOldText = normalizeForFuzzyMatch(oldText);
	return fuzzyContent.split(fuzzyOldText).length - 1;
}

function getNotFoundError(path: string, editIndex: number, totalEdits: number): Error {
	if (totalEdits === 1) {
		return new Error(
			`Could not find the exact text in ${path}. The old text must match exactly including all whitespace and newlines.`,
		);
	}
	return new Error(
		`Could not find edits[${editIndex}] in ${path}. The oldText must match exactly including all whitespace and newlines.`,
	);
}

function getDuplicateError(path: string, editIndex: number, totalEdits: number, occurrences: number): Error {
	if (totalEdits === 1) {
		return new Error(
			`Found ${occurrences} occurrences of the text in ${path}. The text must be unique. Please provide more context to make it unique.`,
		);
	}
	return new Error(
		`Found ${occurrences} occurrences of edits[${editIndex}] in ${path}. Each oldText must be unique. Please provide more context to make it unique.`,
	);
}

function getEmptyOldTextError(path: string, editIndex: number, totalEdits: number): Error {
	if (totalEdits === 1) {
		return new Error(`oldText must not be empty in ${path}.`);
	}
	return new Error(`edits[${editIndex}].oldText must not be empty in ${path}.`);
}

function getNoChangeError(path: string, totalEdits: number): Error {
	if (totalEdits === 1) {
		return new Error(
			`No changes made to ${path}. The replacement produced identical content. This might indicate an issue with special characters or the text not existing as expected.`,
		);
	}
	return new Error(`No changes made to ${path}. The replacements produced identical content.`);
}

/**
 * Apply one or more exact-text replacements to LF-normalized content.
 *
 * All edits are matched against the same original content. Replacements are
 * then applied in reverse order so offsets remain stable. If an edit needs
 * fuzzy matching, the match is located in fuzzy-normalized space and mapped
 * back to a span in the original content, so only the matched regions change
 * and the rest of the file keeps its exact bytes.
 */
export function applyEditsToNormalizedContent(
	normalizedContent: string,
	edits: Edit[],
	path: string,
): AppliedEditsResult {
	const normalizedEdits = edits.map((edit) => ({
		oldText: normalizeToLF(edit.oldText),
		newText: normalizeToLF(edit.newText),
	}));

	for (let i = 0; i < normalizedEdits.length; i++) {
		if (normalizedEdits[i].oldText.length === 0) {
			throw getEmptyOldTextError(path, i, normalizedEdits.length);
		}
	}

	const baseContent = normalizedContent;
	// Built lazily and shared across edits: only needed once an edit fails to
	// match exactly, so the exact-match fast path never pays for it.
	let contentMap: NormalizedContentMap | undefined;

	const matchedEdits: MatchedEdit[] = [];
	for (let i = 0; i < normalizedEdits.length; i++) {
		const edit = normalizedEdits[i];
		if (contentMap === undefined && !baseContent.includes(edit.oldText)) {
			contentMap = buildNormalizedContentMap(baseContent);
		}
		const matchResult = fuzzyFindText(baseContent, edit.oldText, contentMap);
		if (!matchResult.found) {
			throw getNotFoundError(path, i, normalizedEdits.length);
		}

		const occurrences = countOccurrences(baseContent, edit.oldText);
		if (occurrences > 1) {
			throw getDuplicateError(path, i, normalizedEdits.length, occurrences);
		}

		matchedEdits.push({
			editIndex: i,
			matchIndex: matchResult.index,
			matchLength: matchResult.matchLength,
			newText: edit.newText,
		});
	}

	matchedEdits.sort((a, b) => a.matchIndex - b.matchIndex);
	for (let i = 1; i < matchedEdits.length; i++) {
		const previous = matchedEdits[i - 1];
		const current = matchedEdits[i];
		if (previous.matchIndex + previous.matchLength > current.matchIndex) {
			throw new Error(
				`edits[${previous.editIndex}] and edits[${current.editIndex}] overlap in ${path}. Merge them into one edit or target disjoint regions.`,
			);
		}
	}

	let newContent = baseContent;
	for (let i = matchedEdits.length - 1; i >= 0; i--) {
		const edit = matchedEdits[i];
		newContent =
			newContent.substring(0, edit.matchIndex) +
			edit.newText +
			newContent.substring(edit.matchIndex + edit.matchLength);
	}

	if (baseContent === newContent) {
		throw getNoChangeError(path, normalizedEdits.length);
	}

	return { baseContent, newContent };
}

/** Generate a standard unified patch. */
export function generateUnifiedPatch(path: string, oldContent: string, newContent: string, contextLines = 4): string {
	return Diff.createTwoFilesPatch(path, path, oldContent, newContent, undefined, undefined, {
		context: contextLines,
		headerOptions: Diff.FILE_HEADERS_ONLY,
	});
}

/**
 * Generate a display-oriented diff string with line numbers and context.
 * Returns both the diff string and the first changed line number (in the new file).
 */
export function generateDiffString(
	oldContent: string,
	newContent: string,
	contextLines = 4,
): { diff: string; firstChangedLine: number | undefined } {
	const parts = Diff.diffLines(oldContent, newContent);
	const output: string[] = [];

	const oldLines = oldContent.split("\n");
	const newLines = newContent.split("\n");
	const maxLineNum = Math.max(oldLines.length, newLines.length);
	const lineNumWidth = String(maxLineNum).length;

	let oldLineNum = 1;
	let newLineNum = 1;
	let lastWasChange = false;
	let firstChangedLine: number | undefined;

	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		const raw = part.value.split("\n");
		if (raw[raw.length - 1] === "") {
			raw.pop();
		}

		if (part.added || part.removed) {
			// Capture the first changed line (in the new file)
			if (firstChangedLine === undefined) {
				firstChangedLine = newLineNum;
			}

			// Show the change
			for (const line of raw) {
				if (part.added) {
					const lineNum = String(newLineNum).padStart(lineNumWidth, " ");
					output.push(`+${lineNum} ${line}`);
					newLineNum++;
				} else {
					// removed
					const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
					output.push(`-${lineNum} ${line}`);
					oldLineNum++;
				}
			}
			lastWasChange = true;
		} else {
			// Context lines - only show a few before/after changes
			const nextPartIsChange = i < parts.length - 1 && (parts[i + 1].added || parts[i + 1].removed);
			const hasLeadingChange = lastWasChange;
			const hasTrailingChange = nextPartIsChange;

			if (hasLeadingChange && hasTrailingChange) {
				if (raw.length <= contextLines * 2) {
					for (const line of raw) {
						const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
						output.push(` ${lineNum} ${line}`);
						oldLineNum++;
						newLineNum++;
					}
				} else {
					const leadingLines = raw.slice(0, contextLines);
					const trailingLines = raw.slice(raw.length - contextLines);
					const skippedLines = raw.length - leadingLines.length - trailingLines.length;

					for (const line of leadingLines) {
						const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
						output.push(` ${lineNum} ${line}`);
						oldLineNum++;
						newLineNum++;
					}

					output.push(` ${"".padStart(lineNumWidth, " ")} ...`);
					oldLineNum += skippedLines;
					newLineNum += skippedLines;

					for (const line of trailingLines) {
						const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
						output.push(` ${lineNum} ${line}`);
						oldLineNum++;
						newLineNum++;
					}
				}
			} else if (hasLeadingChange) {
				const shownLines = raw.slice(0, contextLines);
				const skippedLines = raw.length - shownLines.length;

				for (const line of shownLines) {
					const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
					output.push(` ${lineNum} ${line}`);
					oldLineNum++;
					newLineNum++;
				}

				if (skippedLines > 0) {
					output.push(` ${"".padStart(lineNumWidth, " ")} ...`);
					oldLineNum += skippedLines;
					newLineNum += skippedLines;
				}
			} else if (hasTrailingChange) {
				const skippedLines = Math.max(0, raw.length - contextLines);
				if (skippedLines > 0) {
					output.push(` ${"".padStart(lineNumWidth, " ")} ...`);
					oldLineNum += skippedLines;
					newLineNum += skippedLines;
				}

				for (const line of raw.slice(skippedLines)) {
					const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
					output.push(` ${lineNum} ${line}`);
					oldLineNum++;
					newLineNum++;
				}
			} else {
				// Skip these context lines entirely
				oldLineNum += raw.length;
				newLineNum += raw.length;
			}

			lastWasChange = false;
		}
	}

	return { diff: output.join("\n"), firstChangedLine };
}

export interface EditDiffResult {
	diff: string;
	firstChangedLine: number | undefined;
}

export interface EditDiffError {
	error: string;
}

/**
 * Compute the diff for one or more edit operations without applying them.
 * Used for preview rendering in the TUI before the tool executes.
 */
export async function computeEditsDiff(
	path: string,
	edits: Edit[],
	cwd: string,
): Promise<EditDiffResult | EditDiffError> {
	const absolutePath = resolveToCwd(path, cwd);

	try {
		// Check if file exists and is readable
		try {
			await access(absolutePath, constants.R_OK);
		} catch (error: unknown) {
			const errorMessage = error instanceof Error && "code" in error ? `Error code: ${error.code}` : String(error);
			return { error: `Could not edit file: ${path}. ${errorMessage}.` };
		}

		// Read the file
		const rawContent = await readFile(absolutePath, "utf-8");

		// Strip BOM before matching (LLM won't include invisible BOM in oldText)
		const { text: content } = stripBom(rawContent);
		const normalizedContent = normalizeToLF(content);
		const { baseContent, newContent } = applyEditsToNormalizedContent(normalizedContent, edits, path);

		// Generate the diff
		return generateDiffString(baseContent, newContent);
	} catch (err) {
		return { error: err instanceof Error ? err.message : String(err) };
	}
}

/**
 * Compute the diff for a single edit operation without applying it.
 * Kept as a convenience wrapper for single-edit callers.
 */
export async function computeEditDiff(
	path: string,
	oldText: string,
	newText: string,
	cwd: string,
): Promise<EditDiffResult | EditDiffError> {
	return computeEditsDiff(path, [{ oldText, newText }], cwd);
}
