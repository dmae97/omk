import { describe, expect, it } from "vitest";
import { capRepairHints, parseRepairBudget, shouldOfferRepair } from "../src/repair-budget.ts";

describe("parseRepairBudget", () => {
	it("defaults to 1 when env unset and no override", () => {
		const prev = process.env.OMK_WALL_REPAIR_BUDGET;
		delete process.env.OMK_WALL_REPAIR_BUDGET;
		try {
			expect(parseRepairBudget()).toBe(1);
		} finally {
			if (prev === undefined) delete process.env.OMK_WALL_REPAIR_BUDGET;
			else process.env.OMK_WALL_REPAIR_BUDGET = prev;
		}
	});

	it("honors numeric override", () => {
		expect(parseRepairBudget(3)).toBe(3);
		expect(parseRepairBudget(-1)).toBe(1);
	});
});

describe("shouldOfferRepair", () => {
	it("offers only for BLOCKED while attempts below budget", () => {
		expect(shouldOfferRepair("BLOCKED", 0, 2)).toBe(true);
		expect(shouldOfferRepair("BLOCKED", 1, 2)).toBe(true);
		expect(shouldOfferRepair("BLOCKED", 2, 2)).toBe(false);
		expect(shouldOfferRepair("PASS", 0, 2)).toBe(false);
	});
});

describe("capRepairHints", () => {
	it("slices hints to budget cap", () => {
		expect(capRepairHints(["a", "b", "c"], 2)).toEqual(["a", "b"]);
		expect(capRepairHints(["a"], 0)).toEqual([]);
	});
});
