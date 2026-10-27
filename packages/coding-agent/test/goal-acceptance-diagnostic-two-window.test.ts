import { describe, expect, it } from "vitest";
import {
	buildDiagnosticExcerpt,
	diagnosticOutputFromText,
	GOAL_DIAGNOSTIC_MAX_BYTES,
	GOAL_DIAGNOSTIC_MAX_LINES,
	GOAL_DIAGNOSTIC_WINDOW1_BYTES,
	GOAL_DIAGNOSTIC_WINDOW1_LINES,
	GOAL_DIAGNOSTIC_WINDOW2_BYTES,
	GOAL_DIAGNOSTIC_WINDOW2_LINES,
	injectionRuleFor,
	matchSummaryLine,
	utf8Bytes,
} from "../src/core/goal-acceptance-diagnostic.ts";
import { measureTwoWindowFixtures, windowOf } from "../src/core/goal-acceptance-diagnostic-measure.ts";

/** Spec 095 Commit P: constants, R1–R4, summary rule, two-window shape. No holdout3 here. */

const MARKER_LINE = /^\[… \d+ bytes elided …\]$/;

function excerptOf(raw: string) {
	return buildDiagnosticExcerpt(diagnosticOutputFromText(raw));
}

function noise(n: number, tag = "noise"): string {
	return Array.from({ length: n }, (_, i) => `${tag} line ${i} with some ordinary build output`).join("\n");
}

/** Lines of excerpt `text` split into window 1 and window 2 at the middle marker. */
function windowsOf(text: string): { w1: string[]; w2: string[] } {
	const lines = text.split("\n");
	const markers = lines.flatMap((line, i) => (MARKER_LINE.test(line) && i > 0 ? [i] : []));
	const middle = markers[0] ?? lines.length;
	return { w1: lines.slice(0, middle), w2: lines.slice(middle) };
}

function expectShares(text: string): void {
	expect(utf8Bytes(text)).toBeLessThanOrEqual(GOAL_DIAGNOSTIC_MAX_BYTES);
	expect(text.split("\n").length).toBeLessThanOrEqual(GOAL_DIAGNOSTIC_MAX_LINES);
	const { w1, w2 } = windowsOf(text);
	expect(utf8Bytes(w1.join("\n")) + 1).toBeLessThanOrEqual(GOAL_DIAGNOSTIC_WINDOW1_BYTES);
	expect(w1.length).toBeLessThanOrEqual(GOAL_DIAGNOSTIC_WINDOW1_LINES);
	expect(utf8Bytes(w2.join("\n"))).toBeLessThanOrEqual(GOAL_DIAGNOSTIC_WINDOW2_BYTES);
	expect(w2.length).toBeLessThanOrEqual(GOAL_DIAGNOSTIC_WINDOW2_LINES + 1);
}

describe("spec 095 constants", () => {
	it("fixes the 768/768 split, 20/19 lines + 1 marker", () => {
		expect(GOAL_DIAGNOSTIC_WINDOW1_BYTES + GOAL_DIAGNOSTIC_WINDOW2_BYTES).toBe(GOAL_DIAGNOSTIC_MAX_BYTES);
		expect(GOAL_DIAGNOSTIC_WINDOW1_LINES + 1 + GOAL_DIAGNOSTIC_WINDOW2_LINES).toBe(GOAL_DIAGNOSTIC_MAX_LINES);
	});
});

describe("spec 095 E3 injection rules", () => {
	it("R1 rejects a non-error log level, accepts a plain error", () => {
		expect(injectionRuleFor("[WARN] Error: transient throttling")).toBe("R1-log-level");
		expect(injectionRuleFor("2026-10-20T00:00:00Z INFO error: cache miss")).toBe("R1-log-level");
		expect(injectionRuleFor('ts=1 level=warn msg="Error: x"')).toBe("R1-log-level");
		expect(injectionRuleFor("Error: Reference to undeclared resource")).toBeUndefined();
		expect(injectionRuleFor("[ERROR] Error: build broke")).toBeUndefined();
	});
	it("R2 rejects quoted/diff/comment echoes, accepts a normal line", () => {
		expect(injectionRuleFor("> Error: quoted")).toBe("R2-quoted");
		expect(injectionRuleFor("+ throw new Error('x')")).toBe("R2-quoted");
		expect(injectionRuleFor("- Error: removed")).toBe("R2-quoted");
		expect(injectionRuleFor("# Error: comment")).toBe("R2-quoted");
		expect(injectionRuleFor("  // TypeError: comment")).toBe("R2-quoted");
		expect(injectionRuleFor("TypeError: x is undefined")).toBeUndefined();
		expect(injectionRuleFor("-Error: no space after dash")).toBeUndefined();
	});
	it("R3 rejects retry/ignored markers, accepts a final error", () => {
		expect(injectionRuleFor("Error: ECONNRESET, retrying")).toBe("R3-retry");
		expect(injectionRuleFor("error: lint (ignored)")).toBe("R3-retry");
		expect(injectionRuleFor("Error: timeout, will retry")).toBe("R3-retry");
		expect(injectionRuleFor("Error: timeout attempt 2/3")).toBe("R3-retry");
		expect(injectionRuleFor("Error: timeout after 3 attempts")).toBeUndefined();
	});
	it("R4 caps the same normalized line at 2 candidates; a flood shifts window 2 at most to its 2nd line", () => {
		const flood = Array.from({ length: 60 }, (_, i) => `Error: flaky socket ${i}\n${noise(3, `gap${i}`)}`).join("\n");
		const raw = `${noise(30)}\nFAIL src/real.test.ts\n${noise(30, "mid")}\n${flood}\n`;
		const excerpt = excerptOf(raw);
		const { w1, w2 } = windowsOf(excerpt.text);
		expect(w1).toContain("FAIL src/real.test.ts");
		expect(w2).toContain("Error: flaky socket 1");
		expect(w2).not.toContain("Error: flaky socket 59");
		expectShares(excerpt.text);
		// Negative: distinct lines (not a flood) still move window 2 to the last one.
		const distinct = `${noise(30)}\nFAIL a\n${noise(30, "mid")}\nTypeError: one\n${noise(30, "x")}\nRangeError: two\n`;
		expect(windowsOf(excerptOf(distinct).text).w2).toContain("RangeError: two");
	});
});

