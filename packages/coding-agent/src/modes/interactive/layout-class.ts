/**
 * Terminal layout classes from the TUI redesign doc: XS (<80 columns), SM (80-119), MD (120-159) and LG (>=160).
 * The startup deck and control pane use MD/LG; an explicitly pinned status sidebar fits at 108 columns.
 */

export type LayoutClass = "xs" | "sm" | "md" | "lg";

export const LAYOUT_BREAKPOINTS = { sm: 80, md: 120, lg: 160 } as const;

/** Minimum terminal rows for any right rail (pinned sidebar or control-pane overlay). */
export const RAIL_MIN_ROWS = 16;
export const PINNED_RAIL_MIN_COLUMNS = 108;

/** Non-finite or narrower-than-SM widths fail closed to "xs". */
export function classifyLayout(columns: number): LayoutClass {
	if (!Number.isFinite(columns) || columns < LAYOUT_BREAKPOINTS.sm) return "xs";
	if (columns < LAYOUT_BREAKPOINTS.md) return "sm";
	if (columns < LAYOUT_BREAKPOINTS.lg) return "md";
	return "lg";
}

export function isRailLayout(layout: LayoutClass): boolean {
	return layout === "md" || layout === "lg";
}

/** The single rail gate used by the deck, the control-pane overlay, and the pinned sidebar. */
export function railFits(columns: number, rows?: number, minColumns: number = LAYOUT_BREAKPOINTS.md): boolean {
	if (!Number.isFinite(columns) || columns < minColumns) return false;
	return rows === undefined || (Number.isFinite(rows) && rows >= RAIL_MIN_ROWS);
}

/** Status line for pinning the sidebar on a terminal too small to show it; undefined when the rail fits. */
export function railVisibility(pinned: boolean, customFooter: boolean, tmux: boolean, width: number, height: number) {
	if (tmux) return "tmux-owner";
	if (customFooter) return "custom-footer";
	if (!pinned) return "unpinned";
	return railFits(width, height, PINNED_RAIL_MIN_COLUMNS) ? "visible" : "terminal-too-small";
}
export function pinnedRailNotice(columns: number, rows: number): string | undefined {
	if (railFits(columns, rows, PINNED_RAIL_MIN_COLUMNS)) return undefined;
	return `Status sidebar pinned; it shows at ${PINNED_RAIL_MIN_COLUMNS}+ columns and ${RAIL_MIN_ROWS}+ rows.`;
}
