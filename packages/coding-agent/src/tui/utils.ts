/**
 * Shared helpers for tool-rendered UI components.
 */

import { truncateToWidth as truncateToWidthBase, visibleWidth } from "@oh-my-pi/pi-tui";
import type { Theme, ThemeBg } from "$c/modes/theme/theme";
import type { IconType, State } from "./types";

export function buildTreePrefix(ancestors: boolean[], theme: Theme): string {
	return ancestors.map((hasNext) => (hasNext ? `${theme.tree.vertical}  ` : "   ")).join("");
}

export function getTreeBranch(isLast: boolean, theme: Theme): string {
	return isLast ? theme.tree.last : theme.tree.branch;
}

export function getTreeContinuePrefix(isLast: boolean, theme: Theme): string {
	return isLast ? "   " : `${theme.tree.vertical}  `;
}

export function truncateToWidth(text: string, width: number, ellipsis: string): string {
	return truncateToWidthBase(text, width, ellipsis);
}

export function padToWidth(text: string, width: number, bgFn?: (s: string) => string): string {
	if (width <= 0) return bgFn ? bgFn(text) : text;
	const paddingNeeded = Math.max(0, width - visibleWidth(text));
	const padded = paddingNeeded > 0 ? text + " ".repeat(paddingNeeded) : text;
	return bgFn ? bgFn(padded) : padded;
}

export function getStateBgColor(state: State): ThemeBg {
	if (state === "success") return "toolSuccessBg";
	if (state === "error") return "toolErrorBg";
	return "toolPendingBg";
}

export function getStateIcon(icon: IconType, theme: Theme, spinnerFrame?: number): string {
	if (icon === "success") return theme.styledSymbol("status.success", "success");
	if (icon === "error") return theme.styledSymbol("status.error", "error");
	if (icon === "warning") return theme.styledSymbol("status.warning", "warning");
	if (icon === "info") return theme.styledSymbol("status.info", "accent");
	if (icon === "pending") return theme.styledSymbol("status.pending", "muted");
	if (spinnerFrame !== undefined) {
		const frames = theme.spinnerFrames;
		return frames[spinnerFrame % frames.length];
	}
	return theme.styledSymbol("status.running", "accent");
}
