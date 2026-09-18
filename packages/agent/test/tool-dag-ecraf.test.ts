import fc from "fast-check";
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

	it("treats slots = 0 as a clean boundary that defers every candidate", () => {
		const plan = planEcrafAdmissions({
			candidates: [candidate(0, 1, {}), candidate(1, 1, {})],
			runningUsage: {},
			capacities: {},
			slots: 0,
		});
		expect(plan.admit).toEqual([]);
		expect(plan.deferred).toEqual([0, 1]);
	});

	describe("input contract (audit §5: malformed input is rejected, not coerced)", () => {
		const base = {
			candidates: [candidate(0, 1, { cpu: 1 })],
			runningUsage: {},
			capacities: { cpu: 1 },
			slots: 1,
		};

		it("rejects NaN slots — a NaN budget is not unbounded", () => {
			// B01: NaN admitted everything because every `admit.length >= NaN` is false.
			expect(() => planEcrafAdmissions({ ...base, slots: Number.NaN })).toThrow(RangeError);
		});

		it("rejects fractional slots — an admission count is integral", () => {
			// B02: 1.5 admitted two nodes because `length >= 1.5` only fails at 2.
			expect(() => planEcrafAdmissions({ ...base, slots: 1.5 })).toThrow(RangeError);
		});

		it("rejects NaN resource demand — NaN must not silence capacity checks", () => {
			// B03: NaN demand never exceeded any capacity and poisoned the reserve map.
			expect(() =>
				planEcrafAdmissions({
					...base,
					candidates: [candidate(0, 1, { cpu: Number.NaN })],
				}),
			).toThrow(RangeError);
		});

		it("rejects negative resource demand — demand cannot manufacture capacity", () => {
			// B04: a -10 demand dropped running usage below zero and admitted later
			// candidates that should not have fit.
			expect(() =>
				planEcrafAdmissions({
					...base,
					candidates: [candidate(0, 1, { cpu: -10 })],
					capacities: { cpu: 1 },
				}),
			).toThrow(RangeError);
		});

		it("rejects duplicate source indices — admit entries must identify unique nodes", () => {
			// B05: two candidates with sourceIndex 7 produced admit = [7, 7].
			expect(() =>
				planEcrafAdmissions({
					...base,
					candidates: [candidate(7, 1, {}), candidate(7, 2, {})],
					slots: 2,
				}),
			).toThrow(RangeError);
		});

		it("rejects duplicate readySeq — ready ordering must be unambiguous", () => {
			expect(() =>
				planEcrafAdmissions({
					...base,
					candidates: [
						{ sourceIndex: 0, readySeq: 3, resources: {}, priority: 1 },
						{ sourceIndex: 1, readySeq: 3, resources: {}, priority: 1 },
					],
					slots: 2,
				}),
			).toThrow(RangeError);
		});

		it("rejects negative running usage, capacity, epsilon, and resource weights", () => {
			expect(() => planEcrafAdmissions({ ...base, runningUsage: { cpu: -1 } })).toThrow(RangeError);
			expect(() => planEcrafAdmissions({ ...base, capacities: { cpu: -1 } })).toThrow(RangeError);
			expect(() => planEcrafAdmissions({ ...base, epsilon: 0 })).toThrow(RangeError);
			expect(() => planEcrafAdmissions({ ...base, epsilon: Number.NaN })).toThrow(RangeError);
			expect(() => planEcrafAdmissions({ ...base, resourceWeights: { cpu: -1 } })).toThrow(RangeError);
		});

		it("rejects negative priority — a ranking score is not a demand", () => {
			expect(() => planEcrafAdmissions({ ...base, candidates: [candidate(0, -1, {})] })).toThrow(RangeError);
		});

		it("keeps the documented 'missing capacity = unbounded' policy", () => {
			// B06: a candidate demanding a resource with no registered capacity is
			// admitted — that is the documented policy, not a defect.
			const plan = planEcrafAdmissions({
				candidates: [candidate(0, 1, { cpU: 5 })],
				runningUsage: {},
				capacities: { cpu: 1 },
				slots: 1,
			});
			expect(plan.admit).toEqual([0]);
		});
	});

	describe("admission invariants (audit §5.4: randomized well-formed input)", () => {
		const resourceName = fc.constantFrom("cpu", "mem", "io");
		const resourceVec = fc.dictionary(resourceName, fc.nat({ max: 100 }), { maxKeys: 3 });
		const candidateArb = fc
			.tuple(fc.nat({ max: 100 }), resourceVec)
			.map(([priority, resources]) => ({ priority, resources }));
		const inputArb = fc
			.tuple(fc.array(candidateArb, { minLength: 0, maxLength: 12 }), resourceVec, resourceVec, fc.nat({ max: 12 }))
			.map(([candidates, runningUsage, capacities, slots]) => ({
				candidates: candidates.map((entry, index) => ({
					sourceIndex: index,
					readySeq: index,
					resources: entry.resources,
					priority: entry.priority,
				})),
				runningUsage,
				capacities,
				slots,
			}));

		it("never violates uniqueness, slot bound, capacity bound, or input immutability", () => {
			fc.assert(
				fc.property(inputArb, (input) => {
					const snapshot = JSON.parse(JSON.stringify(input));
					const plan = planEcrafAdmissions(input);

					// admit + deferred partitions the candidates exactly once.
					expect(new Set(plan.admit).size).toBe(plan.admit.length);
					expect(new Set(plan.deferred).size).toBe(plan.deferred.length);
					const all = new Set([...plan.admit, ...plan.deferred]);
					expect(all.size).toBe(input.candidates.length);
					for (const index of all) {
						expect(index).toBeGreaterThanOrEqual(0);
						expect(index).toBeLessThan(input.candidates.length);
					}

					// No more admissions than free slots.
					expect(plan.admit.length).toBeLessThanOrEqual(input.slots);

					// The demand the planner newly admits stays inside the headroom
					// left by running usage — running usage may itself already exceed
					// capacity, and that is the caller's precondition, not the
					// planner's violation.
					const byIndex = new Map(input.candidates.map((entry) => [entry.sourceIndex, entry]));
					for (const [name, capacity] of Object.entries(input.capacities)) {
						let admitted = 0;
						for (const index of plan.admit) {
							admitted += byIndex.get(index)!.resources[name] ?? 0;
						}
						expect(admitted).toBeLessThanOrEqual(Math.max(0, capacity - (input.runningUsage[name] ?? 0)));
					}

					// The plan is a pure function: input is unchanged and re-planning
					// is deterministic.
					expect(input).toEqual(snapshot);
					expect(planEcrafAdmissions(input)).toEqual(plan);
				}),
				{ numRuns: 200 },
			);
		});

		it("never admits a node that conflicts with an admitted peer when a predicate is supplied", () => {
			fc.assert(
				fc.property(inputArb, (input) => {
					// Deterministic pseudo-conflict: pairs whose source indices sum
					// to 7 conflict — arbitrary but consistent within a run.
					const conflicts = (a: EcrafCandidate, b: EcrafCandidate) => a.sourceIndex + b.sourceIndex === 7;
					const plan = planEcrafAdmissions({ ...input, conflicts });
					for (const left of plan.admit) {
						for (const right of plan.admit) {
							if (left !== right) {
								expect(conflicts(byIndexOf(input, left), byIndexOf(input, right))).toBe(false);
							}
						}
					}
				}),
				{ numRuns: 200 },
			);
		});
	});
});

