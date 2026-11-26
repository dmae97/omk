import { truncateToWidth, visibleWidth } from "omk-tui";
import { theme } from "../theme/theme.ts";

export type ToolChromeState = "pending" | "success" | "error";

interface ToolChromeStyle {
	readonly glyph: string;
	readonly label: string;
	readonly color: "accent" | "success" | "error";
}

const TOOL_CHROME_STYLE: Readonly<Record<ToolChromeState, ToolChromeStyle>> = {
	pending: { glyph: "●", label: "RUN", color: "accent" },
	success: { glyph: "✓", label: "OK", color: "success" },
	error: { glyph: "!", label: "ERR", color: "error" },
};

export function renderHairlineRule(
	width: number,
	leftCorner: string,
	rightCorner: string,
	left: string,
	right = "",
): string {
	const inner = Math.max(0, width - 2);
	const dash = theme.fg("borderMuted", "─");
	const leftPart = left ? `${dash} ${left} ` : "";
	const rightPart = right ? ` ${right} ${dash}` : "";
	const lw = visibleWidth(leftPart);
	const rw = visibleWidth(rightPart);
	if (lw + rw <= inner) {
		const fill = theme.fg("borderMuted", "─".repeat(inner - lw - rw));
		return `${theme.fg("borderMuted", leftCorner)}${leftPart}${fill}${rightPart}${theme.fg("borderMuted", rightCorner)}`;
	}
	const clippedLeft = truncateToWidth(leftPart, inner, "");
	const pad = theme.fg("borderMuted", "─".repeat(Math.max(0, inner - visibleWidth(clippedLeft))));
	return `${theme.fg("borderMuted", leftCorner)}${clippedLeft}${pad}${theme.fg("borderMuted", rightCorner)}`;
}

export function renderToolTopRule(state: ToolChromeState, width: number): string {
	if (width <= 0) return "";
	const style = TOOL_CHROME_STYLE[state];
	const badge = `${theme.fg(style.color, style.glyph)} ${theme.fg("dim", style.label)}`;
	const prefix = `${theme.fg("borderMuted", "──")} ${badge} `;
	const prefixWidth = visibleWidth(prefix);
	if (prefixWidth >= width) {
		return truncateToWidth(prefix, width, "");
	}
	return `${prefix}${theme.fg("borderMuted", "─".repeat(width - prefixWidth))}`;
}

export function renderToolBottomRule(width: number): string {
	if (width <= 0) return "";
	return theme.fg("borderMuted", "─".repeat(width));
}

export function renderToolBlock(
	bodyLines: readonly string[],
	imageLines: readonly string[],
	state: ToolChromeState,
	width: number,
): string[] {
	if (bodyLines.length === 0 && imageLines.length === 0) return [];
	const lines: string[] = [];
	if (bodyLines.length > 0) {
		lines.push("", renderToolTopRule(state, width), ...bodyLines, renderToolBottomRule(width));
	}
	lines.push(...imageLines);
	return lines;
}
