import { describe, expect, it } from "vitest";
import { type EcrafAdmissionsOptions, planEcrafAdmissions } from "../src/tool-dag-ecraf.ts";

const MAX = Number.MAX_VALUE;

function options(overrides: Partial<EcrafAdmissionsOptions> = {}): EcrafAdmissionsOptions {
	return {
		candidates: [{ sourceIndex: 0, readySeq: 0, priority: 1, resources: { cpu: 1 } }],
		runningUsage: {},
		capacities: {},
		slots: 1,
		...overrides,
	};
}

function node(sourceIndex: number, resources: Record<string, number>, priority = 1) {
	return { sourceIndex, readySeq: sourceIndex, priority, resources };
}

describe("ECRAF finite arithmetic", () => {
	it.each([
		["weighted demand", options({ candidates: [node(0, { cpu: MAX })], resourceWeights: { cpu: 2 } })],
		["resource sum", options({ candidates: [node(0, { cpu: MAX, mem: MAX })] })],
		["denominator", options({ candidates: [node(0, { cpu: MAX })], epsilon: MAX })],
		["density", options({ candidates: [node(0, {}, MAX)] })],
	])("rejects overflow in %s even for a single candidate", (_label, input) => {
		expect(() => planEcrafAdmissions(input)).toThrow(RangeError);
	});

	it("validates a zero-slot batch rather than hiding an invalid score", () => {
		expect(() => planEcrafAdmissions(options({ candidates: [node(0, {}, MAX)], slots: 0 }))).toThrow(RangeError);
	});

	it("validates scores before invoking the caller's conflict predicate", () => {
		let conflictCalls = 0;
		const input = options({
			candidates: [node(0, {}, MAX), node(1, {})],
			slots: 2,
			conflicts: () => {
				conflictCalls++;
				return false;
			},
		});
		expect(() => planEcrafAdmissions(input)).toThrow(RangeError);
		expect(conflictCalls).toBe(0);
	});

	it.each([false, true])("rejects unbounded usage overflow (initial usage: %s)", (initialUsage) => {
		const input = options({
			candidates: initialUsage ? [node(0, { cpu: MAX })] : [node(0, { cpu: MAX }), node(1, { cpu: MAX })],
			runningUsage: initialUsage ? { cpu: MAX } : {},
			resourceWeights: { cpu: 0 },
			slots: 2,
		});
		const snapshot = structuredClone(input);
		expect(() => planEcrafAdmissions(input)).toThrow(RangeError);
		expect(input).toEqual(snapshot);
	});

	it("defers a bounded overflow without rejecting the next feasible candidate", () => {
		const plan = planEcrafAdmissions(
			options({
				candidates: [node(0, { cpu: MAX }, 2), node(1, { io: 1 })],
				runningUsage: { cpu: MAX },
				capacities: { cpu: MAX, io: 1 },
				resourceWeights: { cpu: 0 },
				slots: 2,
			}),
		);
		expect(plan).toEqual({ admit: [1], deferred: [0] });
	});

	it("keeps large representable values and zero weights valid", () => {
		const input = options({
			candidates: [node(0, { cpu: MAX / 2 }, MAX)],
			runningUsage: { cpu: MAX / 2 },
			capacities: { cpu: MAX },
			resourceWeights: { cpu: 0 },
			epsilon: 1,
		});
		expect(planEcrafAdmissions(input)).toEqual({ admit: [0], deferred: [] });
	});
});
