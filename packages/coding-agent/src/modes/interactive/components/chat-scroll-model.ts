import { truncateToWidth, visibleWidth } from "omk-tui";
import { theme } from "../theme/theme.ts";
import { renderHairlineRule } from "./paper-hairline.ts";

export type ChatScrollState = { readonly kind: "tail" } | { readonly kind: "scrolled"; readonly anchorEndLine: number };

export interface ChatScrollSlice {
	readonly visibleLines: readonly string[];
	readonly startLine: number;
	readonly endLine: number;
	readonly totalLines: number;
	readonly linesBelow: number;
}

export function reduceChatScrollState(
	state: ChatScrollState,
	deltaLines: number,
	totalLines: number,
	viewportRows: number,
): ChatScrollState {
	if (viewportRows < 2 || totalLines <= viewportRows) return { kind: "tail" };
	const contentRows = Math.max(1, viewportRows - 1);
	if (state.kind === "tail") {
		if (deltaLines >= 0) return state;
		return {
			kind: "scrolled",
			anchorEndLine: Math.max(contentRows, Math.min(totalLines - 1, totalLines + deltaLines)),
		};
	}
	if (state.anchorEndLine >= totalLines && deltaLines >= 0) return { kind: "tail" };
	const base = Math.max(contentRows, Math.min(totalLines - 1, state.anchorEndLine));
	const rawNext = base + deltaLines;
	if (rawNext >= totalLines) return { kind: "tail" };
	return { kind: "scrolled", anchorEndLine: Math.max(contentRows, Math.min(totalLines - 1, rawNext)) };
}

export function resolveChatScrollSlice(
	state: ChatScrollState,
	lines: readonly string[],
	viewportRows: number,
): ChatScrollSlice | null {
	if (
		state.kind === "tail" ||
		viewportRows < 2 ||
		lines.length <= viewportRows ||
		state.anchorEndLine >= lines.length
	) {
		return null;
	}
	const contentRows = Math.max(1, viewportRows - 1);
	const end = Math.max(contentRows, Math.min(lines.length - 1, state.anchorEndLine));
	const start = Math.max(0, end - contentRows);
	return {
		visibleLines: lines.slice(start, end),
		startLine: start + 1,
		endLine: end,
		totalLines: lines.length,
		linesBelow: lines.length - end,
	};
}

export function renderChatScrollOverlayRows(
	slice: ChatScrollSlice,
	leftGutter: number,
	contentWidth: number,
): string[] {
	const pad = leftGutter > 0 ? " ".repeat(leftGutter) : "";
	const rows = slice.visibleLines.map((line) => {
		const fitted =
			contentWidth <= 0 ? "" : visibleWidth(line) <= contentWidth ? line : truncateToWidth(line, contentWidth, "");
		return `${pad}${fitted}`;
	});
	const left = `${theme.fg("accent", "↑")} ${theme.fg("muted", `HISTORY · L${slice.startLine}–${slice.endLine}/${slice.totalLines}`)}`;
	const right = `${theme.fg("dim", `↓ ${slice.linesBelow} below · `)}${theme.fg("accent", "[Latest ▾]")}`;
	rows.push(`${pad}${renderHairlineRule(contentWidth, "─", "─", left, right)}`);
	return rows;
}
