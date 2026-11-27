import { extractSegments, sliceByColumn, sliceWithWidth, stripTerminalSequences, visibleWidth } from "omk-tui";

export interface ScreenCell {
	readonly col: number; // 1-based terminal column
	readonly row: number; // 1-based terminal row
}

export interface SelectionPaneBounds {
	readonly minCol: number; // 1-based inclusive left column
	readonly maxCol: number; // 1-based inclusive right column
}

export type TuiDragSelectionState =
	| { readonly kind: "idle" }
	| {
			readonly kind: "dragging";
			readonly anchor: ScreenCell;
			readonly focus: ScreenCell;
			readonly moved: boolean;
			readonly pane: SelectionPaneBounds;
			readonly termWidth: number;
			readonly termHeight: number;
	  }
	| {
			readonly kind: "selected";
			readonly start: ScreenCell;
			readonly end: ScreenCell;
			readonly pane: SelectionPaneBounds;
			readonly termWidth: number;
			readonly termHeight: number;
	  };

export function clampCell(n: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, n));
}

function isImageLine(line: string): boolean {
	return line.includes("\x1b_G") || line.includes("\x1b]1337;File=");
}

export function resolveSelectionPane(
	anchorCol: number,
	leftGutter: number,
	contentWidth: number,
	termWidth: number,
): SelectionPaneBounds {
	const safeWidth = Math.max(1, termWidth);
	const mainStart = clampCell(leftGutter + 1, 1, safeWidth);
	const mainEnd = clampCell(leftGutter + Math.max(1, contentWidth), mainStart, safeWidth);
	if (anchorCol >= mainStart && anchorCol <= mainEnd) return { minCol: mainStart, maxCol: mainEnd };
	if (leftGutter > 0 && anchorCol < mainStart) return { minCol: 1, maxCol: Math.min(leftGutter, safeWidth) };
	if (mainEnd < safeWidth && anchorCol > mainEnd) return { minCol: mainEnd + 1, maxCol: safeWidth };
	return { minCol: 1, maxCol: safeWidth };
}

export function normalizeSelectionRange(a: ScreenCell, b: ScreenCell): { start: ScreenCell; end: ScreenCell } {
	if (a.row < b.row || (a.row === b.row && a.col <= b.col)) return { start: a, end: b };
	return { start: b, end: a };
}

function rowColumnSpan(
	row: number,
	start: ScreenCell,
	end: ScreenCell,
	pane: SelectionPaneBounds,
): { col0: number; len: number } | null {
	if (row < start.row || row > end.row) return null;
	const c1 = row === start.row ? clampCell(start.col, pane.minCol, pane.maxCol) : pane.minCol;
	const c2 = row === end.row ? clampCell(end.col, pane.minCol, pane.maxCol) : pane.maxCol;
	const lo = Math.min(c1, c2);
	const hi = Math.max(c1, c2);
	return { col0: lo - 1, len: hi - lo + 1 };
}

export function extractSelectedText(
	viewportLines: readonly string[],
	start: ScreenCell,
	end: ScreenCell,
	pane: SelectionPaneBounds,
): string {
	const out: string[] = [];
	for (let row = start.row; row <= end.row; row++) {
		const rawLine = viewportLines[row - 1];
		if (rawLine === undefined || isImageLine(rawLine)) {
			out.push("");
			continue;
		}
		const span = rowColumnSpan(row, start, end, pane);
		if (!span) continue;
		const before = sliceWithWidth(rawLine, 0, span.col0, true);
		const selStart = before.width;
		const selLen = Math.max(0, span.col0 + span.len - selStart);
		const selected = sliceWithWidth(rawLine, selStart, selLen, false);
		out.push(stripTerminalSequences(selected.text).replace(/[ \t]+$/g, ""));
	}
	return out.join("\n");
}

export function applySelectionHighlight(
	viewportLines: readonly string[],
	start: ScreenCell,
	end: ScreenCell,
	pane: SelectionPaneBounds,
	termWidth: number,
): string[] {
	return viewportLines.map((line, idx) => {
		const row = idx + 1;
		const span = rowColumnSpan(row, start, end, pane);
		if (!span || isImageLine(line)) return line;
		const before = sliceWithWidth(line, 0, span.col0, true);
		const selStart = before.width;
		const selLen = Math.max(0, span.col0 + span.len - selStart);
		const selected = sliceWithWidth(line, selStart, selLen, false);
		if (selected.width <= 0) return line;
		const afterStart = selStart + selected.width;
		const seg = extractSegments(line, selStart, afterStart, Math.max(0, termWidth - afterStart), true);
		const padBefore = " ".repeat(Math.max(0, selStart - seg.beforeWidth));
		const plainSel = stripTerminalSequences(selected.text);
		const highlighted = `${seg.before}${padBefore}\x1b[0m\x1b[7m${plainSel}\x1b[0m${seg.after}`;
		return visibleWidth(highlighted) <= termWidth ? highlighted : sliceByColumn(highlighted, 0, termWidth, true);
	});
}
