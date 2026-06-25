import { describe, expect, test } from "vitest";
import {
	colorAt,
	composeStaticBanner,
	type GradientGeom,
	paintGlyph,
	renderGradientLine,
	shouldGradient,
	staticColorAt,
} from "../src/modes/interactive/components/control-panel-gradient.ts";

const ESC_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const TEST_ART = ["  ____   __  __ _  __", " / __ \\ /  |/  / |/ /", "/ /_/ // /|_/ /    < ", "\\____//_/  /_/_/|_| "];

function stripAnsi(value: string): string {
	return value.replace(ESC_RE, "");
}

function escapeCount(value: string, needle: string): number {
	return value.split(needle).length - 1;
}

function colorDistance(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): number {
	return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
}

describe("control-panel static gradient math", () => {
	const geom: GradientGeom = { cols: 22, rows: 4, shear: 2.2 };

	test("colorAt is deterministic, finite, clamped, and anchors cyan to violet diagonally", () => {
		const bottomLeft = colorAt(0, geom.rows - 1, 0, geom);
		const repeated = colorAt(0, geom.rows - 1, 0, geom);
		const topRight = colorAt(geom.cols - 1, 0, 0, geom);

		expect(repeated).toEqual(bottomLeft);
		for (const color of [bottomLeft, topRight, staticColorAt(8, 2, geom)]) {
			for (const channel of [color.r, color.g, color.b]) {
				expect(Number.isFinite(channel)).toBe(true);
				expect(Number.isNaN(channel)).toBe(false);
				expect(channel).toBeGreaterThanOrEqual(0);
				expect(channel).toBeLessThanOrEqual(255);
			}
		}

		expect(colorDistance(bottomLeft, { r: 54, g: 247, b: 255 })).toBeLessThan(32);
		expect(colorDistance(topRight, { r: 123, g: 77, b: 255 })).toBeLessThan(32);
	});
});

describe("control-panel static gradient rendering", () => {
	test("NO_COLOR composeStaticBanner emits plain text only", () => {
		const rendered = composeStaticBanner(TEST_ART, "truecolor", true);
		const joined = rendered.join("\n");

		expect(stripAnsi(joined)).toBe(joined);
		expect(joined).toBe(TEST_ART.join("\n"));
	});

	test("256-color paint path uses indexed ANSI and preserves multiple color buckets", () => {
		const glyph = paintGlyph("X", 0, 242, 242, "256color", false);
		expect(glyph).toContain("\x1b[38;5;");
		expect(glyph).not.toContain("\x1b[38;2;");

		const rendered = composeStaticBanner(TEST_ART, "256color", false).join("\n");
		const indices = new Set(Array.from(rendered.matchAll(/\x1b\[38;5;(\d+)m/g), (match) => match[1]));
		expect(indices.size).toBeGreaterThanOrEqual(4);
	});

	test("truecolor output balances foreground opens and closes", () => {
		const rendered = composeStaticBanner(TEST_ART, "truecolor", false);
		const joined = rendered.join("\n");
		const opens = escapeCount(joined, "\x1b[38;2;") + escapeCount(joined, "\x1b[38;5;");
		const closes = escapeCount(joined, "\x1b[39m");

		expect(opens).toBeGreaterThan(0);
		expect(opens).toBe(closes);
		for (const line of rendered) {
			expect(line.endsWith("\x1b[38;2;")).toBe(false);
			expect(line.endsWith("\x1b[38;5;")).toBe(false);
		}
	});

	test("renderGradientLine preserves visible width and leaves spaces uncolored", () => {
		const geom: GradientGeom = { cols: TEST_ART[0].length, rows: TEST_ART.length, shear: 2.2 };
		const source = " A B ";
		const rendered = renderGradientLine(source, 0, geom, "truecolor", false);

		expect(stripAnsi(rendered).length).toBe(source.length);
		expect(stripAnsi(rendered)).toBe(source);
		expect(rendered.startsWith(" ")).toBe(true);
		expect(rendered.endsWith(" ")).toBe(true);
	});

	test("every composed gradient line has the source visible width", () => {
		const rendered = composeStaticBanner(TEST_ART, "truecolor", false);

		expect(rendered).toHaveLength(TEST_ART.length);
		for (let index = 0; index < TEST_ART.length; index++) {
			expect(stripAnsi(rendered[index]).length).toBe(TEST_ART[index].length);
			expect(stripAnsi(rendered[index])).toBe(TEST_ART[index]);
		}
	});
});

describe("control-panel gradient gating", () => {
	test("shouldGradient follows static phase truth table", () => {
		const base = { isTTY: true, noColor: false, colorMode: "truecolor" as const, expanded: true, width: 32 };

		expect(shouldGradient(base)).toBe(true);
		expect(shouldGradient({ ...base, isTTY: false })).toBe(false);
		expect(shouldGradient({ ...base, noColor: true })).toBe(false);
		expect(shouldGradient({ ...base, expanded: false })).toBe(false);
		expect(shouldGradient({ ...base, width: 31 })).toBe(false);
		expect(shouldGradient({ ...base, colorMode: "256color" })).toBe(true);
	});
});
