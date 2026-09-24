import { truncateToWidth, visibleWidth } from "omk-tui";
import { singleLineDisplayText } from "../../../utils/display-text.ts";
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

/**
 * Section rule for the control rail.
 *
 * Editorial treatment: the label sits flush left behind a single hairline tick
 * and the rule runs out to the right edge, instead of a centered bold caption.
 * Labels are secondary ink like a figure caption; the accent is reserved for signals.
 */
export function sidebarRule(width: number, label: string, borderColor: ThemeColor = "borderMuted"): string {
	const bodyWidth = Math.max(0, width - 2);
	const labelText = ` ${label} `;
	const fill = Math.max(0, bodyWidth - visibleWidth(labelText) - 1);
	return clipLine(
		`${theme.fg(borderColor, "\u2502")}${theme.fg("borderMuted", "\u2500")}${theme.fg("muted", labelText)}${theme.fg("borderMuted", "\u2500".repeat(fill))}${theme.fg(borderColor, "\u2502")}`,
		width,
	);
}

/** Width of the right-aligned label gutter shared by every control-rail row. */
export const RAIL_LABEL_COLUMN = 8;

/**
 * Right-aligned `label:` gutter cell.
 *
 * Labels are right-aligned so every value starts on the same column while the
 * rendered text keeps exactly one space after the colon (`git: main`,
 * `state: ● running`), which the header and rail row assertions depend on.
 */
export function labelCell(label: string, column: number = RAIL_LABEL_COLUMN): string {
	const text = `${label}:`;
	const pad = Math.max(0, column + 1 - visibleWidth(text));
	return `${" ".repeat(pad)}${theme.fg("muted", text)}`;
}

/**
 * `label: value` rail row that keeps the meaningful part of an over-long value:
 * `start` keeps the head (tail becomes `…`), `end` keeps the tail, `middle` keeps both ends.
 * The optional colour paints the fitted value only, so the label gutter stays muted.
 * The value is reduced to one printable line first: rows carry session, journal and file-system text.
 */
export function semanticBoxTextLine(
	width: number,
	label: string,
	value: string,
	preserve: "start" | "middle" | "end",
	column?: number,
	color?: ThemeColor,
): string {
	const text = singleLineDisplayText(value);
	// Alignment is a courtesy, not a cost: if the gutter indent would truncate the
	// value, this row drops back to a flush label so the data survives intact.
	const aligned = `${labelCell(label, column)} `;
	const flush = `${labelCell(label, label.length)} `;
	const alignedRoom = Math.max(0, width - 4 - visibleWidth(aligned));
	const prefix = visibleWidth(text) <= alignedRoom ? aligned : flush;
	const fitted = semanticTruncate(text, Math.max(0, width - 4 - visibleWidth(prefix)), preserve);
	return boxTextLine(width, `${prefix}${color ? theme.fg(color, fitted) : fitted}`);
}

function semanticTruncate(value: string, maxWidth: number, preserve: "start" | "middle" | "end"): string {
	if (visibleWidth(value) <= maxWidth) return value;
	if (maxWidth <= 0) return "";
	if (preserve === "start") return truncateToWidth(value, maxWidth, "…");
	const ellipsis = "…";
	const targetWidth = maxWidth - visibleWidth(ellipsis);
	if (targetWidth <= 0) return truncateToWidth(ellipsis, maxWidth, "");
	if (preserve === "middle") {
		const headWidth = Math.max(1, Math.floor(targetWidth / 2));
		const tailWidth = Math.max(1, targetWidth - headWidth);
		return `${takeStart(value, headWidth)}${ellipsis}${takeEnd(value, tailWidth)}`;
	}
	return `${ellipsis}${takeEnd(value, targetWidth)}`;
}

function takeStart(value: string, maxWidth: number): string {
	let prefix = "";
	for (const char of Array.from(value)) {
		if (visibleWidth(prefix + char) > maxWidth) break;
		prefix += char;
	}
	return prefix;
}

function takeEnd(value: string, maxWidth: number): string {
	let suffix = "";
	for (const char of Array.from(value).reverse()) {
		if (visibleWidth(char + suffix) > maxWidth) break;
		suffix = char + suffix;
	}
	return suffix;
}

