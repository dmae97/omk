import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
	challengeEcrafLocalExchange,
	type EcrafAdmissionsOptions,
	planEcrafAdmissions,
} from "../src/tool-dag-ecraf.ts";

function node(sourceIndex: number, resources: Record<string, number>, priority = 1) {
	return { sourceIndex, readySeq: sourceIndex, resources, priority };
}

function normalized(overrides: Partial<EcrafAdmissionsOptions> = {}): EcrafAdmissionsOptions {
	return {
		algorithmVersion: "normalized-v2",
		candidates: [node(0, { memory: 2, cpu: 1 }), node(1, { memory: 1, cpu: 4 })],
		runningUsage: {},
		capacities: { memory: 4, cpu: 8 },
		slots: 2,
		...overrides,
	};
}

describe("ECRAF normalized-v2", () => {
	it("reports the synthetic density gap without changing the greedy plan (F13)", () => {
		const input = normalized({
			candidates: [node(0, { cpu: 6 }, 11), node(1, { cpu: 5 }, 9), node(2, { cpu: 5 }, 9)],
			capacities: { cpu: 10 },
			slots: 2,
			slotCost: 1,
			referenceScales: { cpu: 10 },
		});
		expect(planEcrafAdmissions(input).admit).toEqual([0]);
		const exchange = challengeEcrafLocalExchange(input);
		expect(exchange.baseline).toEqual([0]);
		expect(exchange.baselinePriority).toBe(11);
		expect(exchange.challengerPriority).toBe(18);
		expect(exchange.challenger).toEqual([1, 2]);
	});

	it("retains deterministic readySeq ordering and zero-slot partitioning", () => {
		const input = normalized({
			candidates: [
				{ ...node(7, {}), readySeq: 1 },
				{ ...node(2, {}), readySeq: 0 },
			],
		});
		expect(planEcrafAdmissions(input)).toEqual({ admit: [2, 7], deferred: [] });
		expect(planEcrafAdmissions({ ...input, slots: 0 })).toEqual({ admit: [], deferred: [2, 7] });
	});

	it.each<Partial<EcrafAdmissionsOptions>>([
		{ candidates: [node(0, {}), { ...node(0, {}), readySeq: 1 }] },
		{ candidates: [node(0, {}), { ...node(1, {}), readySeq: 0 }] },
		{ candidates: [node(0, { cpu: -1 })] },
		{ candidates: [node(0, { cpu: Number.NaN })] },
		{ runningUsage: { cpu: -1 } },
		{ capacities: { cpu: -1 } },
		{ resourceWeights: { cpu: -1 } },
		{ slots: 1.5 },
		{ slots: Number.NaN },
	])("retains the input rejection contract in v2", (overrides) => {
		expect(() => planEcrafAdmissions(normalized(overrides))).toThrow(RangeError);
	});

	it("defers positive zero-capacity demand before scoring, ignoring zero demand even with held usage", () => {
		expect(
			planEcrafAdmissions(
				normalized({
					candidates: [node(0, { memory: 1 }, Number.MAX_VALUE), node(1, { memory: 0 }, 0)],
					capacities: { memory: 0 },
					runningUsage: { memory: 3 },
					epsilon: Number.MIN_VALUE,
					slotCost: Number.MIN_VALUE,
				}),
			),
		).toEqual({ admit: [1], deferred: [0] });
	});

	it("rejects unknown versions and normalization options on legacy-v1", () => {
		for (const overrides of [
			{ algorithmVersion: "future" },
			{ algorithmVersion: "legacy-v1", referenceScales: { memory: 4, cpu: 8 } },
			{ algorithmVersion: "legacy-v1", slotCost: 1 },
			{ algorithmVersion: undefined, slotCost: 1 },
		]) {
			expect(() => Reflect.apply(planEcrafAdmissions, undefined, [{ ...normalized(), ...overrides }])).toThrow(
				RangeError,
			);
		}
	});

	it("uses positive capacities as fixed scales, including memory expressed in bytes", () => {
		const gib = 1024 ** 3;
		expect(
			planEcrafAdmissions(
				normalized({
					candidates: [node(0, { memory: 2 * gib, cpu: 1 }), node(1, { memory: gib, cpu: 4 })],
					capacities: { memory: 4 * gib, cpu: 8 },
				}),
			),
		).toEqual({ admit: [0, 1], deferred: [] });
	});

	it.each<number>([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
		"rejects invalid slot cost and scales (%s), even without work",
		(value) => {
			for (const candidates of [[], [node(0, {})]]) {
				expect(() => planEcrafAdmissions(normalized({ candidates, slots: 0, slotCost: value }))).toThrow(
					RangeError,
				);
				expect(() =>
					planEcrafAdmissions(normalized({ candidates, slots: 0, referenceScales: { unused: value } })),
				).toThrow(RangeError);
			}
		},
	);

	it("requires explicit scales for positive unbounded demands even with zero weight or slots", () => {
		for (const slots of [0, 1]) {
			expect(() =>
				planEcrafAdmissions(normalized({ capacities: {}, slots, resourceWeights: { memory: 0 } })),
			).toThrow(/referenceScales.memory/);
		}
		expect(planEcrafAdmissions(normalized({ capacities: {}, referenceScales: { memory: 4, cpu: 8 } })).admit).toEqual(
			[0, 1],
		);
		expect(planEcrafAdmissions(normalized({ capacities: {}, candidates: [node(0, { unknown: 0 })] })).admit).toEqual([
			0,
		]);
		expect(() => planEcrafAdmissions(normalized({ capacities: { memory: Number.POSITIVE_INFINITY } }))).toThrow(
			RangeError,
		);
	});

	it("uses explicit scales over capacity, not remaining headroom", () => {
		expect(planEcrafAdmissions(normalized({ referenceScales: { memory: 1, cpu: 8 } })).admit).toEqual([1, 0]);
		expect(planEcrafAdmissions(normalized({ runningUsage: { memory: 1 }, slots: 1 })).admit).toEqual([0]);
	});

	it("charges a positive slot cost even for empty and zero resource vectors", () => {
		// Without the slot term the empty low-priority node would dominate.
		const input = normalized({ candidates: [node(0, {}, 1), node(1, { cpu: 8 }, 3)], slots: 1 });
		expect(planEcrafAdmissions(input).admit).toEqual([1]);
		expect(
			planEcrafAdmissions({ ...input, candidates: [node(0, { cpu: 0 }, 1), node(1, { cpu: 8 }, 3)] }).admit,
		).toEqual([1]);
		expect(planEcrafAdmissions({ ...input, slotCost: 0.1 }).admit).toEqual([0]);
	});

	it("retains legacy defaults, explicit legacy order, and scales-only opt-in", () => {
		const input = normalized({
			candidates: [node(0, { memory: 2 * 1024 ** 3, cpu: 1 }), node(1, { memory: 1024 ** 3, cpu: 4 })],
			capacities: {},
		});
		for (const algorithmVersion of [undefined, "legacy-v1"] as const) {
			expect(planEcrafAdmissions({ ...input, algorithmVersion }).admit).toEqual([1, 0]);
		}
		expect(
			planEcrafAdmissions({
				...input,
				algorithmVersion: undefined,
				referenceScales: { memory: 4 * 1024 ** 3, cpu: 8 },
			}).admit,
		).toEqual([0, 1]);
	});

	it.each<Partial<EcrafAdmissionsOptions>>([
		{ candidates: [node(0, { cpu: Number.MAX_VALUE })], referenceScales: { cpu: Number.MIN_VALUE } },
		{ candidates: [node(0, { cpu: Number.MAX_VALUE })], referenceScales: { cpu: 1 }, resourceWeights: { cpu: 2 } },
		{
			candidates: [node(0, { cpu: Number.MAX_VALUE, memory: Number.MAX_VALUE })],
			referenceScales: { cpu: 1, memory: 1 },
		},
		{ candidates: [node(0, {})], epsilon: Number.MAX_VALUE, slotCost: Number.MAX_VALUE },
		{ candidates: [node(0, {}, Number.MAX_VALUE)], epsilon: Number.MIN_VALUE, slotCost: Number.MIN_VALUE },
	])("rejects non-finite normalized arithmetic before conflict callbacks", (overrides) => {
		let calls = 0;
		for (const slots of [0, 2]) {
			expect(() =>
				planEcrafAdmissions(
					normalized({
						...overrides,
						slots,
						conflicts: () => {
							calls++;
							return false;
						},
					}),
				),
			).toThrow(RangeError);
		}
		expect(calls).toBe(0);
	});

	it("keeps bounded overflow deferred and rejects unbounded reservation overflow without mutation", () => {
		const input = normalized({
			candidates: [node(0, { cpu: Number.MAX_VALUE }), node(1, { cpu: Number.MAX_VALUE })],
			capacities: {},
			referenceScales: { cpu: Number.MAX_VALUE },
		});
		const snapshot = structuredClone(input);
		expect(() => planEcrafAdmissions(input)).toThrow(/reserved usage/);
		expect(input).toEqual(snapshot);
		expect(planEcrafAdmissions({ ...input, capacities: { cpu: Number.MAX_VALUE } })).toEqual({
			admit: [0],
			deferred: [1],
		});
	});

	it("preserves order, feasibility, conflicts and inputs under independent power-of-two unit changes", () => {
		fc.assert(
			fc.property(
				fc.array(fc.record({ memory: fc.nat(8), cpu: fc.nat(8), priority: fc.nat(20) }), { maxLength: 10 }),
				fc.integer({ min: -20, max: 30 }),
				fc.integer({ min: -20, max: 30 }),
				fc.nat(10),
				fc.nat(4),
				fc.boolean(),
				(entries, memoryPower, cpuPower, slots, held, unbounded) => {
					const candidates = entries.map(({ memory, cpu, priority }, i) => node(i, { memory, cpu }, priority));
					const input = normalized({
						candidates,
						slots,
						capacities: unbounded ? {} : { memory: 16, cpu: 16 },
						referenceScales: { memory: 16, cpu: 16 },
						runningUsage: { memory: held, cpu: held },
					});
					const snapshot = structuredClone(input);
					const conflicts = (a: { sourceIndex: number }, b: { sourceIndex: number }) =>
						a.sourceIndex + b.sourceIndex === 7;
					const plan = planEcrafAdmissions({ ...input, conflicts });
					const memory = 2 ** memoryPower;
					const cpu = 2 ** cpuPower;
					expect(
						planEcrafAdmissions({
							...input,
							conflicts,
							candidates: candidates.map((entry) => ({
								...entry,
								resources: { memory: entry.resources.memory * memory, cpu: entry.resources.cpu * cpu },
							})),
							referenceScales: { memory: 16 * memory, cpu: 16 * cpu },
							capacities: unbounded ? {} : { memory: 16 * memory, cpu: 16 * cpu },
							runningUsage: { memory: held * memory, cpu: held * cpu },
						}),
					).toEqual(plan);
					expect(input).toEqual(snapshot);
					expect(plan.admit.length).toBeLessThanOrEqual(slots);
					expect([...plan.admit, ...plan.deferred].sort((a, b) => a - b)).toEqual(entries.map((_, i) => i));
					for (const left of plan.admit) {
						for (const right of plan.admit) {
							if (left !== right) expect(left + right).not.toBe(7);
						}
					}
					if (!unbounded) {
						for (const name of ["memory", "cpu"] as const) {
							expect(plan.admit.reduce((sum, i) => sum + entries[i][name], held)).toBeLessThanOrEqual(16);
						}
					}
				},
			),
			{ seed: 110917, numRuns: 300 },
		);
	});
});
