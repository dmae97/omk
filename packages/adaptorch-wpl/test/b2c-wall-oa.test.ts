import { describe, expect, it } from "vitest";
import { AdaptOrchClient, type AdaptOrchTransport } from "../src/adaptorch-client.ts";
import { evaluateCorrectnessWall } from "../src/evaluate-correctness-wall.ts";
import { POLICY_FLAG } from "../src/policy-wall.ts";

/** A scriptable fake transport: maps `adaptorch_get_run`/`_get_artifacts`/`_get_traces` calls by run_id. */
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

const inScopeDiff = [
	"--- a/packages/adaptorch-wpl/src/foo.ts",
	"+++ b/packages/adaptorch-wpl/src/foo.ts",
	"@@ -1 +1 @@",
	"+// comment",
].join("\n");

describe("evaluateCorrectnessWall — OA integration", () => {
	it("invokes OA with runIds and previewOnly false; CONFIRMED yields PASS and strips EVIDENCE_DAG_INCOMPLETE", async () => {
		const client = new AdaptOrchClient(
			makeFakeTransport({
				"run-oa-1": {
					run: { run_id: "run-oa-1", status: "completed" },
					artifacts: [{ path: "out.md", size_bytes: 42 }],
					traces: [{ kind: "write", level: "info" }],
				},
			}),
		);

		const { verdictCard, receipt } = await evaluateCorrectnessWall({
			kind: "code-edit",
			runIds: ["run-oa-1"],
			dispatchRecordId: "disp-oa-1",
			approvedWriteScope: ["packages/adaptorch-wpl/**"],
			diffText: inScopeDiff,
			previewOnly: false,
			client,
		});

		expect(["PASS", "ADVISORY"]).toContain(verdictCard.verdict);
		expect(receipt.adjudicationVerdict).toBe("CONFIRMED");
		expect(receipt.policyFlags).not.toContain(POLICY_FLAG.EVIDENCE_DAG_INCOMPLETE);
		expect(receipt.previewOnly).toBe(false);
		expect(receipt.runIds).toEqual(["run-oa-1"]);
	});

	it("without OA, non-preview run leaves EVIDENCE_DAG_INCOMPLETE on the receipt", async () => {
		const { receipt } = await evaluateCorrectnessWall({
			kind: "code-edit",
			runIds: ["run-missing-client"],
			approvedWriteScope: ["packages/adaptorch-wpl/**"],
			diffText: inScopeDiff,
			previewOnly: false,
		});

		expect(receipt.policyFlags).toContain(POLICY_FLAG.EVIDENCE_DAG_INCOMPLETE);
		expect(receipt.adjudicationVerdict).toBeUndefined();
	});
});
