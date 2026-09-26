import { describe, expect, it } from "vitest";
import { boundedAdmissionJson } from "../src/core/request-admission-json.ts";

describe("bounded provider admission JSON", () => {
	it("prices escaping and preserves ordinary JSON", () => {
		const input = { quote: 'a\n"한글😀', nested: [null, true, 0, { key: "value" }] };
		const expected = JSON.stringify(input);
		const budget = { remaining: expected.length, nodes: 0 };
		expect(boundedAdmissionJson(input, budget)).toBe(expected);
		expect(budget.remaining).toBe(0);
		expect(() => boundedAdmissionJson(input, { remaining: expected.length - 1, nodes: 0 })).toThrow();
	});
	it("does not execute custom serializers", () => {
		let invoked = 0;
		const value = {
			toJSON: () => {
				invoked++;
				return {};
			},
		};
		expect(() => boundedAdmissionJson(value, { remaining: 100, nodes: 0 })).toThrow();
		expect(invoked).toBe(0);
	});
	it("refuses cyclic data and accessors", () => {
		const circular: { child?: unknown } = {};
		circular.child = circular;
		expect(() => boundedAdmissionJson(circular, { remaining: 1000, nodes: 0 })).toThrow();
		const accessor = Object.defineProperty({}, "value", {
			enumerable: true,
			get: () => {
				throw new Error("must not run");
			},
		});
		expect(() => boundedAdmissionJson(accessor, { remaining: 1000, nodes: 0 })).toThrow("admission.json_accessor");
	});
});
