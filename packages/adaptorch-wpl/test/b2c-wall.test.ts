import { describe, expect, it } from "vitest";
import { evaluateCorrectnessWall } from "../src/evaluate-correctness-wall.ts";
import { POLICY_FLAG, parseDiffPaths, pathMatchesApprovedScope, runFastWall } from "../src/policy-wall.ts";

describe("policy-wall helpers", () => {
	it("parses paths from unified diff", () => {
		const diff = ["--- a/packages/foo.ts", "+++ b/packages/foo.ts", "@@ -1 +1 @@", "+x"].join("\n");
		expect(parseDiffPaths(diff)).toEqual(["packages/foo.ts"]);
	});

	it("matches approved scope prefix and glob", () => {
		expect(pathMatchesApprovedScope("packages/adaptorch-wpl/src/x.ts", ["packages/adaptorch-wpl/**"])).toBe(true);
		expect(pathMatchesApprovedScope("packages/other/x.ts", ["packages/adaptorch-wpl/**"])).toBe(false);
	});
});

describe("evaluateCorrectnessWall", () => {
	it("returns BLOCKED when diff touches paths outside approved write scope", async () => {
		const diff = [
			"--- a/packages/adaptorch-wpl/src/index.ts",
			"+++ b/packages/adaptorch-wpl/src/index.ts",
			"--- a/packages/coding-agent/secret.ts",
			"+++ b/packages/coding-agent/secret.ts",
		].join("\n");

		const { verdictCard, receipt } = await evaluateCorrectnessWall({
			kind: "code-edit",
			approvedWriteScope: ["packages/adaptorch-wpl/**"],
			diffText: diff,
			previewOnly: true,
		});

		expect(verdictCard.verdict).toBe("BLOCKED");
		expect(receipt.canApply).toBe(false);
		expect(verdictCard.blocked_reasons.some((r) => r.includes("write scope"))).toBe(true);
	});

	it("returns INCONCLUSIVE when diff is empty", async () => {
		const { verdictCard } = await evaluateCorrectnessWall({
			kind: "code-edit",
			approvedWriteScope: ["packages/adaptorch-wpl/**"],
			diffText: "",
			previewOnly: true,
		});

		expect(verdictCard.verdict).toBe("INCONCLUSIVE");
	});

	it("returns PASS or ADVISORY for trivial in-scope diff in previewOnly mode", async () => {
		const diff = [
			"--- a/packages/adaptorch-wpl/src/foo.ts",
			"+++ b/packages/adaptorch-wpl/src/foo.ts",
			"@@ -1 +1 @@",
			"+// comment",
		].join("\n");

		const { verdictCard } = await evaluateCorrectnessWall({
			kind: "code-edit",
			approvedWriteScope: ["packages/adaptorch-wpl/**"],
			diffText: diff,
			previewOnly: true,
		});

		expect(["PASS", "ADVISORY"]).toContain(verdictCard.verdict);
		expect(verdictCard.next_actions.some((a) => a === "Apply" || a === "Deep Check")).toBe(true);
	});

	it("returns BLOCKED and verificationDigest on secret-like diff line", async () => {
		const diff = [
			"--- a/packages/adaptorch-wpl/.env.local",
			"+++ b/packages/adaptorch-wpl/.env.local",
			"@@ -0,0 +1 @@",
			"+API_KEY=not-a-real-secret",
		].join("\n");
		const wall = runFastWall({ diffText: diff, approvedWriteScope: ["packages/adaptorch-wpl/**"] });
		expect(wall.flags).toContain(POLICY_FLAG.SECRET_SUSPECT);

		const { verdictCard, receipt } = await evaluateCorrectnessWall({
			kind: "code-edit",
			approvedWriteScope: ["packages/adaptorch-wpl/**"],
			diffText: diff,
			previewOnly: true,
		});
		expect(verdictCard.verdict).toBe("BLOCKED");
		expect(receipt.verificationDigest?.patchHash).toBeTruthy();
		expect(receipt.disclaimer).toContain("BATCH1_NO_DOCKER_RUNNER");
	});

	it("blocks sk-/ghp- shaped tokens even without key= assignment syntax", async () => {
		const diff = [
			"--- a/packages/adaptorch-wpl/src/t.ts",
			"+++ b/packages/adaptorch-wpl/src/t.ts",
			"@@ -1 +1 @@",
			'+const token = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz012345";',
		].join("\n");
		const wall = runFastWall({ diffText: diff, approvedWriteScope: ["packages/adaptorch-wpl/**"] });
		expect(wall.flags).toContain(POLICY_FLAG.SECRET_SUSPECT);
		const { verdictCard } = await evaluateCorrectnessWall({
			kind: "code-edit",
			approvedWriteScope: ["packages/adaptorch-wpl/**"],
			diffText: diff,
			previewOnly: true,
		});
		expect(verdictCard.verdict).toBe("BLOCKED");
	});
});
