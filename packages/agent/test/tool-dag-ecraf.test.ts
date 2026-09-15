import { describe, expect, it } from "vitest";
import { type EcrafCandidate, planEcrafAdmissions } from "../src/tool-dag-ecraf.ts";

function candidate(idx: number, priority: number, resources: Record<string, number>): EcrafCandidate {
	return { sourceIndex: idx, readySeq: idx, resources, priority };
}

describe("planEcrafAdmissions (ECRAF deterministic greedy)", () => {
	it("admits ready nodes up to free slots in source order when unconstrained", () => {
		const plan = planEcrafAdmissions({
			candidates: [candidate(0, 1, {}), candidate(1, 1, {}), candidate(2, 1, {})],
			runningUsage: {},
			capacities: {},
			slots: 2,
		});
		expect(plan.admit).toEqual([0, 1]);
		expect(plan.deferred).toEqual([2]);
	});

	it("orders by priority density descending before source order", () => {
		// node 0: P=2 over cost 2 -> density ~1.0; node 1: P=6 over cost 1 -> density ~6.0.
		const plan = planEcrafAdmissions({
			candidates: [candidate(0, 2, { cpu: 2 }), candidate(1, 6, { cpu: 1 })],
			runningUsage: {},
			capacities: { cpu: 8 },
			slots: 2,
		});
		expect(plan.admit[0]).toBe(1);
	});

	it("defers a node whose resource need overflows remaining capacity, then admits the next that fits", () => {
		// running uses 6/8 cpu. node0 wants 4 (would hit 10>8) -> defer; node1 wants 2 -> fits (8<=8).
		const plan = planEcrafAdmissions({
			candidates: [candidate(0, 5, { cpu: 4 }), candidate(1, 1, { cpu: 2 })],
			runningUsage: { cpu: 6 },
			capacities: { cpu: 8 },
			slots: 2,
		});
		expect(plan.admit).toEqual([1]);
		expect(plan.deferred).toEqual([0]);
	});

	it("accounts for newly admitted nodes when checking later candidates", () => {
		// capacity 4. density is uniform (priority == cost), so order stays source order 0,1,2.
		// node0(2)+node1(2) fill to 4; node2(1) would overflow to 5.
		const plan = planEcrafAdmissions({
			candidates: [candidate(0, 2, { mem: 2 }), candidate(1, 2, { mem: 2 }), candidate(2, 1, { mem: 1 })],
			runningUsage: {},
			capacities: { mem: 4 },
			slots: 3,
		});
		expect(plan.admit).toEqual([0, 1]);
		expect(plan.deferred).toEqual([2]);
	});

	it("defers a candidate that semantically conflicts with an already-admitted node", () => {
		const plan = planEcrafAdmissions({
			candidates: [candidate(0, 5, {}), candidate(1, 4, {}), candidate(2, 3, {})],
			runningUsage: {},
			capacities: {},
			slots: 3,
			conflicts: (a: EcrafCandidate, b: EcrafCandidate) =>
				(a.sourceIndex === 0 && b.sourceIndex === 1) || (a.sourceIndex === 1 && b.sourceIndex === 0),
		});
		// 0 admitted; 1 conflicts with 0 -> defer; 2 fine.
		expect(plan.admit).toEqual([0, 2]);
		expect(plan.deferred).toEqual([1]);
	});

	it("is deterministic and stable for identical input", () => {
		const input = {
			candidates: [candidate(0, 2, { cpu: 1 }), candidate(1, 2, { cpu: 1 }), candidate(2, 4, { cpu: 1 })],
			runningUsage: {},
			capacities: { cpu: 4 },
			slots: 2,
		};
		const a = planEcrafAdmissions(input);
		const b = planEcrafAdmissions(input);
		expect(a).toEqual(b);
	});
});
