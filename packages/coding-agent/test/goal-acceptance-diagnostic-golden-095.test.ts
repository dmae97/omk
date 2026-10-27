import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDiagnosticExcerpt, diagnosticOutputFromText } from "../src/core/goal-acceptance-diagnostic.ts";

/**
 * Spec 097 A3b: with OMK_GOAL_DIAGNOSTICS_V3 off, every excerpt is byte-identical to the
 * frozen 095 head 025bb97eed. The golden was generated from that module before the split.
 */
const fixtures = join(import.meta.dirname, "fixtures");
const golden = JSON.parse(
	readFileSync(join(fixtures, "goal-diagnostics-golden", "excerpt-095-025bb97eed.json"), "utf-8"),
) as { excerpts: Record<string, { sha256: string; truncated: boolean; mode: string; windows: unknown }> };

function snapshot(file: string) {
	const excerpt = buildDiagnosticExcerpt(diagnosticOutputFromText(readFileSync(join(fixtures, file), "utf-8")));
	return {
		sha256: createHash("sha256").update(excerpt.text).digest("hex"),
		truncated: excerpt.truncated,
		mode: excerpt.mode,
		windows: excerpt.windows ?? null,
	};
}

describe("A3b: V3 off is byte-identical to 025bb97eed", () => {
	afterEach(() => vi.unstubAllEnvs());
	const files = Object.keys(golden.excerpts);

	it("covers all 41 holdout0–3 fixtures", () => {
		expect(files).toHaveLength(41);
	});

	for (const value of [undefined, "0", ""]) {
		it(`OMK_GOAL_DIAGNOSTICS_V3=${JSON.stringify(value)}`, () => {
			if (value !== undefined) vi.stubEnv("OMK_GOAL_DIAGNOSTICS_V3", value);
			else vi.stubEnv("OMK_GOAL_DIAGNOSTICS_V3", undefined as unknown as string);
			for (const file of files) expect(snapshot(file), file).toEqual(golden.excerpts[file]);
		});
	}
});
