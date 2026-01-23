/**
 * Bordered output container with optional header and sections.
 */

import { visibleWidth } from "@oh-my-pi/pi-tui";
import type { Theme } from "$c/modes/theme/theme";
import type { State } from "./types";
import { getStateBgColor, padToWidth, truncateToWidth } from "./utils";

export interface OutputBlockOptions {
	header?: string;
	headerMeta?: string;
	state?: State;
	sections?: Array<{ label?: string; lines: string[] }>;
	width: number;
}

export function renderOutputBlock(options: OutputBlockOptions, theme: Theme): string[] {
	const { header, headerMeta, state, sections = [], width } = options;
	const h = theme.boxSharp.horizontal;
	const v = theme.boxSharp.vertical;
	const cap = h.repeat(3);
	const lineWidth = Math.max(0, width);
	const border = (text: string) => theme.fg("dim", text);
	const bgFn = state ? (text: string) => theme.bg(getStateBgColor(state), text) : undefined;

	const buildBarLine = (leftChar: string, label?: string, meta?: string): string => {
		const left = border(`${leftChar}${cap}`);
		if (lineWidth <= 0) return left;
		const labelText = [label, meta].filter(Boolean).join(theme.sep.dot);
		const rawLabel = labelText ? ` ${labelText} ` : " ";
		const maxLabelWidth = Math.max(0, lineWidth - visibleWidth(left));
		const trimmedLabel = truncateToWidth(rawLabel, maxLabelWidth, theme.format.ellipsis);
		const fillCount = Math.max(0, lineWidth - visibleWidth(left + trimmedLabel));
		return `${left}${trimmedLabel}${border(h.repeat(fillCount))}`;
	};

	const contentPrefix = border(`${v} `);
	const contentWidth = Math.max(0, lineWidth - visibleWidth(contentPrefix));
	const lines: string[] = [];

	lines.push(padToWidth(buildBarLine(theme.boxSharp.topLeft, header, headerMeta), lineWidth, bgFn));

	const hasSections = sections.length > 0;
	const normalizedSections = hasSections ? sections : [{ lines: [] }];

	for (let i = 0; i < normalizedSections.length; i++) {
		const section = normalizedSections[i];
		if (section.label) {
			lines.push(padToWidth(buildBarLine(theme.boxSharp.teeRight, section.label), lineWidth, bgFn));
		}
		for (const line of section.lines) {
			const text = truncateToWidth(line, contentWidth, theme.format.ellipsis);
			lines.push(padToWidth(`${contentPrefix}${text}`, lineWidth, bgFn));
		}
	}

	const bottomLeft = border(`${theme.boxSharp.bottomLeft}${cap}`);
	const bottomFillCount = Math.max(0, lineWidth - visibleWidth(bottomLeft));
	const bottomLine = `${bottomLeft}${border(h.repeat(bottomFillCount))}`;
	lines.push(padToWidth(bottomLine, lineWidth, bgFn));

	return lines;
}
