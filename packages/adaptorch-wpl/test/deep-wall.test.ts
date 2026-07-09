import { describe, expect, it } from "vitest";
import { BATCH1_NO_DOCKER_RUNNER } from "../src/b2c-mapper.ts";
import {
	DEEP_RUNNER_ERROR,
	DEEP_RUNNER_EVIDENCE_MISSING,
	DEEP_RUNNER_NOT_WIRED,
	DEEP_WALL_UNAVAILABLE,
	isDeepRunnerCompletionAllowed,
	runDeepWall,
	runDeepWallStub,
} from "../src/deep-wall.ts";
import { evaluateCorrectnessWall } from "../src/evaluate-correctness-wall.ts";

describe("isDeepRunnerCompletionAllowed", () => {
	it("is false until hermetic runner ships", () => {
		expect(isDeepRunnerCompletionAllowed()).toBe(false);
	});
});

describe("runDeepWallStub", () => {
	it("returns unavailable with BATCH1 limit and user message (no docker)", () => {
		const result = runDeepWallStub({ kind: "code-edit", runIds: ["run-1"] });
		expect(result.status).toBe("unavailable");
		expect(result.limits).toEqual([BATCH1_NO_DOCKER_RUNNER]);
		expect(result.message.length).toBeGreaterThan(10);
		expect(result.message.toLowerCase()).toContain("docker");
	});

	it("docker phase uses distinct operator message", () => {
		const result = runDeepWallStub({ kind: "code-edit", phase: "docker" });
		expect(result.message).toContain("hermetic");
	});
});

describe("runDeepWall evidence-gated runner", () => {
	const baseParams = { kind: "code-edit", runIds: ["r1"] };
	const validEvidence = { digest: "sha256:abc", command: "docker run -- check", exitCode: 0 };

	it("reaches completed only with runner + allowCompletion + valid evidence", async () => {
		const result = await runDeepWall({
			...baseParams,
			allowCompletion: true,
			runner: async () => ({ status: "completed", evidence: validEvidence, message: "ok" }),
		});
		expect(result.status).toBe("completed");
		expect(result.evidence).toEqual(validEvidence);
	});

	it("downgrades completed-without-evidence to unavailable + EVIDENCE_MISSING", async () => {
		const result = await runDeepWall({
			...baseParams,
			allowCompletion: true,
			runner: async () => ({ status: "completed", message: "ok" }),
		});
		expect(result.status).toBe("unavailable");
		expect(result.runnerFlags).toContain(DEEP_RUNNER_EVIDENCE_MISSING);
	});

	it("catches runner throw -> unavailable + RUNNER_ERROR", async () => {
		const result = await runDeepWall({
			...baseParams,
			allowCompletion: true,
			runner: async () => {
				throw new Error("docker daemon down");
			},
		});
		expect(result.status).toBe("unavailable");
		expect(result.runnerFlags).toContain(DEEP_RUNNER_ERROR);
		expect(result.message).toContain("docker daemon down");
	});

	it("ignores runner when allowCompletion is false (stub path)", async () => {
		const result = await runDeepWall({
			...baseParams,
			runner: async () => ({ status: "completed", evidence: validEvidence, message: "ok" }),
		});
		expect(result.status).toBe("unavailable");
		expect(result.limits).toBeDefined();
	});

	it("rejects evidence with empty digest as invalid", async () => {
		const result = await runDeepWall({
			...baseParams,
			allowCompletion: true,
			runner: async () => ({
				status: "completed",
				evidence: { digest: "", command: "c", exitCode: 0 },
				message: "ok",
			}),
		});
		expect(result.status).toBe("unavailable");
		expect(result.runnerFlags).toContain(DEEP_RUNNER_EVIDENCE_MISSING);
	});
});

describe("evaluateCorrectnessWall deepWall", () => {
	it("merges deep stub into receipt policyFlags and verdict limits when deepWall is true", async () => {
		const diff = [
			"--- a/packages/adaptorch-wpl/src/foo.ts",
			"+++ b/packages/adaptorch-wpl/src/foo.ts",
			"@@ -1 +1 @@",
			"+// ok",
		].join("\n");

		const { verdictCard, receipt } = await evaluateCorrectnessWall({
			kind: "code-edit",
			approvedWriteScope: ["packages/adaptorch-wpl/**"],
			diffText: diff,
			previewOnly: true,
			deepWall: true,
		});

		expect(receipt.policyFlags).toContain(DEEP_WALL_UNAVAILABLE);
		expect(receipt.policyFlags).toContain(DEEP_RUNNER_NOT_WIRED);
		expect(receipt.deepWallStatus).toBe("unavailable");
		expect(verdictCard.limits.code).toBe(BATCH1_NO_DOCKER_RUNNER);
		expect(verdictCard.limits.requiresHumanReview).toBe(true);
		expect(verdictCard.blocked_reasons.some((r) => r.includes("Deep correctness"))).toBe(true);
	});

	it("attaches evidence and clears requiresHumanReview when runner completes", async () => {
		const diff = [
			"--- a/packages/adaptorch-wpl/src/foo.ts",
			"+++ b/packages/adaptorch-wpl/src/foo.ts",
			"@@ -1 +1 @@",
			"+// ok",
		].join("\n");
		const evidence = { digest: "sha256:deadbeef", command: "docker run check", exitCode: 0 };
		const { verdictCard, receipt } = await evaluateCorrectnessWall({
			kind: "code-edit",
			approvedWriteScope: ["packages/adaptorch-wpl/**"],
			diffText: diff,
			previewOnly: true,
			deepWall: true,
			deepWallAllowCompletion: true,
			deepWallRunner: async () => ({ status: "completed", evidence, message: "hermetic ok" }),
		});
		expect(receipt.deepWallStatus).toBe("completed");
		expect(receipt.deepWallEvidence).toEqual(evidence);
		expect(receipt.policyFlags).not.toContain(DEEP_WALL_UNAVAILABLE);
		expect(verdictCard.limits.requiresHumanReview).toBe(false);
	});

	it("does not set deepWallStatus when deepWall is omitted", async () => {
		const diff = [
			"--- a/packages/adaptorch-wpl/src/foo.ts",
			"+++ b/packages/adaptorch-wpl/src/foo.ts",
			"@@ -1 +1 @@",
			"+// ok",
		].join("\n");

		const { receipt } = await evaluateCorrectnessWall({
			kind: "code-edit",
			approvedWriteScope: ["packages/adaptorch-wpl/**"],
			diffText: diff,
			previewOnly: true,
		});

		expect(receipt.deepWallStatus).toBeUndefined();
		expect(receipt.policyFlags).not.toContain(DEEP_WALL_UNAVAILABLE);
	});
});
