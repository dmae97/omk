import { describe, expect, it } from "vitest";
import { parseJsonWithRepair, parseStreamingJson, repairJson } from "../src/utils/json-parse.ts";

describe("repairJson", () => {
	it.each([
		[String.raw`{"path":"C:\dir"}`, String.raw`{"path":"C:\\dir"}`],
		[String.raw`{"value":"\q\x"}`, String.raw`{"value":"\\q\\x"}`],
		['{"path":"trailing\\', '{"path":"trailing\\\\'],
	])("doubles invalid backslashes in %j", (input, expected) => {
		expect(repairJson(input)).toBe(expected);
	});

	it.each([
		["\b", String.raw`\b`],
		["\f", String.raw`\f`],
		["\n", String.raw`\n`],
		["\r", String.raw`\r`],
		["\t", String.raw`\t`],
		["\u0000", String.raw`\u0000`],
		["\u0001", String.raw`\u0001`],
		["\u001f", String.raw`\u001f`],
	])("escapes raw control character %j inside strings", (control, escaped) => {
		expect(repairJson(`{"text":"before${control}after"}`)).toBe(`{"text":"before${escaped}after"}`);
	});

	it("preserves every valid JSON escape", () => {
		const json = String.raw`{"text":"\"\\\/\b\f\n\r\t\u00e9\uABCD"}`;
		expect(repairJson(json)).toBe(json);
	});

	it("keeps escaped quotes inside the string while repairing later escapes", () => {
		expect(repairJson(String.raw`{"text":"say \"C:\dir\""}`)).toBe(String.raw`{"text":"say \"C:\\dir\""}`);
	});

	it("does not change text or control characters outside strings", () => {
		const json = ' \n\\q {"value":"ok"}\t\\x\u0001';
		expect(repairJson(json)).toBe(json);
	});

	it.each(["", '{"value":1}', '"plain text"'])("leaves %j unchanged", (json) => {
		expect(repairJson(json)).toBe(json);
	});
});

describe("parseJsonWithRepair", () => {
	it.each<[string, unknown]>([
		['{"value":1,"nested":[true,null]}', { value: 1, nested: [true, null] }],
		["[1,2]", [1, 2]],
		['"text"', "text"],
		["42", 42],
		["false", false],
		["null", null],
	])("parses valid JSON %j", (json, expected) => {
		expect(parseJsonWithRepair<unknown>(json)).toEqual(expected);
	});

	it("repairs a raw newline before parsing", () => {
		expect(parseJsonWithRepair('{"text":"line\nbreak"}')).toEqual({ text: "line\nbreak" });
	});

	it("repairs an invalid escape before parsing", () => {
		expect(parseJsonWithRepair(String.raw`{"path":"C:\dir"}`)).toEqual({ path: String.raw`C:\dir` });
	});

	it.each(["not json", '{"value":}', '{"text":"line\nbreak",}'])(
		"throws SyntaxError when %j cannot be repaired",
		(json) => {
			expect(() => parseJsonWithRepair(json)).toThrow(SyntaxError);
		},
	);
});

describe("parseStreamingJson", () => {
	it.each([undefined, "", " ", "\t\r\n"])("returns an empty object for %j", (json) => {
		expect(parseStreamingJson(json)).toEqual({});
	});

	it.each<[string, unknown]>([
		['{"value":1,"nested":[true,null]}', { value: 1, nested: [true, null] }],
		["[1,2]", [1, 2]],
		['"text"', "text"],
		["42", 42],
		["false", false],
		["null", null],
	])("preserves the value of complete JSON %j", (json, expected) => {
		expect(parseStreamingJson<unknown>(json)).toEqual(expected);
	});

	it("repairs malformed complete JSON before falling back to partial parsing", () => {
		expect(parseStreamingJson('{"text":"line\nbreak"}')).toEqual({ text: "line\nbreak" });
	});

	it.each<[string, unknown]>([
		['{"a":1,"b":"hel', { a: 1, b: "hel" }],
		['{"nested":{"list":[1,2', { nested: { list: [1, 2] } }],
		['{"a":1,"b":', { a: 1 }],
	])("falls back to partial parsing for %j", (json, expected) => {
		expect(parseStreamingJson(json)).toEqual(expected);
	});

	it("repairs a truncated string when unrepaired partial parsing also fails", () => {
		expect(parseStreamingJson('"line\nbreak')).toBe("line\nbreak");
	});

	it("returns an empty object when the partial parser produces null", () => {
		expect(parseStreamingJson("nu")).toEqual({});
	});

	it.each(["garbage", "}", "\\q"])("returns an empty object instead of throwing for %j", (json) => {
		expect(parseStreamingJson(json)).toEqual({});
	});
});
