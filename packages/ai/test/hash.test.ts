import { describe, expect, it } from "vitest";
import { shortHash } from "../src/utils/hash.ts";

// Two unsigned 32-bit values in base36: each part is 1 to 7 characters ("1z141z3" is 2^32 - 1).
const MIN_LENGTH = 2;
const MAX_LENGTH = 14;

describe("shortHash", () => {
	it("returns the same output for the same input", () => {
		expect(shortHash("hello")).toBe(shortHash("hello"));
		expect(shortHash("")).toBe(shortHash(""));
		expect(shortHash("시스템 prompt 😀")).toBe(shortHash("시스템 prompt 😀"));
	});

	it("returns different outputs for different inputs", () => {
		expect(shortHash("a")).not.toBe(shortHash("b"));
		expect(shortHash("hello")).not.toBe(shortHash("hello "));
		expect(shortHash("ab")).not.toBe(shortHash("ba"));
	});

	it("pins known values so the algorithm cannot drift unnoticed", () => {
		expect(shortHash("")).toBe("k4n83c7h0j2b");
		expect(shortHash("hello")).toBe("1h6qa0qrowduu");
		expect(shortHash("시스템 prompt")).toBe("zu79sx1hdwaub");
	});

	it("only emits lowercase base36 characters", () => {
		for (const input of ["", "hello", "Hello, World!", "시스템 prompt", "😀", "x".repeat(10_000)]) {
			expect(shortHash(input)).toMatch(/^[0-9a-z]+$/);
		}
	});

	it("returns a non-empty hash for the empty string", () => {
		expect(shortHash("")).not.toBe("");
	});

	it("does not pad, so the length varies within the two-part base36 range", () => {
		expect(shortHash("")).toHaveLength(12);
		expect(shortHash("hello")).toHaveLength(13);
		for (const input of ["", "a", "hello", "시스템 prompt", "x".repeat(10_000)]) {
			const { length } = shortHash(input);
			expect(length).toBeGreaterThanOrEqual(MIN_LENGTH);
			expect(length).toBeLessThanOrEqual(MAX_LENGTH);
		}
	});
});
