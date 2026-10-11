/**
 * Regression: a height resize while the reply streams lost transcript rows
 * from the terminal's scrollback (main-r4: `value1_3`..`value1_6`).
 *
 * The clearing redraw homed the cursor and repainted only the last `height`
 * rows, assuming the screen top was exactly row `newLines.length - height`.
 * Terminals do not guarantee that across a resize: xterm.js drops the rows
 * below the cursor (the editor's footer) when the screen shrinks, and a frame
 * written for the old size before omk sees SIGWINCH scrolls the screen by
 * however many rows it appended. Either way the screen top lands above the
 * repainted tail and the rows in between were overwritten without ever
 * reaching scrollback.
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import { type Component, CURSOR_MARKER, TUI } from "../src/tui.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

/** Transcript rows, then an editor row holding the cursor, then footer rows below it. */
class ChatLike implements Component {
	transcript: string[] = [];
	footerRows = 0;
	cursor = true;
	render(_width: number): string[] {
		const footer = Array.from({ length: this.footerRows }, (_, index) => `footer ${index + 1}`);
		return [...this.transcript, `> ask${this.cursor ? CURSOR_MARKER : ""}`, ...footer];
	}
	invalidate(): void {}
}

const rows = (count: number, from = 1): string[] => Array.from({ length: count }, (_, index) => `C${from + index}`);

function occurrences(buffer: string[], probe: string): number {
	return buffer.filter((row) => row.trimEnd() === probe).length;
}

/**
 * Every row survives. `maxCopies` 2 allows the duplicate a height grow
 * already leaves (the tail repaint over rows the terminal pulled back from
 * scrollback); that predates this fix and is bounded by the stacking test.
 */
function assertTranscriptKept(terminal: VirtualTerminal, transcript: string[], maxCopies = 1): void {
	const buffer = terminal.getScrollBuffer();
	const missing = transcript.filter((row) => occurrences(buffer, row) === 0);
	assert.deepStrictEqual(missing, [], `rows lost from scrollback: ${missing.join(", ")}`);
	const stacked = transcript.filter((row) => occurrences(buffer, row) > maxCopies);
	assert.deepStrictEqual(stacked, [], `rows printed more than ${maxCopies}x: ${stacked.join(", ")}`);
}

/** Copies of each transcript row, matched by the row's first word (an overlay may share the terminal row). */
function copiesByFirstWord(terminal: VirtualTerminal, transcript: string[]): Map<string, number> {
	const counts = new Map(transcript.map((row) => [row, 0]));
	for (const line of terminal.getScrollBuffer()) {
		const word = line.trimStart().split(/\s+/, 1)[0] ?? "";
		const count = counts.get(word);
		if (count !== undefined) counts.set(word, count + 1);
	}
	return counts;
}

/** A pinned rail like the status sidebar: top-right, full height, never takes focus. */
class Rail implements Component {
	render(width: number): string[] {
		return Array.from({ length: 80 }, (_, index) => `|rail ${index}`.padEnd(width).slice(0, width));
	}
	invalidate(): void {}
}

async function settle(terminal: VirtualTerminal): Promise<void> {
	await terminal.waitForRender().catch(() => terminal.flush());
}

