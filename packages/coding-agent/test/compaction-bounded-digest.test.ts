import { describe, expect, it } from "vitest";
import {
	DEFAULT_COMPACTION_RAW_INPUT_CHAR_CEILING,
	packSummaryInputForTokenBudget,
} from "../src/core/compaction/compaction.ts";

describe("compaction raw input bounding", () => {
	it("leaves small input unchanged below the raw char ceiling", () => {
		const text = "short serialized conversation";
		const packed = packSummaryInputForTokenBudget(text, undefined, 1000);

		expect(packed.text).toBe(text);
		expect(packed.wasCompressed).toBe(false);
		expect(packed.omittedTokens).toBe(0);
	});

	it("clamps raw input above the ceiling before token packing", () => {
		const text = `HEADTOKEN-${"x".repeat(3000)}-TAILTOKEN`;
		const packed = packSummaryInputForTokenBudget(text, undefined, 200);

		expect(packed.text.length).toBeLessThanOrEqual(200);
		expect(packed.text).toContain("HEADTOKEN");
		expect(packed.text).toContain("TAILTOKEN");
		expect(packed.text).toContain("omk-digest:truncated");
		expect(packed.wasCompressed).toBe(true);
	});

	it("respects an explicit maxRawChars override", () => {
		const text = `HEAD-${"y".repeat(1000)}-TAIL`;
		const packed = packSummaryInputForTokenBudget(text, 10_000, 120);

		expect(packed.text.length).toBeLessThanOrEqual(120);
	});

	it("still applies token packing after raw clamp", () => {
		const text = Array.from(
			{ length: 120 },
			(_, index) => `packages/coding-agent/src/file-${index}.ts error line`,
		).join("\n");
		const packed = packSummaryInputForTokenBudget(text, 80, 500);

		expect(packed.wasCompressed).toBe(true);
		expect(packed.text).toContain("omk-summary-input-compressed");
		expect(packed.packedTokens).toBeLessThan(packed.originalTokens);
		expect(packed.omittedTokens).toBeGreaterThan(0);
	});

	it("does not duplicate overlapping head and tail slices", () => {
		const text = `HEADTOKEN-${"a".repeat(240)}-MIDTOKEN-${"b".repeat(240)}-TAILTOKEN`;
		const packed = packSummaryInputForTokenBudget(text, 80, 700);

		expect(packed.wasCompressed).toBe(true);
		expect(packed.text).toContain("omk-summary-input-compressed");
		expect(packed.text.match(/HEADTOKEN/g) ?? []).toHaveLength(1);
		expect(packed.text.match(/MIDTOKEN/g) ?? []).toHaveLength(1);
		expect(packed.text.match(/TAILTOKEN/g) ?? []).toHaveLength(1);
	});

	it("exports a default raw input char ceiling", () => {
		expect(DEFAULT_COMPACTION_RAW_INPUT_CHAR_CEILING).toBeGreaterThan(0);
	});
});
