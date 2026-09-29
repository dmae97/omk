import { describe, expect, it } from "vitest";
import { MeasurementInputError } from "../src/core/performance-upgrade/measurement-trace.ts";
import {
	type ArmObservation,
	evaluatePromotion,
	type PairedBlock,
	type PromotionPolicy,
} from "../src/core/performance-upgrade/promotion-gate.ts";

// OMK_MATH_f46a8f6 B12 promotion: promote iff semanticGate and l_X > delta_T / tau and
// l_Y >= -eps_Q and l_Z >= -eps_F. `harm` (u_X < 0 or u_Y < -eps_Q or u_Z < -eps_F) is this
// implementation's definition of the bundle's undefined harmEstablished.

const POLICY: PromotionPolicy = {
	capMs: 2000,
	minLatencyGainMs: 100,
	successMargin: 0.2,
	falseCompletionMargin: 0.2,
};

function arm(latencyMs: number | null, success = true, falseCompletion = false): ArmObservation {
	return { latencyMs, success, falseCompletion };
}

function blocks(count: number, baseline: ArmObservation, candidate: ArmObservation): PairedBlock[] {
	return Array.from({ length: count }, (_, index) => ({
		blockId: `b${index}`,
		order: index % 2 === 0 ? "01" : "10",
		baseline,
		candidate,
	}));
}

