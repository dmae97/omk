import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Text } from "../src/components/text.ts";
import { WindowedContainer } from "../src/windowed-container.ts";
import { SEGMENT_MAX_LINES } from "../src/windowed-segments.ts";

describe("WindowedContainer long-session virtual promotion", () => {
	it("promotes oldest frozen segments into virtualChildren as a live session grows past live+seed", () => {
		const container = new WindowedContainer();
		container.setLiveLineBudget(10);
		container.setPrefixSeed(20);

		let lastOut: string[] = [];
		for (let i = 0; i < 1200; i++) {
			container.addChild(new Text(`turn-${i}: ${"a".repeat(30)}`, 0, 0));
			lastOut = container.render(80);
		}

		// Old frozen segments above the seed budget must be promoted to virtualChildren
		// so frozenLines and rendered output stay bounded across long sessions.
		assert.ok(
			container.getVirtualChildCount() >= 500,
			`expected >= 500 virtual children, got ${container.getVirtualChildCount()}`,
		);
		assert.ok(
			container.getFrozenLineCount() <= 20 + SEGMENT_MAX_LINES,
			`expected frozenLines <= ${20 + SEGMENT_MAX_LINES}, got ${container.getFrozenLineCount()}`,
		);
		assert.ok(lastOut.length <= 30 + SEGMENT_MAX_LINES, `expected bounded rendered lines, got ${lastOut.length}`);
		// Full transcript export via renderAll stays lossless.
		assert.equal(container.renderAll(80).length, 1200);
	});
});
