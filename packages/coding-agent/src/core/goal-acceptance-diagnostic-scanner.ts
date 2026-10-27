/** Spec 095 streaming anchor scanner. */
import { dropCutLine, fitWindow1 } from "./goal-acceptance-diagnostic-fit.ts";
import {
	injectionRuleFor,
	matchErrorLine,
	matchSummaryLine,
	repeatKey,
} from "./goal-acceptance-diagnostic-patterns.ts";
import {
	ANCHOR_LINE_CHARS,
	GOAL_DIAGNOSTIC_ANCHOR_CONTEXT_LINES,
	GOAL_DIAGNOSTIC_REPEAT_CAP,
	GOAL_DIAGNOSTIC_WINDOW1_BYTES,
	GOAL_DIAGNOSTIC_WINDOW1_LINES,
	GOAL_DIAGNOSTIC_WINDOW2_BYTES,
	GOAL_DIAGNOSTIC_WINDOW2_LINES,
	REPEAT_MEMORY,
	utf8Bytes,
} from "./goal-acceptance-diagnostic-text.ts";
import type { DiagnosticAnchor, DiagnosticWindow } from "./goal-acceptance-diagnostic-types.ts";
import { classifyV3Line, goalDiagnosticsV3Enabled } from "./goal-acceptance-diagnostic-v3.ts";

interface Line {
	readonly no: number;
	readonly text: string;
	/** Sanitized bytes before this line. */
	readonly offset: number;
}

interface Pending {
	line: number;
	pattern: string;
	startLine: number;
	skippedBytes: number;
	lines: string[];
	bytes: number;
}

/**
 * Streams sanitized text once and keeps bounded windows: around the first
 * candidate, around the last candidate (or summary line), the head and the
 * tail. Memory is bounded by the window caps plus the R4 memory.
 */
export class AnchorScanner {
	private partial = "";
	private partialBytes = 0;
	private lineNo = 0;
	private offset = 0;
	private readonly before: Line[] = [];
	private readonly tailLines: Line[] = [];
	private readonly headLines: string[] = [];
	private headBytes = 0;
	private first: Pending | undefined;
	private last: Pending | undefined;
	private summary: Pending | undefined;
	private readonly seen = new Map<string, number>();
	/**
	 * An error pattern matched on a line that survived R1–R4; disables summary
	 * anchoring. Lines rejected by R1–R4 count as nonexistent (spec 095, Tech Lead decision 2).
	 */
	private errorMatched = false;
	/** Spec 097 (OMK_GOAL_DIAGNOSTICS_V3); off keeps the 095 scanner byte for byte. */
	private readonly v3: boolean;
	/** V3 D5: warnings anchor only when no error/shape line exists anywhere. */
	private warnFirst: Pending | undefined;
	private warnLast: Pending | undefined;
	/** V3 D4: first non-empty line that is not a known-format info/warning log line. */
	private fallback: Pending | undefined;

	constructor(options: { readonly v3?: boolean } = {}) {
		this.v3 = options.v3 ?? goalDiagnosticsV3Enabled();
	}

	push(sanitized: string): void {
		const parts = sanitized.split("\n");
		const rest = parts.pop() ?? "";
		for (const part of parts) {
			const text = this.partial + part;
			const bytes = this.partialBytes + utf8Bytes(part);
			this.partial = "";
			this.partialBytes = 0;
			this.line(text.slice(0, ANCHOR_LINE_CHARS), bytes);
		}
		this.partial = (this.partial + rest).slice(0, ANCHOR_LINE_CHARS);
		this.partialBytes += utf8Bytes(rest);
	}

	finish(): DiagnosticAnchor | undefined {
		if (this.partialBytes > 0) this.line(this.partial, this.partialBytes);
		this.partial = "";
		this.partialBytes = 0;
		if (this.v3 && this.last === undefined && this.warnLast !== undefined) {
			this.first = this.warnFirst;
			this.last = this.warnLast;
		}
		const winner =
			this.last ?? (this.errorMatched ? undefined : this.summary) ?? (this.v3 ? this.fallback : undefined);
		if (winner === undefined) return undefined;
		const firstPending = this.first ?? (this.v3 ? this.fallback : undefined);
		const toWindow = (pending: Pending): DiagnosticWindow => ({
			line: pending.line,
			pattern: pending.pattern,
			startLine: pending.startLine,
			skippedBytes: pending.skippedBytes,
			lines: [...pending.lines],
		});
		const first = firstPending ? toWindow(firstPending) : undefined;
		let last: DiagnosticWindow = toWindow(winner);
		// The last candidate inside window 1 (or no distinct last candidate) -> window 2 = tail.
		if (first && (winner === firstPending || winner.line < first.startLine + this.keptLines(first))) {
			last = this.tailWindow();
		}
		return {
			...(first ? { first } : {}),
			last,
			head: { pattern: "head", startLine: 1, skippedBytes: 0, lines: [...this.headLines] },
			totalLines: this.lineNo,
			totalBytes: this.offset,
			...(this.v3 ? { v3: true as const } : {}),
			pattern: first?.pattern ?? winner.pattern,
		};
	}