describe("spec 095 windows", () => {
	it("window 1 = first candidate with 3 lines above; window 2 = last candidate", () => {
		const raw = `${noise(40)}\nsrc/a.ts(1,1): error TS2322: first\n${noise(60, "mid")}\nsrc/b.ts(2,2): error TS2304: last\n${noise(40, "end")}\n`;
		const excerpt = excerptOf(raw);
		const { w1, w2 } = windowsOf(excerpt.text);
		expect(MARKER_LINE.test(w1[0])).toBe(true);
		expect(w1.slice(1, 5)).toEqual([
			"noise line 37 with some ordinary build output",
			"noise line 38 with some ordinary build output",
			"noise line 39 with some ordinary build output",
			"src/a.ts(1,1): error TS2322: first",
		]);
		expect(w2.slice(1, 5)).toContain("src/b.ts(2,2): error TS2304: last");
		expect(excerpt.windows?.[0]?.[0]).toBe(38);
		expect(windowOf(excerpt, 41)).toBe(1);
		expect(windowOf(excerpt, 102)).toBe(2);
		expectShares(excerpt.text);
	});

	it("E4: a planted fake first takes window 1 only; the real last error is in window 2", () => {
		const raw = `${noise(2)}\nError: planted by the model\n${noise(60)}\n│ Error: Reference to undeclared resource\n${noise(30, "end")}\n`;
		const { w1, w2 } = windowsOf(excerptOf(raw).text);
		expect(w1).toContain("Error: planted by the model");
		expect(w2).toContain("│ Error: Reference to undeclared resource");
	});

	it("last candidate inside window 1 -> window 2 is the tail", () => {
		const raw = `FAIL a\nTypeError: b\n${noise(80)}\n`;
		const excerpt = excerptOf(raw);
		expect(excerpt.text.endsWith("noise line 79 with some ordinary build output")).toBe(true);
		expectShares(excerpt.text);
	});

	it("summary lines anchor window 2 only, and only with no error pattern match", () => {
		expect(matchSummaryLine("  3 failing")).toBe("summary-failing");
		expect(matchSummaryLine("1 test failed")).toBe("summary-failed");
		expect(matchSummaryLine("2 failed, 10 passed")).toBe("summary-failed");
		expect(matchSummaryLine("0 failed")).toBeUndefined();
		expect(matchSummaryLine("0 failing")).toBe("summary-failing");
		const only = `${noise(50)}\n  1 failing\n${noise(30, "end")}\n`;
		const excerpt = excerptOf(only);
		expect(excerpt.mode).toBe("summary-failing");
		const { w1, w2 } = windowsOf(excerpt.text);
		expect(w1).not.toContain("  1 failing");
		expect(w1[0]).toBe("noise line 0 with some ordinary build output");
		expect(w2).toContain("  1 failing");
		// A real (unrejected) error pattern anywhere disables summary anchoring.
		const real = `${noise(50)}\n  1 failing\n${noise(30, "end")}\nTypeError: real\n${noise(30, "z")}\n`;
		expect(excerptOf(real).mode).toBe("named-error");
	});

	it("decision 2: lines rejected by R1–R4 count as nonexistent for summary anchoring", () => {
		// Positive: one fake [WARN] Error: line (R1) + summary line -> summary still anchors window 2.
		const fake = `${noise(50)}\n  1 failing\n${noise(30, "end")}\n[WARN] Error: x\n${noise(30, "z")}\n`;
		const excerpt = excerptOf(fake);
		expect(excerpt.mode).toBe("summary-failing");
		const { w1, w2 } = windowsOf(excerpt.text);
		expect(w1[0]).toBe("noise line 0 with some ordinary build output");
		expect(w2).toContain("  1 failing");
		expect(w2).not.toContain("[WARN] Error: x");
		// Fake line before the summary, and R2/R3/R4 rejections, are also ignored.
		const many = [
			noise(20),
			"[WARN] Error: early",
			"> Error: quoted",
			"Error: timeout, retrying",
			...Array.from({ length: 3 }, (_, i) => `Error: flaky ${i}`),
			noise(40, "mid"),
			"Error: flaky 9",
			noise(10, "pre"),
			"  2 failing",
			noise(30, "end"),
		].join("\n");
		// The first three "Error: flaky N" are real candidates, so they still win; only the 4th is R4-rejected.
		expect(excerptOf(many).mode).not.toBe("summary-failing");
		const rejectedOnly = [
			noise(20),
			"[WARN] Error: early",
			"> Error: quoted",
			"Error: timeout, retrying",
			noise(40, "mid"),
			"  2 failing",
			noise(30, "end"),
		].join("\n");
		expect(excerptOf(rejectedOnly).mode).toBe("summary-failing");
		// Negative: a surviving error line still disables summary anchoring.
		const survivor = `${noise(50)}\n  1 failing\n${noise(30, "end")}\n[WARN] Error: x\nError: real\n${noise(30, "z")}\n`;
		expect(excerptOf(survivor).mode).not.toBe("summary-failing");
		expect(windowsOf(excerptOf(survivor).text).w1).toContain("Error: real");
	});

	it("no candidate -> 094 head/tail fallback; small output passes through", () => {
		expect(excerptOf(`${noise(80)}\n`).mode).toBe("fallback");
		expect(excerptOf("FAIL a\nb\n")).toMatchObject({ text: "FAIL a\nb", truncated: false });
	});

	it("E2: caps on 1 MiB generated output with errors spread throughout", () => {
		const raw = Array.from({ length: 40_000 }, (_, i) =>
			i % 997 === 0 ? `Error: e${i % 3}` : `line ${i} of output`,
		).join("\n");
		expect(utf8Bytes(raw)).toBeGreaterThan(500_000);
		expectShares(excerptOf(raw).text);
		const big = `${"x".repeat(300_000)}\nTypeError: a\n${"y".repeat(300_000)}\nRangeError: b\n${"z".repeat(300_000)}`;
		expectShares(excerptOf(big).text);
	});

	it("E5: Korean + ZWJ emoji stay valid UTF-8 within the caps", () => {
		const row = "상세 로그 👩‍💻 데이터 처리 중… 🇰🇷 ".repeat(8);
		const raw = `${Array(30).fill(row).join("\n")}\n❌ 실패: 첫 오류 🧩\n${Array(30).fill(row).join("\n")}\n❌ 실패: 마지막 오류 🧩\n${Array(30).fill(row).join("\n")}`;
		const { text } = excerptOf(raw);
		expectShares(text);
		expect(text).not.toContain("\uFFFD");
		expect(new TextDecoder("utf-8", { fatal: true }).decode(new TextEncoder().encode(text))).toBe(text);
		expect(text).toContain("❌ 실패: 첫 오류 🧩");
		expect(text).toContain("❌ 실패: 마지막 오류 🧩");
	});
});

