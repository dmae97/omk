/**
 * Standardized status header rendering for tool output.
 */

import type { Theme, ThemeColor } from "$c/modes/theme/theme";
import type { IconType } from "./types";
import { getStateIcon } from "./utils";

export interface StatusLineOptions {
	icon?: IconType;
	spinnerFrame?: number;
	title: string;
	titleColor?: ThemeColor;
	description?: string;
	badge?: { label: string; color: ThemeColor };
	meta?: string[];
}

export function renderStatusLine(options: StatusLineOptions, theme: Theme): string {
	const icon = options.icon ? getStateIcon(options.icon, theme, options.spinnerFrame) : "";
	const titleColor = options.titleColor ?? "accent";
	const title = theme.fg(titleColor, options.title);
	let line = icon ? `${icon} ${title}` : title;

	if (options.description) {
		line += `: ${theme.fg("muted", options.description)}`;
	}

	if (options.badge) {
		const { label, color } = options.badge;
		line += ` ${theme.fg(color, `${theme.format.bracketLeft}${label}${theme.format.bracketRight}`)}`;
	}

	const meta = options.meta?.filter((value) => value.trim().length > 0) ?? [];
	if (meta.length > 0) {
		line += ` ${theme.fg("dim", meta.join(theme.sep.dot))}`;
	}

	return line;
}
