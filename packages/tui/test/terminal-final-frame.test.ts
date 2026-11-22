/**
 * Tests for finishTerminalFrame (cursor parked below the last rendered row
 * before the TUI stops, so the shell prompt never overwrites transcript text)
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import type { Terminal } from "../src/terminal.ts";
import { finishTerminalFrame } from "../src/terminal-final-frame.ts";

/** Records every write/showCursor/stop call in order. */
function createFakeTerminal() {
	const calls: string[] = [];
	const writes: string[] = [];
	return {
		calls,
		writes,
		terminal: {
			write(data: string) {
				calls.push(`write:${JSON.stringify(data)}`);
				writes.push(data);
			},
			showCursor() {
				calls.push("showCursor");
			},
			stop() {
				calls.push("stop");
			},
		} as unknown as Terminal,
	};
}

describe("finishTerminalFrame", () => {
	it("writes nothing when there are no content rows, then shows the cursor and stops", () => {
		const fake = createFakeTerminal();
		finishTerminalFrame(fake.terminal, 0, 0);
		assert.deepStrictEqual(fake.writes, []);
		assert.deepStrictEqual(fake.calls, ["showCursor", "stop"]);
	});

	it("moves the cursor down when it sits above the last content row", () => {
		const fake = createFakeTerminal();
		finishTerminalFrame(fake.terminal, 5, 2);
		assert.deepStrictEqual(fake.writes, ["\x1b[0m", "\x1b[3B", "\r\n"]);
		assert.deepStrictEqual(fake.calls, [
			'write:"\\u001b[0m"',
			'write:"\\u001b[3B"',
			'write:"\\r\\n"',
			"showCursor",
			"stop",
		]);
	});

	it("moves the cursor up when it sits below the last content row", () => {
		const fake = createFakeTerminal();
		finishTerminalFrame(fake.terminal, 5, 7);
		assert.deepStrictEqual(fake.writes, ["\x1b[0m", "\x1b[2A", "\r\n"]);
	});

	it("writes no cursor move when the cursor is already on the last content row", () => {
		const fake = createFakeTerminal();
		finishTerminalFrame(fake.terminal, 5, 5);
		assert.deepStrictEqual(fake.writes, ["\x1b[0m", "\r\n"]);
	});

	it("always shows the cursor before stopping", () => {
		for (const [contentRows, hardwareCursorRow] of [
			[0, 0],
			[5, 2],
			[5, 7],
			[5, 5],
		] as const) {
			const fake = createFakeTerminal();
			finishTerminalFrame(fake.terminal, contentRows, hardwareCursorRow);
			assert.ok(
				fake.calls.indexOf("showCursor") < fake.calls.indexOf("stop"),
				`showCursor must run before stop for (${contentRows}, ${hardwareCursorRow})`,
			);
		}
	});
});