describe("resize scrollback loss regression", () => {
	it("keeps every transcript row when shrinking with footer rows below the cursor", async () => {
		const terminal = new VirtualTerminal(80, 40);
		const tui = new TUI(terminal);
		const chat = new ChatLike();
		chat.footerRows = 3;
		chat.transcript = rows(80);
		tui.addChild(chat);
		tui.start();
		await settle(terminal);

		terminal.resize(80, 24);
		await settle(terminal);

		assertTranscriptKept(terminal, chat.transcript);
		tui.stop();
	});

	it("keeps rows the stream appends in the same frame as the resize", async () => {
		const terminal = new VirtualTerminal(80, 80);
		const tui = new TUI(terminal);
		const chat = new ChatLike();
		chat.cursor = false; // cursor stays on the last row, so no row is dropped below it
		chat.transcript = rows(120);
		tui.addChild(chat);
		tui.start();
		await settle(terminal);

		// The terminal shrinks and, before omk renders, four more rows stream in.
		terminal.resizeEmulatorOnly(80, 24);
		chat.transcript = rows(124);
		terminal.announceResize();
		await settle(terminal);

		assertTranscriptKept(terminal, chat.transcript);
		tui.stop();
	});

	it("keeps every transcript row across a streamed 40 → 80 → 24 → 40 height sequence (main-r4 shape)", async () => {
		const terminal = new VirtualTerminal(120, 40);
		const tui = new TUI(terminal);
		const chat = new ChatLike();
		chat.footerRows = 3;
		chat.transcript = rows(200);
		tui.addChild(chat);
		tui.start();
		await settle(terminal);

		let next = 201;
		const stream = async (count: number): Promise<void> => {
			chat.transcript = [...chat.transcript, ...rows(count, next)];
			next += count;
			tui.requestRender();
			await settle(terminal);
		};
		for (const height of [80, 24, 40]) {
			await stream(60); // enough rows that the previous resize's repaint does not cover them
			terminal.resizeEmulatorOnly(120, height);
			await stream(2); // frame written for the old height, processed at the new one
			chat.transcript = [...chat.transcript, ...rows(4, next)];
			next += 4;
			terminal.announceResize(); // the resize frame also carries new rows
			await settle(terminal);
		}
		await stream(5);

		assertTranscriptKept(terminal, chat.transcript, 2);
		tui.stop();
	});
	it("keeps every row when the resize frame appends more rows than the repaint budget", async () => {
		const terminal = new VirtualTerminal(80, 24);
		const tui = new TUI(terminal);
		const chat = new ChatLike();
		chat.cursor = false;
		chat.transcript = rows(99); // 100 rows with the editor row
		tui.addChild(chat);
		tui.start();
		await settle(terminal);

		terminal.resizeEmulatorOnly(80, 20);
		chat.transcript = rows(219); // +120 rows in the resize frame (budget 4 × 20 = 80)
		terminal.announceResize();
		await settle(terminal);

		assertTranscriptKept(terminal, chat.transcript);
		tui.stop();
	});

	it("re-sends a row above the cursor that changed in the resize frame, exactly once", async () => {
		const terminal = new VirtualTerminal(80, 40);
		const tui = new TUI(terminal);
		const chat = new ChatLike();
		chat.footerRows = 3;
		chat.transcript = rows(80);
		tui.addChild(chat);
		tui.start();
		await settle(terminal);

		// 84 rows at 40: screen top is row 44. Shrinking to 24 drops the 3 footer rows below
		// the cursor, so rows 57..59 stay on screen above the 24-row tail (60..83).
		// Row 58 ("C59") changes in the same frame.
		terminal.resizeEmulatorOnly(80, 24);
		chat.transcript = chat.transcript.map((row) => (row === "C59" ? "C59 edited" : row));
		terminal.announceResize();
		await settle(terminal);

		const buffer = terminal.getScrollBuffer();
		assert.strictEqual(occurrences(buffer, "C59 edited"), 1, "edited row appears once");
		assert.strictEqual(occurrences(buffer, "C59"), 0, "stale copy is gone");
		assertTranscriptKept(terminal, chat.transcript);
		tui.stop();
	});
	it("does not re-send rows under a full-height overlay on every resize step", async () => {
		const terminal = new VirtualTerminal(100, 40);
		const tui = new TUI(terminal);
		const chat = new ChatLike();
		chat.footerRows = 3;
		chat.transcript = rows(100);
		tui.addChild(chat);
		tui.setRightGutter(20);
		tui.showOverlay(new Rail(), { anchor: "top-right", width: 20, maxHeight: "100%", nonCapturing: true });
		tui.start();
		await settle(terminal);

		// Drag the window edge: 40 → 24 → 40, one row per resize event, three times.
		for (let drag = 0; drag < 3; drag++) {
			for (let height = 39; height >= 24; height--) {
				terminal.resize(100, height);
				await settle(terminal);
			}
			for (let height = 25; height <= 40; height++) {
				terminal.resize(100, height);
				await settle(terminal);
			}
		}

		const copies = copiesByFirstWord(terminal, chat.transcript);
		const missing = [...copies].filter(([, count]) => count === 0).map(([row]) => row);
		const stacked = [...copies].filter(([, count]) => count > 1).map(([row, count]) => `${row}×${count}`);
		assert.deepStrictEqual(missing, [], `rows lost: ${missing.join(", ")}`);
		assert.deepStrictEqual(stacked, [], `rows re-sent under the overlay: ${stacked.join(", ")}`);
		tui.stop();
	});
});
