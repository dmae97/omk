import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	getAvailableThemes,
	getResolvedThemeColors,
	loadThemeFromPath,
	resolveThemeName,
	rgbTo256,
} from "../src/modes/interactive/theme/theme.ts";
import { THEME_NAME_ALIASES } from "../src/modes/interactive/theme/theme-aliases.ts";

/**
 * The paper pair carries the shared paper/ink/vermillion design language into the terminal.
 * A theme cannot paint the terminal background, so text is checked against the paper
 * surfaces and against common terminal backgrounds of the same polarity.
 */
const PAIRS = [
	{ name: "omk-paper-dark", backgrounds: ["#0d0d0d", "#131313", "#181818", "#000000", "#1e1e1e"] },
	{ name: "omk-paper-light", backgrounds: ["#ede6d6", "#f3ece0", "#f7f1e6", "#ffffff"] },
] as const;

/** Tokens rendered as text: WCAG 1.4.3 (4.5:1). */
const TEXT_ROLES = [
	"text",
	"muted",
	"dim",
	"thinkingText",
	"accent",
	"success",
	"error",
	"warning",
	"userMessageText",
	"customMessageText",
	"customMessageLabel",
	"toolTitle",
	"toolOutput",
	"mdHeading",
	"mdLink",
	"mdLinkUrl",
	"mdCode",
	"mdCodeBlock",
	"mdQuote",
	"mdListBullet",
	"toolDiffAdded",
	"toolDiffRemoved",
	"toolDiffContext",
	"syntaxComment",
	"syntaxKeyword",
	"syntaxFunction",
	"syntaxVariable",
	"syntaxString",
	"syntaxNumber",
	"syntaxType",
	"syntaxOperator",
	"syntaxPunctuation",
] as const;

/** Component boundaries a user must perceive: WCAG 1.4.11 (3:1). */
const BOUNDARY_ROLES = [
	"border",
	"borderAccent",
	"thinkingOff",
	"thinkingMinimal",
	"thinkingLow",
	"thinkingMedium",
	"thinkingHigh",
	"thinkingXhigh",
	"bashMode",
] as const;

/** Hairlines that separate but carry no meaning of their own: a documented floor, not 3:1. */
const DECORATIVE_ROLES = ["borderMuted", "mdHr", "mdQuoteBorder", "mdCodeBlockBorder"] as const;
const DECORATIVE_FLOOR = 1.5;

/** Text drawn on the theme's own filled backgrounds. */
const TEXT_ON_OWN_BACKGROUND: readonly (readonly [string, string])[] = [
	["userMessageText", "userMessageBg"],
	["customMessageText", "customMessageBg"],
	["customMessageLabel", "customMessageBg"],
	["toolTitle", "toolPendingBg"],
	["toolOutput", "toolPendingBg"],
	["toolTitle", "toolSuccessBg"],
	["toolOutput", "toolSuccessBg"],
	["toolTitle", "toolErrorBg"],
	["toolOutput", "toolErrorBg"],
	["text", "selectedBg"],
	["accent", "selectedBg"],
];

function hexToRgb(hex: string): [number, number, number] {
	const value = hex.replace("#", "");
	return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16)) as [number, number, number];
}