/**
 * Square-cornered frame like a printed plate: the title is a caption in secondary ink, not the accent.
 */
export function boxTop(width: number, label: string, borderColor: ThemeColor = "borderMuted"): string {
	const text = ` ${label} `;
	const fillWidth = Math.max(0, width - visibleWidth("+") - visibleWidth(text) - visibleWidth("+"));
	return clipLine(
		`${theme.fg(borderColor, "\u250c")}${theme.fg("muted", text)}${theme.fg(borderColor, "\u2500".repeat(fillWidth))}${theme.fg(borderColor, "\u2510")}`,
		width,
	);
}

export function boxBottom(width: number, borderColor: ThemeColor = "borderMuted"): string {
	return clipLine(theme.fg(borderColor, `\u2514${"\u2500".repeat(Math.max(0, width - 2))}\u2518`), width);
}

export function boxBlankLine(width: number): string {
	return boxTextLine(width, "");
}

/** Hairline rule inside a framed panel, inset from both frame edges. */
export function boxRuleLine(width: number, inset = 0): string {
	const innerWidth = Math.max(0, width - 4);
	const ruleWidth = Math.max(0, innerWidth - inset * 2);
	return boxTextLine(width, `${" ".repeat(inset)}${theme.fg("borderMuted", "\u2500".repeat(ruleWidth))}`);
}

export function boxCenteredLine(width: number, text: string, color?: ThemeColor): string {
	return boxTextLine(width, centerText(Math.max(0, width - 4), color ? theme.fg(color, text) : text));
}

export function boxTextLine(width: number, text: string, color?: ThemeColor): string {
	const body = color ? theme.fg(color, text) : text;
	return clipLine(
		`${theme.fg("borderMuted", "\u2502 ")}${fitLine(body, Math.max(0, width - 4))}${theme.fg("borderMuted", " \u2502")}`,
		width,
	);
}

/**
 * Pad a framed column with blank body rows so two side-by-side panels close on
 * the same row. The leading and trailing frame lines are preserved.
 *
 * `"center"` splits the filler above and below the body, which turns leftover
 * height into deliberate negative space instead of a hollow bottom half.
 */
export function padBoxColumn(
	lines: string[],
	targetHeight: number,
	width: number,
	distribution: "bottom" | "center" = "bottom",
): string[] {
	if (lines.length === 0 || lines.length >= targetHeight) return lines;
	const top = lines[0] as string;
	const bottom = lines[lines.length - 1] as string;
	const body = lines.slice(1, -1);
	const missing = targetHeight - lines.length;
	const blank = () => boxTextLine(width, "");
	if (distribution === "bottom") {
		return [top, ...body, ...Array.from({ length: missing }, blank), bottom];
	}
	const above = Math.floor(missing / 2);
	return [
		top,
		...Array.from({ length: above }, blank),
		...body,
		...Array.from({ length: missing - above }, blank),
		bottom,
	];
}

export function centerLine(width: number, text: string, color?: ThemeColor): string {
	return clipLine(centerText(width, color ? theme.fg(color, text) : text), width);
}

export function centerText(width: number, text: string): string {
	const fitted = truncateToWidth(text, width, "");
	const remaining = Math.max(0, width - visibleWidth(fitted));
	return `${" ".repeat(Math.floor(remaining / 2))}${fitted}${" ".repeat(Math.ceil(remaining / 2))}`;
}

/**
 * Captioned plate rule for the single-column layouts: `┌─ LABEL ──┐` opens the frame, `├─ LABEL ──┤`
 * separates sections and `└──────┘` closes it (an empty label draws a plain rule).
 */
export function divider(
	width: number,
	label: string,
	color: ThemeColor,
	edge: "top" | "middle" | "bottom" = "middle",
): string {
	const [left, right] =
		edge === "top" ? ["\u250c", "\u2510"] : edge === "bottom" ? ["\u2514", "\u2518"] : ["\u251c", "\u2524"];
	const caption = label ? ` ${label} ` : "";
	const fillWidth = Math.max(0, width - 3 - visibleWidth(caption));
	return clipLine(
		`${theme.fg("borderMuted", `${left}\u2500`)}${caption ? theme.fg(color, caption) : ""}${theme.fg("borderMuted", `${"\u2500".repeat(fillWidth)}${right}`)}`,
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
