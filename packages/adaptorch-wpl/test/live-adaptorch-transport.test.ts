import { describe, expect, it } from "vitest";
import { evaluateCorrectnessWall } from "../src/evaluate-correctness-wall.ts";
import { createLiveAdaptOrchClient } from "../src/live-adaptorch-transport.ts";

describe("createLiveAdaptOrchClient", () => {
	it("adjudicates CONFIRMED when callTool returns terminal run payloads", async () => {
		const client = createLiveAdaptOrchClient(async (name, args) => {
			const runId = args.run_id as string;
			if (name === "adaptorch_get_run") return { run_id: runId, status: "completed" };
			if (name === "adaptorch_get_artifacts") return [{ path: "out.md", size_bytes: 1 }];
			if (name === "adaptorch_get_traces") return [{ kind: "w", level: "info" }];
			throw new Error(`unexpected ${name}`);
		});
		const diff = [
			"--- a/packages/adaptorch-wpl/src/live.ts",
			"+++ b/packages/adaptorch-wpl/src/live.ts",
			"@@ -1 +1 @@",
			"+// live",
		].join("\n");
		const { verdictCard, receipt } = await evaluateCorrectnessWall({
			kind: "code-edit",
			diffText: diff,
			approvedWriteScope: ["packages/adaptorch-wpl/**"],
			previewOnly: false,
			runIds: ["run-live-1"],
			client,
		});
		expect(verdictCard.verdict).toBe("PASS");
		expect(receipt.adjudicationVerdict).toBe("CONFIRMED");
	});

	it("maps transport failure to INCONCLUSIVE / VERIFIER-ERROR", async () => {
		const client = createLiveAdaptOrchClient(async () => {
			throw new Error("MCP connection refused");
		});
		const { verdictCard, receipt } = await evaluateCorrectnessWall({
			kind: "code-edit",
			diffText: "--- a/x\n+++ b/x\n@@\n+x",
			previewOnly: false,
			runIds: ["run-fail"],
			client,
		});
		expect(verdictCard.verdict).toBe("INCONCLUSIVE");
		expect(receipt.adjudicationVerdict).toBe("VERIFIER-ERROR");
	});
});
