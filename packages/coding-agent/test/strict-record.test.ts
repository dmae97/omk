import { describe, expect, it } from "vitest";
import { isExactRecord } from "../src/core/strict-record.ts";

describe("isExactRecord", () => {
	it("accepts an object with exactly the expected keys, in any order", () => {
		expect(isExactRecord({ a: 1, b: 2 }, ["b", "a"])).toBe(true);
	});

	it("accepts an empty object when no keys are expected", () => {
		expect(isExactRecord({}, [])).toBe(true);
	});

	it("rejects an object missing an expected key", () => {
		expect(isExactRecord({ a: 1 }, ["a", "b"])).toBe(false);
	});

	it("rejects an object with the same number of keys but a different key name", () => {
		expect(isExactRecord({ a: 1, b: 2 }, ["a", "c"])).toBe(false);
	});

	it("rejects an object with an extra key", () => {
		expect(isExactRecord({ a: 1, b: 2 }, ["a"])).toBe(false);
	});

	it("rejects an empty expected key list for a non-empty object", () => {
		expect(isExactRecord({ a: 1 }, [])).toBe(false);
	});

	it("counts a key present with value undefined as a key", () => {
		expect(isExactRecord({ a: 1, b: undefined }, ["a"])).toBe(false);
	});

	it("rejects null", () => {
		expect(isExactRecord(null, ["a"])).toBe(false);
	});

	it("rejects arrays, including one holding the expected key", () => {
		expect(isExactRecord([], ["a"])).toBe(false);
		expect(isExactRecord(["a"], ["a"])).toBe(false);
	});

	it("rejects strings and numbers", () => {
		expect(isExactRecord("a", ["a"])).toBe(false);
		expect(isExactRecord(1, ["a"])).toBe(false);
	});

	it("rejects duplicate expected keys", () => {
		expect(isExactRecord({ a: 1 }, ["a", "a"])).toBe(false);
	});
});
