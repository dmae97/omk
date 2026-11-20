/**
 * Tests for normalizeReverseSkillText / normalizeReverseSkillName
 */

import { describe, expect, it } from "vitest";
import { normalizeReverseSkillName, normalizeReverseSkillText } from "../src/harness/reverse-skill-text.ts";

describe("normalizeReverseSkillText", () => {
	it("returns an empty string for undefined", () => {
		expect(normalizeReverseSkillText(undefined)).toBe("");
	});

	it("lowercases and turns separators into single spaces", () => {
		expect(normalizeReverseSkillText("  Fix_Bug.in/src:main  ")).toBe("fix bug in src main");
	});

	it("straightens curly quotes", () => {
		expect(normalizeReverseSkillText("‘Hi’ “yo”")).toBe("'hi' \"yo\"");
	});

	it("applies NFKC normalization", () => {
		expect(normalizeReverseSkillText("ＡＢＣ")).toBe("abc");
	});
});

describe("normalizeReverseSkillName", () => {
	it("slugifies a display name", () => {
		expect(normalizeReverseSkillName("My Skill!!")).toBe("my-skill");
	});

	it("falls back when nothing is left", () => {
		expect(normalizeReverseSkillName("!!!")).toBe("reverse-skill");
	});

	it("cuts long names to 64 characters", () => {
		expect(normalizeReverseSkillName("a".repeat(70))).toBe("a".repeat(64));
	});

	it("drops a trailing dash left by the cut", () => {
		expect(normalizeReverseSkillName(`${"a".repeat(63)} b`)).toBe("a".repeat(63));
	});
});
