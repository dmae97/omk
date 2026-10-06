import { expect, it } from "vitest";
import {
	memoryMarginalUtility,
	memoryMatches,
	memoryQueryTerms,
	memorySpanCovered,
} from "../src/core/verified-memory-score.ts";

const record = { path: "cache.ts", quote: "alpha source", contentHash: "hash", startLine: 1, endLine: 4 };
it("unrelated quotes do not inherit instruction priority", () => {
	expect(memoryMatches(record, memoryQueryTerms("zebra"))).toEqual(new Set());
	expect(memoryQueryTerms("the and for")).toEqual([]);
});
it("later source terms remain searchable", () => {
	expect(
		memoryMatches({ ...record, quote: `${Array.from({ length: 100 }, (_, i) => `word${i}`).join(" ")} needle` }, [
			"needle",
		]).has("needle"),
	).toBe(true);
});
it("coverage utility diminishes only for repeated query terms", () => {
	expect(memoryMarginalUtility(new Set(["alpha"]), new Map([["alpha", 1]]), 2)).toBe(0.25);
	expect(memoryMarginalUtility(new Set(["beta"]), new Map([["alpha", 1]]), 2)).toBe(0.5);
});
it("only complete same-source span coverage is redundant", () => {
	expect(
		memorySpanCovered(record, [
			{ ...record, endLine: 2 },
			{ ...record, startLine: 3 },
		]),
	).toBe(true);
	expect(memorySpanCovered(record, [{ ...record, endLine: 2 }])).toBe(false);
});
