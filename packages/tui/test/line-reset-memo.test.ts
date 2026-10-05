import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractKittyImageIds, LineResetMemo, SEGMENT_RESET } from "../src/line-reset-memo.ts";
import { encodeKitty } from "../src/terminal-image.ts";

describe("LineResetMemo", () => {
	it("reuses prior output string refs when raw rows are unchanged", () => {
		const memo = new LineResetMemo();
		const first = ["hello", "world"];
		memo.apply(first);
		const out0 = first[0];
		const out1 = first[1];
		assert.ok(out0.endsWith(SEGMENT_RESET));
		assert.ok(out1.endsWith(SEGMENT_RESET));

		const second = ["hello", "world"];
		memo.apply(second);
		assert.equal(second[0], out0);
		assert.equal(second[1], out1);
	});

	it("renormalizes only changed rows", () => {
		const memo = new LineResetMemo();
		const a = ["a", "b", "c"];
		memo.apply(a);
		const kept = a[0];
		const b = ["a", "B", "c"];
		memo.apply(b);
		assert.equal(b[0], kept);
		assert.notEqual(b[1], a[1]);
		assert.ok(b[1].startsWith("B"));
	});

	it("leaves kitty image lines untouched and records ids", () => {
		const memo = new LineResetMemo();
		const image = encodeKitty("AAAA", { columns: 2, rows: 1, imageId: 99, moveCursor: false });
		const lines = ["text", image];
		memo.apply(lines);
		assert.equal(lines[1], image);
		assert.ok(memo.kittyImageIds.has(99));
		assert.deepEqual([...extractKittyImageIds(image)], [99]);
	});
});
