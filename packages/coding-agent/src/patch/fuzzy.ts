/**
 * Fuzzy matching utilities for the edit tool.
 *
 * Provides both character-level and line-level fuzzy matching with progressive
 * fallback strategies for finding text in files.
 */
import { countLeadingWhitespace, normalizeForFuzzy, normalizeUnicode } from "./normalize";
import type { ContextLineResult, FuzzyMatch, MatchOutcome, SequenceMatchStrategy, SequenceSearchResult } from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

/** Default similarity threshold for fuzzy matching */
export const DEFAULT_FUZZY_THRESHOLD = 0.95;

/** Threshold for sequence-based fuzzy matching */
const SEQUENCE_FUZZY_THRESHOLD = 0.92;

/** Fallback threshold for line-based matching */
const FALLBACK_THRESHOLD = 0.8;

/** Threshold for context line matching */
const CONTEXT_FUZZY_THRESHOLD = 0.8;

/** Minimum length for partial/substring matching */
const PARTIAL_MATCH_MIN_LENGTH = 6;

/** Minimum ratio of pattern to line length for substring match */
const PARTIAL_MATCH_MIN_RATIO = 0.3;

/** Context lines to show before/after an ambiguous match preview */
const OCCURRENCE_PREVIEW_CONTEXT = 5;

/** Maximum line length for ambiguous match previews */
const OCCURRENCE_PREVIEW_MAX_LEN = 80;

// ═══════════════════════════════════════════════════════════════════════════
// Core Algorithms
// ═══════════════════════════════════════════════════════════════════════════

/** Compute Levenshtein distance between two strings */
export function levenshteinDistance(a: string, b: string): number {
	if (a === b) return 0;
	const aLen = a.length;
	const bLen = b.length;
	if (aLen === 0) return bLen;
	if (bLen === 0) return aLen;

	let prev = new Array<number>(bLen + 1);
	let curr = new Array<number>(bLen + 1);
	for (let j = 0; j <= bLen; j++) {
		prev[j] = j;
	}

	for (let i = 1; i <= aLen; i++) {
		curr[0] = i;
		const aCode = a.charCodeAt(i - 1);
		for (let j = 1; j <= bLen; j++) {
			const cost = aCode === b.charCodeAt(j - 1) ? 0 : 1;
			const deletion = prev[j] + 1;
			const insertion = curr[j - 1] + 1;
			const substitution = prev[j - 1] + cost;
			curr[j] = Math.min(deletion, insertion, substitution);
		}
		const tmp = prev;
		prev = curr;
		curr = tmp;
	}

	return prev[bLen];
}

/** Compute similarity score between two strings (0 to 1) */
export function similarity(a: string, b: string): number {
	if (a.length === 0 && b.length === 0) return 1;
	const maxLen = Math.max(a.length, b.length);
	if (maxLen === 0) return 1;
	const distance = levenshteinDistance(a, b);
	return 1 - distance / maxLen;
}

// ═══════════════════════════════════════════════════════════════════════════
// Line-Based Utilities
// ═══════════════════════════════════════════════════════════════════════════

/** Compute relative indent depths for lines */
function computeRelativeIndentDepths(lines: string[]): number[] {
	const indents = lines.map(countLeadingWhitespace);
	const nonEmptyIndents: number[] = [];
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].trim().length > 0) {
			nonEmptyIndents.push(indents[i]);
		}
	}
	const minIndent = nonEmptyIndents.length > 0 ? Math.min(...nonEmptyIndents) : 0;
	const indentSteps = nonEmptyIndents.map(indent => indent - minIndent).filter(step => step > 0);
	const indentUnit = indentSteps.length > 0 ? Math.min(...indentSteps) : 1;

	return lines.map((line, index) => {
		if (line.trim().length === 0) return 0;
		if (indentUnit <= 0) return 0;
		const relativeIndent = indents[index] - minIndent;
		return Math.round(relativeIndent / indentUnit);
	});
}

