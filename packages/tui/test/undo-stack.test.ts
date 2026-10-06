import assert from "node:assert";
import { describe, it } from "node:test";
import { Editor } from "../src/components/editor.ts";
import { TUI } from "../src/tui.ts";
import { DEFAULT_UNDO_LIMIT, UndoStack } from "../src/undo-stack.ts";
import { defaultEditorTheme } from "./test-themes.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

const UNDO = "\x1b[45;5u"; // Ctrl+-

describe("UndoStack", () => {
	it("keeps at most the limit, dropping the oldest snapshots", () => {
		const stack = new UndoStack<{ n: number }>(3);
		for (let n = 1; n <= 5; n++) stack.push({ n });
		assert.strictEqual(stack.length, 3);
		assert.deepStrictEqual(
			[stack.pop(), stack.pop(), stack.pop(), stack.pop()],
			[{ n: 5 }, { n: 4 }, { n: 3 }, undefined],
		);
	});

	it("still clones on push", () => {
		const stack = new UndoStack<{ items: number[] }>();
		const state = { items: [1] };
		stack.push(state);
		state.items.push(2);
		assert.deepStrictEqual(stack.pop(), { items: [1] });
	});

	it("defaults to a limit of 200 and clamps nonsensical limits to 1", () => {
		assert.strictEqual(DEFAULT_UNDO_LIMIT, 200);
		const stack = new UndoStack<number>();
		for (let n = 0; n < 500; n++) stack.push(n);
		assert.strictEqual(stack.length, DEFAULT_UNDO_LIMIT);
		const tiny = new UndoStack<number>(0);
		tiny.push(1);
		tiny.push(2);
		assert.strictEqual(tiny.length, 1);
		assert.strictEqual(tiny.pop(), 2);
	});
});

describe("Editor undo history cap", () => {
	it("retains the most recent DEFAULT_UNDO_LIMIT word edits of a long draft", () => {
		const editor = new Editor(new TUI(new VirtualTerminal(80, 24)), defaultEditorTheme);
		const words = DEFAULT_UNDO_LIMIT + 50;
		for (let i = 0; i < words; i++) for (const ch of "ab ") editor.handleInput(ch);
		const full = editor.getText();
		assert.strictEqual(full, "ab ".repeat(words));

		for (let i = 0; i < words + 10; i++) editor.handleInput(UNDO);
		// The oldest 50 word edits are gone; undo stops at the draft they produced.
		const remaining = editor.getText();
		assert.ok(remaining.length > 0, "undo past the cap must not clear the whole draft");
		assert.ok(full.startsWith(remaining));
		assert.ok(remaining.length <= 50 * 3 + 3, `remaining ${remaining.length} chars`);
	});
});