function luminance(hex: string): number {
	const [r, g, b] = hexToRgb(hex).map((channel) => {
		const c = channel / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi! + 0.05) / (lo! + 0.05);
}

function themeFile(name: string): string {
	return fileURLToPath(new URL(`../src/modes/interactive/theme/${name}.json`, import.meta.url));
}

function requiredColorTokens(): string[] {
	const schema = JSON.parse(readFileSync(themeFile("theme-schema"), "utf-8")) as {
		properties: { colors: { required: string[] } };
	};
	return schema.properties.colors.required;
}

describe.each(PAIRS)("$name", ({ name, backgrounds }) => {
	const colors = () => getResolvedThemeColors(name);

	it("loads through the schema-validated loader with all 51 tokens as explicit hex colours", () => {
		expect(() => loadThemeFromPath(themeFile(name))).not.toThrow();
		const resolved = colors();
		const required = requiredColorTokens();
		expect(required).toHaveLength(51);
		for (const token of required) expect(resolved[token], token).toMatch(/^#[0-9a-f]{6}$/i);
	});

	it("keeps every text role at 4.5:1 or more on paper and on common terminal backgrounds", () => {
		const resolved = colors();
		const failures = TEXT_ROLES.flatMap((role) =>
			backgrounds
				.map((bg) => ({ role, bg, ratio: contrast(resolved[role]!, bg) }))
				.filter(({ ratio }) => ratio < 4.5),
		);
		expect(failures).toEqual([]);
	});

	it("keeps component boundaries at 3:1 or more", () => {
		const resolved = colors();
		const failures = BOUNDARY_ROLES.flatMap((role) =>
			backgrounds.map((bg) => ({ role, bg, ratio: contrast(resolved[role]!, bg) })).filter(({ ratio }) => ratio < 3),
		);
		expect(failures).toEqual([]);
	});

	it("keeps decorative hairlines visible above the documented floor", () => {
		const resolved = colors();
		const failures = DECORATIVE_ROLES.flatMap((role) =>
			backgrounds
				.map((bg) => ({ role, bg, ratio: contrast(resolved[role]!, bg) }))
				.filter(({ ratio }) => ratio < DECORATIVE_FLOOR),
		);
		expect(failures).toEqual([]);
	});

	it("keeps message and tool text at 4.5:1 or more on the theme's own backgrounds", () => {
		const resolved = colors();
		const failures = TEXT_ON_OWN_BACKGROUND.map(([fg, bg]) => ({
			fg,
			bg,
			ratio: contrast(resolved[fg]!, resolved[bg]!),
		})).filter(({ ratio }) => ratio < 4.5);
		expect(failures).toEqual([]);
	});

	it("reserves vermillion: links and inline code are not painted in the accent", () => {
		const resolved = colors();
		expect(resolved.mdLink).not.toBe(resolved.accent);
		expect(resolved.mdCode).not.toBe(resolved.accent);
		expect(resolved.mdHeading).not.toBe(resolved.accent);
		expect(resolved.syntaxKeyword).not.toBe(resolved.accent);
	});

	it("keeps the accent in the red family after 256-colour quantisation", () => {
		const [r, g, b] = hexToRgb(colors().accent!);
		const index = rgbTo256(r, g, b);
		const steps = [0, 95, 135, 175, 215, 255];
		expect(index).toBeGreaterThanOrEqual(16);
		expect(index).toBeLessThan(232);
		const cube = index - 16;
		const [qr, qg, qb] = [steps[Math.floor(cube / 36)]!, steps[Math.floor(cube / 6) % 6]!, steps[cube % 6]!];
		expect(qr).toBeGreaterThan(qg);
		expect(qr).toBeGreaterThan(qb);
	});

	it("gives HTML export paper surfaces", () => {
		const file = JSON.parse(readFileSync(themeFile(name), "utf-8")) as { export?: Record<string, string> };
		expect(Object.keys(file.export ?? {}).sort()).toEqual(["cardBg", "infoBg", "pageBg"]);
	});
});

describe("paper theme names", () => {
	it("resolves the paper aliases", () => {
		expect(resolveThemeName("paper")).toBe("omk-paper-dark");
		expect(resolveThemeName("paper-dark")).toBe("omk-paper-dark");
		expect(resolveThemeName("omk-paper")).toBe("omk-paper-dark");
		expect(resolveThemeName("paper-light")).toBe("omk-paper-light");
		expect(getAvailableThemes()).toEqual(expect.arrayContaining(["omk-paper-dark", "omk-paper-light"]));
	});

	it("never names a theme or alias after the separate AdaptOrch product", () => {
		const aliases: Readonly<Record<string, string>> = THEME_NAME_ALIASES;
		const names: string[] = [...getAvailableThemes(), ...Object.keys(aliases), ...Object.values(aliases)];
		expect(names.filter((themeName) => /adaptorch/i.test(themeName))).toEqual([]);
	});
});
