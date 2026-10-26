import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Editor } from "../src/components/editor.ts";
import { KILL_RING_MAX_CODE_UNITS, KILL_RING_MAX_ENTRIES, KillRing } from "../src/kill-ring.ts";
import { TUI } from "../src/tui.ts";
import { defaultEditorTheme } from "./test-themes.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

describe("kill ring retention", () => {
	it("evicts oldest entries by count while preserving yank-pop order", () => {
		const ring = new KillRing();
		for (let i = 0; i <= KILL_RING_MAX_ENTRIES; i++) ring.push(String(i), { prepend: false });
		assert.equal(ring.length, KILL_RING_MAX_ENTRIES);
		assert.equal(ring.peek(), String(KILL_RING_MAX_ENTRIES));
		ring.rotate();
		assert.equal(ring.peek(), String(KILL_RING_MAX_ENTRIES - 1));
		for (let i = 1; i < KILL_RING_MAX_ENTRIES; i++) ring.rotate();
		assert.equal(ring.peek(), String(KILL_RING_MAX_ENTRIES));
	});

	it("evicts older entries when the character budget is exceeded", () => {
		const ring = new KillRing();
		const block = "a".repeat(KILL_RING_MAX_CODE_UNITS / 2);
		ring.push(block, { prepend: false });
		ring.push(block, { prepend: false });
		ring.push("new", { prepend: false });
		assert.equal(ring.length, 2);
		assert.equal(ring.peek(), "new");
		ring.rotate();
		assert.equal(ring.peek(), block);
	});

	it("keeps an oversized latest kill and drops it after a later kill", () => {
		const ring = new KillRing();
		const big = "\u{1f642}".repeat(KILL_RING_MAX_CODE_UNITS / 2 + 1);
		ring.push("old", { prepend: false });
		ring.push(big, { prepend: false });
		assert.equal(ring.length, 1);
		assert.equal(ring.peek(), big);
		ring.push("next", { prepend: false });
		assert.equal(ring.length, 1);
		assert.equal(ring.peek(), "next");
	});

	it("applies the budget after accumulating consecutive kills", () => {
		const ring = new KillRing();
		ring.push("old", { prepend: false });
		ring.push("a".repeat(KILL_RING_MAX_CODE_UNITS - 1), { prepend: false });
		ring.push("xy", { prepend: true, accumulate: true });
		assert.equal(ring.length, 1);
		assert.ok(ring.peek()?.startsWith("xy"));
	});

	it("keeps the most recent killed text available through the editor", () => {
		const editor = new Editor(new TUI(new VirtualTerminal(80, 24)), defaultEditorTheme);
		for (let i = 0; i <= KILL_RING_MAX_ENTRIES; i++) {
			editor.setText(`entry-${i}`);
			editor.handleInput("\x15");
		}
		editor.handleInput("\x19");
		assert.equal(editor.getText(), `entry-${KILL_RING_MAX_ENTRIES}`);
		editor.handleInput("\x1by");
		assert.equal(editor.getText(), `entry-${KILL_RING_MAX_ENTRIES - 1}`);
	});
});