	/** Lines of `window` that fit window 1's share. */
	private keptLines(window: DiagnosticWindow): number {
		const fit = fitWindow1(window);
		if (this.v3) dropCutLine(fit);
		return fit.count;
	}

	private tailWindow(): DiagnosticWindow {
		const lines: Line[] = [];
		let bytes = 0;
		for (let i = this.tailLines.length - 1; i >= 0; i--) {
			const size = utf8Bytes(this.tailLines[i].text) + 1;
			if (lines.length > 0 && bytes + size > GOAL_DIAGNOSTIC_WINDOW2_BYTES) break;
			lines.unshift(this.tailLines[i]);
			bytes += size;
		}
		const start = lines[0] ?? { no: this.lineNo + 1, offset: this.offset, text: "" };
		return { pattern: "tail", startLine: start.no, skippedBytes: start.offset, lines: lines.map((l) => l.text) };
	}

	private line(text: string, bytes: number): void {
		this.lineNo++;
		const current: Line = { no: this.lineNo, text, offset: this.offset };
		this.offset += bytes + 1;
		if (this.headLines.length < GOAL_DIAGNOSTIC_WINDOW1_LINES && this.headBytes < GOAL_DIAGNOSTIC_WINDOW1_BYTES) {
			this.headLines.push(text);
			this.headBytes += bytes + 1;
		}
		this.tailLines.push(current);
		if (this.tailLines.length > GOAL_DIAGNOSTIC_WINDOW2_LINES) this.tailLines.shift();

		for (const pending of new Set([
			this.first,
			this.last,
			this.summary,
			this.warnFirst,
			this.warnLast,
			this.fallback,
		])) {
			if (pending && pending.line !== current.no) this.extend(pending, text);
		}
		const candidate = this.v3 ? undefined : this.candidate(text);
		if (this.v3) {
			this.lineV3(current, text);
		} else if (candidate !== undefined) {
			const pending = this.open(candidate, current);
			if (this.first === undefined) this.first = pending;
			this.last = pending;
		} else if (!this.errorMatched) {
			const summary = matchSummaryLine(text);
			if (summary !== undefined && injectionRuleFor(text) === undefined && this.underRepeatCap(text)) {
				this.summary = this.open(summary, current);
			}
		}
		this.before.push(current);
		if (this.before.length > GOAL_DIAGNOSTIC_ANCHOR_CONTEXT_LINES) this.before.shift();
	}

	/** Spec 097 D1–D5 for one line. */
	private lineV3(current: Line, text: string): void {
		const { kind, pattern } = classifyV3Line(text);
		const rule = injectionRuleFor(text);
		if ((kind === "error" || kind === "shape") && rule === undefined && this.underRepeatCap(text)) {
			this.errorMatched = true;
			const pending = this.open(pattern, current);
			if (this.first === undefined) this.first = pending;
			this.last = pending;
		} else if (kind === "warning" && (rule === undefined || rule === "R1-log-level") && this.underRepeatCap(text)) {
			const pending = this.open(pattern, current);
			if (this.warnFirst === undefined) this.warnFirst = pending;
			this.warnLast = pending;
		} else if (kind === "none" && pattern !== "d3-success" && !this.errorMatched) {
			const summary = matchSummaryLine(text);
			if (summary !== undefined && rule === undefined && this.underRepeatCap(text)) {
				this.summary = this.open(summary, current);
			}
		}
		if (this.fallback === undefined && kind !== "skip" && text.trim() !== "") {
			this.fallback = this.open("d4-fallback", current, []);
		}
	}

	/** Error pattern + success exclusions + R1–R4. */
	private candidate(text: string): string | undefined {
		const pattern = matchErrorLine(text);
		if (pattern === undefined || injectionRuleFor(text) !== undefined) return undefined;
		if (!this.underRepeatCap(text)) return undefined;
		this.errorMatched = true;
		return pattern;
	}

	private underRepeatCap(text: string): boolean {
		const key = repeatKey(text);
		const count = this.seen.get(key) ?? 0;
		if (count >= GOAL_DIAGNOSTIC_REPEAT_CAP) return false;
		if (count > 0 || this.seen.size < REPEAT_MEMORY) this.seen.set(key, count + 1);
		return true;
	}

	private open(pattern: string, current: Line, context: readonly Line[] = this.before): Pending {
		const startLine = context[0]?.no ?? current.no;
		const skippedBytes = context[0]?.offset ?? current.offset;
		const pending: Pending = { line: current.no, pattern, startLine, skippedBytes, lines: [], bytes: 0 };
		for (const kept of context) this.extend(pending, kept.text);
		// The anchor line is always kept, even when long context filled the window.
		pending.lines.push(current.text);
		pending.bytes += utf8Bytes(current.text) + 1;
		return pending;
	}

	private extend(pending: Pending, text: string): void {
		if (pending.lines.length >= GOAL_DIAGNOSTIC_WINDOW1_LINES || pending.bytes >= GOAL_DIAGNOSTIC_WINDOW1_BYTES)
			return;
		pending.lines.push(text);
		pending.bytes += utf8Bytes(text) + 1;
	}
}
