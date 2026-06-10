export interface CockpitRect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface CockpitLayout {
	width: number;
	height: number;
	mainWidth: number;
	transcript: CockpitRect;
	composer: CockpitRect;
	working: CockpitRect;
	footer: CockpitRect;
	rightRail: CockpitRect;
}

export type WheelTarget = "leftTranscript" | "rightRail" | "none";
export type TranscriptPagingKey = "pageUp" | "pageDown" | "home" | "end";

export interface CockpitScrollStateSnapshot {
	leftScrollFromBottom: number;
	leftTranscriptLineCount: number;
	leftTranscriptHeight: number;
	followTail: boolean;
	currentLayout?: CockpitLayout;
}

export interface CockpitInputHandlingResult {
	consumed: boolean;
	kind: "wheel" | "paging";
	target: WheelTarget;
	nextScrollFromBottom: number;
	followTail: boolean;
	pagingKey?: TranscriptPagingKey;
	wheel?: ParsedSgrWheelEvent;
}

export interface ParsedSgrWheelEvent {
	direction: "up" | "down";
	x: number;
	y: number;
	button: number;
	raw: string;
}

export function parseSgrWheelEvent(input: string): ParsedSgrWheelEvent | null {
	const match = /^\x1b\[<(\d+);(\d+);(\d+)M$/.exec(input);
	if (!match) return null;
	const button = Number.parseInt(match[1] ?? "", 10);
	const x = Number.parseInt(match[2] ?? "", 10);
	const y = Number.parseInt(match[3] ?? "", 10);
	if (!Number.isFinite(button) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
	if ((button & 64) === 0) return null;
	return {
		direction: (button & 1) === 1 ? "down" : "up",
		x,
		y,
		button,
		raw: input,
	};
}

export function parseTranscriptPagingKey(input: string): TranscriptPagingKey | null {
	switch (input) {
		case "\x1b[5~":
		case "\x1b[[5~":
			return "pageUp";
		case "\x1b[6~":
		case "\x1b[[6~":
			return "pageDown";
		case "\x1b[H":
		case "\x1b[1~":
		case "\x1bOH":
			return "home";
		case "\x1b[F":
		case "\x1b[4~":
		case "\x1bOF":
			return "end";
		default:
			return null;
	}
}

export function maxScrollFromBottom(lineCount: number, viewportHeight: number): number {
	return Math.max(0, lineCount - Math.max(0, viewportHeight));
}

export function clampScrollFromBottom(scrollFromBottom: number, lineCount: number, viewportHeight: number): number {
	const maxScroll = maxScrollFromBottom(lineCount, viewportHeight);
	return Math.max(0, Math.min(Math.max(0, Math.floor(scrollFromBottom)), maxScroll));
}

export function sliceFromBottom(lines: string[], viewportHeight: number, scrollFromBottom: number): string[] {
	const safeHeight = Math.max(0, Math.floor(viewportHeight));
	if (safeHeight <= 0) return [];
	const clampedScroll = clampScrollFromBottom(scrollFromBottom, lines.length, safeHeight);
	const end = Math.max(0, lines.length - clampedScroll);
	const start = Math.max(0, end - safeHeight);
	return lines.slice(start, end);
}

export function buildTranscriptViewportLines(
	lines: string[],
	viewportHeight: number,
	scrollFromBottom: number,
): string[] {
	const safeHeight = Math.max(0, Math.floor(viewportHeight));
	if (safeHeight <= 0) return [];
	const visible = sliceFromBottom(lines, safeHeight, scrollFromBottom);
	return [...Array.from({ length: Math.max(0, safeHeight - visible.length) }, () => ""), ...visible];
}

export function routeWheelTarget(layout: CockpitLayout | undefined, x: number, y: number): WheelTarget {
	if (!layout) return "none";
	if (pointInRect(layout.rightRail, x, y)) return "rightRail";
	if (
		pointInRect(layout.transcript, x, y) ||
		pointInRect(layout.composer, x, y) ||
		pointInRect(layout.working, x, y)
	) {
		return "leftTranscript";
	}
	if (x >= 1 && x <= layout.mainWidth) return "leftTranscript";
	return "none";
}

export function consumeCockpitScrollInput(
	input: string,
	state: CockpitScrollStateSnapshot,
): CockpitInputHandlingResult | null {
	const wheel = parseSgrWheelEvent(input);
	if (wheel) {
		const target = routeWheelTarget(state.currentLayout, wheel.x, wheel.y);
		const nextScrollFromBottom =
			target === "leftTranscript"
				? adjustScrollForWheel(
						state.leftScrollFromBottom,
						wheel.direction,
						state.leftTranscriptLineCount,
						state.leftTranscriptHeight,
					)
				: state.leftScrollFromBottom;
		return {
			consumed: true,
			kind: "wheel",
			target,
			nextScrollFromBottom,
			followTail: nextScrollFromBottom === 0,
			wheel,
		};
	}

	const pagingKey = parseTranscriptPagingKey(input);
	if (!pagingKey) return null;
	const nextScrollFromBottom = adjustScrollForPaging(
		state.leftScrollFromBottom,
		pagingKey,
		state.leftTranscriptLineCount,
		state.leftTranscriptHeight,
	);
	return {
		consumed: true,
		kind: "paging",
		target: "leftTranscript",
		nextScrollFromBottom,
		followTail: nextScrollFromBottom === 0,
		pagingKey,
	};
}

export function adjustScrollForWheel(
	scrollFromBottom: number,
	direction: "up" | "down",
	lineCount: number,
	viewportHeight: number,
	step = 3,
): number {
	const delta = direction === "up" ? step : -step;
	return clampScrollFromBottom(scrollFromBottom + delta, lineCount, viewportHeight);
}

export function adjustScrollForPaging(
	scrollFromBottom: number,
	key: TranscriptPagingKey,
	lineCount: number,
	viewportHeight: number,
): number {
	switch (key) {
		case "pageUp":
			return clampScrollFromBottom(scrollFromBottom + Math.max(1, viewportHeight - 1), lineCount, viewportHeight);
		case "pageDown":
			return clampScrollFromBottom(scrollFromBottom - Math.max(1, viewportHeight - 1), lineCount, viewportHeight);
		case "home":
			return maxScrollFromBottom(lineCount, viewportHeight);
		case "end":
			return 0;
	}
}

export function debugInputHex(input: string): string {
	return Buffer.from(input, "utf8").toString("hex");
}

export function debugInputEscaped(input: string): string {
	return input.replace(/\x1b/g, "\\x1b").replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g, "\\t");
}

function pointInRect(rect: CockpitRect, x: number, y: number): boolean {
	if (rect.w <= 0 || rect.h <= 0) return false;
	return x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
}
