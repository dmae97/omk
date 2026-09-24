import { visibleWidth } from "omk-tui";
import { beforeAll, describe, expect, test } from "vitest";
import {
	heroBodyLines,
	narrowBrandLines,
	OMK_BRAND_PLATE,
	OMK_WORDMARK,
} from "../src/modes/interactive/components/control-panel-brand.ts";
import {
	type ControlPanelContent,
	renderControlPanelLayout,
	renderControlPanelRightPane,
} from "../src/modes/interactive/components/control-panel-layout.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const REVEALS = [0, 0.25, 0.5, 0.75, 1] as const;
const DECK_WIDTHS = [120, 140, 160, 200] as const;
const META = { modelId: "gpt-5.6-sol", modelProvider: "openai", thinkingLevel: "high", ansiColorState: "on" };

const content: ControlPanelContent = {
	appName: "omk",
	version: "1.2.4",
	compactInstructions: () => "Ctrl+C interrupt · / commands",
	expandedInstructions: () => "Ctrl+C to interrupt\n/ for commands",
	compactOnboarding: () => "Press Ctrl+O for help.",
	onboarding: () => "OMK can explain its own features.",
	statusSnapshot: () => ({ ...META, contextPercent: 42.5, contextWindowTokens: 128_000 }),
};

/** Text painted with one exact foreground sequence, e.g. every accent run in a line. */
function runsIn(line: string, fgAnsi: string): string[] {
	const runs: string[] = [];
	for (const match of line.matchAll(/(\x1b\[[0-9;]*m)([^\x1b]*)/g)) {
		if (match[1] === fgAnsi && match[2]) runs.push(match[2]);
	}
	return runs;
}

beforeAll(() => {
	initTheme("omk-paper-dark");
});

describe("OMK wordmark and mark", () => {
	test("the wordmark is six rows of equal width", () => {
		expect(OMK_WORDMARK).toHaveLength(6);
		const widths = new Set(OMK_WORDMARK.map((row) => visibleWidth(row)));
		expect([...widths]).toEqual([52]);
	});

	test("the hero carries the README hero's public copy and nothing else as brand text", () => {
		const plain = heroBodyLines(META, 116).map(stripAnsi).join("\n");
		expect(plain).toContain(OMK_BRAND_PLATE);
		expect(plain).toContain("MIT · PROVIDER-NEUTRAL");
		expect(plain).toContain("O P E N   M U L T I - A G E N T   K I T");
		expect(plain).toContain("Scope the work. Route the right agents.");
		expect(plain).toContain("Verify every release.");
		expect(plain).toContain("SCOPE → ROUTE → VERIFY → REPLAY");
		expect(plain).toContain("MODEL gpt-5.6-sol:high");
		expect(plain).toMatch(/[●◉]/);
		expect(plain).not.toMatch(/\p{Extended_Pictographic}/u);
	});
});

describe("reveal", () => {
	test("never moves the layout: same line count and widths for every reveal value", () => {
		for (const width of DECK_WIDTHS) {
			for (const expanded of [false, true]) {
				const final = renderControlPanelLayout(content, expanded, width);
				for (const reveal of REVEALS) {
					const frame = renderControlPanelLayout(content, expanded, width, reveal);
					expect(frame.map(stripAnsi), `width=${width} expanded=${expanded} reveal=${reveal}`).toEqual(
						final.map(stripAnsi),
					);
					expect(frame.map((line) => visibleWidth(line))).toEqual(final.map((line) => visibleWidth(line)));
				}
			}
		}
	});

	test("reveal 1 is the default render, and non-finite reveal falls back to it", () => {
		for (const width of DECK_WIDTHS) {
			const final = renderControlPanelLayout(content, true, width);
			expect(renderControlPanelLayout(content, true, width, 1)).toEqual(final);
			expect(renderControlPanelLayout(content, true, width, Number.NaN)).toEqual(final);
		}
	});

	test("inks the wordmark top to bottom and stamps the accent only at the end", () => {
		const pencil = theme.getFgAnsi("borderMuted");
		const ink = theme.getFgAnsi("text");
		const accent = theme.getFgAnsi("accent");
		const inkedRows = (reveal: number) =>
			narrowBrandLines(80, reveal)
				.slice(0, OMK_WORDMARK.length)
				.map((line) => runsIn(line, ink).length > 0);
		expect(inkedRows(0)).toEqual([false, false, false, false, false, false]);
		expect(inkedRows(0.5)).toEqual([true, true, true, false, false, false]);
		expect(inkedRows(1)).toEqual([true, true, true, true, true, true]);
		expect(
			narrowBrandLines(80, 0)
				.slice(0, 6)
				.every((line) => runsIn(line, pencil).length > 0),
		).toBe(true);

		const accentRuns = (reveal: number) => heroBodyLines(META, 116, reveal).flatMap((line) => runsIn(line, accent));
		expect(accentRuns(0.99)).toEqual([]);
		expect(accentRuns(1).length).toBeGreaterThan(0);
	});
});

describe("accent dosage", () => {
	test("the hero paints only the Verify stage in the accent", () => {
		const accent = theme.getFgAnsi("accent");
		const allowed = new Set(["┃", "●", "─".repeat(22), "Verify", "VERIFY"]);
		const runs = heroBodyLines(META, 116).flatMap((line) => runsIn(line, accent));
		expect(runs.filter((run) => !allowed.has(run))).toEqual([]);
		expect(new Set(runs)).toEqual(allowed);
	});

	test("titles, identities, section labels and the theme name are not accent", () => {
		const accent = theme.getFgAnsi("accent");
		const deck = renderControlPanelLayout(content, false, 160);
		const runs = deck.flatMap((line) => runsIn(line, accent));
		// The active tab is the one accent in the rail of an idle, unverified session.
		expect(runs.filter((run) => !["┃", "●", "─".repeat(22), "Verify", "VERIFY", "1:CONTROL"].includes(run))).toEqual(
			[],
		);
	});
});

describe("trademark separation", () => {
	test("no control-panel surface names the separate AdaptOrch product", () => {
		const outputs: string[] = [];
		for (const width of [40, 60, 90, 119, 120, 160, 200]) {
			for (const expanded of [false, true]) outputs.push(...renderControlPanelLayout(content, expanded, width));
		}
		outputs.push(...renderControlPanelRightPane(content, 38));
		expect(outputs.map(stripAnsi).filter((line) => /adaptorch/i.test(line))).toEqual([]);
	});
});

describe("narrow layouts", () => {
	test("every line fits at widths below the deck, compact and expanded", () => {
		for (const width of [40, 60, 90, 119]) {
			for (const expanded of [false, true]) {
				const lines = renderControlPanelLayout(content, expanded, width);
				const tooWide = lines.filter((line) => visibleWidth(line) > width);
				expect(tooWide, `width=${width} expanded=${expanded}`).toEqual([]);
			}
		}
	});

	test("falls back to one line of text when the wordmark does not fit", () => {
		const plain = narrowBrandLines(40).map(stripAnsi);
		expect(plain[0]).toBe("OMK OPEN MULTI-AGENT KIT");
		expect(plain.join("\n")).not.toContain("▄");
		expect(narrowBrandLines(52).map(stripAnsi).slice(0, 6)).toEqual([...OMK_WORDMARK]);
	});
});

describe("compact opening", () => {
	test("is a closed plate with the product name, the hero lede and the status line", () => {
		const lines = renderControlPanelLayout(content, false, 100);
		const plain = lines.map(stripAnsi);
		expect(plain[0]).toMatch(/^┌─ OMK · OPEN MULTI-AGENT KIT ─+┐$/);
		expect(plain[1]).toContain("Scope the work. Route the right agents. Verify every release.");
		expect(plain[2]).toContain("OMK v1.2.4 · VERIFY ? UNVERIFIED · MODEL openai/gpt-5.6-sol · ANSI ON");
		expect(plain.at(-1)).toMatch(/^└─+┘$/);
		const accent = theme.getFgAnsi("accent");
		expect(lines.flatMap((line) => runsIn(line, accent))).toEqual(["Verify"]);
	});
});
