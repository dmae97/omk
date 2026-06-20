import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	getAvailableThemes,
	getThemeByName,
	loadThemeFromPath,
	resolveThemeName,
	Theme,
} from "../src/modes/interactive/theme/theme.ts";

type ThemeFile = {
	name: string;
	vars?: Record<string, string | number>;
	colors: Record<string, string | number>;
	export?: Record<string, string | number | undefined>;
};

const THEME_NAMES = ["omk-blackboard", "omk-slate-light"] as const;

type PiPortedThemeName = (typeof THEME_NAMES)[number];

function themePath(fileName: string): string {
	return fileURLToPath(new URL(`../src/modes/interactive/theme/${fileName}`, import.meta.url));
}

function requiredColorTokens(): string[] {
	const schema = JSON.parse(readFileSync(themePath("theme-schema.json"), "utf-8")) as {
		properties: { colors: { required: string[] } };
	};
	return schema.properties.colors.required;
}

function readTheme(name: PiPortedThemeName): ThemeFile {
	return JSON.parse(readFileSync(themePath(`${name}.json`), "utf-8")) as ThemeFile;
}

function isThemeVarReference(value: string | number | undefined): value is string {
	return typeof value === "string" && value.length > 0 && !value.startsWith("#");
}

function resolveValue(
	value: string | number | undefined,
	vars: Record<string, string | number>,
	visited = new Set<string>(),
): string | number | undefined {
	if (typeof value !== "string" || value === "" || value.startsWith("#")) {
		return value;
	}
	if (visited.has(value)) {
		throw new Error(`circular variable reference: ${value}`);
	}
	visited.add(value);
	return resolveValue(vars[value], vars, visited);
}

function resolveHex(theme: ThemeFile, token: string): string {
	const value = resolveValue(theme.colors[token], theme.vars ?? {});
	if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)) {
		throw new Error(`token ${token} did not resolve to a hex value: ${String(value)}`);
	}
	return value;
}

function resolveExportHex(theme: ThemeFile, key: string, fallbackToken: string): string {
	const value = resolveValue(theme.export?.[key], theme.vars ?? {});
	if (typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)) {
		return value;
	}
	return resolveHex(theme, fallbackToken);
}

function channelLuminance(channel: number): number {
	const c = channel / 255;
	return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
	const r = Number.parseInt(hex.slice(1, 3), 16);
	const g = Number.parseInt(hex.slice(3, 5), 16);
	const b = Number.parseInt(hex.slice(5, 7), 16);
	return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

function contrastRatio(fgHex: string, bgHex: string): number {
	const a = relativeLuminance(fgHex);
	const b = relativeLuminance(bgHex);
	const lighter = Math.max(a, b);
	const darker = Math.min(a, b);
	return (lighter + 0.05) / (darker + 0.05);
}

describe("OMK pi-ported original themes", () => {
	it("lists both themes as available built-in themes", () => {
		const availableThemes = getAvailableThemes();

		for (const name of THEME_NAMES) {
			expect(availableThemes).toContain(name);
		}
	});

	it("loads both themes through the built-in registry", () => {
		for (const name of THEME_NAMES) {
			const theme = getThemeByName(name);

			expect(theme).toBeInstanceOf(Theme);
			expect(theme?.fg("accent", "OMK")).toContain("OMK");
		}
	});

	it("resolves pi-ported theme aliases", () => {
		expect(resolveThemeName("blackboard")).toBe("omk-blackboard");
		expect(resolveThemeName("chalk")).toBe("omk-blackboard");
		expect(resolveThemeName("slate-light")).toBe("omk-slate-light");
		expect(resolveThemeName("paper")).toBe("omk-slate-light");
	});

	it("validates both theme JSON files with the theme parser", () => {
		for (const name of THEME_NAMES) {
			const theme = loadThemeFromPath(themePath(`${name}.json`));

			expect(theme.name).toBe(name);
		}
	});

	it("defines exactly the 51 required color tokens for each theme", () => {
		const required = requiredColorTokens().sort();
		expect(required).toHaveLength(51);

		for (const name of THEME_NAMES) {
			const theme = readTheme(name);
			const actual = Object.keys(theme.colors).sort();

			expect(actual).toHaveLength(51);
			expect(actual).toEqual(required);
			expect(new Set(actual).size).toBe(actual.length);
		}
	});

	it("resolves every required token and export color to valid hex", () => {
		for (const name of THEME_NAMES) {
			const theme = readTheme(name);
			for (const token of requiredColorTokens()) {
				expect(resolveHex(theme, token)).toMatch(/^#[0-9a-fA-F]{6}$/);
			}
			for (const key of ["pageBg", "cardBg", "infoBg"]) {
				expect(resolveExportHex(theme, key, "userMessageBg")).toMatch(/^#[0-9a-fA-F]{6}$/);
			}
		}
	});

	it("does not define unused vars", () => {
		for (const name of THEME_NAMES) {
			const theme = readTheme(name);
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
		}
	});
});

describe("OMK pi-ported theme WCAG contrast", () => {
	it("keeps text and dim text legible over base, selected, user, and custom backgrounds", () => {
		for (const name of THEME_NAMES) {
			const theme = readTheme(name);
			const backgrounds = [
				resolveExportHex(theme, "pageBg", "userMessageBg"),
				resolveHex(theme, "selectedBg"),
				resolveHex(theme, "userMessageBg"),
				resolveHex(theme, "customMessageBg"),
			];

			for (const bg of backgrounds) {
				expect(contrastRatio(resolveHex(theme, "text"), bg)).toBeGreaterThanOrEqual(4.5);
				expect(contrastRatio(resolveHex(theme, "dim"), bg)).toBeGreaterThanOrEqual(3.0);
			}
		}
	});

	it("keeps omk-slate-light genuinely light with dark body text", () => {
		const theme = readTheme("omk-slate-light");
		const base = resolveExportHex(theme, "pageBg", "userMessageBg");
		const text = resolveHex(theme, "text");

		expect(relativeLuminance(base)).toBeGreaterThanOrEqual(0.72);
		expect(relativeLuminance(text)).toBeLessThanOrEqual(0.12);
		expect(contrastRatio(text, base)).toBeGreaterThanOrEqual(4.5);
	});
});
