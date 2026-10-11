/**
 * How far back a clearing repair repaint may reach, in viewport screens.
 * Bounds the scrollback churn of fixing rows that already scrolled off
 * (see the repaint budget note in TUI.doRender's fullRender helper). Shared
 * by the above-viewport repair and the height-resize resync below.
 */
export const REPAINT_BUDGET_SCREENS = 4;

/**
 * Rows to write, relative to the cursor, before a height-change repaint.
 *
 * The height-change repaint homes the cursor and rewrites only the last
 * `height` rows, which assumes the screen top is row `newLines.length - height`.
 * A resize does not guarantee that: xterm.js drops the rows below the cursor
 * (the editor footer) when the screen shrinks, and rows the stream appended
 * since the last frame shift the tail down. Either way the screen top sits
 * above the tail, and the repaint overwrote rows that never reached scrollback
 * (scrollback-20 main-r4 lost `value1_3`..`value1_6`).
 *
 * What a resize does keep is the cursor's row and the rows above it (the
 * terminal scrolls or pulls rows around the cursor, it does not move the
 * cursor off its row). So walk up from the cursor's row to the first row that
 * differs from the last frame and rewrite from there to the end with line
 * feeds: rows that no longer fit scroll into scrollback in order, and the tail
 * repaint that follows lands on a screen that already holds the same rows.
 * If the walk up is clamped at the screen top (the first changed row already
 * scrolled away), the changed rows print below their stale copies: duplicated,
 * not lost. Already-printed rows more than REPAINT_BUDGET_SCREENS screens
 * above the end are not re-sent; the start never moves below the cursor row.
 *
 * Rows are compared without overlays (`previousBase`/`currentBase`, the
 * rows the components rendered): a full-height overlay such as the pinned
 * status rail shifts relative to the content when the screen scrolls, so the
 * composited rows above the cursor would all look changed and be re-sent on
 * every resize step. What is written is the composited frame (`newLines`).
 *
 * A frame that fits the new screen needs no resync: the tail repaint writes
 * all of it from the top. Resyncing it anyway is harmful when the frame was
 * padded to the screen height (an overlay taller than short content): its
 * rows are screen rows, not scrollback-anchored rows, so after a grow pulled
 * rows back from scrollback the cursor's row no longer maps to the same
 * content row and the line feeds push the pulled-back rows into scrollback a
 * second time.
 *
 * @param previousBase pre-overlay rows of the last frame
 * @param newLines composited rows of the frame about to be painted
 * @param cursorRow content row the hardware cursor was left on by the last frame
 * @param height terminal rows after the resize
 * @param currentBase pre-overlay rows of the frame about to be painted (default: `newLines`)
 */
export function resyncAfterResize(
	previousBase: readonly string[],
	newLines: readonly string[],
	cursorRow: number,
	height: number,
	currentBase: readonly string[] = newLines,
): string {
	if (newLines.length === 0 || newLines.length <= height) return "";
	const { first } = resyncStart(previousBase, currentBase, newLines.length, cursorRow, height);
	const up = cursorRow - first;
	let buffer = up > 0 ? `\x1b[${up}A\r` : "\r";
	for (let i = first; i < newLines.length; i++) {
		if (i > first) buffer += "\r\n";
		buffer += `\x1b[2K${newLines[i]}`;
	}
	return buffer;
}

/**
 * First row the resync rewrites, and whether the repaint budget moved it down
 * from the first changed row. Requires `length > 0`.
 */
export function resyncStart(
	previousBase: readonly string[],
	currentBase: readonly string[],
	length: number,
	cursorRow: number,
	height: number,
): { first: number; capped: boolean } {
	const top = Math.min(cursorRow, length - 1);
	let changed = top;
	for (let i = 0; i < top; i++) {
		if (previousBase[i] !== currentBase[i]) {
			changed = i;
			break;
		}
	}
	// The budget only limits how far UP already-printed rows are re-sent. It
	// must never push the start below the cursor: cursor-down stops at the
	// screen bottom, so the rows in between would never be written (a resize
	// frame that appended more than the budget lost them).
	const first = Math.min(Math.max(changed, length - height * REPAINT_BUDGET_SCREENS, 0), top);
	return { first, capped: first > changed };
}

/** Per-TUI state for resyncAfterResize: the pre-overlay rows of the last two frames. */
export class ResizeResync {
	private previousBase: readonly string[] = [];
	private currentBase: readonly string[] = [];

	/** Records a frame's rows before overlays are composited; returns them unchanged. Call once per render. */
	track<T extends readonly string[]>(base: T): T {
		this.previousBase = this.currentBase;
		this.currentBase = base;
		return base;
	}

	/** resyncAfterResize for the frame last passed to track(), painted as `newLines`. */
	after(newLines: readonly string[], cursorRow: number, height: number): string {
		return resyncAfterResize(this.previousBase, newLines, cursorRow, height, this.currentBase);
	}
}

/** Termux changes height when the software keyboard shows or hides; those resizes skip the clearing repaint. */
export function isTermuxSession(): boolean {
	return Boolean(process.env.TERMUX_VERSION);
}
