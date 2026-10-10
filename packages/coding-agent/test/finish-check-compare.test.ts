import { describe, expect, it } from "vitest";
import { checkComparisons } from "../src/core/finish-check-compare.ts";

// Review focus for #62: units, decimals, %, ≥/≤, and number forms models actually write.
const holds = (text: string | undefined) => checkComparisons(text);

describe("finish-check comparison parser", () => {
	it("evaluates plain, decimal and percent comparisons", () => {
		expect(holds("stone 74 >= 75")).toEqual({ evaluated: 1, gaps: ["stone 74 >= 75"] });
		expect(holds("stone 75 >= 75")).toEqual({ evaluated: 1, gaps: [] });
		expect(holds("accuracy 0.62 >= 0.62")).toEqual({ evaluated: 1, gaps: [] });
		expect(holds("accuracy 0.6105 >= 0.62").gaps).toEqual(["accuracy 0.6105 >= 0.62"]);
		expect(holds("win 62% >= 75%").gaps).toEqual(["win 62% >= 75%"]);
		expect(holds("win 33 percent >= 33%")).toEqual({ evaluated: 1, gaps: [] });
	});

	it("accepts unicode and reversed operators", () => {
		expect(holds("0.62 ≥ 0.6")).toEqual({ evaluated: 1, gaps: [] });
		expect(holds("5 ≤ 3").gaps).toEqual(["5 ≤ 3"]);
		expect(holds("acc 0.7 => 0.62")).toEqual({ evaluated: 1, gaps: [] });
		expect(holds("size 160 =< 150").gaps).toEqual(["size 160 =< 150"]);
		expect(holds("lines 10 == 10")).toEqual({ evaluated: 1, gaps: [] });
		expect(holds("lines 9 <= 10; 11 < 10").gaps).toEqual(["11 < 10"]);
	});

	it("reads negative numbers, including the unicode minus (review m1)", () => {
		expect(holds("-0.5 <= -0.3")).toEqual({ evaluated: 1, gaps: [] });
		expect(holds("−1 <= 0")).toEqual({ evaluated: 1, gaps: [] });
		expect(holds("loss −0.2 >= −0.1").evaluated).toBe(1);
		expect(holds("loss −0.2 >= −0.1").gaps).toHaveLength(1);
	});

	it("reads scientific notation (review M2)", () => {
		expect(holds("err 1e-3 <= 0.01")).toEqual({ evaluated: 1, gaps: [] });
		expect(holds("2.5e+3 <= 3000")).toEqual({ evaluated: 1, gaps: [] });
		expect(holds("5E-4 < 1e-3")).toEqual({ evaluated: 1, gaps: [] });
		expect(holds("err 1e-2 <= 1e-3").gaps).toEqual(["err 1e-2 <= 1e-3"]);
	});

	it("reads thousands separators", () => {
		expect(holds("1,200 ms <= 1,500 ms")).toEqual({ evaluated: 1, gaps: [] });
		expect(holds("pairs 100,000 > 99,999")).toEqual({ evaluated: 1, gaps: [] });
		expect(holds("pairs 100,001 <= 100,000").gaps).toHaveLength(1);
	});

	it("skips mixed units instead of guessing", () => {
		expect(holds("120MB <= 1 GB")).toEqual({ evaluated: 0, gaps: [] });
		expect(holds("74% >= 75")).toEqual({ evaluated: 0, gaps: [] });
		expect(holds("acc 61% >= 0.62")).toEqual({ evaluated: 0, gaps: [] });
		expect(holds("120MB <= 150 MB")).toEqual({ evaluated: 1, gaps: [] });
	});

	it("skips version strings (review m3)", () => {
		expect(holds("python 3.11.2 >= 3.8.0")).toEqual({ evaluated: 0, gaps: [] });
		expect(holds("v3.11 >= v3.8")).toEqual({ evaluated: 0, gaps: [] });
	});

	it("evaluates every link of a chained limit", () => {
		expect(holds("Tm 58 <= 61 <= 72")).toEqual({ evaluated: 2, gaps: [] });
		expect(holds("Tm 58 <= 75 <= 72").gaps).toEqual(["Tm 58 <= 75 <= 72"]);
	});

	it("judges each part by its last comparison, so earlier context does not fail it (review m2)", () => {
		expect(holds("was 80 > 90 before, now 95 > 90")).toEqual({ evaluated: 1, gaps: [] });
		expect(holds("now 80 > 90, was 95 > 90 before")).toEqual({ evaluated: 1, gaps: [] });
		expect(holds("was 95 > 90 before, now 80 > 90").gaps).toHaveLength(1);
	});

	it("ignores text without a comparison", () => {
		expect(holds(undefined)).toEqual({ evaluated: 0, gaps: [] });
		expect(holds("all opponents beaten")).toEqual({ evaluated: 0, gaps: [] });
		expect(holds("3/3 pairs within 5 C")).toEqual({ evaluated: 0, gaps: [] });
	});
});
