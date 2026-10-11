/**
 * Unit tests for resyncAfterResize: which rows a height-change resync re-sends
 * and how the cursor gets there. Integration with a real emulator lives in
 * regression-resize-scrollback-loss.test.ts.
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import { REPAINT_BUDGET_SCREENS, ResizeResync, resyncAfterResize } from "../src/terminal-resync.ts";

const rows = (count: number, from = 0): string[] => Array.from({ length: count }, (_, index) => `R${from + index}`);

/** Rows the resync output writes, in order (each row is preceded by an erase-line). */
function writtenRows(output: string): string[] {
	return output
		.split("\x1b[2K")
		.slice(1)
		.map((row) => row.replace(/\r\n$/, ""));
}

describe("resyncAfterResize", () => {
	it("starts at the first row above the cursor that changed since the last frame", () => {
		const previous = rows(10);
		const next = [...previous];
		next[6] = "R6 changed";
		const output = resyncAfterResize(previous, next, 9, 24);
		assert.ok(output.startsWith("\x1b[3A\r"), JSON.stringify(output.slice(0, 12)));
		assert.deepStrictEqual(writtenRows(output), ["R6 changed", "R7", "R8", "R9"]);
	});

	it("starts at the cursor row when nothing above it changed", () => {
		const previous = rows(10);
		const output = resyncAfterResize(previous, [...previous, "R10"], 9, 24);
		assert.ok(output.startsWith("\r"), JSON.stringify(output.slice(0, 12)));
		assert.deepStrictEqual(writtenRows(output), ["R9", "R10"]);
	});

	it("re-sends at most REPAINT_BUDGET_SCREENS screens of already-printed rows", () => {
		const height = 10;
		const previous = rows(200);
		const next = ["R0 changed", ...previous.slice(1)];
		const output = resyncAfterResize(previous, next, 199, height);
		const budgetStart = 200 - height * REPAINT_BUDGET_SCREENS;
		assert.ok(output.startsWith(`\x1b[${199 - budgetStart}A\r`), JSON.stringify(output.slice(0, 12)));
		const written = writtenRows(output);
		assert.strictEqual(written[0], `R${budgetStart}`);
		assert.strictEqual(written.length, 200 - budgetStart);
	});

	it("never starts below the cursor, even when the frame grew by more than the budget", () => {
		// 100 printed rows, cursor on the last one, 120 rows appended in the resize frame:
		// the budget start (220 - 80 = 140) is below the cursor, and moving down to it
		// would skip rows 100..139 (cursor-down stops at the screen bottom).
		const previous = rows(100);
		const next = rows(220);
		const output = resyncAfterResize(previous, next, 99, 20);
		assert.ok(output.startsWith("\r"), JSON.stringify(output.slice(0, 12)));
		assert.ok(!output.includes("B\r"), "no cursor-down move");
		assert.deepStrictEqual(writtenRows(output), rows(121, 99));
	});

	it("compares rows without overlays, so a shifted overlay alone does not count as a change", () => {
		const base = rows(30);
		// Composited frames: an overlay column whose rows shifted by one since the last frame.
		const composite = (shift: number) => base.map((row, index) => `${row} |rail ${index + shift}`);
		const resync = new ResizeResync();
		resync.track(base);
		resync.track([...base]);
		const output = resync.after(composite(1), 29, 24);
		assert.ok(output.startsWith("\r"), JSON.stringify(output.slice(0, 12)));
		assert.deepStrictEqual(writtenRows(output), ["R29 |rail 30"]);
		// Comparing the composited rows instead would restart at row 0 (capped by the budget only).
		assert.ok(resyncAfterResize(composite(0), composite(1), 29, 24).startsWith("\x1b[29A"));
	});
});
