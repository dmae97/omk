/**
 * Terminal layout classes from the TUI redesign doc: XS (<80 columns), SM (80-119), MD (120-159) and LG (>=160).
 * Right rails are allowed only at MD/LG. The absolute numbers are provisional pending native visual QA, so this
 * module is their single owner: every rail gate must call `railFits` instead of comparing sizes itself.
 */

export type LayoutClass = "xs" | "sm" | "md" | "lg";

export const LAYOUT_BREAKPOINTS = { sm: 80, md: 120, lg: 160 } as const;

/** Minimum terminal rows for any right rail (pinned sidebar or control-pane overlay). */
export const RAIL_MIN_ROWS = 16;

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
export function railFits(columns: number, rows?: number): boolean {
	if (!isRailLayout(classifyLayout(columns))) return false;
	return rows === undefined || (Number.isFinite(rows) && rows >= RAIL_MIN_ROWS);
}

/** Status line for pinning the sidebar on a terminal too small to show it; undefined when the rail fits. */
export function pinnedRailNotice(columns: number, rows: number): string | undefined {
	if (railFits(columns, rows)) return undefined;
	return `Status sidebar pinned; it shows at ${LAYOUT_BREAKPOINTS.md}+ columns and ${RAIL_MIN_ROWS}+ rows.`;
}
