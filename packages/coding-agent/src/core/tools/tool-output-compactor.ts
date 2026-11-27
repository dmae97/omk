import { stripAnsi } from "../../utils/ansi.ts";

export interface ToolOutputCompactionOptions {
	/** Minimum consecutive identical non-blank lines before folding (default: 3). */
	readonly minRepeatRun?: number;
	/** Maximum consecutive blank lines kept (default: 1). */
	readonly maxConsecutiveBlankLines?: number;
}

export interface ToolOutputCompactionResult {
	readonly text: string;
	readonly originalBytes: number;
	readonly compactedBytes: number;
	readonly savedBytes: number;
	readonly collapsedDuplicateLines: number;
	readonly collapsedBlankLines: number;
	readonly strippedAnsi: boolean;
	readonly applied: boolean;
}

function resolveCarriageReturns(line: string): string {
	if (!line.includes("\r")) return line;
	const frames = line.split("\r").filter((segment) => segment.length > 0);
	return frames.length === 0 ? "" : frames[frames.length - 1];
}

/**
 * Deterministic, signal-preserving tool output compactor:
 * removes ANSI escape noise, collapses terminal carriage-return progress frames,
 * folds consecutive identical boilerplate lines, and bounds consecutive blank runs.
 */
export function compactToolOutput(raw: string, options: ToolOutputCompactionOptions = {}): ToolOutputCompactionResult {
	const originalBytes = Buffer.byteLength(raw, "utf8");
	if (originalBytes === 0) {
		return {
			text: raw,
			originalBytes: 0,
			compactedBytes: 0,
			savedBytes: 0,
			collapsedDuplicateLines: 0,
			collapsedBlankLines: 0,
			strippedAnsi: false,
			applied: false,
		};
	}

	const minRepeatRun = Math.max(2, Math.floor(options.minRepeatRun ?? 3));
	const maxBlank = Math.max(1, Math.floor(options.maxConsecutiveBlankLines ?? 1));

	const normalizedLineEndings = raw.replace(/\r\n/g, "\n");
	const noAnsi = stripAnsi(normalizedLineEndings);
	const strippedAnsi = noAnsi !== normalizedLineEndings;

	const lines = noAnsi.split("\n").map(resolveCarriageReturns);
	const out: string[] = [];
	let collapsedDuplicateLines = 0;
	let collapsedBlankLines = 0;
	let blankRun = 0;

	let i = 0;
	while (i < lines.length) {
		const current = lines[i];
		if (current.trim().length === 0) {
			blankRun += 1;
			if (blankRun <= maxBlank) {
				out.push("");
			} else {
				collapsedBlankLines += 1;
			}
			i += 1;
			continue;
		}
		blankRun = 0;

		let runEnd = i + 1;
		while (runEnd < lines.length && lines[runEnd] === current) {
			runEnd += 1;
		}
		const runLength = runEnd - i;
		if (runLength >= minRepeatRun) {
			const omitted = runLength - 1;
			collapsedDuplicateLines += omitted;
			out.push(current, `[... repeated ${omitted} more times]`);
		} else {
			for (let k = i; k < runEnd; k += 1) out.push(lines[k]);
		}
		i = runEnd;
	}

	const text = out.join("\n");
	const compactedBytes = Buffer.byteLength(text, "utf8");
	const applied = text !== raw;
	return {
		text,
		originalBytes,
		compactedBytes,
		savedBytes: Math.max(0, originalBytes - compactedBytes),
		collapsedDuplicateLines,
		collapsedBlankLines,
		strippedAnsi,
		applied,
	};
}
