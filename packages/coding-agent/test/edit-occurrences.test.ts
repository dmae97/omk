import { describe, expect, it } from "vitest";
import { countOverlappingOccurrences } from "../src/core/tools/edit-occurrences.ts";

describe("countOverlappingOccurrences", () => {
	it("counts overlapping starts", () => {
		expect(countOverlappingOccurrences("aaaa", "aaa")).toBe(2);
	});

	it("counts overlapping two-char needle", () => {
		expect(countOverlappingOccurrences("aaaa", "aa")).toBe(3);
	});

	it("counts non-overlapping repeated needle", () => {
		expect(countOverlappingOccurrences("abcabc", "abc")).toBe(2);
	});

	it("returns zero when needle absent", () => {
		expect(countOverlappingOccurrences("abc", "x")).toBe(0);
	});

	it("keeps split() count for empty needle", () => {
		expect(countOverlappingOccurrences("abc", "")).toBe(2);
	});
});
