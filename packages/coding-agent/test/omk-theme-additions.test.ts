import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { orderThemesForSelector } from "../src/modes/interactive/components/theme-selector.ts";
import {
	getAvailableThemes,
	getThemeByName,
	loadThemeFromPath,
	resolveThemeName,
	Theme,
} from "../src/modes/interactive/theme/theme.ts";

type ThemeFile = {
	vars?: Record<string, string | number>;
	colors: Record<string, string | number>;
	export?: Record<string, string | number | undefined>;
};

function themePath(fileName: string): string {
	return fileURLToPath(new URL(`../src/modes/interactive/theme/${fileName}`, import.meta.url));
}

function requiredColorTokens(): string[] {
	const schema = JSON.parse(readFileSync(themePath("theme-schema.json"), "utf-8")) as {
		properties: { colors: { required: string[] } };
	};
	return schema.properties.colors.required;
}

function isThemeVarReference(value: string | number | undefined): value is string {
	return typeof value === "string" && value.length > 0 && !value.startsWith("#");
}

describe("OMK theme additions", () => {
	it("lists omk-neon-ops as an available built-in theme", () => {
		expect(getAvailableThemes()).toContain("omk-neon-ops");
	});

	it("loads omk-neon-ops as a Theme", () => {
		const theme = getThemeByName("omk-neon-ops");

		expect(theme).toBeInstanceOf(Theme);
		expect(theme?.fg("accent", "OMK")).toContain("OMK");
	});

	it("resolves brand aliases", () => {
		expect(resolveThemeName("neon-ops")).toBe("omk-neon-ops");
		expect(resolveThemeName("omk-neon")).toBe("omk-neon-ops");
	});

	it("validates the omk-neon-ops theme JSON", () => {
		const theme = loadThemeFromPath(themePath("omk-neon-ops.json"));

		expect(theme.name).toBe("omk-neon-ops");
	});

	it("orders OMK themes before non-OMK themes", () => {
		expect(orderThemesForSelector(["zebra", "omk-neon-ops", "dark", "omk-control-panel"])).toEqual([
			"omk-control-panel",
			"omk-neon-ops",
			"dark",
			"zebra",
		]);
	});

	it("does not mutate input while ordering themes", () => {
		const themes = ["zebra", "omk-neon-ops", "dark"];
		expect(orderThemesForSelector(themes)).toEqual(["omk-neon-ops", "dark", "zebra"]);
		expect(themes).toEqual(["zebra", "omk-neon-ops", "dark"]);
	});

	it("defines exactly the required color tokens", () => {
		const theme = JSON.parse(readFileSync(themePath("omk-neon-ops.json"), "utf-8")) as ThemeFile;
		const actual = Object.keys(theme.colors).sort();
		const required = requiredColorTokens().sort();

		expect(actual).toEqual(required);
	});

	it("does not define unused omk-neon-ops vars", () => {
		const theme = JSON.parse(readFileSync(themePath("omk-neon-ops.json"), "utf-8")) as ThemeFile;
		const referenced = new Set<string>();
		for (const value of Object.values(theme.colors)) {
			if (isThemeVarReference(value)) referenced.add(value);
		}
		for (const value of Object.values(theme.export ?? {})) {
			if (isThemeVarReference(value)) referenced.add(value);
		}
		for (const value of Object.values(theme.vars ?? {})) {
			if (isThemeVarReference(value)) referenced.add(value);
		}

		expect(Object.keys(theme.vars ?? {}).filter((name) => !referenced.has(name))).toEqual([]);
	});
});