/** Normalize lines for matching, optionally including indent depth */
function normalizeLines(lines: string[], includeDepth = true): string[] {
	const indentDepths = includeDepth ? computeRelativeIndentDepths(lines) : null;
	return lines.map((line, index) => {
		const trimmed = line.trim();
		const prefix = indentDepths ? `${indentDepths[index]}|` : "|";
		if (trimmed.length === 0) return prefix;
		return `${prefix}${normalizeForFuzzy(trimmed)}`;
	});
}

/** Compute character offsets for each line in content */
function computeLineOffsets(lines: string[]): number[] {
	const offsets: number[] = [];
	let offset = 0;
	for (let i = 0; i < lines.length; i++) {
		offsets.push(offset);
		offset += lines[i].length;
		if (i < lines.length - 1) offset += 1; // newline
	}
	return offsets;
}

// ═══════════════════════════════════════════════════════════════════════════
// Character-Level Fuzzy Match (for replace mode)
// ═══════════════════════════════════════════════════════════════════════════

interface BestFuzzyMatchResult {
	best?: FuzzyMatch;
	aboveThresholdCount: number;
	secondBestScore: number;
}

function findBestFuzzyMatchCore(
	contentLines: string[],
	targetLines: string[],
	offsets: number[],
	threshold: number,
	includeDepth: boolean,
): BestFuzzyMatchResult {
	const targetNormalized = normalizeLines(targetLines, includeDepth);

	let best: FuzzyMatch | undefined;
	let bestScore = -1;
	let secondBestScore = -1;
	let aboveThresholdCount = 0;

	for (let start = 0; start <= contentLines.length - targetLines.length; start++) {
		const windowLines = contentLines.slice(start, start + targetLines.length);
		const windowNormalized = normalizeLines(windowLines, includeDepth);
		let score = 0;
		for (let i = 0; i < targetLines.length; i++) {
			score += similarity(targetNormalized[i], windowNormalized[i]);
		}
		score = score / targetLines.length;

		if (score >= threshold) {
			aboveThresholdCount++;
		}

		if (score > bestScore) {
			secondBestScore = bestScore;
			bestScore = score;
			best = {
				actualText: windowLines.join("\n"),
				startIndex: offsets[start],
				startLine: start + 1,
				confidence: score,
			};
		} else if (score > secondBestScore) {
			secondBestScore = score;
		}
	}

	return { best, aboveThresholdCount, secondBestScore };
}

function findBestFuzzyMatch(content: string, target: string, threshold: number): BestFuzzyMatchResult {
	const contentLines = content.split("\n");
	const targetLines = target.split("\n");

	if (targetLines.length === 0 || target.length === 0) {
		return { aboveThresholdCount: 0, secondBestScore: 0 };
	}
	if (targetLines.length > contentLines.length) {
		return { aboveThresholdCount: 0, secondBestScore: 0 };
	}

	const offsets = computeLineOffsets(contentLines);
	let result = findBestFuzzyMatchCore(contentLines, targetLines, offsets, threshold, true);

	// Retry without indent depth if match is close but below threshold
	if (result.best && result.best.confidence < threshold && result.best.confidence >= FALLBACK_THRESHOLD) {
		const noDepthResult = findBestFuzzyMatchCore(contentLines, targetLines, offsets, threshold, false);
		if (noDepthResult.best && noDepthResult.best.confidence > result.best.confidence) {
			result = noDepthResult;
		}
	}

	return result;
}

/**
 * Find a match for target text within content.
 * Used primarily for replace-mode edits.
 */
