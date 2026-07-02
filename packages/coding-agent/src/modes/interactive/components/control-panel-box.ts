import { truncateToWidth, visibleWidth } from "omk-tui";
import { type ThemeColor, theme } from "../theme/theme.ts";

export function composeColumns(
	leftLines: string[],
	leftWidth: number,
	rightLines: string[],
	rightWidth: number,
	gapWidth: number,
	width: number,
): string[] {
	return Array.from({ length: Math.max(leftLines.length, rightLines.length) }, (_, index) =>
		clipLine(
			`${fitLine(leftLines[index] ?? "", leftWidth)}${" ".repeat(gapWidth)}${fitLine(rightLines[index] ?? "", rightWidth)}`,
			width,
		),
	);
}

export function sidebarRule(width: number, label: string, borderColor: ThemeColor = "borderAccent"): string {
	const bodyWidth = Math.max(0, width - 2);
	const labelText = ` ${label} `;
	const fill = Math.max(0, bodyWidth - visibleWidth(labelText));
	const left = Math.floor(fill / 2);
	const right = fill - left;
	return clipLine(
		`${theme.fg(borderColor, "\u2502")}${theme.fg("borderMuted", "\u2500".repeat(left))}${theme.bold(theme.fg("accent", labelText))}${theme.fg("borderMuted", "\u2500".repeat(right))}${theme.fg(borderColor, "\u2502")}`,
		width,
	);
}

export function boxTop(width: number, label: string, borderColor: ThemeColor = "borderAccent"): string {
	const text = ` ${label} `;
	const fillWidth = Math.max(0, width - visibleWidth("+") - visibleWidth(text) - visibleWidth("+"));
	return clipLine(
		`${theme.fg(borderColor, "\u256d")}${theme.bold(theme.fg("accent", text))}${theme.fg(borderColor, "\u2500".repeat(fillWidth))}${theme.fg(borderColor, "\u256e")}`,
		width,
	);
}

export function boxBottom(width: number, borderColor: ThemeColor = "borderAccent"): string {
	return clipLine(theme.fg(borderColor, `\u2570${"\u2500".repeat(Math.max(0, width - 2))}\u256f`), width);
}

export function boxBlankLine(width: number): string {
	return boxTextLine(width, "");
}

export function boxCenteredLine(width: number, text: string, color?: ThemeColor): string {
	return boxTextLine(width, centerText(Math.max(0, width - 4), color ? theme.fg(color, text) : text));
}

export function boxTextLine(width: number, text: string, color?: ThemeColor): string {
	const body = color ? theme.fg(color, text) : text;
	return clipLine(
		`${theme.fg("borderAccent", "\u2502 ")}${fitLine(body, Math.max(0, width - 4))}${theme.fg("borderAccent", " \u2502")}`,
		width,
	);
}

export function centerLine(width: number, text: string, color?: ThemeColor): string {
	return clipLine(centerText(width, color ? theme.fg(color, text) : text), width);
}

export function centerText(width: number, text: string): string {
	const fitted = truncateToWidth(text, width, "");
	const remaining = Math.max(0, width - visibleWidth(fitted));
	return `${" ".repeat(Math.floor(remaining / 2))}${fitted}${" ".repeat(Math.ceil(remaining / 2))}`;
}

export function divider(width: number, label: string, color: ThemeColor): string {
	const fillWidth = Math.max(0, width - visibleWidth("+-- ") - visibleWidth(label) - visibleWidth(" +"));
	return clipLine(
		`${theme.fg("border", "+-- ")}${theme.bold(theme.fg(color, label))}${theme.fg("border", ` ${"-".repeat(fillWidth)}+`)}`,
		width,
	);
}

export function textLine(width: number, text: string, color?: ThemeColor): string {
	const body = color ? theme.fg(color, text) : text;
	return clipLine(
		`${theme.fg("borderMuted", "\u2502 ")}${fitLine(body, Math.max(0, width - 4))}${theme.fg("borderMuted", " \u2502")}`,
		width,
	);
}

export function fitLine(line: string, width: number): string {
	const clipped = truncateToWidth(line, width, "");
	return `${clipped}${" ".repeat(Math.max(0, width - visibleWidth(clipped)))}`;
}

export function clipLine(line: string, width: number): string {
	return visibleWidth(line) <= width ? line : truncateToWidth(line, width, "");
}
