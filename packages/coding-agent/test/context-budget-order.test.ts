import { describe, expect, it } from "vitest";
import { compareContextIds } from "../src/core/context-budget-order.ts";

describe("compareContextIds", () => {
	it("orders plain ASCII ids by UTF-16 code unit", () => {
		expect(compareContextIds("a", "b")).toBe(-1);
		expect(compareContextIds("b", "a")).toBe(1);
		expect(compareContextIds("a", "a")).toBe(0);
	});

	it("sorts uppercase before lowercase, unlike a locale collator", () => {
		expect(compareContextIds("Z", "a")).toBeLessThan(0);
	});

	it("sorts mixed-case ids in code-unit order", () => {
		expect(["b", "B", "a", "A"].sort(compareContextIds)).toEqual(["A", "B", "a", "b"]);
	});

	it("compares accented ids by code unit rather than by collation", () => {
		expect(compareContextIds("a", "\u00e1")).toBe(-1);
	});

	it("compares UTF-16 code units, not code points", () => {
		// The emoji's first code unit is 0xd83d, which sorts before 0xffff.
		expect(compareContextIds("\uffff", "\ud83d\ude00")).toBe(1);
	});
});
