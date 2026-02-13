/**
 * Bash command normalizer - extracts patterns that are better handled natively.
 *
 * Detects and extracts:
 * - `| head -n N` / `| head -N` - extracted to headLines
 * - `| tail -n N` / `| tail -N` - extracted to tailLines
 */

export interface NormalizedCommand {
	/** Cleaned command with patterns stripped */
	command: string;
	/** Extracted head line count, if any */
	headLines?: number;
	/** Extracted tail line count, if any */
	tailLines?: number;
}

/**
 * Pattern to match trailing pipe to head/tail.
 * Captures: full match, command (head/tail), line count
 *
 * Matches:
 * - `| head -n 50`
 * - `| head -50`
 * - `| tail -n 100`
 * - `| tail -100`
 *
 * Does NOT match head/tail with other flags or without line count.
 */
const TRAILING_HEAD_TAIL_PATTERN = /\|\s*(head|tail)\s+(?:-n\s*(\d+)|(-\d+))\s*$/;

/**
 * Normalize a bash command by stripping patterns better handled natively.
 *
 * Extracts `| head -n N` and `| tail -n N` suffixes into separate fields
 * so they can be applied post-execution without breaking streaming.
 *
 * Strips `2>&1` since we already merge stdout/stderr.
 */
export function normalizeBashCommand(command: string): NormalizedCommand {
	let normalized = command;
	let headLines: number | undefined;
	let tailLines: number | undefined;

	// Extract trailing head/tail
	const match = normalized.match(TRAILING_HEAD_TAIL_PATTERN);
	if (match) {
		const [fullMatch, cmd, nValue, dashValue] = match;
		const lineCount = nValue ? Number.parseInt(nValue, 10) : Number.parseInt(dashValue.slice(1), 10);

		if (cmd === "head") {
			headLines = lineCount;
		} else {
			tailLines = lineCount;
		}

		normalized = normalized.slice(0, -fullMatch.length);
	}

	// Preserve internal whitespace (important for heredocs / indentation-sensitive scripts)
	normalized = normalized.trim();

	return {
		command: normalized,
		headLines,
		tailLines,
	};
}

/**
 * Apply head/tail limits to output text.
 *
 * If both head and tail are specified, head is applied first (take first N lines),
 * then tail is applied (take last M lines of that).
 */
export function applyHeadTail(
	text: string,
	headLines?: number,
	tailLines?: number,
): { text: string; applied: boolean; headApplied?: number; tailApplied?: number } {
	if (!headLines && !tailLines) {
		return { text, applied: false };
	}

	let lines = text.split("\n");
	let headApplied: number | undefined;
	let tailApplied: number | undefined;

	// Apply head first (keep first N lines)
	if (headLines !== undefined && headLines > 0 && lines.length > headLines) {
		lines = lines.slice(0, headLines);
		headApplied = headLines;
	}

	// Then apply tail (keep last N lines)
	if (tailLines !== undefined && tailLines > 0 && lines.length > tailLines) {
		lines = lines.slice(-tailLines);
		tailApplied = tailLines;
	}

	return {
		text: lines.join("\n"),
		applied: headApplied !== undefined || tailApplied !== undefined,
		headApplied,
		tailApplied,
	};
}
