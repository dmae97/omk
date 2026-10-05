import assert from "node:assert";
import { describe, it } from "node:test";
import { Box } from "../src/components/box.ts";
import { Text } from "../src/components/text.ts";
import type { Component } from "../src/tui.ts";

class ArrayChild implements Component {
	lines: string[];
	renders = 0;
	constructor(lines: string[]) {
		this.lines = lines;
	}
	render(_width: number): string[] {
		this.renders++;
		return this.lines;
	}
	invalidate(): void {}
}

const bg = (text: string) => `\x1b[48;5;236m${text}\x1b[49m`;

describe("Box render cache", () => {
	it("returns the same array when children return unchanged arrays", () => {
		const box = new Box(1, 1, bg);
		box.addChild(new Text("first line\nsecond line", 0, 0));
		box.addChild(new ArrayChild(["tool output", "more output"]));
		const first = box.render(40);
		const second = box.render(40);
		assert.strictEqual(second, first);
		assert.strictEqual(box.render(40), first);
	});

	it("returns the same array when a child returns a new array with equal lines", () => {
		const child = new ArrayChild(["a", "b"]);
		const box = new Box(1, 0, bg);
		box.addChild(child);
		const first = box.render(20);
		child.lines = ["a", "b"];
		assert.strictEqual(box.render(20), first);
	});

	it("rebuilds when a child mutates its returned array in place", () => {
		const child = new ArrayChild(["a", "b"]);
		const box = new Box(1, 0);
		box.addChild(child);
		const first = box.render(10);
		child.lines[1] = "changed";
		const second = box.render(10);
		assert.notStrictEqual(second, first);
		assert.strictEqual(second[1], ` changed${" ".repeat(10 - 8)}`);
	});

	it("rebuilds on child text, child count, width and background changes", () => {
		const text = new Text("hello", 0, 0);
		const box = new Box(1, 0, bg);
		box.addChild(text);
		let previous = box.render(20);

		text.setText("hello world");
		let next = box.render(20);
		assert.notStrictEqual(next, previous);
		assert.ok(next[0].includes("hello world"));
		previous = next;

		box.addChild(new ArrayChild(["extra"]));
		next = box.render(20);
		assert.notStrictEqual(next, previous);
		assert.strictEqual(next.length, 2);
		previous = next;

		next = box.render(30);
		assert.notStrictEqual(next, previous);
		previous = next;

		box.setBgFn((s) => `\x1b[41m${s}\x1b[49m`);
		next = box.render(30);
		assert.notStrictEqual(next, previous);
		assert.ok(next[0].includes("\x1b[41m"));
	});

	it("still re-renders children every frame so their own state stays live", () => {
		const child = new ArrayChild(["x"]);
		const box = new Box(0, 0);
		box.addChild(child);
		box.render(10);
		box.render(10);
		assert.strictEqual(child.renders, 2);
	});
});
