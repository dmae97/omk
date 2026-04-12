import { describe, expect, it } from "bun:test";
import { getSessionAccentHex, getSessionAccentHexForTitle } from "../src/utils/session-color";

describe("getSessionAccentHexForTitle", () => {
	it("ignores auto-generated titles", () => {
		expect(getSessionAccentHexForTitle("Auto title", "auto")).toBeUndefined();
	});

	it("keeps explicit and legacy titles color-stable", () => {
		const expected = getSessionAccentHex("Named session");

		expect(getSessionAccentHexForTitle("Named session", "user")).toBe(expected);
		expect(getSessionAccentHexForTitle("Named session", undefined)).toBe(expected);
	});
});
