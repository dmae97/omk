import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
	MEASUREMENT_PHASES,
	MEASUREMENT_SPAN_OUTCOMES,
	type MeasurementSpan,
	parseMeasurementSpan,
} from "../src/core/performance-upgrade/measurement-trace.ts";

// OMK_MATH_f46a8f6 B12 trace fields: {runId, spanId, parentId, phase, monotonicStart,
// monotonicEnd, outcome, counts}. Every other field (prompts, credentials, environment) is dropped;
// ids are short tokens, which keeps prose out but not a token-shaped secret put there by a writer.

const ALLOWED_KEYS = ["counts", "monotonicEnd", "monotonicStart", "outcome", "parentId", "phase", "runId", "spanId"];

function line(overrides: Record<string, unknown> = {}): string {
	return JSON.stringify({
		runId: "run-1",
		spanId: "span-2",
		parentId: "span-1",
		phase: "tool",
		monotonicStart: 1_000,
		monotonicEnd: 4_500,
		outcome: "ok",
		counts: { calls: 3, bytesIn: 120 },
		...overrides,
	});
}

describe("parseMeasurementSpan", () => {
	it("projects exactly the allowlisted trace fields", () => {
		const span = parseMeasurementSpan(
			line({ prompt: "private prompt", apiKey: "sk-secret", env: { HOME: "/home/user" } }),
		);
		expect(span).toEqual({
			runId: "run-1",
			spanId: "span-2",
			parentId: "span-1",
			phase: "tool",
			monotonicStart: 1_000,
			monotonicEnd: 4_500,
			outcome: "ok",
			counts: { bytesIn: 120, calls: 3 },
		});
		expect(Object.keys(span ?? {}).every((key) => ALLOWED_KEYS.includes(key))).toBe(true);
		expect(JSON.stringify(span)).not.toMatch(/secret|private|HOME/);
	});

	it("keeps a root span without parentId", () => {
		const span = parseMeasurementSpan(line({ parentId: undefined }));
		expect(span?.parentId).toBeUndefined();
		expect(span && "parentId" in span).toBe(false);
	});

	it("reads a null parentId as a root span", () => {
		const span = parseMeasurementSpan(line({ parentId: null }));
		expect(span).toBeDefined();
		expect(span && "parentId" in span).toBe(false);
	});

	it("returns counts without an Object prototype", () => {
		const counts = parseMeasurementSpan(line())?.counts;
		expect(counts && Object.getPrototypeOf(counts)).toBeNull();
		expect(counts?.toString).toBeUndefined();
	});

	it("rejects an over-long line before parsing it", () => {
		expect(parseMeasurementSpan(line({ padding: "x".repeat(70_000) }))).toBeUndefined();
	});

	it("keeps a line just under the 64 KiB cap and drops its extra field", () => {
		const span = parseMeasurementSpan(line({ padding: "x".repeat(60_000) }));
		expect(span?.spanId).toBe("span-2");
		expect(span && "padding" in span).toBe(false);
	});

	it("accepts the documented limits exactly: 128-char ids, 32 counts, 64-char count names", () => {
		const counts = Object.fromEntries(Array.from({ length: 32 }, (_, i) => [`c${i}`, i]));
		const span = parseMeasurementSpan(line({ runId: "r".repeat(128), counts }));
		expect(span?.runId).toHaveLength(128);
		expect(Object.keys(span?.counts ?? {})).toHaveLength(32);
		const longName = `c${"x".repeat(63)}`;
		expect(parseMeasurementSpan(line({ counts: { [longName]: 1 } }))?.counts[longName]).toBe(1);
	});

	it.each([
		["not JSON", "{"],
		["an array", "[]"],
		["a bare string", '"span"'],
		["an unknown phase", line({ phase: "network" })],
		["an unknown outcome", line({ outcome: "crashed" })],
		["a fractional tick", line({ monotonicStart: 1.5 })],
		["a negative tick", line({ monotonicStart: -1 })],
		["an unsafe tick", line({ monotonicEnd: 2 ** 53 })],
		["an end before its start", line({ monotonicStart: 10, monotonicEnd: 9 })],
		["a missing runId", line({ runId: undefined })],
		["an id with spaces", line({ spanId: "span 2" })],
		["an over-long id", line({ runId: "r".repeat(129) })],
		["a dot id", line({ spanId: "." })],
		["a dot-dot id", line({ runId: ".." })],
		["a __proto__ id", line({ parentId: "__proto__" })],
		["a self parent", line({ parentId: "span-2" })],
		["a non-object counts", line({ counts: [1, 2] })],
		["a count key with content", line({ counts: { "rm -rf /": 1 } })],
		["a 65-char count name", line({ counts: { [`c${"x".repeat(64)}`]: 1 } })],
		[
			"a prototype count key",
			'{"runId":"r","spanId":"s","phase":"tool","monotonicStart":0,"monotonicEnd":1,"outcome":"ok","counts":{"__proto__":1}}',
		],
		["a count named like an Object method", line({ counts: { toString: 1 } })],
		["a constructor count", line({ counts: { constructor: 1 } })],
		["a negative count", line({ counts: { calls: -1 } })],
		["a fractional count", line({ counts: { calls: 0.5 } })],
		["too many counts", line({ counts: Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`c${i}`, i])) })],
	])("rejects %s", (_label, text) => {
		expect(parseMeasurementSpan(text)).toBeUndefined();
	});

	it("exposes the twelve B12 phases including unattributed", () => {
		expect(MEASUREMENT_PHASES).toEqual([
			"startup",
			"fit",
			"count",
			"claims",
			"dag",
			"permit",
			"provider",
			"retry",
			"tool",
			"render",
			"drain",
			"unattributed",
		]);
	});

	const idArb = fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,15}$/);
	const spanArb: fc.Arbitrary<MeasurementSpan> = fc
		.record({
			runId: idArb,
			spanId: idArb,
			parentId: fc.option(idArb, { nil: undefined }),
			phase: fc.constantFrom(...MEASUREMENT_PHASES),
			start: fc.nat({ max: 1_000_000 }),
			length: fc.nat({ max: 1_000_000 }),
			outcome: fc.constantFrom(...MEASUREMENT_SPAN_OUTCOMES),
			counts: fc.dictionary(fc.stringMatching(/^[A-Za-z][A-Za-z0-9_]{0,8}$/), fc.nat(), { maxKeys: 5 }),
		})
		.filter((value) => value.parentId !== value.spanId)
		.map(({ start, length, parentId, ...rest }) => ({
			...rest,
			...(parentId === undefined ? {} : { parentId }),
			monotonicStart: start,
			monotonicEnd: start + length,
		}));

	it("round-trips every valid span through JSON", () => {
		fc.assert(
			fc.property(spanArb, (span) => {
				expect(parseMeasurementSpan(JSON.stringify(span))).toEqual(span);
			}),
			{ numRuns: 500, seed: 20260928 },
		);
	});

	it("never throws on arbitrary JSON or text", () => {
		fc.assert(
			fc.property(
				fc.oneof(
					fc.string(),
					fc.jsonValue().map((value) => JSON.stringify(value)),
				),
				(text) => {
					const span = parseMeasurementSpan(text);
					if (span !== undefined) {
						expect(Object.keys(span).every((key) => ALLOWED_KEYS.includes(key))).toBe(true);
					}
				},
			),
			{ numRuns: 500, seed: 1701 },
		);
	});
});
