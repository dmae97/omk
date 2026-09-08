import { describe, expect, it } from "vitest";
import { DEEP_RUNNER_EVIDENCE_MISSING, runDeepWall } from "../src/deep-wall.ts";
import { evaluateCorrectnessWall } from "../src/evaluate-correctness-wall.ts";

const evidence = { digest: "sha256:fixture", command: "fixture-check", exitCode: 0 };

describe("Deep Wall completion evidence", () => {
	it.each([1, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
		"refuses completion when the runner exit code is %s",
		async (exitCode) => {
			const result = await runDeepWall({
				kind: "code-edit",
				allowCompletion: true,
				runner: async () => ({ status: "completed", evidence: { ...evidence, exitCode }, message: "claimed done" }),
			});
			expect(result.status).toBe("unavailable");
			expect(result.runnerFlags).toContain(DEEP_RUNNER_EVIDENCE_MISSING);
		},
	);

	it.each(["digest", "command"] as const)("refuses whitespace-only %s evidence", async (field) => {
		const result = await runDeepWall({
			kind: "code-edit",
			allowCompletion: true,
			runner: async () => ({
				status: "completed",
				evidence: { ...evidence, [field]: " \n\t" },
				message: "claimed done",
			}),
		});
		expect(result.status).toBe("unavailable");
	});
});

describe("Deep Wall preserves prior policy decisions", () => {
	it("preserves human review when a completed runner follows an out-of-scope patch", async () => {
		const { verdictCard, receipt } = await evaluateCorrectnessWall({
			kind: "code-edit",
			diffText: "--- a/private/config.ts\n+++ b/private/config.ts\n@@ -1 +1 @@\n-old\n+new",
			approvedWriteScope: ["src/**"],
			previewOnly: true,
			deepWall: true,
			deepWallAllowCompletion: true,
			deepWallRunner: async () => ({ status: "completed", evidence, message: "fixture passed" }),
		});
		expect(receipt.deepWallStatus).toBe("completed");
		expect(verdictCard.verdict).toBe("BLOCKED");
		expect(verdictCard.limits.requiresHumanReview).toBe(true);
		expect(receipt.shouldSubmit).toBe(false);
	});

	it("preserves human review when a completed runner follows missing patch evidence", async () => {
		const { verdictCard, receipt } = await evaluateCorrectnessWall({
			kind: "code-edit",
			diffText: "",
			previewOnly: true,
			deepWall: true,
			deepWallAllowCompletion: true,
			deepWallRunner: async () => ({ status: "completed", evidence, message: "fixture passed" }),
		});
		expect(verdictCard.verdict).toBe("INCONCLUSIVE");
		expect(verdictCard.limits.requiresHumanReview).toBe(true);
		expect(receipt.shouldSubmit).toBe(false);
	});
});
