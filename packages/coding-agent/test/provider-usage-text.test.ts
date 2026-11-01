import { describe, expect, it } from "vitest";
import { clampPercent, usageText } from "../src/core/provider-usage-text.ts";

describe("usageText", () => {
	it.each([undefined, "", "   ", "\u0007\u200b"])("returns undefined for empty content: %j", (value) => {
		expect(usageText(value)).toBeUndefined();
	});

	it("trims and collapses repeated whitespace", () => {
		expect(usageText("  Weekly   limit\u00a0\u00a0 remaining  ")).toBe("Weekly limit remaining");
	});

	it.each(["\u0000\u001f", "\u007f\u009f", "\u200b\u200f", "\u202a\u202e", "\u2060\u206f"])(
		"strips control and format characters: %j",
		(characters) => {
			expect(usageText(`a${characters}b`)).toBe("ab");
		},
	);

	it("preserves printable Unicode text", () => {
		expect(usageText("  Limite\u00a0hebdomadaire: 50 %  ")).toBe("Limite hebdomadaire: 50 %");
		expect(usageText("  使用量  ")).toBe("使用量");
	});

	it("removes newlines before collapsing whitespace", () => {
		// Pin the current behavior: control characters are removed, not replaced by spaces.
		expect(usageText("Weekly\nlimit")).toBe("Weeklylimit");
	});

	it.each([39, 40])("keeps text at or below the 40-character limit (%i)", (length) => {
		const text = "a".repeat(length);
		expect(usageText(text)).toBe(text);
	});

	it("cuts longer text to 40 characters after cleaning it", () => {
		const prefix = `${"a".repeat(39)}b`;
		expect(usageText(`  ${prefix}${"c".repeat(10)}  `)).toBe(prefix);
	});
});

describe("clampPercent", () => {
	it.each([
		[-5, 0],
		[0, 0],
		[100, 100],
		[150, 100],
		[33.33333, 33.33],
		[33.336, 33.34],
		[1.5, 1.5],
	])("clamps and rounds %s to %s", (value, expected) => {
		expect(clampPercent(value)).toBe(expected);
	});

	it("preserves NaN rather than treating it as a percentage", () => {
		expect(clampPercent(Number.NaN)).toBeNaN();
	});
});
