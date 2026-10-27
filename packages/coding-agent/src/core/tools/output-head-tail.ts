/**
 * Spec 113 (`OMK_EXEC_TRUNCATE_MIDDLE=1`, agent bash tool only): head + marker + tail view of long output.
 * Idea from Codex CLI's middle truncation (Apache-2.0); no code copied.
 */
import { formatSize, type TruncationResult, truncateStringToBytesFromStart, truncateTail } from "./truncate.ts";

/** Upper bound for the marker line while streaming; `buildHeadTail` uses the real size. */
const HEAD_TAIL_MARKER_RESERVE = 256;

function byteLength(text: string): number {
	return Buffer.byteLength(text, "utf-8");
}

function countNewlines(text: string): number {
	let count = 0;
	for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) count++;
	return count;
}

function countLines(text: string): number {
	if (text.length === 0) return 0;
	return countNewlines(text) + (text.endsWith("\n") ? 0 : 1);
}

/** Keeps the first decoded lines/bytes until the head budget is full, then freezes (bounded memory). */
export class HeadCapture {
	text = "";
	private textBytes = 0;
	private newlines = 0;
	private headDone = false;
	private readonly captureBytes: number;
	private readonly captureLines: number;

	constructor(maxBytes: number, maxLines: number) {
		this.captureBytes = Math.max(0, Math.floor((maxBytes - HEAD_TAIL_MARKER_RESERVE) / 2));
		this.captureLines = Math.max(0, Math.floor((maxLines - 1) / 2));
	}

	append(text: string, bytes: number): void {
		if (this.headDone) return;
		this.text += text;
		this.textBytes += bytes;
		for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) this.newlines++;
		if (this.newlines < this.captureLines && this.textBytes < this.captureBytes) return;
		if (this.newlines >= this.captureLines) {
			let cut = -1;
			for (let n = 0; n < this.captureLines; n++) cut = this.text.indexOf("\n", cut + 1);
			if (cut !== -1) this.text = this.text.slice(0, cut + 1);
		}
		this.text = truncateStringToBytesFromStart(this.text, this.captureBytes);
		this.textBytes = byteLength(this.text);
		this.headDone = true;
	}
}

export interface HeadTailInput {
	headText: string;
	/** Decoded rolling tail, starting at a line boundary, ending at the end of the output. */
	tailText: string;
	totalLines: number;
	totalBytes: number;
	maxLines: number;
	maxBytes: number;
	fullOutputPath: string | undefined;
}

export interface HeadTailResult {
	content: string;
	outputLines: number;
	outputBytes: number;
	lastLinePartial: boolean;
	headLines: number;
	headBytes: number;
	omittedLines: number;
	omittedBytes: number;
}

/** Spec 113: head + marker + tail within maxBytes / maxLines (marker counted inside the budget). */
export function buildHeadTail(input: HeadTailInput): HeadTailResult {
	const { totalLines, totalBytes, maxLines, maxBytes } = input;
	const snapshotText = input.tailText;
	let markerBytes = 0;
	let result: HeadTailResult | undefined;
	for (let attempt = 0; attempt < 6; attempt++) {
		const headBudget = Math.max(0, Math.floor((maxBytes - markerBytes) / 2));
		const candidate = truncateStringToBytesFromStart(input.headText, headBudget);
		const lastNewline = candidate.lastIndexOf("\n");
		const headPartial = lastNewline === -1;
		const head = headPartial ? candidate : candidate.slice(0, lastNewline + 1);
		const headBytes = byteLength(head);
		const headLines = headPartial ? 1 : countNewlines(head);
		const tailBudget = Math.max(0, maxBytes - markerBytes - headBytes - (headPartial ? 1 : 0));
		const tailTruncation = truncateTail(snapshotText, {
			maxLines: Math.max(0, maxLines - 1 - headLines),
			maxBytes: tailBudget,
		});
		let tail = tailTruncation.content;
		// truncateTail drops the final "\n"; count it as shown-from-the-end so the omitted bytes stay exact.
		const droppedNewline = snapshotText.endsWith("\n") && !tail.endsWith("\n") && tail.length > 0 ? 1 : 0;
		let tailBytes = byteLength(tail) + droppedNewline;
		const tailStart = totalBytes - tailBytes;
		if (tailStart < headBytes) {
			// Overlap guard: never show a byte twice.
			const tailBuffer = Buffer.from(tail, "utf-8");
			let start = headBytes - tailStart;
			while (start < tailBuffer.length && (tailBuffer[start] & 0xc0) === 0x80) start++;
			tail = tailBuffer.subarray(start).toString("utf-8");
			tailBytes = byteLength(tail) + droppedNewline;
		}
		const tailPartial = tailTruncation.lastLinePartial;
		const tailLineCount = countLines(tail);
		const firstTailLine = tailPartial ? totalLines : totalLines - tailLineCount + 1;
		const inside = headPartial && tailPartial && totalLines === headLines;
		const omittedLines = inside ? 0 : Math.max(0, firstTailLine - headLines - 1);
		const omittedBytes = Math.max(0, totalBytes - headBytes - tailBytes);
		const where = inside ? `inside line ${headLines}` : `between line ${headLines} and line ${firstTailLine}`;
		const saved = input.fullOutputPath
			? `Full output: ${input.fullOutputPath} (use read with offset/limit to see the middle)`
			: "Full output could not be saved.";
		const marker = `[... omitted ${omittedLines} lines (${formatSize(omittedBytes)}) of ${totalLines} lines (${formatSize(totalBytes)}) ${where}. ${saved} ...]`;
		const content = `${head}${headPartial ? "\n" : ""}${marker}\n${tail}`;
		result = {
			content,
			outputLines: headLines + 1 + tailLineCount,
			outputBytes: byteLength(content),
			lastLinePartial: tailPartial,
			headLines,
			headBytes,
			omittedLines,
			omittedBytes,
		};
		const actualMarkerBytes = byteLength(marker) + 1;
		if (actualMarkerBytes <= markerBytes) break;
		markerBytes = actualMarkerBytes;
	}
	return result!;
}

/** Spec 113: the accumulator's tail-only truncation with head + marker + tail content and additive fields. */
export function headTailTruncation(
	truncation: TruncationResult,
	input: Pick<HeadTailInput, "headText" | "tailText" | "fullOutputPath">,
): TruncationResult {
	const r = buildHeadTail({ ...input, ...truncation });
	return {
		...truncation,
		content: r.content,
		outputLines: r.outputLines,
		outputBytes: r.outputBytes,
		lastLinePartial: r.lastLinePartial,
		strategy: "head-tail",
		headLines: r.headLines,
		headBytes: r.headBytes,
		omittedLines: r.omittedLines,
		omittedBytes: r.omittedBytes,
	};
}
