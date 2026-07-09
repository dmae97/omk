/**
 * Lane T2 — B2C Correctness Wall regression (omk-adaptorch-wpl surface).
 * Imports match examples/extensions/correctness-wall (relative adaptorch-wpl path).
 */
import { describe, expect, it } from "vitest";
import {
	AdaptOrchClient,
	type AdaptOrchTransport,
	BATCH1_NO_DOCKER_RUNNER,
	evaluateCorrectnessWall,
	POLICY_FLAG,
	runFastWall,
} from "../../../../adaptorch-wpl/src/index.ts";

const FORBIDDEN_VERDICT_CARD_KEYS = ["lcb", "dag", "topology", "leakScore"] as const;

function makeFakeTransport(
	byRunId: Record<string, { run: unknown; artifacts: unknown; traces: unknown }>,
): AdaptOrchTransport {
	return {
		async callTool(name: string, args: Record<string, unknown>) {
			const runId = args.run_id as string;
			const fixture = byRunId[runId];
			if (!fixture) throw new Error(`no fixture for run_id ${runId}`);
			if (name === "adaptorch_get_run") return fixture.run;
			if (name === "adaptorch_get_artifacts") return fixture.artifacts;
			if (name === "adaptorch_get_traces") return fixture.traces;
			throw new Error(`unexpected tool call: ${name}`);
		},
	};
}

function inScopeDiff(relPath = "packages/adaptorch-wpl/src/foo.ts"): string {
	return [`--- a/${relPath}`, `+++ b/${relPath}`, "@@ -1 +1 @@", "+// ok"].join("\n");
}

describe("018-b2c-correctness-wall", () => {
	it("evaluateCorrectnessWall: secret-like diff line -> BLOCKED or blocked_reasons mention secret", async () => {
		const diff = [
			"--- a/packages/adaptorch-wpl/local-config",
			"+++ b/packages/adaptorch-wpl/local-config",
			"@@ -0,0 +1 @@",
			"+" + "API_KEY=not-a-real-secret",
		].join("\n");

		expect(runFastWall({ diffText: diff, approvedWriteScope: ["packages/adaptorch-wpl/**"] }).flags).toContain(
			POLICY_FLAG.SECRET_SUSPECT,
		);

		const { verdictCard } = await evaluateCorrectnessWall({
			kind: "code-edit",
			approvedWriteScope: ["packages/adaptorch-wpl/**"],
			diffText: diff,
			previewOnly: true,
		});

		const mentionsSecret =
			verdictCard.verdict === "BLOCKED" || verdictCard.blocked_reasons.some((r) => /secret|credential/i.test(r));
		expect(mentionsSecret).toBe(true);
	});

	it("verdictCard has no internal keys lcb, dag, topology, leakScore", async () => {
		const { verdictCard } = await evaluateCorrectnessWall({
			kind: "code-edit",
			approvedWriteScope: ["packages/adaptorch-wpl/**"],
			diffText: inScopeDiff(),
			previewOnly: true,
		});

		for (const key of FORBIDDEN_VERDICT_CARD_KEYS) {
			expect(verdictCard).not.toHaveProperty(key);
		}
		expect(Object.keys(verdictCard)).not.toEqual(expect.arrayContaining([...FORBIDDEN_VERDICT_CARD_KEYS]));
	});

	it("receipt.disclaimer is present when previewOnly is true", async () => {
		const { receipt } = await evaluateCorrectnessWall({
			kind: "code-edit",
			approvedWriteScope: ["packages/adaptorch-wpl/**"],
			diffText: inScopeDiff(),
			previewOnly: true,
		});

		expect(receipt.previewOnly).toBe(true);
		expect(receipt.disclaimer).toBeDefined();
		expect(receipt.disclaimer).toContain(BATCH1_NO_DOCKER_RUNNER);
	});

	it("next_actions includes Apply or Regenerate per verdict rules", async () => {
		const secretDiff = [
			"--- a/packages/adaptorch-wpl/x.ts",
			"+++ b/packages/adaptorch-wpl/x.ts",
			"@@ -0,0 +1 @@",
			"+" + "password=leak",
		].join("\n");

		const blocked = await evaluateCorrectnessWall({
			kind: "code-edit",
			approvedWriteScope: ["packages/adaptorch-wpl/**"],
			diffText: secretDiff,
			previewOnly: true,
		});
		expect(blocked.verdictCard.verdict).toBe("BLOCKED");
		expect(blocked.verdictCard.next_actions).toContain("Regenerate");
		expect(blocked.verdictCard.next_actions).not.toContain("Apply");

		const passish = await evaluateCorrectnessWall({
			kind: "code-edit",
			approvedWriteScope: ["packages/adaptorch-wpl/**"],
			diffText: inScopeDiff(),
			previewOnly: true,
		});
		expect(["PASS", "ADVISORY"]).toContain(passish.verdictCard.verdict);
		expect(passish.verdictCard.next_actions.some((a) => a === "Apply" || a === "Deep Check")).toBe(true);
	});

	it("OA path with AdaptOrchClient yields PASS and records runIds when evidence confirms", async () => {
		const runIds = ["run-b2c-018"];
		const client = new AdaptOrchClient(
			makeFakeTransport({
				"run-b2c-018": {
					run: { run_id: "run-b2c-018", status: "completed" },
					artifacts: [{ path: "out.md", size_bytes: 64 }],
					traces: [{ kind: "write", level: "info" }],
				},
			}),
		);

		const { verdictCard, receipt } = await evaluateCorrectnessWall({
			kind: "code-edit",
			approvedWriteScope: ["packages/adaptorch-wpl/**"],
			diffText: inScopeDiff(),
			previewOnly: false,
			runIds,
			client,
		});

		expect(verdictCard.verdict).toBe("PASS");
		expect(receipt.runIds).toEqual(runIds);
		expect(receipt.adjudicationVerdict).toBe("CONFIRMED");
	});
});