export function findMatch(
	content: string,
	target: string,
	options: { allowFuzzy: boolean; threshold?: number },
): MatchOutcome {
	if (target.length === 0) {
		return {};
	}

	// Try exact match first
	const exactIndex = content.indexOf(target);
	if (exactIndex !== -1) {
		const occurrences = content.split(target).length - 1;
		if (occurrences > 1) {
			// Find line numbers and previews for each occurrence (up to 5)
			const contentLines = content.split("\n");
			const occurrenceLines: number[] = [];
			const occurrencePreviews: string[] = [];
			let searchStart = 0;
			for (let i = 0; i < 5; i++) {
				const idx = content.indexOf(target, searchStart);
				if (idx === -1) break;
				const lineNumber = content.slice(0, idx).split("\n").length;
				occurrenceLines.push(lineNumber);
				const start = Math.max(0, lineNumber - 1 - OCCURRENCE_PREVIEW_CONTEXT);
				const end = Math.min(contentLines.length, lineNumber + OCCURRENCE_PREVIEW_CONTEXT + 1);
				const previewLines = contentLines.slice(start, end);
				const preview = previewLines
					.map((line, idx) => {
						const num = start + idx + 1;
						return `  ${num} | ${line.length > OCCURRENCE_PREVIEW_MAX_LEN ? `${line.slice(0, OCCURRENCE_PREVIEW_MAX_LEN - 3)}...` : line}`;
					})
					.join("\n");
				occurrencePreviews.push(preview);
				searchStart = idx + 1;
			}
			return { occurrences, occurrenceLines, occurrencePreviews };
		}
		const startLine = content.slice(0, exactIndex).split("\n").length;
		return {
			match: {
				actualText: target,
				startIndex: exactIndex,
				startLine,
				confidence: 1,
			},
		};
	}

	// Try fuzzy match
	const threshold = options.threshold ?? DEFAULT_FUZZY_THRESHOLD;
	const { best, aboveThresholdCount, secondBestScore } = findBestFuzzyMatch(content, target, threshold);

	if (!best) {
		return {};
	}

	if (options.allowFuzzy && best.confidence >= threshold) {
		if (aboveThresholdCount === 1) {
			return { match: best, closest: best };
		}
		const dominantDelta = 0.08;
		const dominantMin = 0.97;
		if (
			aboveThresholdCount > 1 &&
			best.confidence >= dominantMin &&
			best.confidence - secondBestScore >= dominantDelta
		) {
			return { match: best, closest: best, fuzzyMatches: aboveThresholdCount, dominantFuzzy: true };
		}
	}

	return { closest: best, fuzzyMatches: aboveThresholdCount };
}

// ═══════════════════════════════════════════════════════════════════════════
// Line-Based Sequence Match (for patch mode)
// ═══════════════════════════════════════════════════════════════════════════

/** Check if pattern matches lines starting at index using comparison function */
function matchesAt(lines: string[], pattern: string[], i: number, compare: (a: string, b: string) => boolean): boolean {
	for (let j = 0; j < pattern.length; j++) {
		if (!compare(lines[i + j], pattern[j])) {
			return false;
		}
	}
	return true;
}

/** Compute average similarity score for pattern at position */
function fuzzyScoreAt(lines: string[], pattern: string[], i: number): number {
	let totalScore = 0;
	for (let j = 0; j < pattern.length; j++) {
		const lineNorm = normalizeForFuzzy(lines[i + j]);
		const patternNorm = normalizeForFuzzy(pattern[j]);
		totalScore += similarity(lineNorm, patternNorm);
	}
	return totalScore / pattern.length;
}

/** Check if line starts with pattern (normalized) */
function lineStartsWithPattern(line: string, pattern: string): boolean {
	const lineNorm = normalizeForFuzzy(line);
	const patternNorm = normalizeForFuzzy(pattern);
	if (patternNorm.length === 0) return lineNorm.length === 0;
	return lineNorm.startsWith(patternNorm);
}

/** Check if line contains pattern as significant substring */
function lineIncludesPattern(line: string, pattern: string): boolean {
	const lineNorm = normalizeForFuzzy(line);
	const patternNorm = normalizeForFuzzy(pattern);
	if (patternNorm.length === 0) return lineNorm.length === 0;
	if (patternNorm.length < PARTIAL_MATCH_MIN_LENGTH) return false;
	if (!lineNorm.includes(patternNorm)) return false;
	return patternNorm.length / Math.max(1, lineNorm.length) >= PARTIAL_MATCH_MIN_RATIO;
}

