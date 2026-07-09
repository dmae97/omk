/**
 * Wave 2 — hook OA path uses same evaluate + fixture client as tool (algorithm v2 step 3).
 */
import { describe, expect, it } from "vitest";
import {
	AdaptOrchClient,
	type AdaptOrchTransport,
	evaluateCorrectnessWall,
} from "../../../../adaptorch-wpl/src/index.ts";

function makeTransport(): AdaptOrchTransport {
	return {
		async callTool(name: string, args: Record<string, unknown>) {
			const runId = args.run_id as string;
			if (name === "adaptorch_get_run") return { run_id: runId, status: "completed" };
			if (name === "adaptorch_get_artifacts") return [{ path: "a.md", size_bytes: 5 }];
			if (name === "adaptorch_get_traces") return [{ kind: "w", level: "info" }];
			throw new Error(name);
		},
	};
}

describe("hook-equivalent OA evaluation", () => {
	it("previewOnly false with fixture client matches CONFIRMED PASS", async () => {
		const client = new AdaptOrchClient(makeTransport());
		const diff = [
			"--- a/packages/adaptorch-wpl/src/hook.ts",
			"+++ b/packages/adaptorch-wpl/src/hook.ts",
			"@@ -1 +1 @@",
			"+// hook",
		].join("\n");
		const { verdictCard, receipt } = await evaluateCorrectnessWall({
			kind: "omk.patch.edit",
			diffText: diff,
			approvedWriteScope: ["packages/adaptorch-wpl/**"],
			previewOnly: false,
			runIds: ["run-hook-020"],
			client,
		});
		expect(verdictCard.verdict).toBe("PASS");
		expect(receipt.adjudicationVerdict).toBe("CONFIRMED");
		expect(receipt.policyFlags).not.toContain("EVIDENCE_DAG_INCOMPLETE");
	});
});
