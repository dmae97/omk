import { describe, expect, it } from "vitest";
import { MeasurementInputError } from "../src/core/performance-upgrade/measurement-trace.ts";
import {
	attributePhases,
	type PhaseSpan,
	turnSpeedupBound,
} from "../src/core/performance-upgrade/phase-attribution.ts";

// OMK_MATH_f46a8f6 B12: T_turn = t_settled - t_submit = sum_j T_j over a partition of the
// turn window into breakpoint segments, each assigned to exactly one phase.

function span(spanId: string, phase: PhaseSpan["phase"], start: number, end: number, parentId?: string): PhaseSpan {
	return { spanId, phase, monotonicStart: start, monotonicEnd: end, ...(parentId ? { parentId } : {}) };
}

function nonZero(ticks: Readonly<Record<string, number>>): Record<string, number> {
	return Object.fromEntries(Object.entries(ticks).filter(([, value]) => value !== 0));
}

describe("attributePhases", () => {
	it("gives each segment to the deepest covering span", () => {
		const result = attributePhases({
			submittedAt: 0,
			settledAt: 100,
			spans: [
				span("a", "tool", 0, 100),
				span("b", "permit", 10, 30, "a"),
				span("c", "provider", 40, 90, "a"),
				span("d", "retry", 50, 60, "c"),
			],
		});
		expect(result.turnTicks).toBe(100);
		expect(nonZero(result.phaseTicks)).toEqual({ tool: 30, permit: 20, provider: 40, retry: 10 });
		expect(Object.fromEntries(result.exclusiveTicks)).toEqual({ a: 30, b: 20, c: 40, d: 10 });
		expect(result.clippedSpans).toBe(0);
	});

	it("assigns uncovered time to unattributed", () => {
		const result = attributePhases({ submittedAt: 0, settledAt: 50, spans: [span("f", "fit", 10, 20)] });
		expect(nonZero(result.phaseTicks)).toEqual({ fit: 10, unattributed: 40 });
	});

	it("gives overlapping siblings' shared time to the one that ends last", () => {
		const result = attributePhases({
			submittedAt: 0,
			settledAt: 30,
			spans: [span("x", "tool", 0, 20), span("y", "render", 10, 30)],
		});
		expect(nonZero(result.phaseTicks)).toEqual({ tool: 10, render: 20 });
		// Exclusive times double count the overlap: sum_v e_v != T_turn in general.
		expect(Object.fromEntries(result.exclusiveTicks)).toEqual({ x: 20, y: 20 });
	});

	it("breaks remaining ties by later start, then by the smaller spanId", () => {
		const laterStart = attributePhases({
			submittedAt: 0,
			settledAt: 10,
			spans: [span("m", "claims", 0, 10), span("k", "dag", 5, 10)],
		});
		expect(nonZero(laterStart.phaseTicks)).toEqual({ claims: 5, dag: 5 });
		const sameInterval = attributePhases({
			submittedAt: 0,
			settledAt: 10,
			spans: [span("u1", "fit", 0, 10), span("u0", "count", 0, 10)],
		});
		expect(nonZero(sameInterval.phaseTicks)).toEqual({ count: 10 });
	});

	it("clips spans to the turn window so the partition still sums to T_turn", () => {
		// Unclipped breakpoints {95,100,130,140,200,210} would sum to 115 over a 100-tick turn.
		const result = attributePhases({
			submittedAt: 100,
			settledAt: 200,
			spans: [span("p", "startup", 95, 130), span("q", "drain", 140, 210)],
		});
		expect(result.clippedSpans).toBe(2);
		expect(nonZero(result.phaseTicks)).toEqual({ startup: 30, unattributed: 10, drain: 60 });
		expect(Object.values(result.phaseTicks).reduce((sum, value) => sum + value, 0)).toBe(100);
	});

	it("ranks overlapping spans by their real end, not the end clipped to the window", () => {
		// A ends at 150, B at 120: the overlap [20, 100) is A's in any window, even one that ends at
		// 100 and clips both ends to the same tick.
		const spans = [span("A", "tool", 10, 150), span("B", "render", 20, 120)];
		expect(nonZero(attributePhases({ submittedAt: 0, settledAt: 200, spans }).phaseTicks)).toEqual({
			tool: 140,
			unattributed: 60,
		});
		expect(nonZero(attributePhases({ submittedAt: 0, settledAt: 100, spans }).phaseTicks)).toEqual({
			tool: 90,
			unattributed: 10,
		});
	});

	it("returns an all-zero partition for an empty turn", () => {
		const result = attributePhases({ submittedAt: 7, settledAt: 7, spans: [span("z", "tool", 0, 20)] });
		expect(result.turnTicks).toBe(0);
		expect(nonZero(result.phaseTicks)).toEqual({});
	});

	it.each([
		["a duplicate spanId", [span("a", "tool", 0, 5), span("a", "fit", 1, 2)], "duplicate_id"],
		["an unknown parent", [span("a", "tool", 0, 5, "ghost")], "unknown_parent"],
		["a parent cycle", [span("a", "tool", 0, 5, "b"), span("b", "fit", 1, 2, "a")], "cycle"],
		["an end before its start", [span("a", "tool", 5, 4)], "invalid_interval"],
		["a fractional tick", [span("a", "tool", 0.5, 4)], "invalid_tick"],
		["a negative tick", [span("a", "tool", -1, 4)], "invalid_tick"],
		["an unknown phase", [{ ...span("a", "tool", 0, 4), phase: "network" as PhaseSpan["phase"] }], "invalid_phase"],
		["a non-string spanId", [{ ...span("a", "tool", 0, 4), spanId: 1 as unknown as string }], "invalid_id"],
		["a non-string parentId", [{ ...span("a", "tool", 0, 4), parentId: 7 as unknown as string }], "invalid_id"],
	])("rejects %s", (_label, spans, code) => {
		expect(() => attributePhases({ submittedAt: 0, settledAt: 10, spans })).toThrow(
			expect.objectContaining({ name: "MeasurementInputError", code }),
		);
	});

	it("rejects a window that ends before it starts", () => {
		expect(() => attributePhases({ submittedAt: 10, settledAt: 9, spans: [] })).toThrow(MeasurementInputError);
	});

	it("rejects a window whose ticks are not safe integers", () => {
		expect(() => attributePhases({ submittedAt: 0.5, settledAt: 9, spans: [] })).toThrow(
			expect.objectContaining({ code: "invalid_tick", field: "window" }),
		);
	});

	it("reads each span field once, so a getter cannot change a validated value", () => {
		const reads = new Map<string, number>();
		const counted = (spanId: string, phase: PhaseSpan["phase"], start: number, end: number): PhaseSpan => {
			const read =
				<T>(field: string, first: T, later: T) =>
				() => {
					const key = `${spanId}.${field}`;
					reads.set(key, (reads.get(key) ?? 0) + 1);
					return reads.get(key) === 1 ? first : later;
				};
			return Object.defineProperties({} as PhaseSpan, {
				spanId: { get: read("spanId", spanId, `${spanId}-changed`), enumerable: true },
				parentId: { get: read("parentId", undefined, "ghost"), enumerable: true },
				phase: { get: read("phase", phase, "network"), enumerable: true },
				monotonicStart: { get: read("monotonicStart", start, -1), enumerable: true },
				monotonicEnd: { get: read("monotonicEnd", end, 0.5), enumerable: true },
			});
		};
		const result = attributePhases({
			submittedAt: 0,
			settledAt: 30,
			spans: [counted("x", "tool", 0, 20), counted("y", "render", 10, 30)],
		});
		expect(nonZero(result.phaseTicks)).toEqual({ tool: 10, render: 20 });
		expect([...reads.values()].every((count) => count === 1)).toBe(true);
	});
});

describe("turnSpeedupBound", () => {
	it("is Amdahl's bound 1 / ((1 - f) + f / s)", () => {
		expect(turnSpeedupBound(0.25, 4)).toBe(1.2307692307692308);
		expect(turnSpeedupBound(0.25, Number.POSITIVE_INFINITY)).toBeCloseTo(4 / 3, 15);
		expect(turnSpeedupBound(0, 10)).toBe(1);
		expect(turnSpeedupBound(1, 2)).toBe(2);
	});

	it.each([
		[-0.1, 2],
		[1.1, 2],
		[0.5, 0],
		[0.5, Number.NaN],
		[true as unknown as number, 2],
		[0.5, "2" as unknown as number],
	])("rejects share %s with speedup %s", (share, speedup) => {
		expect(() => turnSpeedupBound(share, speedup)).toThrow(MeasurementInputError);
	});
});