function byIndexOf(input: { candidates: readonly EcrafCandidate[] }, index: number): EcrafCandidate {
	return input.candidates[index];
}

describe("ECRAF unit-invariance (audit §13.3/§21.1)", () => {
	const A = { memory: 2, cpuWeight: 1 };
	const B = { memory: 1, cpuWeight: 4 };

	function order(units: "gib" | "bytes") {
		const scale = units === "gib" ? 1 : 1024 ** 3;
		return planEcrafAdmissions({
			candidates: [
				candidate(0, 1, { memory: A.memory * scale, cpuWeight: A.cpuWeight }),
				candidate(1, 1, { memory: B.memory * scale, cpuWeight: B.cpuWeight }),
			],
			runningUsage: {},
			capacities: {},
			slots: 1,
		}).admit[0];
	}

	it("raw unnormalized sum flips ranking when memory units change (known defect)", () => {
		// GiB numbers: A=3 < B=5 so A (sourceIndex 0) has higher density. In raw
		// bytes the memory term dominates and B (sourceIndex 1) wins instead.
		expect(order("gib")).toBe(0);
		expect(order("bytes")).toBe(1);
	});

	it("normalized demands keep the ranking stable across unit changes", () => {
		// memory scale 4 GiB, cpu scale 8 (spec §13.3): A=0.625 beats B=0.75 in both units.
		const scales = { memory: 4, cpuWeight: 8 };
		const ordered = (units: "gib" | "bytes") => {
			const scale = units === "gib" ? 1 : 1024 ** 3;
			return planEcrafAdmissions({
				candidates: [
					candidate(0, 1, { memory: A.memory * scale, cpuWeight: A.cpuWeight }),
					candidate(1, 1, { memory: B.memory * scale, cpuWeight: B.cpuWeight }),
				],
				runningUsage: {},
				capacities: {},
				slots: 2,
				referenceScales: { memory: scales.memory * scale, cpuWeight: scales.cpuWeight },
				slotCost: 0.001,
			}).admit;
		};
		expect(ordered("gib")).toEqual([0, 1]);
		expect(ordered("bytes")).toEqual([0, 1]);
	});
});
