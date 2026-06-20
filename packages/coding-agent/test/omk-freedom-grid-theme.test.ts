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

function readFreedomGrid(): ThemeFile {
	return JSON.parse(readFileSync(themePath("omk-freedom-grid.json"), "utf-8")) as ThemeFile;
}

function resolveHex(theme: ThemeFile, token: string): string {
	const raw = theme.colors[token];
	const vars = theme.vars ?? {};
	const value = typeof raw === "string" && raw in vars ? vars[raw] : raw;
	if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)) {
		throw new Error(`token ${token} did not resolve to a hex value: ${String(value)}`);
	}
	return value;
}

function resolveExportHex(theme: ThemeFile, key: string, fallbackToken: string): string {
	const raw = theme.export?.[key];
	const vars = theme.vars ?? {};
	const value = typeof raw === "string" && raw in vars ? vars[raw] : raw;
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

// Near-white ink tokens that must remain fully legible as body text.
const INK_TOKENS = [
	"text",
	"userMessageText",
	"customMessageText",
	"toolOutput",
	"muted",
	"thinkingText",
	"mdCodeBlock",
	"mdQuote",
	"syntaxVariable",
];

// Intentionally subdued tokens (>= 3.0 contrast is the UI floor).
const TERTIARY_TOKENS = ["dim", "mdLinkUrl", "syntaxComment", "toolDiffContext", "syntaxPunctuation"];

// Colored accent/signal tokens (>= 3.0 contrast as non-body emphasis).
const ACCENT_TOKENS = [
	"accent",
	"toolTitle",
	"mdHeading",
	"syntaxFunction",
	"mdLink",
	"syntaxType",
	"mdCode",
	"syntaxOperator",
	"customMessageLabel",
	"success",
	"borderAccent",
	"mdListBullet",
	"toolDiffAdded",
	"syntaxString",
	"bashMode",
	"error",
	"toolDiffRemoved",
	"warning",
	"syntaxNumber",
	"thinkingHigh",
	"syntaxKeyword",
	"mdQuoteBorder",
	"thinkingLow",
	"thinkingMedium",
	"thinkingXhigh",
	"thinkingMinimal",
];

describe("OMK freedom-grid theme", () => {
	it("lists omk-freedom-grid as an available built-in theme", () => {
		expect(getAvailableThemes()).toContain("omk-freedom-grid");
	});

	it("loads omk-freedom-grid as a Theme", () => {
		const theme = getThemeByName("omk-freedom-grid");

		expect(theme).toBeInstanceOf(Theme);
		expect(theme?.fg("accent", "OMK")).toContain("OMK");
	});

	it("resolves freedom-grid brand aliases", () => {
		expect(resolveThemeName("freedom")).toBe("omk-freedom-grid");
		expect(resolveThemeName("freedom-grid")).toBe("omk-freedom-grid");
		expect(resolveThemeName("cyber-freedom")).toBe("omk-freedom-grid");
		expect(resolveThemeName("omk-freedom")).toBe("omk-freedom-grid");
	});

	it("validates the omk-freedom-grid theme JSON", () => {
		const theme = loadThemeFromPath(themePath("omk-freedom-grid.json"));

		expect(theme.name).toBe("omk-freedom-grid");
	});

	it("defines exactly the required color tokens", () => {
		const theme = readFreedomGrid();
		const actual = Object.keys(theme.colors).sort();
		const required = requiredColorTokens().sort();

		expect(actual).toEqual(required);
	});

	it("does not define unused omk-freedom-grid vars", () => {
		const theme = readFreedomGrid();
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

	it("resolves every freedom-grid color token to a hex value", () => {
		const theme = readFreedomGrid();
		for (const token of requiredColorTokens()) {
			expect(resolveHex(theme, token)).toMatch(/^#[0-9a-fA-F]{6}$/);
		}
	});

	it("orders omk-freedom-grid before non-OMK themes", () => {
		expect(orderThemesForSelector(["zebra", "omk-freedom-grid", "dark", "omk-control-panel"])).toEqual([
			"omk-control-panel",
			"omk-freedom-grid",
			"dark",
			"zebra",
		]);
	});
});

describe("OMK freedom-grid WCAG contrast", () => {
	const theme = readFreedomGrid();
	const pageBg = resolveExportHex(theme, "pageBg", "userMessageBg");
	const selectedBg = resolveHex(theme, "selectedBg");
	const userBg = resolveHex(theme, "userMessageBg");
	const customBg = resolveHex(theme, "customMessageBg");

	it("keeps ink tokens at AA (>= 4.5) over base, selected, user, and custom backgrounds", () => {
		for (const token of INK_TOKENS) {
			const fg = resolveHex(theme, token);
			for (const bg of [pageBg, selectedBg, userBg, customBg]) {
				expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
			}
		}
	});

	it("keeps subdued tokens at the UI floor (>= 3.0) over base, selected, and user backgrounds", () => {
		for (const token of TERTIARY_TOKENS) {
			const fg = resolveHex(theme, token);
			for (const bg of [pageBg, selectedBg, userBg]) {
				expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(3.0);
			}
		}
	});

	it("keeps accent tokens at emphasis contrast (>= 3.0) over base, selected, and user backgrounds", () => {
		for (const token of ACCENT_TOKENS) {
			const fg = resolveHex(theme, token);
			for (const bg of [pageBg, selectedBg, userBg]) {
				expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(3.0);
			}
		}
	});

	it("keeps tool box text legible over tool state backgrounds", () => {
		for (const bgToken of ["toolPendingBg", "toolSuccessBg", "toolErrorBg"]) {
			const bg = resolveHex(theme, bgToken);
			expect(contrastRatio(resolveHex(theme, "toolTitle"), bg)).toBeGreaterThanOrEqual(3.0);
			expect(contrastRatio(resolveHex(theme, "toolOutput"), bg)).toBeGreaterThanOrEqual(4.5);
		}
		expect(contrastRatio(resolveHex(theme, "success"), resolveHex(theme, "toolSuccessBg"))).toBeGreaterThanOrEqual(
			3.0,
		);
		expect(contrastRatio(resolveHex(theme, "error"), resolveHex(theme, "toolErrorBg"))).toBeGreaterThanOrEqual(3.0);
	});
});
