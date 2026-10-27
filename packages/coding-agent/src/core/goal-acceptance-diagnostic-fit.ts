/** Spec 095 window fitting: byte/line budgets and elision markers. */
import {
	GOAL_DIAGNOSTIC_WINDOW1_BYTES,
	GOAL_DIAGNOSTIC_WINDOW1_LINES,
	MARKER_RESERVE_BYTES,
	prefixBytes,
	sanitizeDiagnosticText,
	suffixBytes,
	utf8Bytes,
} from "./goal-acceptance-diagnostic-text.ts";
import type { DiagnosticWindow } from "./goal-acceptance-diagnostic-types.ts";

export function marker(bytes: number): string {
	return `[… ${bytes} bytes elided …]`;
}

/** Whole lines (code-point-safe cut of the one that overflows) within the byte and line budget. */
export function fitWindow(
	lines: readonly string[],
	maxBytes: number,
	maxLines: number,
): { lines: string[]; count: number; used: number; cut: boolean } {
	const out: string[] = [];
	let bytes = 0;
	let used = 0;
	let cut = false;
	for (const line of lines) {
		if (out.length >= maxLines) break;
		const size = utf8Bytes(line) + 1;
		const budget = maxBytes - bytes;
		if (budget <= 1) break;
		if (size > budget) {
			out.push(prefixBytes(line, budget - 1));
			used += size;
			bytes = maxBytes;
			cut = true;
			break;
		}
		out.push(line);
		bytes += size;
		used += size;
	}
	return { lines: out, count: out.length, used, cut };
}

/**
 * Drop context lines above the anchor (oldest first) until the anchor line
 * itself starts within `maxBytes`, so the cut never loses the anchor line.
 */
export function trimContext(window: DiagnosticWindow, maxBytes: number): DiagnosticWindow {
	if (window.line === undefined) return window;
	let lines = window.lines.map((line) => sanitizeDiagnosticText(line));
	let { startLine, skippedBytes } = window;
	const sizeBefore = (count: number) => lines.slice(0, count).reduce((sum, line) => sum + utf8Bytes(line) + 1, 0);
	while (startLine < window.line && sizeBefore(window.line - startLine) + 1 + MARKER_RESERVE_BYTES > maxBytes - 64) {
		skippedBytes += utf8Bytes(lines[0]) + 1;
		lines = lines.slice(1);
		startLine++;
	}
	return { ...window, startLine, skippedBytes, lines };
}

/** Window 1 cut to its share; the leading marker (if any) counts against it. */
export function fitWindow1(
	source: DiagnosticWindow,
): ReturnType<typeof fitWindow> & { lead: string; window: DiagnosticWindow } {
	const window = trimContext(source, GOAL_DIAGNOSTIC_WINDOW1_BYTES);
	const lead = window.skippedBytes > 0 ? marker(window.skippedBytes) : "";
	const leadBytes = lead ? utf8Bytes(lead) + 1 : 0;
	const fit = fitWindow(
		window.lines.map((line) => sanitizeDiagnosticText(line)),
		GOAL_DIAGNOSTIC_WINDOW1_BYTES - leadBytes,
		GOAL_DIAGNOSTIC_WINDOW1_LINES - (lead ? 1 : 0),
	);
	return { ...fit, lead, window };
}

/** Whole trailing lines (code-point-safe suffix of the first one if it alone overflows). */
export function fitTail(
	lines: readonly string[],
	maxBytes: number,
	maxLines: number,
): { lines: string[]; skipped: number } {
	const out: string[] = [];
	let bytes = 0;
	for (let i = lines.length - 1; i >= 0 && out.length < maxLines; i--) {
		const size = utf8Bytes(lines[i]) + 1;
		if (bytes + size > maxBytes) {
			if (out.length === 0) out.unshift(suffixBytes(lines[i], maxBytes - 1));
			break;
		}
		out.unshift(lines[i]);
		bytes += size;
	}
	const skipped = lines.slice(0, lines.length - out.length).reduce((sum, line) => sum + utf8Bytes(line) + 1, 0);
	return { lines: out, skipped };
}

/**
 * Spec 097: a window-1 line cut at the cap (after the anchor line) is dropped whole, so it is
 * either elided by the middle marker or shown whole by window 2, never half-shown.
 */
export function dropCutLine(w1: ReturnType<typeof fitWindow1>): void {
	const anchorIndex = w1.window.line === undefined ? -1 : w1.window.line - w1.window.startLine;
	if (!w1.cut || w1.count - 1 <= anchorIndex || w1.count < 2) return;
	w1.lines.pop();
	w1.count--;
	w1.used -= utf8Bytes(sanitizeDiagnosticText(w1.window.lines[w1.count])) + 1;
	w1.cut = false;
}
