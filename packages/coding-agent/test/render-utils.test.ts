import { describe, expect, it } from "vitest";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import { normalizeDisplayText, replaceTabs, shortenPath, str } from "../src/core/tools/render-utils.ts";

describe("render-utils text helpers", () => {
	it("str returns string as-is", () => {
		expect(str("a")).toBe("a");
	});

	it("str returns empty string for null/undefined", () => {
		expect(str(null)).toBe("");
		expect(str(undefined)).toBe("");
	});

	it("str returns null for non-string primitives and objects", () => {
		expect(str(1)).toBeNull();
		expect(str({})).toBeNull();
		expect(str(true)).toBeNull();
	});

	it("replaceTabs converts tabs to three spaces", () => {
		expect(replaceTabs("a\tb\t\tc")).toBe("a   b      c");
		expect(replaceTabs("")).toBe("");
		expect(replaceTabs("no-tabs")).toBe("no-tabs");
	});

	it("normalizeDisplayText removes carriage returns", () => {
		expect(normalizeDisplayText("a\r\nb\rc")).toBe("a\nbc");
		expect(normalizeDisplayText("")).toBe("");
		expect(normalizeDisplayText("no-cr")).toBe("no-cr");
	});

	it("shortenPath replaces home directory with tilde", () => {
		const home = homedir();
		expect(shortenPath(join(home, "proj", "a.ts"))).toBe(`~${sep}proj${sep}a.ts`);
		expect(shortenPath(home)).toBe("~");
	});

	it("shortenPath returns unchanged path when outside home", () => {
		expect(shortenPath("/tmp/outside")).toBe("/tmp/outside");
		expect(shortenPath("C:\\Windows\\system32")).toBe("C:\\Windows\\system32");
	});

	it("shortenPath returns empty string for non-string input", () => {
		expect(shortenPath(42)).toBe("");
		expect(shortenPath(undefined)).toBe("");
		expect(shortenPath(null)).toBe("");
		expect(shortenPath({})).toBe("");
	});
});