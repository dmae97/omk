import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { MEASUREMENT_PHASES, type MeasurementPhase } from "../src/core/performance-upgrade/measurement-trace.ts";
import { attributePhases, type PhaseSpan } from "../src/core/performance-upgrade/phase-attribution.ts";

// B12 partition identity sum_j T_j = T_turn for any span forest, including spans that cross the
// turn window, checked against a tick-by-tick oracle that applies the same assignment rule.

interface Case {
	readonly spans: PhaseSpan[];
	readonly submittedAt: number;
	readonly settledAt: number;
}

const caseArb: fc.Arbitrary<Case> = fc
	.record({
		raw: fc.array(
			fc.record({
				a: fc.nat({ max: 60 }),
				b: fc.nat({ max: 60 }),
				phase: fc.constantFrom(...MEASUREMENT_PHASES),
				parent: fc.nat({ max: 1_000 }),
				hasParent: fc.boolean(),
			}),
			{ maxLength: 12 },
		),
		w0: fc.nat({ max: 60 }),
		w1: fc.nat({ max: 60 }),
	})
	.map(({ raw, w0, w1 }) => ({
		submittedAt: Math.min(w0, w1),
		settledAt: Math.max(w0, w1),
		spans: raw.map((item, index) => ({
			spanId: `s${index}`,
			phase: item.phase,
			monotonicStart: Math.min(item.a, item.b),
			monotonicEnd: Math.max(item.a, item.b),
			...(item.hasParent && index > 0 ? { parentId: `s${item.parent % index}` } : {}),
		})),
	}));

function depthOf(spans: readonly PhaseSpan[]): Map<string, number> {
	const byId = new Map(spans.map((span) => [span.spanId, span]));
	const depth = new Map<string, number>();
	const visit = (span: PhaseSpan): number => {
		const known = depth.get(span.spanId);
		if (known !== undefined) return known;
		const parent = span.parentId === undefined ? undefined : byId.get(span.parentId);
		const value = parent === undefined ? 0 : visit(parent) + 1;
		depth.set(span.spanId, value);
		return value;
	};
	for (const span of spans) visit(span);
	return depth;
}

function tickOracle({ spans, submittedAt, settledAt }: Case): Record<MeasurementPhase, number> {
	const totals = Object.fromEntries(MEASUREMENT_PHASES.map((phase) => [phase, 0])) as Record<MeasurementPhase, number>;
	const depth = depthOf(spans);
	const clip = (value: number) => Math.min(Math.max(value, submittedAt), settledAt);
	for (let tick = submittedAt; tick < settledAt; tick++) {
		const covering = spans.filter((span) => clip(span.monotonicStart) <= tick && tick < clip(span.monotonicEnd));
		// Ranking uses the real (unclipped) ends and starts; clipping only bounds the window.
		covering.sort(
			(x, y) =>
				(depth.get(y.spanId) ?? 0) - (depth.get(x.spanId) ?? 0) ||
				y.monotonicEnd - x.monotonicEnd ||
				y.monotonicStart - x.monotonicStart ||
				(x.spanId < y.spanId ? -1 : 1),
		);
		totals[covering[0]?.phase ?? "unattributed"]++;
	}
	return totals;
}

describe("attributePhases partition properties", () => {
	it("sums to the turn length and matches the tick oracle", () => {
		fc.assert(
			fc.property(caseArb, (input) => {
				const result = attributePhases(input);
				const phaseSum = MEASUREMENT_PHASES.reduce((sum, phase) => sum + result.phaseTicks[phase], 0);
				expect(result.turnTicks).toBe(input.settledAt - input.submittedAt);
				expect(phaseSum).toBe(result.turnTicks);
				expect(MEASUREMENT_PHASES.every((phase) => result.phaseTicks[phase] >= 0)).toBe(true);
				expect(result.phaseTicks).toEqual(tickOracle(input));
			}),
			{ numRuns: 1_000, seed: 20260928 },
		);
	});

	it("does not depend on span order", () => {
		fc.assert(
			fc.property(caseArb, fc.nat(), (input, rotation) => {
				const shift = input.spans.length === 0 ? 0 : rotation % input.spans.length;
				const rotated = [...input.spans.slice(shift), ...input.spans.slice(0, shift)].reverse();
				const a = attributePhases(input);
				const b = attributePhases({ ...input, spans: rotated });
				expect(b.phaseTicks).toEqual(a.phaseTicks);
				expect(Object.fromEntries(b.exclusiveTicks)).toEqual(Object.fromEntries(a.exclusiveTicks));
			}),
			{ numRuns: 300, seed: 31415 },
		);
	});
});
