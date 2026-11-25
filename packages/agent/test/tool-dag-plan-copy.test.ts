import { describe, expect, it } from "vitest";
import { copyDagClaimEntries, copyDagSchedulePlan } from "../src/tool-dag-plan-copy.ts";
import type { DagSchedulePlan, ResolvedClaimEntry } from "../src/tool-dag-scheduler.ts";

/**
 * Pins the deep-copy boundary of the tool DAG plan cache: mutation on a copy
 * must never reach the cached plan. Fixtures follow the shapes the scheduler
 * actually builds. An `exclusive` resolution always carries
 * `canonicalClaims: []` (see resolveBatchClaims), so the canonical-claim
 * mutation case targets the claims entry.
 */

function buildPlan(): DagSchedulePlan {
	return {
		levels: [[0, 1], [2]],
		planKey: "plan-key-0127",
		entries: [
			{
				sourceIndex: 0,
				resolution: { kind: "exclusive" },
				canonicalClaims: [],
			},
			{
				sourceIndex: 1,
				resolution: { kind: "claims", claims: [{ kind: "path", key: "a.txt", access: "read" }] },
				canonicalClaims: [{ kind: "path", key: "a.txt", access: "read" }],
			},
			{
				sourceIndex: 2,
				resolution: { kind: "claims", claims: [{ kind: "path", key: "b.txt", access: "write" }] },
				canonicalClaims: [{ kind: "path", key: "b.txt", access: "write" }],
			},
		],
	};
}

function claimsOf(entry: ResolvedClaimEntry) {
	const { resolution } = entry;
	if (resolution.kind !== "claims") throw new Error("expected a claims resolution");
	return resolution.claims;
}

describe("copyDagSchedulePlan", () => {
	it("copies a plan to an equal value with the same planKey", () => {
		const plan = buildPlan();
		const copy = copyDagSchedulePlan(plan);

		expect(copy).toEqual(plan);
		expect(copy.planKey).toBe(plan.planKey);
		expect(copy).not.toBe(plan);
		expect(copy.levels).not.toBe(plan.levels);
		expect(copy.entries).not.toBe(plan.entries);
	});

	it("detaches levels so pushing into a copied level leaves the original alone", () => {
		const plan = buildPlan();
		const copy = copyDagSchedulePlan(plan);

		copy.levels[0].push(99);

		expect(plan.levels[0]).toEqual([0, 1]);
		expect(copy.levels[0]).toEqual([0, 1, 99]);
	});

	it("detaches resolution claims so mutating a copied claim leaves the original alone", () => {
		const plan = buildPlan();
		const copy = copyDagSchedulePlan(plan);

		const copiedClaims = claimsOf(copy.entries[1]);
		copiedClaims[0].key = "mutated.txt";

		expect(copiedClaims).not.toBe(claimsOf(plan.entries[1]));
		expect(claimsOf(plan.entries[1])[0].key).toBe("a.txt");
	});

	it("detaches canonical claims so mutating a copied canonical claim leaves the original alone", () => {
		const plan = buildPlan();
		const copy = copyDagSchedulePlan(plan);

		copy.entries[1].canonicalClaims[0].key = "mutated-canonical.txt";

		expect(plan.entries[1].canonicalClaims[0].key).toBe("a.txt");
		expect(copy.entries[1].canonicalClaims).not.toBe(plan.entries[1].canonicalClaims);
	});

	it('keeps an exclusive resolution exactly { kind: "exclusive" } with no canonical claims', () => {
		const plan = buildPlan();
		const copy = copyDagSchedulePlan(plan);

		expect(copy.entries[0].resolution).toEqual({ kind: "exclusive" });
		expect(copy.entries[0].resolution).not.toBe(plan.entries[0].resolution);
		expect(copy.entries[0].canonicalClaims).toEqual([]);
		expect(copy.entries[0].sourceIndex).toBe(0);
	});
});

describe("copyDagClaimEntries", () => {
	it("returns an empty array for an empty batch", () => {
		expect(copyDagClaimEntries([])).toEqual([]);
	});

	it("copies entries one for one, preserving source order and each claim array", () => {
		const plan = buildPlan();
		const entries = copyDagClaimEntries(plan.entries);

		expect(entries).toEqual(plan.entries);
		expect(entries).toHaveLength(plan.entries.length);
		expect(entries.map((entry) => entry.sourceIndex)).toEqual([0, 1, 2]);
		for (let index = 0; index < entries.length; index++) {
			expect(entries[index]).not.toBe(plan.entries[index]);
			expect(entries[index].canonicalClaims).not.toBe(plan.entries[index].canonicalClaims);
		}
	});
});
