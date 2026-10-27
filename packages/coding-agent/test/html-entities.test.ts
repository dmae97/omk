import { describe, expect, it } from "vitest";
import { decodeHtmlEntity, decodeHtmlEntityAt } from "../src/utils/html.ts";

describe("decodeHtmlEntity", () => {
	it.each([
		["amp", "&"],
		["lt", "<"],
		["gt", ">"],
		["quot", '"'],
		["apos", "'"],
	])("decodes the named entity %s", (entity, expected) => {
		expect(decodeHtmlEntity(entity)).toBe(expected);
	});

	it.each([
		["#39", "'"],
		["#x27", "'"],
		["#X27", "'"],
		["#128512", "😀"],
		["#x1F600", "😀"],
		["#0", "\0"],
		["#x10FFFF", "\u{10ffff}"],
	])("decodes the numeric entity %s", (entity, expected) => {
		expect(decodeHtmlEntity(entity)).toBe(expected);
	});

	it.each(["", "unknown", "AMP", "#", "#x", "#X", "#xZZ", "#nope", "#-1", "#x-1", "#1114112", "#x110000"])(
		"returns undefined for %j",
		(entity) => {
			expect(decodeHtmlEntity(entity)).toBeUndefined();
		},
	);
});

describe("decodeHtmlEntityAt", () => {
	it.each([
		["&amp;", "&", 5],
		["&#39;", "'", 5],
		["&#x27;", "'", 6],
		["&#X27;", "'", 6],
		["&#x1F600;", "😀", 9],
	])("decodes %s and includes both delimiters in its length", (html, text, length) => {
		expect(decodeHtmlEntityAt(html, 0)).toEqual({ text, length });
	});

	it("decodes at a nonzero index without consuming the surrounding text", () => {
		expect(decodeHtmlEntityAt("before &lt; after &amp;", 7)).toEqual({ text: "<", length: 4 });
	});

	it.each(["&amp", "&#39", "&"])("returns undefined when %s has no semicolon", (html) => {
		expect(decodeHtmlEntityAt(html, 0)).toBeUndefined();
	});

	it.each(["&;", "&unknown;", "&#xZZ;", "&#x110000;"])("returns undefined when %s cannot be decoded", (html) => {
		expect(decodeHtmlEntityAt(html, 0)).toBeUndefined();
	});

	it("accepts a semicolon exactly 16 characters from the entity start", () => {
		expect(decodeHtmlEntityAt("prefix &#00000000000039; suffix", 7)).toEqual({ text: "'", length: 17 });
	});

	it("rejects a semicolon more than 16 characters from the entity start", () => {
		expect(decodeHtmlEntityAt("prefix &#000000000000039; suffix", 7)).toBeUndefined();
	});
});
