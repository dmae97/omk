import { describe, expect, it } from "vitest";
import { ownResourceNumber } from "../src/tool-dag-own-number.ts";

describe("ownResourceNumber", () => {
	it("returns the value for an own key", () => {
		expect(ownResourceNumber({ a: 1 }, "a")).toBe(1);
	});

	it("returns zero when the own value is zero", () => {
		expect(ownResourceNumber({ a: 0 }, "a")).toBe(0);
	});

	it("returns undefined for a missing key", () => {
		expect(ownResourceNumber({ a: 1 }, "b")).toBeUndefined();
	});

	it.each(["toString", "constructor", "__proto__"])("never reads an inherited Object.prototype key (%s)", (key) => {
		expect(ownResourceNumber({ a: 1 }, key)).toBeUndefined();
	});

	it("reads an own key from a null-prototype map", () => {
		const values = Object.assign(Object.create(null), { x: 2 });
		expect(ownResourceNumber(values, "x")).toBe(2);
	});
});
