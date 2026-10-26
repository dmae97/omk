import { describe, expect, it } from "vitest";
import { sanitizeSurrogates } from "../src/utils/sanitize-unicode.ts";

describe("sanitizeSurrogates", () => {
	it("keeps a properly paired emoji unchanged", () => {
		expect(sanitizeSurrogates("Hello 🙈 World")).toBe("Hello 🙈 World");
	});

	it("removes a lone high surrogate", () => {
		expect(sanitizeSurrogates("\uD83D")).toBe("");
	});

	it("removes a lone low surrogate", () => {
		expect(sanitizeSurrogates("\uDE48")).toBe("");
	});

	it("keeps a valid pair and drops only an extra leading high surrogate", () => {
		// high + (high+low pair) → keep the pair only
		expect(sanitizeSurrogates("\uD83D\uD83D\uDE48")).toBe("🙈");
	});

	it("removes a reversed low-then-high pair completely", () => {
		expect(sanitizeSurrogates("\uDE48\uD83D")).toBe("");
	});

	it("returns an empty string unchanged", () => {
		expect(sanitizeSurrogates("")).toBe("");
	});

	it("returns plain ASCII unchanged", () => {
		expect(sanitizeSurrogates("plain ASCII text 123")).toBe("plain ASCII text 123");
	});
});
