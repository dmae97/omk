/**
 * Spec 097 step 2: the measurement scorer implements the 097 pass rule exactly,
 * and the 095 rule is still selectable (and the default) for the 095 record.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DiagnosticExcerpt } from "../src/core/goal-acceptance-diagnostic.ts";
import { lineShown, measureTwoWindowFixtures, scoreFixture } from "../src/core/goal-acceptance-diagnostic-measure.ts";

// 60 numbered lines; line N reads "line N".
const text = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join("\n");
const M = (n: number) => `[… ${n} bytes elided …]`;
const lines = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => `line ${a + i}`);

function excerpt(parts: string[], windows: [number, number][]): DiagnosticExcerpt {
	return { text: parts.join("\n"), truncated: true, mode: "test", windows };
}

describe("097 scorer rule", () => {
	// Window 1 = 10-14, window 2 = 40-44, markers elsewhere.
	const two = excerpt(
		[M(90), ...lines(10, 14), M(200), ...lines(40, 44), M(100)],
		[
			[10, 14],
			[40, 44],
		],
	);

	it("passes when both GT lines are in emitted text", () => {
		expect(scoreFixture(two, text, 12, 42, "097").pass).toBe(true);
	});

	it("passes when both GT lines sit in one (merged) window", () => {
		expect(scoreFixture(two, text, 11, 13, "097").pass).toBe(true);
		// 095 rule fails the same case (last not in window 2): the rule really differs.
		expect(scoreFixture(two, text, 11, 13, "095").pass).toBe(false);
	});

	it("passes across adjacent windows emitted without a marker", () => {
		const adjacent = excerpt(
			[M(90), ...lines(10, 14), ...lines(15, 18), M(10)],
			[
				[10, 14],
				[15, 18],
			],
		);
		expect(scoreFixture(adjacent, text, 12, 17, "097").pass).toBe(true);
	});

	it("fails when the first GT line is missing", () => {
		const s = scoreFixture(two, text, 5, 42, "097");
		expect(s).toMatchObject({ firstShown: false, lastShown: true, pass: false });
	});

	it("fails when the last GT line is missing", () => {
		const s = scoreFixture(two, text, 12, 55, "097");
		expect(s).toMatchObject({ firstShown: true, lastShown: false, pass: false });
	});

	it("fails when a GT line is covered only by an elision marker", () => {
		// Line 25 is between the windows: only the middle marker covers it.
		expect(lineShown(two, 25, text)).toBe(false);
		expect(scoreFixture(two, text, 12, 25, "097").pass).toBe(false);
	});

	it("fails when the range claims a line whose text is not emitted", () => {
		const lying = excerpt([...lines(10, 12), M(30)], [[10, 14]]);
		expect(lineShown(lying, 14, text)).toBe(false);
	});

	it("cut prefix only counts for the last line of a window", () => {
		const t = text.replace("line 11", "line 11 long message");
		expect(lineShown(excerpt(["line 10", "line 11 lo", "line 12"], [[10, 12]]), 11, t)).toBe(false);
	});

	it("never counts a marker line as emitted text", () => {
		const t = `${M(5)}\n${"x".repeat(10)}`;
		const e = excerpt([M(5)], [[1, 2]]);
		expect(lineShown(e, 1, t)).toBe(false);
	});

	it("counts a line cut at the cap (non-empty prefix) as shown", () => {
		const e = excerpt(["other text"], [[10, 10]]);
		const t = text.replace("line 10", "line 10 long message");
		expect(lineShown(excerpt(["line 10 lo"], [[10, 10]]), 10, t)).toBe(true);
		expect(lineShown(e, 10, t)).toBe(false);
	});

	it("uses head/tail ranges for the 094 fallback", () => {
		const fb: DiagnosticExcerpt = {
			text: `${lines(1, 5).join("\n")}\n${M(300)}\n${lines(56, 60).join("\n")}`,
			truncated: true,
			mode: "fallback",
		};
		expect(scoreFixture(fb, text, 3, 58, "097").pass).toBe(true);
		expect(scoreFixture(fb, text, 3, 30, "097").pass).toBe(false);
	});
});

describe("measureTwoWindowFixtures rule selection", () => {
	const long = Array.from({ length: 80 }, (_, i) => (i === 50 ? "Error: boom" : `ok ${i + 1}`)).join("\n");

	it("hard-stops on a fixture that fits the cap whole, under both rules", () => {
		for (const rule of ["095", "097"] as const) {
			expect(() =>
				measureTwoWindowFixtures(
					[{ file: "small", raw: "Error: x\nmore", truth: { groundTruthLine: 1, groundTruthLastLine: 1 } }],
					{ rule },
				),
			).toThrow(/fits the cap whole/);
		}
	});

	it("hard-stops on missing GT fields under 097", () => {
		expect(() =>
			measureTwoWindowFixtures([{ file: "a", raw: long, truth: { groundTruthLine: 51 } }], { rule: "097" }),
		).toThrow(/groundTruthLastLine/);
	});

	it("defaults to the 095 rule", () => {
		const [row] = measureTwoWindowFixtures([
			{ file: "a", raw: long, truth: { groundTruthLine: 51, groundTruthLastLine: 51 } },
		]);
		expect(row.rule).toBe("095");
	});

	it("095 mode is unchanged on the committed holdout3: still 0/10", () => {
		const dir = join(__dirname, "fixtures", "goal-diagnostics-holdout3");
		const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as Record<string, unknown>;
		const fixtures = Object.entries(manifest).map(([file, truth]) => ({
			file,
			raw: readFileSync(join(dir, file), "utf8"),
			truth,
		}));
		const r095 = measureTwoWindowFixtures(fixtures, { rule: "095" });
		expect(r095.filter((row) => row.pass).length).toBe(0);
		expect(measureTwoWindowFixtures(fixtures).map((row) => row.pass)).toEqual(r095.map((row) => row.pass));
	});
});
