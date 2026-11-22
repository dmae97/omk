import { describe, expect, it } from "vitest";
import { copyDagClaimEntries, copyDagSchedulePlan } from "../src/tool-dag-plan-copy.ts";
import type { DagSchedulePlan } from "../src/tool-dag-scheduler.ts";

function buildPlan(): DagSchedulePlan {
	return {
		levels: [[0, 1], [2]],
		planKey: "plan-key",
		entries: [
			{
				sourceIndex: 0,
				resolution: { kind: "exclusive" },
				canonicalClaims: [{ kind: "path", key: "a.txt", access: "read" }],
			},
			{
				sourceIndex: 1,
				resolution: {
					kind: "claims",
					claims: [{ kind: "path", key: "a.txt", access: "read" }],
				},
				canonicalClaims: [{ kind: "path", key: "a.txt", access: "read" }],
			},
		],
	};
}

describe("copyDagSchedulePlan", () => {
	it("copies the plan value and keeps the same planKey", () => {
		const plan = buildPlan();
		const copy = copyDagSchedulePlan(plan);
		expect(copy).toEqual(plan);
		expect(copy.planKey).toBe(plan.planKey);
		expect(copy).not.toBe(plan);
		expect(copy.levels).not.toBe(plan.levels);
		expect(copy.entries).not.toBe(plan.entries);
	});

	it("detaches levels so pushing into the copy leaves the original alone", () => {
		const plan = buildPlan();
		const copy = copyDagSchedulePlan(plan);
		copy.levels[0].push(9);
		expect(plan.levels[0]).toEqual([0, 1]);
		expect(copy.levels[0]).toEqual([0, 1, 9]);
	});

	it("detaches resolution claims so editing the copy leaves the original alone", () => {
		const plan = buildPlan();
		const copy = copyDagSchedulePlan(plan);
		const copied = copy.entries[1].resolution;
		if (copied.kind !== "claims") throw new Error("Expected path claims");
		copied.claims[0].key = "b.txt";
		const original = plan.entries[1].resolution;
		if (original.kind !== "claims") throw new Error("Expected path claims");
		expect(original.claims[0].key).toBe("a.txt");
	});

	it("detaches canonical claims so editing the copy leaves the original alone", () => {
		const plan = buildPlan();
		const copy = copyDagSchedulePlan(plan);
		copy.entries[0].canonicalClaims[0].key = "b.txt";
		expect(plan.entries[0].canonicalClaims[0].key).toBe("a.txt");
	});

	it("keeps an exclusive resolution exactly as { kind: 'exclusive' }", () => {
		const plan = buildPlan();
		const copy = copyDagSchedulePlan(plan);
		expect(copy.entries[0].resolution).toEqual({ kind: "exclusive" });
	});
});

describe("copyDagClaimEntries", () => {
	it("returns [] for an empty entry list", () => {
		expect(copyDagClaimEntries([])).toEqual([]);
	});
});
