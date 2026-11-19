import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as publicIndex from "../src/index.ts";
import { sliceByColumn } from "../src/utils.ts";

describe("public pi-tui column slicing compatibility", () => {
	it("exports the existing column slicer", () => {
		assert.equal(publicIndex.sliceByColumn, sliceByColumn);
		assert.equal(publicIndex.sliceByColumn("hello world", 6, 5), "world");
	});

	it("fits styled wide characters within a strict column budget", () => {
		const text = "\x1b[31m가나다\x1b[0m";
		const sliced = publicIndex.sliceByColumn(text, 0, 3, true);
		assert.equal(publicIndex.visibleWidth(sliced), 2);
		assert.equal(publicIndex.sliceByColumn(text, 0, 0, true), "");
	});
});
