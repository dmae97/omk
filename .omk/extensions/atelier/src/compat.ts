import { stripVTControlCharacters } from "node:util";
import { sliceByColumn, truncateToWidth } from "omk-tui";
import type { ExtensionContext } from "open-multi-agent-kit";

export const DEFAULT_ATELIER_KEYBINDINGS = { sidebarToggle: "ctrl+shift+q" } as const;

// Older installed OMK hosts lack this named export. APC includes the editor cursor marker.
export const stripTerminalSequences = (text: string): string =>
	stripVTControlCharacters(text.replace(/\u001b_[\s\S]*?(?:\u0007|\u001b\\)/g, ""));

export function isAtelierProjectTrusted(ctx: ExtensionContext): boolean {
	return "isProjectTrusted" in ctx && typeof ctx.isProjectTrusted === "function" && ctx.isProjectTrusted() === true;
}

export function compositeTuiLine(base: string, overlay: string, column: number, width: number, total: number): string {
	const reset = "\u001b[0m\u001b]8;;\u0007";
	return truncateToWidth(
		truncateToWidth(sliceByColumn(base, 0, column, true), column, "", true) +
			reset +
			truncateToWidth(overlay, width, "", true) +
			reset +
			sliceByColumn(base, column + width, total - column - width, true),
		total,
		"",
	);
}