function stripCommentPrefix(line: string): string {
	let trimmed = line.trimStart();
	if (trimmed.startsWith("/*")) {
		trimmed = trimmed.slice(2);
	} else if (trimmed.startsWith("*/")) {
		trimmed = trimmed.slice(2);
	} else if (trimmed.startsWith("//")) {
		trimmed = trimmed.slice(2);
	} else if (trimmed.startsWith("*")) {
		trimmed = trimmed.slice(1);
	} else if (trimmed.startsWith("#")) {
		trimmed = trimmed.slice(1);
	} else if (trimmed.startsWith(";")) {
		trimmed = trimmed.slice(1);
	} else if (trimmed.startsWith("/") && trimmed[1] === " ") {
		trimmed = trimmed.slice(1);
	}
	return trimmed.trimStart();
}

/**
 * Find a sequence of pattern lines within content lines.
 *
 * Attempts matches with decreasing strictness:
 * 1. Exact match
 * 2. Trailing whitespace ignored
 * 3. All whitespace trimmed
 * 4. Unicode punctuation normalized
 * 5. Prefix match (pattern is prefix of line)
 * 6. Substring match (pattern is substring of line)
 * 7. Fuzzy similarity match
 *
 * @param lines - The lines of the file content
 * @param pattern - The lines to search for
 * @param start - Starting index for the search
 * @param eof - If true, prefer matching at end of file first
 */
