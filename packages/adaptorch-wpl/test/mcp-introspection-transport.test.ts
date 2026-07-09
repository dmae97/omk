import { describe, expect, it } from "vitest";
import { evaluateCorrectnessWall } from "../src/evaluate-correctness-wall.ts";
import { createMcpIntrospectionClient } from "../src/mcp-introspection-transport.ts";

describe("createMcpIntrospectionClient", () => {
	it("fixture mode adjudicates like in-memory client", async () => {
		const client = createMcpIntrospectionClient({
			mode: "fixture",
			fixture: {
				"run-mcp-1": {
					run: { run_id: "run-mcp-1", status: "completed" },
					artifacts: [{ path: "out.md", size_bytes: 10 }],
					traces: [{ kind: "write", level: "info" }],
				},
			},
		});
		const diff = [
			"--- a/packages/adaptorch-wpl/src/foo.ts",
			"+++ b/packages/adaptorch-wpl/src/foo.ts",
			"@@ -1 +1 @@",
			"+// ok",
		].join("\n");
		const { verdictCard, receipt } = await evaluateCorrectnessWall({
			kind: "code-edit",
			diffText: diff,
			approvedWriteScope: ["packages/adaptorch-wpl/**"],
			previewOnly: false,
			runIds: ["run-mcp-1"],
			client,
		});
		expect(verdictCard.verdict).toBe("PASS");
		expect(receipt.adjudicationVerdict).toBe("CONFIRMED");
	});

	it("unavailable mode maps transport failure to INCONCLUSIVE OA verdict", async () => {
		const client = createMcpIntrospectionClient({ mode: "unavailable" });
		const { verdictCard, receipt } = await evaluateCorrectnessWall({
			kind: "code-edit",
			diffText: "--- a/x\n+++ b/x\n@@\n+x",
			previewOnly: false,
			runIds: ["run-x"],
			client,
		});
		expect(verdictCard.verdict).toBe("INCONCLUSIVE");
		expect(receipt.adjudicationVerdict).toBe("VERIFIER-ERROR");
		expect(receipt.adjudicationReasonCode).toBe("RUN_FETCH_FAILED");
	});
});
