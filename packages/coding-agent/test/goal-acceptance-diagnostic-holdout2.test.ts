import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	buildDiagnosticExcerpt,
	diagnosticOutputFromText,
	GOAL_DIAGNOSTIC_MAX_BYTES,
	GOAL_DIAGNOSTIC_MAX_LINES,
	sanitizeDiagnosticText,
	utf8Bytes,
} from "../src/core/goal-acceptance-diagnostic.ts";

/**
 * Spec 094 holdout2 measurement. Fixtures and ground truth were committed
 * (d3da973d9e) before this measurement; the excerpt was not tuned after it.
 * The pinned numbers are the measured result, not a pass bar: Tech Lead's bar
 * is 10/10 and this set measured 8/10 under 094's single window.
 *
 * Spec 095 (two windows): regression only, not evidence (the summary patterns
 * were added after seeing mocha-30-pass). Re-measured, not retuned: 9/10.
 * mocha-30-pass is now kept by window 2 (summary-failing); ava-korean-28-pass
 * is now LOST: its only match is the summary line `1 test failed`, so window 1
 * is the head (lines 1–20) and window 2 sits at lines 40–43, and the real line
 * 29 falls between them (094's tail kept it).
 */
const DIR = join(import.meta.dirname, "fixtures", "goal-diagnostics-holdout2");

interface Truth {
	readonly groundTruthLine?: number;
	readonly groundTruthText?: string;
}

function measure() {
	const manifest = JSON.parse(readFileSync(join(DIR, "manifest.json"), "utf8")) as Record<string, Truth>;
	return Object.entries(manifest).map(([file, truth]) => {
		const text = sanitizeDiagnosticText(readFileSync(join(DIR, file), "utf8"));
		const excerpt = buildDiagnosticExcerpt(diagnosticOutputFromText(text));
		const line = typeof truth.groundTruthLine === "number" ? text.split("\n")[truth.groundTruthLine - 1] : undefined;
		const inWindow = line !== undefined && excerpt.text.split("\n").includes(line);
		return { file, truth, line, excerpt, inWindow };
	});
}

describe("spec 094 holdout2 measurement", () => {
	const rows = measure();

	it("has ground truth for all 10 fixtures, matching the sanitized line", () => {
		expect(rows).toHaveLength(10);
		for (const row of rows) {
			expect(row.truth.groundTruthLine, row.file).toBeTypeOf("number");
			expect(row.line, row.file).toBe(row.truth.groundTruthText);
		}
	});

	it("holds the caps on every fixture", () => {
		for (const { excerpt } of rows) {
			expect(utf8Bytes(excerpt.text)).toBeLessThanOrEqual(GOAL_DIAGNOSTIC_MAX_BYTES);
			expect(excerpt.text.split("\n").length).toBeLessThanOrEqual(GOAL_DIAGNOSTIC_MAX_LINES);
		}
	});

	it("pins the measured result (spec 095): real line in excerpt 9/10, fallback 3/10", () => {
		const table = Object.fromEntries(rows.map((row) => [row.file, [row.excerpt.mode, row.inWindow]]));
		expect(table).toEqual({
			"playwright-40-pass.txt": ["error-word", true],
			"mocha-30-pass.txt": ["summary-failing", true],
			"phpunit-deceptive.txt": ["fallback", true],
			"terraform-fake-error.txt": ["error-colon", true],
			"mypy.txt": ["error-colon", true],
			"dotnet-warnings-first.txt": ["fallback", true],
			"xcodebuild-keywordless.txt": ["fallback", true],
			"bazel.txt": ["error-word", true],
			"kotlin-deceptive.txt": ["fail-marker", true],
			"ava-korean-28-pass.txt": ["summary-failed", false],
		});
		expect(rows.filter((row) => row.inWindow)).toHaveLength(9);
		expect(rows.filter((row) => row.excerpt.mode === "fallback")).toHaveLength(3);
	});
});