export function seekSequence(
	lines: string[],
	pattern: string[],
	start: number,
	eof: boolean,
	options?: { allowFuzzy?: boolean },
): SequenceSearchResult {
	const allowFuzzy = options?.allowFuzzy ?? true;
	// Empty pattern matches immediately
	if (pattern.length === 0) {
		return { index: start, confidence: 1.0, strategy: "exact" };
	}

	// Pattern longer than available content cannot match
	if (pattern.length > lines.length) {
		return { index: undefined, confidence: 0 };
	}

	// Determine search start position
	const searchStart = eof && lines.length >= pattern.length ? lines.length - pattern.length : start;
	const maxStart = lines.length - pattern.length;

	const runExactPasses = (from: number, to: number): SequenceSearchResult | undefined => {
		// Pass 1: Exact match
		for (let i = from; i <= to; i++) {
			if (matchesAt(lines, pattern, i, (a, b) => a === b)) {
				return { index: i, confidence: 1.0, strategy: "exact" };
			}
		}

		// Pass 2: Trailing whitespace stripped
		for (let i = from; i <= to; i++) {
			if (matchesAt(lines, pattern, i, (a, b) => a.trimEnd() === b.trimEnd())) {
				return { index: i, confidence: 0.99, strategy: "trim-trailing" };
			}
		}

		// Pass 3: Both leading and trailing whitespace stripped
		for (let i = from; i <= to; i++) {
			if (matchesAt(lines, pattern, i, (a, b) => a.trim() === b.trim())) {
				return { index: i, confidence: 0.98, strategy: "trim" };
			}
		}

		// Pass 3b: Comment-prefix normalized match
		for (let i = from; i <= to; i++) {
			if (matchesAt(lines, pattern, i, (a, b) => stripCommentPrefix(a) === stripCommentPrefix(b))) {
				return { index: i, confidence: 0.975, strategy: "comment-prefix" };
			}
		}

		// Pass 4: Normalize unicode punctuation
		for (let i = from; i <= to; i++) {
			if (matchesAt(lines, pattern, i, (a, b) => normalizeUnicode(a) === normalizeUnicode(b))) {
				return { index: i, confidence: 0.97, strategy: "unicode" };
			}
		}

		if (!allowFuzzy) {
			return undefined;
		}

		// Pass 5: Partial line prefix match (track all matches for ambiguity detection)
		{
			let firstMatch: number | undefined;
			let matchCount = 0;
			const matchIndices: number[] = [];
			for (let i = from; i <= to; i++) {
				if (matchesAt(lines, pattern, i, lineStartsWithPattern)) {
					if (firstMatch === undefined) firstMatch = i;
					matchCount++;
					if (matchIndices.length < 5) matchIndices.push(i);
				}
			}
			if (matchCount > 0) {
				return { index: firstMatch, confidence: 0.965, matchCount, matchIndices, strategy: "prefix" };
			}
		}

		// Pass 6: Partial line substring match (track all matches for ambiguity detection)
		{
			let firstMatch: number | undefined;
			let matchCount = 0;
			const matchIndices: number[] = [];
			for (let i = from; i <= to; i++) {
				if (matchesAt(lines, pattern, i, lineIncludesPattern)) {
					if (firstMatch === undefined) firstMatch = i;
					matchCount++;
					if (matchIndices.length < 5) matchIndices.push(i);
				}
			}
			if (matchCount > 0) {
				return { index: firstMatch, confidence: 0.94, matchCount, matchIndices, strategy: "substring" };
			}
		}

		return undefined;
	};

	const primaryPassResult = runExactPasses(searchStart, maxStart);
	if (primaryPassResult) {
		return primaryPassResult;
	}

	if (eof && searchStart > start) {
		const fromStartResult = runExactPasses(start, maxStart);
		if (fromStartResult) {
			return fromStartResult;
		}
	}

	if (!allowFuzzy) {
		return { index: undefined, confidence: 0 };
	}

	// Pass 7: Fuzzy matching - find best match above threshold
	let bestIndex: number | undefined;
	let bestScore = 0;
	let secondBestScore = 0;
	let matchCount = 0;
	const matchIndices: number[] = [];

	for (let i = searchStart; i <= maxStart; i++) {
		const score = fuzzyScoreAt(lines, pattern, i);
		if (score >= SEQUENCE_FUZZY_THRESHOLD) {
			matchCount++;
			if (matchIndices.length < 5) matchIndices.push(i);
		}
		if (score > bestScore) {
			secondBestScore = bestScore;
			bestScore = score;
			bestIndex = i;
		} else if (score > secondBestScore) {
			secondBestScore = score;
		}
	}

	// Also search from start if eof mode started from end
	if (eof && searchStart > start) {
		for (let i = start; i < searchStart; i++) {
			const score = fuzzyScoreAt(lines, pattern, i);
			if (score >= SEQUENCE_FUZZY_THRESHOLD) {
				matchCount++;
				if (matchIndices.length < 5) matchIndices.push(i);
			}
			if (score > bestScore) {
				secondBestScore = bestScore;
				bestScore = score;
				bestIndex = i;
			} else if (score > secondBestScore) {
				secondBestScore = score;
			}
		}
	}

	if (bestIndex !== undefined && bestScore >= SEQUENCE_FUZZY_THRESHOLD) {
		const dominantDelta = 0.08;
		const dominantMin = 0.97;
		if (matchCount > 1 && bestScore >= dominantMin && bestScore - secondBestScore >= dominantDelta) {
			return {
				index: bestIndex,
				confidence: bestScore,
				matchCount: 1,
				matchIndices,
				strategy: "fuzzy-dominant",
			};
		}
		return { index: bestIndex, confidence: bestScore, matchCount, matchIndices, strategy: "fuzzy" };
	}

	// Pass 8: Character-based fuzzy matching via findMatch
	// This is the final fallback for when line-based matching fails
	const CHARACTER_MATCH_THRESHOLD = 0.92;
	const patternText = pattern.join("\n");
	const contentText = lines.slice(start).join("\n");
	const matchOutcome = findMatch(contentText, patternText, {
		allowFuzzy: true,
		threshold: CHARACTER_MATCH_THRESHOLD,
	});

	if (matchOutcome.match) {
		// Convert character index back to line index
		const matchedContent = contentText.substring(0, matchOutcome.match.startIndex);
		const lineIndex = start + matchedContent.split("\n").length - 1;
		const fallbackMatchCount = matchOutcome.occurrences ?? matchOutcome.fuzzyMatches ?? 1;
		return {
			index: lineIndex,
			confidence: matchOutcome.match.confidence,
			matchCount: fallbackMatchCount,
			strategy: "character",
		};
	}

	const fallbackMatchCount = matchOutcome.occurrences ?? matchOutcome.fuzzyMatches;
	return { index: undefined, confidence: bestScore, matchCount: fallbackMatchCount };
}

