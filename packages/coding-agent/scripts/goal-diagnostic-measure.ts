/**
 * Spec 095 measurement (Commit M tool). Usage:
 *   node scripts/goal-diagnostic-measure.ts <fixture-dir> [--rule=095|097]   (default 095)
 * The directory holds `manifest.json` mapping file -> { groundTruthLine, groundTruthLastLine }
 * (1-based on sanitized text). Hard stops (exit 2) when any entry lacks either
 * field or any fixture fits the cap whole (<= 1,536 B and <= 40 lines after
 * sanitize): such fixtures are invalid under spec 095 and must be replaced.
 * 095 pass: first line in window 1 and, when the last line differs, last line in window 2.
 * Top-level `authorDeclaration` (a string) is skipped. Set OMK_GOAL_DIAGNOSTICS_V3=1 to measure excerpt v3.
 * 097 pass: both lines inside the emitted excerpt text (any window), not inside an elision marker.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type MeasureRule, manifestFixtures, measureTwoWindowFixtures } from "../src/core/goal-acceptance-diagnostic-measure.ts";

const args = process.argv.slice(2);
const ruleArg = args.find((arg) => arg.startsWith("--rule="))?.slice("--rule=".length) ?? "095";
if (ruleArg !== "095" && ruleArg !== "097") {
	console.error(`unknown --rule=${ruleArg} (expected 095 or 097)`);
	process.exit(2);
}
const rule: MeasureRule = ruleArg;
const dir = args.find((arg) => !arg.startsWith("--"));
if (!dir) {
	console.error("usage: goal-diagnostic-measure <fixture-dir>");
	process.exit(2);
}
const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as Record<string, unknown>;
try {
	const rows = measureTwoWindowFixtures(
		manifestFixtures(manifest, (file) => readFileSync(join(dir, file), "utf8")),
		{ rule },
	);
	console.table(rows.map(({ excerpt: _excerpt, ...row }) => row));
	const passed = rows.filter((row) => row.pass).length;
	console.log(`rule ${rule}: pass ${passed}/${rows.length}`);
	process.exit(passed === rows.length ? 0 : 1);
} catch (error) {
	console.error(`HARD STOP: ${(error as Error).message}`);
	process.exit(2);
}
