import assert from "node:assert";
import { describe, it } from "node:test";
import { extractKittyImageIds, LineResetMemo, SEGMENT_RESET } from "../src/line-reset-memo.ts";
import { encodeKitty } from "../src/terminal-image.ts";
import { normalizeTerminalOutput } from "../src/utils.ts";

const expected = (line: string) => normalizeTerminalOutput(line) + SEGMENT_RESET;

describe("LineResetMemo", () => {
	it("matches full normalization on every frame", () => {
		const memo = new LineResetMemo();
		const frames = [
			["plain", "\ttab", "\x1b[31mred\x1b[0m", "ไทย"],
			["plain", "\ttab changed", "\x1b[31mred\x1b[0m", "ไทย", "added"],
			["plain"],
			["new first", "\ttab", "x"],
		];
		for (const frame of frames) {
			const out = memo.apply(frame.slice());
			assert.deepStrictEqual(out, frame.map(expected));
		}
	});

	it("reuses previous output strings for unchanged rows and only re-normalizes changed rows", () => {
		const memo = new LineResetMemo();
		const first = memo.apply(["a", "b", "c"]);
		const second = memo.apply(["a", "B", "c"]);
		assert.strictEqual(second[0], first[0]);
		assert.strictEqual(second[2], first[2]);
		assert.strictEqual(second[1], expected("B"));
	});

	it("compares against the raw input, not the caller's mutated array", () => {
		const memo = new LineResetMemo();
		const lines = ["a", "b"];
		memo.apply(lines);
		// apply() normalized `lines` in place; feeding normalized text back must not be
		// mistaken for the raw rows.
		assert.deepStrictEqual(memo.apply(["a", "b"]), ["a", "b"].map(expected));
	});

	it("tracks Kitty image ids across changed and reused rows", () => {
		const memo = new LineResetMemo();
		const image = encodeKitty("AAAA", { columns: 2, rows: 1, imageId: 42, moveCursor: false });
		const other = encodeKitty("BBBB", { columns: 2, rows: 1, imageId: 7, moveCursor: false });
		const first = memo.apply(["text", image]);
		assert.strictEqual(first[1], image, "image lines are not normalized");
		assert.deepStrictEqual([...memo.kittyImageIds], [42]);

		memo.apply(["text changed", image]);
		assert.deepStrictEqual([...memo.kittyImageIds], [42]);

		memo.apply(["text changed", image, other]);
		assert.deepStrictEqual([...memo.kittyImageIds].sort(), [42, 7].sort());

		memo.apply(["text changed"]);
		assert.deepStrictEqual([...memo.kittyImageIds], []);
	});

	it("extracts image ids like the renderer did", () => {
		assert.deepStrictEqual(extractKittyImageIds("no image"), []);
		assert.deepStrictEqual(extractKittyImageIds("\x1b_Ga=T,i=12;AAAA\x1b\\"), [12]);
		assert.deepStrictEqual(extractKittyImageIds("\x1b_Ga=T,i=0;AAAA\x1b\\"), []);
		assert.deepStrictEqual(extractKittyImageIds("\x1b_Ga=T"), []);
	});
});