export function findClosestSequenceMatch(
	lines: string[],
	pattern: string[],
	options?: { start?: number; eof?: boolean },
): { index: number | undefined; confidence: number; strategy: SequenceMatchStrategy } {
	if (pattern.length === 0) {
		return { index: options?.start ?? 0, confidence: 1, strategy: "exact" };
	}
	if (pattern.length > lines.length) {
		return { index: undefined, confidence: 0, strategy: "fuzzy" };
	}

	const start = options?.start ?? 0;
	const eof = options?.eof ?? false;
	const maxStart = lines.length - pattern.length;
	const searchStart = eof && lines.length >= pattern.length ? maxStart : start;

	let bestIndex: number | undefined;
	let bestScore = 0;

	for (let i = searchStart; i <= maxStart; i++) {
		const score = fuzzyScoreAt(lines, pattern, i);
		if (score > bestScore) {
			bestScore = score;
			bestIndex = i;
		}
	}

	if (eof && searchStart > start) {
		for (let i = start; i < searchStart; i++) {
			const score = fuzzyScoreAt(lines, pattern, i);
			if (score > bestScore) {
				bestScore = score;
				bestIndex = i;
			}
		}
	}

	return { index: bestIndex, confidence: bestScore, strategy: "fuzzy" };
}

/**
 * Find a context line in the file using progressive matching strategies.
 *
 * @param lines - The lines of the file content
 * @param context - The context line to search for
 * @param startFrom - Starting index for the search
 */
