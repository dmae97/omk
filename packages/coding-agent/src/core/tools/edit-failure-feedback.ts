import { buildNormalizedContentMap, type Edit, normalizeForFuzzyMatch, normalizeToLF } from "./edit-diff.ts";
import { classifyEditMatchFailure, findIndentMatchLines } from "./edit-match-observe.ts";

const MAX_CANDIDATES = 5;

function positionAt(content: string, offset: number): { line: number; column: number } {
	const before = content.slice(0, offset).split("\n");
	return { line: before.length, column: before[before.length - 1].length + 1 };
}

function recoveryHint(content: string, edits: readonly Edit[]): string | undefined {
	// Failure-only work is bounded independently of the edit's normal matching rules.
	if (
		content.length > 256_000 ||
		edits.length > 64 ||
		edits.some((edit) => edit.oldText.length > 32_000 || edit.newText.length > 32_000)
	) {
		return undefined;
	}
	const { reason, editIndex } = classifyEditMatchFailure(content, edits);
	if (editIndex === null || reason === "unknown") return undefined;
	const edit = edits[editIndex];
	const oldText = normalizeToLF(edit.oldText);
	let hint: string;
	if (reason === "multiple_matches") {
		const needle = normalizeForFuzzyMatch(oldText);
		if (!needle) return undefined;
		const map = buildNormalizedContentMap(content);
		const positions: string[] = [];
		let at = map.normalized.indexOf(needle);
		while (at !== -1 && positions.length < MAX_CANDIDATES) {
			const position = positionAt(content, map.startOffsets[at]);
			positions.push(`${position.line}:${position.column}`);
			at = map.normalized.indexOf(needle, at + 1);
		}
		hint = `Candidate positions (line:column): ${positions.join(", ")}${at !== -1 ? " (showing first 5)" : ""}. Re-read these locations and add surrounding context to oldText so it is unique.`;
	} else {
		const newText = normalizeToLF(edit.newText);
		const replacementAt = newText.trim() ? content.indexOf(newText) : -1;
		if (replacementAt !== -1) {
			hint = `newText is already present at line ${positionAt(content, replacementAt).line}. This does not prove the intended edit was applied. Re-read the file before deciding whether another edit is needed.`;
		} else if (reason === "indent_only") {
			const starts = findIndentMatchLines(content, oldText, MAX_CANDIDATES + 1);
			const limit = Math.min(20, oldText.trimEnd().split("\n").length);
			const reads = starts.slice(0, MAX_CANDIDATES).map((offset) => `read(offset=${offset}, limit=${limit})`);
			hint = `Indentation-only candidates: ${reads.join("; ")}${starts.length > MAX_CANDIDATES ? " (showing first 5)" : ""}. Re-read the current file at these ranges and retry with its exact indentation.`;
		} else {
			hint = "Re-read the current file and copy the exact oldText, including whitespace, before retrying.";
		}
	}
	return `Edit recovery for edits[${editIndex}]: ${hint} No changes were written.`;
}

/** Recovery is advisory: preserve the original exception if diagnostics cannot be computed. */
export function addEditFailureFeedback(error: Error, content: string, edits: readonly Edit[]): Error {
	try {
		const hint = recoveryHint(content, edits);
		return hint ? new Error(`${error.message}\n${hint}`, { cause: error }) : error;
	} catch {
		return error;
	}
}
