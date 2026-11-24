import { describe, expect, it } from "vitest";
import { stripJsonComments } from "../src/utils/json.ts";

describe("stripJsonComments", () => {
	it("strips single-line // comments outside string literals", () => {
		const input = '{"a": 1, // note\n"b": 2}';
		expect(JSON.parse(stripJsonComments(input))).toEqual({ a: 1, b: 2 });
	});

	it("preserves // inside string literals such as URLs", () => {
		const input = '{"url": "http://x//y"}';
		expect(JSON.parse(stripJsonComments(input))).toEqual({ url: "http://x//y" });
	});

	it("removes trailing commas before closing brackets and braces", () => {
		const input = '{"a": [1, 2,], }';
		expect(JSON.parse(stripJsonComments(input))).toEqual({ a: [1, 2] });
	});

	it("preserves commas followed by closing delimiters inside string literals", () => {
		const input = '{"s": "a,}"}';
		expect(JSON.parse(stripJsonComments(input))).toEqual({ s: "a,}" });
	});

	it("handles escaped quotes inside strings before //", () => {
		const input = '{"q": "say \\"hi\\" // not a comment"}';
		expect(JSON.parse(stripJsonComments(input))).toEqual({ q: 'say "hi" // not a comment' });
	});

	it("strips comments at the end of the file without a trailing newline", () => {
		const input = '{"a": 1} // trailing comment';
		expect(JSON.parse(stripJsonComments(input))).toEqual({ a: 1 });
	});

	it("strips comments and trailing commas across nested objects and arrays", () => {
		const input = `{
			// top-level comment
			"models": [
				{
					"id": "demo", // inline comment
					"url": "https://example.com//v1",
				},
			],
		}`;
		expect(JSON.parse(stripJsonComments(input))).toEqual({
			models: [{ id: "demo", url: "https://example.com//v1" }],
		});
	});
});