export function findContextLine(
	lines: string[],
	context: string,
	startFrom: number,
	options?: { allowFuzzy?: boolean; skipFunctionFallback?: boolean },
): ContextLineResult {
	const allowFuzzy = options?.allowFuzzy ?? true;
	const trimmedContext = context.trim();

	// Pass 1: Exact line match
	{
		let firstMatch: number | undefined;
		let matchCount = 0;
		const matchIndices: number[] = [];
		for (let i = startFrom; i < lines.length; i++) {
			if (lines[i] === context) {
				if (firstMatch === undefined) firstMatch = i;
				matchCount++;
				if (matchIndices.length < 5) matchIndices.push(i);
			}
		}
		if (matchCount > 0) {
			return { index: firstMatch, confidence: 1.0, matchCount, matchIndices, strategy: "exact" };
		}
	}

	// Pass 2: Trimmed match
	{
		let firstMatch: number | undefined;
		let matchCount = 0;
		const matchIndices: number[] = [];
		for (let i = startFrom; i < lines.length; i++) {
			if (lines[i].trim() === trimmedContext) {
				if (firstMatch === undefined) firstMatch = i;
				matchCount++;
				if (matchIndices.length < 5) matchIndices.push(i);
			}
		}
		if (matchCount > 0) {
			return { index: firstMatch, confidence: 0.99, matchCount, matchIndices, strategy: "trim" };
		}
	}

	// Pass 3: Unicode normalization match
	const normalizedContext = normalizeUnicode(context);
	{
		let firstMatch: number | undefined;
		let matchCount = 0;
		const matchIndices: number[] = [];
		for (let i = startFrom; i < lines.length; i++) {
			if (normalizeUnicode(lines[i]) === normalizedContext) {
				if (firstMatch === undefined) firstMatch = i;
				matchCount++;
				if (matchIndices.length < 5) matchIndices.push(i);
			}
		}
		if (matchCount > 0) {
			return { index: firstMatch, confidence: 0.98, matchCount, matchIndices, strategy: "unicode" };
		}
	}

	if (!allowFuzzy) {
		return { index: undefined, confidence: 0 };
	}

	// Pass 4: Prefix match (file line starts with context)
	const contextNorm = normalizeForFuzzy(context);
	if (contextNorm.length > 0) {
		let firstMatch: number | undefined;
		let matchCount = 0;
		const matchIndices: number[] = [];
		for (let i = startFrom; i < lines.length; i++) {
			const lineNorm = normalizeForFuzzy(lines[i]);
			if (lineNorm.startsWith(contextNorm)) {
				if (firstMatch === undefined) firstMatch = i;
				matchCount++;
				if (matchIndices.length < 5) matchIndices.push(i);
			}
		}
		if (matchCount > 0) {
			return { index: firstMatch, confidence: 0.96, matchCount, matchIndices, strategy: "prefix" };
		}
	}

	// Pass 5: Substring match (file line contains context)
	// First pass: find all substring matches (ignoring ratio)
	// If exactly one match exists, accept it (uniqueness is sufficient)
	// If multiple matches, apply ratio filter to disambiguate
	if (contextNorm.length >= PARTIAL_MATCH_MIN_LENGTH) {
		const allSubstringMatches: Array<{ index: number; ratio: number }> = [];
		for (let i = startFrom; i < lines.length; i++) {
			const lineNorm = normalizeForFuzzy(lines[i]);
			if (lineNorm.includes(contextNorm)) {
				const ratio = contextNorm.length / Math.max(1, lineNorm.length);
				allSubstringMatches.push({ index: i, ratio });
			}
		}
		const matchIndices = allSubstringMatches.slice(0, 5).map(match => match.index);

		// If exactly one substring match, accept it regardless of ratio
		if (allSubstringMatches.length === 1) {
			return {
				index: allSubstringMatches[0].index,
				confidence: 0.94,
				matchCount: 1,
				matchIndices,
				strategy: "substring",
			};
		}

		// Multiple matches: filter by ratio to disambiguate
		let firstMatch: number | undefined;
		let matchCount = 0;
		for (const match of allSubstringMatches) {
			if (match.ratio >= PARTIAL_MATCH_MIN_RATIO) {
				if (firstMatch === undefined) firstMatch = match.index;
				matchCount++;
			}
		}
		if (matchCount > 0) {
			return { index: firstMatch, confidence: 0.94, matchCount, matchIndices, strategy: "substring" };
		}

		// If we had substring matches but none passed ratio filter,
		// return ambiguous result so caller knows matches exist
		if (allSubstringMatches.length > 1) {
			return {
				index: allSubstringMatches[0].index,
				confidence: 0.94,
				matchCount: allSubstringMatches.length,
				matchIndices,
				strategy: "substring",
			};
		}
	}

	// Pass 6: Fuzzy match using similarity
	let bestIndex: number | undefined;
	let bestScore = 0;
	let matchCount = 0;
	const matchIndices: number[] = [];

	for (let i = startFrom; i < lines.length; i++) {
		const lineNorm = normalizeForFuzzy(lines[i]);
		const score = similarity(lineNorm, contextNorm);
		if (score >= CONTEXT_FUZZY_THRESHOLD) {
			matchCount++;
			if (matchIndices.length < 5) matchIndices.push(i);
		}
		if (score > bestScore) {
			bestScore = score;
			bestIndex = i;
		}
	}

	if (bestIndex !== undefined && bestScore >= CONTEXT_FUZZY_THRESHOLD) {
		return { index: bestIndex, confidence: bestScore, matchCount, matchIndices, strategy: "fuzzy" };
	}

	if (!options?.skipFunctionFallback && trimmedContext.endsWith("()")) {
		const withParen = trimmedContext.replace(/\(\)\s*$/u, "(");
		const withoutParen = trimmedContext.replace(/\(\)\s*$/u, "");
		const parenResult = findContextLine(lines, withParen, startFrom, { allowFuzzy, skipFunctionFallback: true });
		if (parenResult.index !== undefined || (parenResult.matchCount ?? 0) > 0) {
			return parenResult;
		}
		return findContextLine(lines, withoutParen, startFrom, { allowFuzzy, skipFunctionFallback: true });
	}

	return { index: undefined, confidence: bestScore };
}