describe("evaluatePromotion", () => {
	it("promotes a large, clean latency gain once the time-uniform bound clears delta_T / tau", () => {
		const report = evaluatePromotion(blocks(2000, arm(1000), arm(400)), POLICY, true);
		expect(report.familySize).toBe(8);
		expect(report.latency.mean).toBeCloseTo(0.3, 15);
		expect(report.latency.lower).toBeCloseTo(0.15518761865807335, 12);
		expect(report.latency.effect).toBeCloseTo(600, 9);
		expect(report.success.lower).toBeCloseTo(-0.14481238134192664, 12);
		expect(report.decision).toBe("promote");
		expect(report.orderCounts).toEqual({ "01": 1000, "10": 1000 });
	});

	it("never promotes when the semantic gate is closed", () => {
		const report = evaluatePromotion(blocks(2000, arm(1000), arm(400)), POLICY, false);
		expect(report.decision).toBe("noDecision");
	});

	it("opens the semantic gate only for the boolean true", () => {
		const data = blocks(2000, arm(1000), arm(400));
		for (const gate of ["false", 1, "true"]) {
			expect(evaluatePromotion(data, POLICY, gate as unknown as boolean).decision).toBe("noDecision");
		}
	});

	it("reports harm when the candidate is slower beyond the bound", () => {
		expect(evaluatePromotion(blocks(2000, arm(400), arm(1000)), POLICY, true).decision).toBe("harm");
	});

	it("reports harm from a success drop or a false-completion rise alone", () => {
		const successDrop = evaluatePromotion(blocks(2000, arm(1000), arm(1000, false)), POLICY, true);
		expect(successDrop.success.upper).toBeLessThan(-POLICY.successMargin);
		expect(successDrop.decision).toBe("harm");
		const falseCompletions = evaluatePromotion(blocks(2000, arm(1000), arm(1000, true, true)), POLICY, true);
		expect(falseCompletions.falseCompletion.upper).toBeLessThan(-POLICY.falseCompletionMargin);
		expect(falseCompletions.decision).toBe("harm");
	});

	it("applies each margin to its own metric", () => {
		// Half the candidate runs fail: mean Y = -0.5, u_Y = -0.355. That is harm under eps_Q = 0.1
		// and not under eps_Q = 0.9, whatever eps_F is.
		const data = Array.from({ length: 2000 }, (_, index) => ({
			blockId: `h${index}`,
			order: "01" as const,
			baseline: arm(1000),
			candidate: arm(1000, index % 2 === 0),
		}));
		const lenient = { ...POLICY, successMargin: 0.9, falseCompletionMargin: 0.1 };
		const strict = { ...POLICY, successMargin: 0.1, falseCompletionMargin: 0.9 };
		expect(evaluatePromotion(data, lenient, true).decision).toBe("noDecision");
		expect(evaluatePromotion(data, strict, true).decision).toBe("harm");
	});

	it("reports harm even when the semantic gate is closed", () => {
		expect(evaluatePromotion(blocks(2000, arm(400), arm(1000)), POLICY, false).decision).toBe("harm");
	});

	it("caps a candidate latency above tau in its p95 band", () => {
		const report = evaluatePromotion(blocks(50, arm(1000), arm(5000)), POLICY, true);
		expect(report.p95.candidate).toMatchObject({ estimate: 2000, upper: 2000, upperIsCap: true });
		expect(report.latency.mean).toBeCloseTo(-0.5, 15);
	});

	it("makes no decision on a small sample", () => {
		const report = evaluatePromotion(blocks(10, arm(1000), arm(400)), POLICY, true);
		expect(report.latency.lower).toBe(-1);
		expect(report.decision).toBe("noDecision");
	});

	it("has bottom statistics and no decision at n = 0", () => {
		const report = evaluatePromotion([], POLICY, true);
		expect(report.n).toBe(0);
		expect(report.latency).toEqual({
			mean: undefined,
			lower: -1,
			upper: 1,
			pValue: undefined,
			effect: undefined,
		});
		expect(report.effectSizeDz).toBeUndefined();
		expect(report.decision).toBe("noDecision");
	});

	it("counts an interrupted run at tau and keeps it in the denominator", () => {
		const report = evaluatePromotion(
			[{ blockId: "b0", order: "10", baseline: arm(null, false), candidate: arm(500) }],
			POLICY,
			true,
		);
		expect(report.n).toBe(1);
		expect(report.latency.mean).toBeCloseTo(0.75, 15);
		expect(report.success.mean).toBe(1);
		expect(report.p95.baseline.estimate).toBe(2000);
	});

	it("computes d_z on the millisecond differences", () => {
		const report = evaluatePromotion(
			[
				{ blockId: "a", order: "01", baseline: arm(1000), candidate: arm(800) },
				{ blockId: "b", order: "10", baseline: arm(1000), candidate: arm(400) },
			],
			POLICY,
			true,
		);
		expect(report.effectSizeDz).toBeCloseTo(Math.SQRT2, 12);
		expect(report.latency.effect).toBeCloseTo(400, 9);
	});

	it("has no d_z when every block has the same difference (s_D = 0 exactly)", () => {
		// Floating-point means of identical values can miss them by an ulp (0.3 / 3 !== 0.1); that
		// noise must not turn s_D = 0 into d_z near 1e16.
		const report = evaluatePromotion(blocks(7, arm(1234.5), arm(1000.1)), POLICY, true);
		expect(report.effectSizeDz).toBeUndefined();
		expect(evaluatePromotion(blocks(3, arm(1000), arm(800)), POLICY, true).effectSizeDz).toBeUndefined();
	});

	it("has no d_z when the spread underflows to zero", () => {
		const report = evaluatePromotion(
			[
				{ blockId: "a", order: "01", baseline: arm(1e-200), candidate: arm(0) },
				{ blockId: "b", order: "10", baseline: arm(2e-200), candidate: arm(0) },
			],
			POLICY,
			true,
		);
		expect(report.effectSizeDz).toBeUndefined();
	});

	it("tests each metric against its own null boundary", () => {
		const report = evaluatePromotion(blocks(2000, arm(1000), arm(400)), POLICY, true);
		// H0: E X <= delta_T / tau is rejected; H0: E Y <= -eps_Q is rejected at mean 0.
		expect(report.latency.pValue).toBeLessThan(0.05);
		expect(report.success.pValue).toBeLessThan(0.05);
	});

	it("reports an invalid alpha before looking at any block", () => {
		const malformed = [{ ...blocks(1, arm(1), arm(1))[0], order: "00" as PairedBlock["order"] }];
		expect(() => evaluatePromotion(malformed, { ...POLICY, alpha: 2 }, true)).toThrow(
			expect.objectContaining({ code: "invalid_number", field: "alpha" }),
		);
	});

	it("requires J >= metrics x candidates x arms", () => {
		const data = blocks(3, arm(1000), arm(400));
		expect(() => evaluatePromotion(data, { ...POLICY, familySize: 7 }, true)).toThrow(
			expect.objectContaining({ code: "family_too_small" }),
		);
		expect(evaluatePromotion(data, { ...POLICY, candidateCount: 2 }, true).familySize).toBe(16);
		expect(evaluatePromotion(data, { ...POLICY, familySize: 20 }, true).familySize).toBe(20);
	});

	it.each([
		["a duplicate block", [...blocks(1, arm(1), arm(1)), ...blocks(1, arm(1), arm(1))], "duplicate_id"],
		["a success without a settled latency", blocks(1, arm(null, true), arm(1)), "contradictory_record"],
		["a non-boolean success", blocks(1, { ...arm(1), success: null as unknown as boolean }, arm(1)), "invalid_flag"],
		[
			"a non-boolean false completion",
			blocks(1, arm(1), { ...arm(1), falseCompletion: "1" as unknown as boolean }),
			"invalid_flag",
		],
		["a string latency", blocks(1, { ...arm(1), latencyMs: "5" as unknown as number }, arm(1)), "invalid_number"],
		["a negative latency", blocks(1, arm(-1), arm(1)), "invalid_number"],
		["an infinite latency", blocks(1, arm(Number.POSITIVE_INFINITY), arm(1)), "invalid_number"],
		[
			"an unknown pair order",
			[{ ...blocks(1, arm(1), arm(1))[0], order: "00" as PairedBlock["order"] }],
			"invalid_order",
		],
		["a non-string block id", [{ ...blocks(1, arm(1), arm(1))[0], blockId: {} as unknown as string }], "invalid_id"],
	])("rejects %s", (_label, data, code) => {
		expect(() => evaluatePromotion(data, POLICY, true)).toThrow(expect.objectContaining({ code }));
	});

	it.each([
		{ ...POLICY, capMs: 0 },
		{ ...POLICY, minLatencyGainMs: -1 },
		{ ...POLICY, successMargin: Number.NaN },
		{ ...POLICY, alpha: 1 },
		{ ...POLICY, alpha: null as unknown as number },
		{ ...POLICY, familySize: null as unknown as number },
		{ ...POLICY, candidateCount: null as unknown as number },
	])("rejects policy %o", (policy) => {
		expect(() => evaluatePromotion([], policy, true)).toThrow(MeasurementInputError);
	});

	it("reads each policy and block field once, so a getter cannot change a validated value", () => {
		const reads = new Map<string, number>();
		const once =
			<T>(name: string, first: T, later: T) =>
			() => {
				reads.set(name, (reads.get(name) ?? 0) + 1);
				return reads.get(name) === 1 ? first : later;
			};
		const policy = Object.defineProperties({} as PromotionPolicy, {
			capMs: { get: once("capMs", 2000, -5), enumerable: true },
			minLatencyGainMs: { get: once("minLatencyGainMs", 100, -1), enumerable: true },
			successMargin: { get: once("successMargin", 0.2, 5), enumerable: true },
			falseCompletionMargin: { get: once("falseCompletionMargin", 0.2, 5), enumerable: true },
		});
		const block = Object.defineProperties({} as PairedBlock, {
			blockId: { get: once("blockId", "b0", "b1"), enumerable: true },
			order: { get: once("order", "01", "00"), enumerable: true },
			baseline: { get: once("baseline", arm(1000), arm(0)), enumerable: true },
			candidate: { get: once("candidate", arm(400), arm(2000)), enumerable: true },
		});
		const report = evaluatePromotion([block], policy, true);
		expect(report.latency.mean).toBeCloseTo(0.3, 15);
		expect(report.decision).toBe("noDecision");
		expect([...reads.values()].every((count) => count === 1)).toBe(true);
	});
});
