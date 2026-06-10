import assert from "node:assert";
import { describe, it } from "node:test";
import { formatOmkStatusLine, getOmkStatusSegments, OMK_BRAND_LABEL, visibleWidth } from "../src/index.ts";

describe("OMK TUI status", () => {
	it("formats route/verify/loop/control segments", () => {
		const line = formatOmkStatusLine({ route: "agents", verify: "evidence", loop: "stable", control: "operator" });

		assert.ok(line.includes(OMK_BRAND_LABEL));
		assert.ok(line.includes("ROUTE:agents"));
		assert.ok(line.includes("VERIFY:evidence"));
		assert.ok(line.includes("LOOP:stable"));
		assert.ok(line.includes("CONTROL:operator"));
	});

	it("returns stable segment ordering", () => {
		assert.deepStrictEqual(
			getOmkStatusSegments().map((segment) => segment.kind),
			["route", "verify", "loop", "control"],
		);
	});

	it("truncates to requested width", () => {
		const line = formatOmkStatusLine({ route: "very-long-routing-state" }, 24);

		assert.ok(visibleWidth(line) <= 24);
		assert.ok(line.includes("…"));
	});
});
