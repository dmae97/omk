import { describe, expect, it } from "vitest";
import { headersToRecord } from "../src/utils/headers.ts";

describe("headersToRecord", () => {
	it("returns an empty record for empty headers", () => {
		expect(headersToRecord(new Headers())).toEqual({});
	});

	it("normalizes header names to lowercase", () => {
		expect(headersToRecord(new Headers({ "X-A": "1", "Content-Type": "application/json" }))).toEqual({
			"content-type": "application/json",
			"x-a": "1",
		});
	});

	it("joins repeated ordinary header values", () => {
		const headers = new Headers();
		headers.append("X-A", "1");
		headers.append("x-a", "2");
		expect(headersToRecord(headers)).toEqual({ "x-a": "1, 2" });
	});

	it("keeps the last Set-Cookie value in the record", () => {
		const headers = new Headers();
		headers.append("Set-Cookie", "a=1");
		headers.append("Set-Cookie", "b=2");
		// Headers iterates cookies separately; the record currently overwrites earlier ones.
		expect(headersToRecord(headers)).toEqual({ "set-cookie": "b=2" });
	});
});
