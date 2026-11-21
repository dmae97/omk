import { describe, expect, it } from "vitest";
import { resolveScrollbackSeedScreens } from "../src/core/terminal-settings.ts";

describe("resolveScrollbackSeedScreens", () => {
	it("defaults to 50 when nothing is set", () => {
		expect(resolveScrollbackSeedScreens(undefined, {})).toBe(50);
	});

	it("prefers a finite configured number over the env var", () => {
		expect(resolveScrollbackSeedScreens(5, { OMK_SCROLLBACK_SCREENS: "9" })).toBe(5);
	});

	it("floors fractions and clamps negatives to zero", () => {
		expect(resolveScrollbackSeedScreens(7.9, {})).toBe(7);
		expect(resolveScrollbackSeedScreens(-3, {})).toBe(0);
		expect(resolveScrollbackSeedScreens(undefined, { OMK_SCROLLBACK_SCREENS: "-4" })).toBe(0);
	});

	it("trims the env var", () => {
		expect(resolveScrollbackSeedScreens(undefined, { OMK_SCROLLBACK_SCREENS: " 12 " })).toBe(12);
	});

	it("falls back to 50 for a blank or non-numeric env var", () => {
		expect(resolveScrollbackSeedScreens(undefined, { OMK_SCROLLBACK_SCREENS: "   " })).toBe(50);
		expect(resolveScrollbackSeedScreens(undefined, { OMK_SCROLLBACK_SCREENS: "abc" })).toBe(50);
	});

	it("falls back to the env var, then to 50, for a non-finite or non-number configured value", () => {
		expect(resolveScrollbackSeedScreens(Infinity, { OMK_SCROLLBACK_SCREENS: "3" })).toBe(3);
		expect(resolveScrollbackSeedScreens(Number.NaN, { OMK_SCROLLBACK_SCREENS: "abc" })).toBe(50);
		expect(resolveScrollbackSeedScreens("8", {})).toBe(50);
	});
});
