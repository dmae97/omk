/**
 * Lane W1-T — soft-mode apply gate + mapToB2C SECRET policy (library surface).
 */
import { describe, expect, it } from "vitest";
import { mapToB2C, POLICY_FLAG, runFastWall } from "../../../../adaptorch-wpl/src/index.ts";

type WallMode = "shadow" | "soft" | "hard";

function shouldBlock(verdict: string, mode: WallMode, wallOverrideActive: boolean): boolean {
	if (mode === "shadow") return false;
	if (verdict === "PASS" || verdict === "ADVISORY") return false;
	if (mode === "hard") return verdict === "BLOCKED" || verdict === "INCONCLUSIVE";
	if (verdict !== "BLOCKED") return false;
	return !wallOverrideActive;
}

describe("019-correctness-wall-soft-mode", () => {
	it("mapToB2C: SECRET_SUSPECT flags -> BLOCKED verdict and secret blocked_reason", () => {
		const diff = [
			"--- a/packages/adaptorch-wpl/x.ts",
			"+++ b/packages/adaptorch-wpl/x.ts",
			"@@ -0,0 +1 @@",
			"+" + "API_KEY=not-a-real-secret",
		].join("\n");

		const wall = runFastWall({
			diffText: diff,
			approvedWriteScope: ["packages/adaptorch-wpl/**"],
		});
		expect(wall.flags).toContain(POLICY_FLAG.SECRET_SUSPECT);

		const { verdictCard } = mapToB2C({
			kind: "code-edit",
			runIds: [],
			previewOnly: true,
			policyFlags: wall.flags,
			diffPaths: wall.diffPaths,
		});

		expect(verdictCard.verdict).toBe("BLOCKED");
		expect(verdictCard.blocked_reasons.some((r) => /secret|credential/i.test(r))).toBe(true);
		expect(verdictCard.next_actions).toContain("Regenerate");
	});

	it("shouldBlock: soft mode blocks BLOCKED unless override; shadow never blocks", () => {
		expect(shouldBlock("BLOCKED", "soft", false)).toBe(true);
		expect(shouldBlock("BLOCKED", "soft", true)).toBe(false);
		expect(shouldBlock("BLOCKED", "shadow", false)).toBe(false);
		expect(shouldBlock("INCONCLUSIVE", "hard", false)).toBe(true);
		expect(shouldBlock("PASS", "hard", false)).toBe(false);
	});
});
