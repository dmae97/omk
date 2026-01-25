/**
 * Bordered output container with optional header and sections.
 */
import { visibleWidth } from "@oh-my-pi/pi-tui";
import type { Theme } from "../modes/theme/theme";
import type { State } from "./types";
import { getStateBgColor, padToWidth, truncateToWidth } from "./utils";

export interface OutputBlockOptions {
	header?: string;
	headerMeta?: string;
	state?: State;
	sections?: Array<{ label?: string; lines: string[] }>;
	width: number;
	applyBg?: boolean;
}

export function renderOutputBlock(options: OutputBlockOptions, theme: Theme): string[] {
	const { header, headerMeta, state, sections = [], width, applyBg = true } = options;
	const h = theme.boxSharp.horizontal;
	const v = theme.boxSharp.vertical;
	const cap = h.repeat(3);
	const lineWidth = Math.max(0, width);
	// Border colors: running/pending use accent, success uses dim (gray), error/warning keep their colors
	const borderColor: "error" | "warning" | "accent" | "dim" =
		state === "error"
			? "error"
			: state === "warning"
				? "warning"
				: state === "running" || state === "pending"
					? "accent"
					: "dim";
	const border = (text: string) => theme.fg(borderColor, text);
	const bgFn = state && applyBg ? (text: string) => theme.bg(getStateBgColor(state), text) : undefined;

	const buildBarLine = (leftChar: string, rightChar: string, label?: string, meta?: string): string => {
		const left = border(`${leftChar}${cap}`);
		const right = border(rightChar);
		if (lineWidth <= 0) return left + right;
		const labelText = [label, meta].filter(Boolean).join(theme.sep.dot);
		const rawLabel = labelText ? ` ${labelText} ` : " ";
		const leftWidth = visibleWidth(left);
		const rightWidth = visibleWidth(right);
		const maxLabelWidth = Math.max(0, lineWidth - leftWidth - rightWidth);
		const trimmedLabel = truncateToWidth(rawLabel, maxLabelWidth, theme.format.ellipsis);
		const labelWidth = visibleWidth(trimmedLabel);
		const fillCount = Math.max(0, lineWidth - leftWidth - labelWidth - rightWidth);
		return `${left}${trimmedLabel}${border(h.repeat(fillCount))}${right}`;
	};

	const contentPrefix = border(`${v} `);
	const contentSuffix = border(v);
	const contentWidth = Math.max(0, lineWidth - visibleWidth(contentPrefix) - visibleWidth(contentSuffix));
	const lines: string[] = [];

	lines.push(
		padToWidth(buildBarLine(theme.boxSharp.topLeft, theme.boxSharp.topRight, header, headerMeta), lineWidth, bgFn),
	);

	const hasSections = sections.length > 0;
	const normalizedSections = hasSections ? sections : [{ lines: [] }];

	for (let i = 0; i < normalizedSections.length; i++) {
		const section = normalizedSections[i];
		if (section.label) {
			lines.push(
				padToWidth(buildBarLine(theme.boxSharp.teeRight, theme.boxSharp.teeLeft, section.label), lineWidth, bgFn),
			);
		}
		for (const line of section.lines) {
			const text = truncateToWidth(line, contentWidth, theme.format.ellipsis);
			const innerPadding = " ".repeat(Math.max(0, contentWidth - visibleWidth(text)));
			const fullLine = `${contentPrefix}${text}${innerPadding}${contentSuffix}`;
			lines.push(padToWidth(fullLine, lineWidth, bgFn));
		}
	}

	const bottomLeft = border(`${theme.boxSharp.bottomLeft}${cap}`);
	const bottomRight = border(theme.boxSharp.bottomRight);
	const bottomFillCount = Math.max(0, lineWidth - visibleWidth(bottomLeft) - visibleWidth(bottomRight));
	const bottomLine = `${bottomLeft}${border(h.repeat(bottomFillCount))}${bottomRight}`;
	lines.push(padToWidth(bottomLine, lineWidth, bgFn));

	return lines;
}
