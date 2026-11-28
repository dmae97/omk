import { homedir } from "node:os";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeDisplayText, replaceTabs, shortenPath, str } from "../src/core/tools/render-utils.ts";

describe("render-utils", () => {
	it("str preserves strings, coerces null/undefined to empty string, and returns null otherwise", () => {
		expect(str("a")).toBe("a");
		expect(str(null)).toBe("");
		expect(str(undefined)).toBe("");
		expect(str(1)).toBeNull();
		expect(str({})).toBeNull();
	});

	it("replaceTabs expands each tab to three spaces", () => {
		expect(replaceTabs("a\tb\t\tc")).toBe("a   b      c");
	});

	it("normalizeDisplayText strips carriage returns while preserving newlines", () => {
		expect(normalizeDisplayText("a\r\nb\rc")).toBe("a\nbc");
	});

	it("shortenPath replaces homedir prefix with tilde, handles non-strings, and leaves other paths unchanged", () => {
		const home = homedir();
		expect(shortenPath(join(home, "proj", "a.ts"))).toBe(`~${sep}proj${sep}a.ts`);
		expect(shortenPath(home)).toBe("~");
		expect(shortenPath(42)).toBe("");
		expect(shortenPath(undefined)).toBe("");

		const outsidePath = process.platform === "win32" ? "C:\\outside\\file.ts" : "/etc/hosts";
		expect(shortenPath(outsidePath)).toBe(outsidePath);
	});
});
