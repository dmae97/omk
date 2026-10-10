import type { OutputSnapshot } from "./output-accumulator.ts";
import { DEFAULT_MAX_BYTES, formatSize, type TruncationResult } from "./truncate.ts";

/** Keep raw-output links and truncation notices identical across filtered and ordinary results. */
export function formatBashOutput(snapshot: OutputSnapshot, lastLineBytes: number, emptyText = "(no output)") {
	const truncation = snapshot.truncation;
	let text = snapshot.content || emptyText;
	let details:
		| { truncation?: TruncationResult; fullOutputPath?: string; outputFilter?: OutputSnapshot["outputFilter"] }
		| undefined;
	if (truncation.truncated) {
		details = { truncation, fullOutputPath: snapshot.fullOutputPath };
		const startLine = truncation.totalLines - truncation.outputLines + 1;
		const endLine = truncation.totalLines;
		if (truncation.lastLinePartial) {
			const lastLineSize = formatSize(lastLineBytes);
			text += `\n\n[Showing last ${formatSize(truncation.outputBytes)} of line ${endLine} (line is ${lastLineSize}). Full output: ${snapshot.fullOutputPath}]`;
		} else if (truncation.truncatedBy === "lines") {
			text += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}. Full output: ${snapshot.fullOutputPath}]`;
		} else {
			text += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). Full output: ${snapshot.fullOutputPath}]`;
		}
	} else if (snapshot.fullOutputPath) {
		details = { fullOutputPath: snapshot.fullOutputPath, outputFilter: snapshot.outputFilter };
		text += `\n\n[${snapshot.outputFilter?.status === "applied" ? `RTK ${snapshot.outputFilter.filter} filtered output. ` : ""}Full output: ${snapshot.fullOutputPath}]`;
	}
	return { text, details };
}
