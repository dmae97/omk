import { describe, expect, it } from "vitest";
import { BATCH1_NO_DOCKER_RUNNER, mapToB2C } from "../src/b2c-mapper.ts";
import { evaluateCorrectnessWall } from "../src/evaluate-correctness-wall.ts";
import { POLICY_FLAG, scanDiffLinesForSecrets } from "../src/policy-wall.ts";
import { deriveRepairHints } from "../src/repair-loop.ts";
import { buildVerificationDigest } from "../src/signed-receipt.ts";

describe("buildVerificationDigest", () => {
	it("hashes patch and evidence without echoing content", () => {
		const d = buildVerificationDigest({
			patchText: "+api_key=REDACTED\n",
			evidenceChunks: ["run-abc"],
		});
		expect(d.algorithm).toBe("sha256-hex");
		expect(d.patchHash).toMatch(/^[a-f0-9]{64}$/);
		expect(d.evidenceHashes).toHaveLength(1);
		expect(d.compositeHash).toMatch(/^[a-f0-9]{64}$/);
		expect(JSON.stringify(d)).not.toContain("REDACTED");
	});
});

describe("deriveRepairHints", () => {
	it("suggests secret removal when SECRET_SUSPECT is set", () => {
		const hints = deriveRepairHints({
			userVerdict: "BLOCKED",
			policyFlags: [POLICY_FLAG.SECRET_SUSPECT, POLICY_FLAG.NON_NEGOTIABLE_BLOCKING],
			previewOnly: true,
			diffPaths: ["x.ts"],
		});
		expect(hints.some((h) => h.includes("secret"))).toBe(true);
	});
});

describe("mapToB2C next_actions and limits", () => {
	it("uses Apply on PASS and BATCH1 code in previewOnly", () => {
		const { verdictCard, receipt } = mapToB2C({
			kind: "code-edit",
			runIds: [],
			previewOnly: true,
			policyFlags: [POLICY_FLAG.LOW_DISCRIMINATION, POLICY_FLAG.REPRO_OVERFIT_SUSPECT],
			diffPaths: ["packages/adaptorch-wpl/a.ts"],
		});
		expect(verdictCard.next_actions).toContain("Apply");
		expect(verdictCard.limits.code).toBe(BATCH1_NO_DOCKER_RUNNER);
		expect(receipt.disclaimer).toContain(BATCH1_NO_DOCKER_RUNNER);
	});

	it("uses Regenerate when BLOCKED", () => {
		const { verdictCard } = mapToB2C({
			kind: "code-edit",
			runIds: [],
			previewOnly: false,
			policyFlags: [POLICY_FLAG.CANDIDATE_LEAK_SUSPECT, POLICY_FLAG.NON_NEGOTIABLE_BLOCKING],
			diffPaths: ["out.ts"],
		});
		expect(verdictCard.verdict).toBe("BLOCKED");
		expect(verdictCard.next_actions).toEqual(["Regenerate"]);
	});
});

describe("scanDiffLinesForSecrets", () => {
	it("flags api_key and private key patterns on added lines", () => {
		const diff = ["--- a/f", "+++ b/f", "+api_key=xxx", "+-----BEGIN PRIVATE KEY-----"].join("\n");
		expect(scanDiffLinesForSecrets(diff)).toBe(true);
		expect(scanDiffLinesForSecrets("+const x = 1\n")).toBe(false);
	});
});

describe("evaluateCorrectnessWall repairHints", () => {
	it("attaches repairHints on blocked scope violation", async () => {
		const diff = [
			"--- a/packages/adaptorch-wpl/src/index.ts",
			"+++ b/packages/adaptorch-wpl/src/index.ts",
			"--- a/packages/other/x.ts",
			"+++ b/packages/other/x.ts",
		].join("\n");
		const { verdictCard } = await evaluateCorrectnessWall({
			kind: "code-edit",
			approvedWriteScope: ["packages/adaptorch-wpl/**"],
			diffText: diff,
			previewOnly: true,
		});
		expect(verdictCard.repairHints).toBeDefined();
		expect(verdictCard.repairHints!.length).toBeGreaterThan(0);
	});
});
