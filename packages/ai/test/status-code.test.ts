import { describe, expect, it } from "vitest";
import { hasStatusCodeLike } from "../src/utils/status-code.ts";

describe("hasStatusCodeLike", () => {
	it("matches left-side transport words before status code", () => {
		expect(hasStatusCodeLike("HTTP 429", [429])).toBe(true);
		expect(hasStatusCodeLike("status: 401", [401])).toBe(true);
		expect(hasStatusCodeLike("status code 500", [500])).toBe(true);
		expect(hasStatusCodeLike("error: 503", [503])).toBe(true);
		expect(hasStatusCodeLike("error code 400", [400])).toBe(true);
		expect(hasStatusCodeLike("code 408", [408])).toBe(true);
		expect(hasStatusCodeLike("https 502", [502])).toBe(true);
	});

	it("matches right-side status phrases after status code", () => {
		expect(hasStatusCodeLike("503 Service Unavailable", [503])).toBe(true);
		expect(hasStatusCodeLike("429 Too Many Requests", [429])).toBe(true);
		expect(hasStatusCodeLike("502 Bad Gateway", [502])).toBe(true);
		expect(hasStatusCodeLike("500 Internal Server Error", [500])).toBe(true);
		expect(hasStatusCodeLike("504 Gateway Timeout", [504])).toBe(true);
		expect(hasStatusCodeLike("401 Unauthorized", [401])).toBe(true);
		expect(hasStatusCodeLike("403 Forbidden", [403])).toBe(true);
	});

	it("does not match bare numbers without transport context", () => {
		expect(hasStatusCodeLike("saved 500 records", [500])).toBe(false);
		expect(hasStatusCodeLike("processed 429 items in total", [429])).toBe(false);
		expect(hasStatusCodeLike("item 401 of 500", [401, 500])).toBe(false);
	});

	it("does not match when status code is not in target list", () => {
		expect(hasStatusCodeLike("error 503", [500])).toBe(false);
		expect(hasStatusCodeLike("HTTP 404", [429, 500, 502])).toBe(false);
		expect(hasStatusCodeLike("503 Service Unavailable", [429])).toBe(false);
	});

	it("resets regex state across repeated calls", () => {
		const text = "HTTP 429 and error 503";
		expect(hasStatusCodeLike(text, [429])).toBe(true);
		expect(hasStatusCodeLike(text, [429])).toBe(true);
		expect(hasStatusCodeLike(text, [503])).toBe(true);
		expect(hasStatusCodeLike(text, [503])).toBe(true);
		expect(hasStatusCodeLike(text, [500])).toBe(false);
		expect(hasStatusCodeLike(text, [500])).toBe(false);
	});

	it("handles case-insensitivity and empty inputs", () => {
		expect(hasStatusCodeLike("http 429", [429])).toBe(true);
		expect(hasStatusCodeLike("STATUS: 401", [401])).toBe(true);
		expect(hasStatusCodeLike("503 service unavailable", [503])).toBe(true);
		expect(hasStatusCodeLike("", [500])).toBe(false);
		expect(hasStatusCodeLike("no numbers here", [500])).toBe(false);
		expect(hasStatusCodeLike("HTTP 500", [])).toBe(false);
	});
});