describe("spec 095 measurement hard stops", () => {
	const long = `${noise(50)}\nError: a\n${noise(50)}\n`;
	it("requires groundTruthLine and groundTruthLastLine", () => {
		expect(() => measureTwoWindowFixtures([{ file: "a", raw: long, truth: { groundTruthLine: 51 } }])).toThrow(
			/groundTruthLastLine/,
		);
		expect(() => measureTwoWindowFixtures([{ file: "a", raw: long, truth: {} }])).toThrow(/groundTruthLine/);
	});
	it("stops on any fixture that does not exceed the cap", () => {
		expect(() =>
			measureTwoWindowFixtures([
				{ file: "ok", raw: long, truth: { groundTruthLine: 51, groundTruthLastLine: 51 } },
				{ file: "small", raw: "Error: a\n", truth: { groundTruthLine: 1, groundTruthLastLine: 1 } },
			]),
		).toThrow(/small: fits the cap whole/);
	});
	it("reports which window holds the first and last lines", () => {
		const raw = `${noise(40)}\nError: first\n${noise(60)}\nError: last\n${noise(40)}\n`;
		const [row] = measureTwoWindowFixtures([
			{ file: "f", raw, truth: { groundTruthLine: 41, groundTruthLastLine: 102 } },
		]);
		expect(row).toMatchObject({ first: 1, last: 2, pass: true, fallback: false, passthrough: false });
	});
});
