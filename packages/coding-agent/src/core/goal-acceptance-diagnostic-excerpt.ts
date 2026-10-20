/** Spec 094 head/tail and spec 095 two-window excerpts. */
import { dropCutLine, fitTail, fitWindow, fitWindow1, marker, trimContext } from "./goal-acceptance-diagnostic-fit.ts";
import {
	firstLines,
	GOAL_DIAGNOSTIC_HEAD_BYTES,
	GOAL_DIAGNOSTIC_HEAD_LINES,
	GOAL_DIAGNOSTIC_MAX_BYTES,
	GOAL_DIAGNOSTIC_MAX_LINES,
	GOAL_DIAGNOSTIC_WINDOW2_BYTES,
	GOAL_DIAGNOSTIC_WINDOW2_LINES,
	lastLines,
	MARKER_RESERVE_BYTES,
	prefixBytes,
	sanitizeDiagnosticText,
	suffixBytes,
	utf8Bytes,
} from "./goal-acceptance-diagnostic-text.ts";
import type { DiagnosticAnchor, DiagnosticExcerpt, DiagnosticOutput } from "./goal-acceptance-diagnostic-types.ts";

/** Fixed 768/768 two-window excerpt with markers (spec 095). */
function twoWindowExcerpt(anchor: DiagnosticAnchor): DiagnosticExcerpt {
	const out: string[] = [];
	const w1 = fitWindow1(anchor.first ?? anchor.head);
	const w1Source = w1.window;
	if (anchor.v3) dropCutLine(w1);
	if (w1.lead) out.push(w1.lead);
	out.push(...w1.lines);
	const w1End = w1Source.startLine + w1.count - 1;
	const w1EndOffset = w1Source.skippedBytes + w1.used;

	// Window 2 starts after window 1 if they overlap.
	let w2Lines = anchor.last.lines.map((line) => sanitizeDiagnosticText(line));
	let w2Start = anchor.last.startLine;
	let w2Skipped = anchor.last.skippedBytes;
	if (w2Start <= w1End) {
		const drop = w1End - w2Start + 1;
		for (const line of w2Lines.slice(0, drop)) w2Skipped += utf8Bytes(line) + 1;
		w2Lines = w2Lines.slice(drop);
		w2Start = w1End + 1;
	}
	// Middle marker share is reserved up front (its byte count is only known after window 2 is fitted).
	const middleBytes = MARKER_RESERVE_BYTES;
	const w2Budget = GOAL_DIAGNOSTIC_WINDOW2_BYTES - middleBytes - MARKER_RESERVE_BYTES;
	let w2: ReturnType<typeof fitWindow>;
	if (anchor.last.pattern === "tail") {
		const tail = fitTail(w2Lines, w2Budget, GOAL_DIAGNOSTIC_WINDOW2_LINES - 1);
		w2Skipped += tail.skipped;
		w2Start += w2Lines.length - tail.lines.length;
		const used = tail.lines.reduce((sum, line) => sum + utf8Bytes(line) + 1, 0);
		w2 = {
			lines: tail.lines,
			count: tail.lines.length,
			used: Math.max(used, anchor.totalBytes - w2Skipped),
			cut: false,
		};
	} else {
		const trimmed = trimContext(
			{ ...anchor.last, startLine: w2Start, skippedBytes: w2Skipped, lines: w2Lines },
			GOAL_DIAGNOSTIC_WINDOW2_BYTES - middleBytes,
		);
		w2Start = trimmed.startLine;
		w2Skipped = trimmed.skippedBytes;
		w2 = fitWindow(trimmed.lines, w2Budget, GOAL_DIAGNOSTIC_WINDOW2_LINES - 1);
	}
	const gap = Math.max(0, w2Skipped - w1EndOffset);
	const middle = gap > 0 || w1.cut ? marker(gap + (w1.cut ? 1 : 0)) : "";
	if (middle) out.push(middle);
	out.push(...w2.lines);
	const after = Math.max(0, anchor.totalBytes - w2Skipped - w2.used);
	if (after > 0 || w2.cut) out.push(marker(after + (w2.cut ? 1 : 0)));
	const text = out.join("\n").replace(/\s+$/, "");
	const windows: (readonly [number, number])[] = [[w1Source.startLine, w1End]];
	if (w2.count > 0) windows.push([w2Start, w2Start + w2.count - 1]);
	return { text, truncated: true, mode: anchor.pattern, windows };
}

/** Passthrough when the whole output fits; else two windows when anchored; else the 094 head/tail split. */
export function buildDiagnosticExcerpt(output: DiagnosticOutput): DiagnosticExcerpt {
	if (output.complete) {
		const whole = sanitizeDiagnosticText(output.head).replace(/\s+$/, "");
		if (utf8Bytes(whole) <= GOAL_DIAGNOSTIC_MAX_BYTES && whole.split("\n").length <= GOAL_DIAGNOSTIC_MAX_LINES) {
			return { text: whole, truncated: false, mode: output.anchor?.pattern ?? "fallback" };
		}
	}
	return output.anchor ? twoWindowExcerpt(output.anchor) : headTailExcerpt(output);
}

function headTailExcerpt(output: DiagnosticOutput): DiagnosticExcerpt {
	const head = sanitizeDiagnosticText(output.head).replace(/\s+$/, "");
	const tail = sanitizeDiagnosticText(output.tail).replace(/\s+$/, "");
	if (
		output.complete &&
		utf8Bytes(head) <= GOAL_DIAGNOSTIC_MAX_BYTES &&
		head.split("\n").length <= GOAL_DIAGNOSTIC_MAX_LINES
	) {
		return { text: head, truncated: false, mode: "fallback" };
	}
	let headPart = firstLines(prefixBytes(head, GOAL_DIAGNOSTIC_HEAD_BYTES), GOAL_DIAGNOSTIC_HEAD_LINES);
	const headNewline = headPart.lastIndexOf("\n");
	if (headNewline > 0 && headPart.length < head.length) headPart = headPart.slice(0, headNewline);
	const headLines = headPart.split("\n").length;
	const tailBudget = GOAL_DIAGNOSTIC_MAX_BYTES - utf8Bytes(headPart) - MARKER_RESERVE_BYTES;
	const source = output.complete ? head : tail;
	let tailPart = lastLines(suffixBytes(source, tailBudget), GOAL_DIAGNOSTIC_MAX_LINES - headLines - 1);
	const tailNewline = tailPart.indexOf("\n");
	if (tailNewline >= 0 && tailNewline < tailPart.length - 1 && tailPart.length < source.length) {
		tailPart = tailPart.slice(tailNewline + 1);
	}
	const total = output.complete ? utf8Bytes(head) : output.totalBytes;
	const elided = Math.max(0, total - utf8Bytes(headPart) - utf8Bytes(tailPart));
	return { text: `${headPart}\n[… ${elided} bytes elided …]\n${tailPart}`, truncated: true, mode: "fallback" };
}
