/**
 * Diff generation and replace-mode utilities for the edit tool.
 *
 * Provides diff string generation and the replace-mode edit logic
 * used when not in patch mode.
 */

import * as Diff from "diff";
import { resolveToCwd } from "$c/tools/path-utils";
import { previewPatch } from "./applicator";
import { DEFAULT_FUZZY_THRESHOLD, findMatch } from "./fuzzy";
import { adjustIndentation, normalizeToLF, stripBom } from "./normalize";
import type { DiffError, DiffResult, PatchInput } from "./types";
import { EditMatchError } from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// Diff String Generation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a unified diff string with line numbers and context.
 * Returns both the diff string and the first changed line number (in the new file).
 */
export function generateDiffString(oldContent: string, newContent: string, contextLines = 4): DiffResult {
	const parts = Diff.diffLines(oldContent, newContent);
	const output: string[] = [];

	const countLines = (content: string): number => {
		const lines = content.split("\n");
		if (lines.length > 1 && lines[lines.length - 1] === "") {
			lines.pop();
		}
		return Math.max(1, lines.length);
	};

	const maxLineNum = Math.max(countLines(oldContent), countLines(newContent));
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
					const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
					output.push(`-${lineNum} ${line}`);
					oldLineNum++;
				}
			}
			lastWasChange = true;
		} else {
			// Context lines - only show a few before/after changes
			const nextPartIsChange = i < parts.length - 1 && (parts[i + 1].added || parts[i + 1].removed);

			if (lastWasChange || nextPartIsChange) {
				let linesToShow = raw;
				let skipStart = 0;
				let skipEnd = 0;

				if (!lastWasChange) {
					// Show only last N lines as leading context
					skipStart = Math.max(0, raw.length - contextLines);
					linesToShow = raw.slice(skipStart);
				}

				if (!nextPartIsChange && linesToShow.length > contextLines) {
					// Show only first N lines as trailing context
					skipEnd = linesToShow.length - contextLines;
					linesToShow = linesToShow.slice(0, contextLines);
				}

				// Add ellipsis if we skipped lines at start
				if (skipStart > 0) {
					output.push(` ${"".padStart(lineNumWidth, " ")} ...`);
					oldLineNum += skipStart;
					newLineNum += skipStart;
				}

				for (const line of linesToShow) {
					const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
					output.push(` ${lineNum} ${line}`);
					oldLineNum++;
					newLineNum++;
				}

				// Add ellipsis if we skipped lines at end
				if (skipEnd > 0) {
					output.push(` ${"".padStart(lineNumWidth, " ")} ...`);
					oldLineNum += skipEnd;
					newLineNum += skipEnd;
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

// ═══════════════════════════════════════════════════════════════════════════
// Replace Mode Logic
// ═══════════════════════════════════════════════════════════════════════════

export interface ReplaceOptions {
	/** Allow fuzzy matching */
	fuzzy: boolean;
	/** Replace all occurrences */
	all: boolean;
	/** Similarity threshold for fuzzy matching */
	threshold?: number;
}

export interface ReplaceResult {
	/** The new content after replacements */
	content: string;
	/** Number of replacements made */
	count: number;
}

/**
 * Generate a unified diff string without file headers.
 * Returns both the diff string and the first changed line number (in the new file).
 */
export function generateUnifiedDiffString(oldContent: string, newContent: string, contextLines = 3): DiffResult {
	const patch = Diff.structuredPatch("", "", oldContent, newContent, "", "", { context: contextLines });
	const output: string[] = [];
	let firstChangedLine: number | undefined;

	for (const hunk of patch.hunks) {
		output.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
		let newLine = hunk.newStart;
		for (const line of hunk.lines) {
			output.push(line);
			if (firstChangedLine === undefined && (line.startsWith("+") || line.startsWith("-"))) {
				firstChangedLine = newLine;
			}
			if (line.startsWith("+") || line.startsWith(" ")) {
				newLine++;
			}
		}
	}

	return { diff: output.join("\n"), firstChangedLine };
}

/**
 * Find and replace text in content using fuzzy matching.
 */
export function replaceText(content: string, oldText: string, newText: string, options: ReplaceOptions): ReplaceResult {
	if (oldText.length === 0) {
		throw new Error("oldText must not be empty.");
	}
	const threshold = options.threshold ?? DEFAULT_FUZZY_THRESHOLD;
	let normalizedContent = normalizeToLF(content);
	const normalizedOldText = normalizeToLF(oldText);
	const normalizedNewText = normalizeToLF(newText);
	let count = 0;

	if (options.all) {
		// Check for exact matches first
		const exactCount = normalizedContent.split(normalizedOldText).length - 1;
		if (exactCount > 0) {
			return {
				content: normalizedContent.split(normalizedOldText).join(normalizedNewText),
				count: exactCount,
			};
		}

		// No exact matches - try fuzzy matching iteratively
		while (true) {
			const matchOutcome = findMatch(normalizedContent, normalizedOldText, {
				allowFuzzy: options.fuzzy,
				threshold,
			});

			const shouldUseClosest =
				options.fuzzy &&
				matchOutcome.closest &&
				matchOutcome.closest.confidence >= threshold &&
				(matchOutcome.fuzzyMatches === undefined || matchOutcome.fuzzyMatches <= 1);
			const match = matchOutcome.match || (shouldUseClosest ? matchOutcome.closest : undefined);
			if (!match) {
				break;
			}

			const adjustedNewText = adjustIndentation(normalizedOldText, match.actualText, normalizedNewText);
			if (adjustedNewText === match.actualText) {
				break;
			}
			normalizedContent =
				normalizedContent.substring(0, match.startIndex) +
				adjustedNewText +
				normalizedContent.substring(match.startIndex + match.actualText.length);
			count++;
		}

		return { content: normalizedContent, count };
	}

	// Single replacement mode
	const matchOutcome = findMatch(normalizedContent, normalizedOldText, {
		allowFuzzy: options.fuzzy,
		threshold,
	});

	if (matchOutcome.occurrences && matchOutcome.occurrences > 1) {
		const previews = matchOutcome.occurrencePreviews?.join("\n\n") ?? "";
		const moreMsg = matchOutcome.occurrences > 5 ? ` (showing first 5 of ${matchOutcome.occurrences})` : "";
		throw new Error(
			`Found ${matchOutcome.occurrences} occurrences${moreMsg}:\n\n${previews}\n\n` +
				`Add more context lines to disambiguate.`,
		);
	}

	if (!matchOutcome.match) {
		return { content: normalizedContent, count: 0 };
	}

	const match = matchOutcome.match;
	const adjustedNewText = adjustIndentation(normalizedOldText, match.actualText, normalizedNewText);
	normalizedContent =
		normalizedContent.substring(0, match.startIndex) +
		adjustedNewText +
		normalizedContent.substring(match.startIndex + match.actualText.length);

	return { content: normalizedContent, count: 1 };
}

// ═══════════════════════════════════════════════════════════════════════════
// Preview/Diff Computation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute the diff for an edit operation without applying it.
 * Used for preview rendering in the TUI before the tool executes.
 */
export async function computeEditDiff(
	path: string,
	oldText: string,
	newText: string,
	cwd: string,
	fuzzy = true,
	all = false,
	threshold?: number,
): Promise<DiffResult | DiffError> {
	if (oldText.length === 0) {
		return { error: "oldText must not be empty." };
	}
	const absolutePath = resolveToCwd(path, cwd);

	try {
		const file = Bun.file(absolutePath);
		try {
			if (!(await file.exists())) {
				return { error: `File not found: ${path}` };
			}
		} catch {
			return { error: `File not found: ${path}` };
		}

		let rawContent: string;
		try {
			rawContent = await file.text();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { error: message || `Unable to read ${path}` };
		}

		const { text: content } = stripBom(rawContent);
		const normalizedContent = normalizeToLF(content);
		const normalizedOldText = normalizeToLF(oldText);
		const normalizedNewText = normalizeToLF(newText);

		const result = replaceText(normalizedContent, normalizedOldText, normalizedNewText, {
			fuzzy,
			all,
			threshold,
		});

		if (result.count === 0) {
			// Get closest match for error message
			const matchOutcome = findMatch(normalizedContent, normalizedOldText, {
				allowFuzzy: fuzzy,
				threshold: threshold ?? DEFAULT_FUZZY_THRESHOLD,
			});

			if (matchOutcome.occurrences && matchOutcome.occurrences > 1) {
				const previews = matchOutcome.occurrencePreviews?.join("\n\n") ?? "";
				const moreMsg = matchOutcome.occurrences > 5 ? ` (showing first 5 of ${matchOutcome.occurrences})` : "";
				return {
					error: `Found ${matchOutcome.occurrences} occurrences in ${path}${moreMsg}:\n\n${previews}\n\nAdd more context lines to disambiguate.`,
				};
			}

			return {
				error: EditMatchError.formatMessage(path, normalizedOldText, matchOutcome.closest, {
					allowFuzzy: fuzzy,
					threshold: threshold ?? DEFAULT_FUZZY_THRESHOLD,
					fuzzyMatches: matchOutcome.fuzzyMatches,
				}),
			};
		}

		if (normalizedContent === result.content) {
			return {
				error: `No changes would be made to ${path}. The replacement produces identical content.`,
			};
		}

		return generateDiffString(normalizedContent, result.content);
	} catch (err) {
		return { error: err instanceof Error ? err.message : String(err) };
	}
}

/**
 * Compute the diff for a patch operation without applying it.
 * Used for preview rendering in the TUI before patch-mode edits execute.
 */
export async function computePatchDiff(
	input: PatchInput,
	cwd: string,
	options?: { fuzzyThreshold?: number; allowFuzzy?: boolean },
): Promise<DiffResult | DiffError> {
	try {
		const result = await previewPatch(input, {
			cwd,
			fuzzyThreshold: options?.fuzzyThreshold,
			allowFuzzy: options?.allowFuzzy,
		});
		const oldContent = result.change.oldContent ?? "";
		const newContent = result.change.newContent ?? "";
		const normalizedOld = normalizeToLF(stripBom(oldContent).text);
		const normalizedNew = normalizeToLF(stripBom(newContent).text);
		if (!normalizedOld && !normalizedNew) {
			return { diff: "", firstChangedLine: undefined };
		}
		return generateUnifiedDiffString(normalizedOld, normalizedNew);
	} catch (err) {
		return { error: err instanceof Error ? err.message : String(err) };
	}
}
