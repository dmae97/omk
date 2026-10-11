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
 * not lost. Rows more than REPAINT_BUDGET_SCREENS screens above the end are
 * never rewritten.
 *
 * @param previousLines rows of the last frame, as the terminal received them
 * @param newLines rows of the frame about to be painted
 * @param cursorRow content row the hardware cursor was left on by the last frame
 * @param height terminal rows after the resize
 */
export function resyncAfterResize(
	previousLines: readonly string[],
	newLines: readonly string[],
	cursorRow: number,
	height: number,
): string {
	if (newLines.length === 0) return "";
	let first = Math.min(cursorRow, newLines.length - 1);
	for (let i = 0; i < first; i++) {
		if (previousLines[i] !== newLines[i]) {
			first = i;
			break;
		}
	}
	first = Math.max(first, newLines.length - height * REPAINT_BUDGET_SCREENS, 0);
	const up = cursorRow - first;
	let buffer = up > 0 ? `\x1b[${up}A\r` : up < 0 ? `\x1b[${-up}B\r` : "\r";
	for (let i = first; i < newLines.length; i++) {
		if (i > first) buffer += "\r\n";
		buffer += `\x1b[2K${newLines[i]}`;
	}
	return buffer;
}
