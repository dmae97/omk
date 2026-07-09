/**
 * Wave 4 — OA transport mode: live callTool injection vs fixture default.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createLiveAdaptOrchClient, evaluateCorrectnessWall } from "../../../../adaptorch-wpl/src/index.ts";
import {
	resolveOaClientForEvaluation,
	setWallAdaptOrchCallTool,
} from "../../../examples/extensions/correctness-wall/adjudication-fixture.ts";

const ENV_KEYS = ["OMK_WALL_OA_TRANSPORT", "OMK_WALL_OA_FIXTURE_PATH"] as const;

function saveEnv(): Record<string, string | undefined> {
	const saved: Record<string, string | undefined> = {};
	for (const k of ENV_KEYS) saved[k] = process.env[k];
	return saved;
}

function restoreEnv(saved: Record<string, string | undefined>): void {
	for (const k of ENV_KEYS) {
		if (saved[k] === undefined) delete process.env[k];
		else process.env[k] = saved[k];
	}
}

describe("resolveOaClientForEvaluation transport", () => {
	afterEach(() => {
		setWallAdaptOrchCallTool(undefined);
	});

	it("uses live client when OMK_WALL_OA_TRANSPORT=mcp and callTool is set", async () => {
		const saved = saveEnv();
		try {
			process.env.OMK_WALL_OA_TRANSPORT = "mcp";
			setWallAdaptOrchCallTool(async (name, args) => {
				const runId = args.run_id as string;
				if (name === "adaptorch_get_run") return { run_id: runId, status: "completed" };
				if (name === "adaptorch_get_artifacts") return [{ path: "a.md", size_bytes: 1 }];
				if (name === "adaptorch_get_traces") return [{ kind: "w", level: "info" }];
				throw new Error(name);
			});
			const { client } = await resolveOaClientForEvaluation({
				previewOnly: false,
				runIds: ["run-021"],
			});
			expect(client).toBeDefined();
			const diff = [
				"--- a/packages/adaptorch-wpl/src/t.ts",
				"+++ b/packages/adaptorch-wpl/src/t.ts",
				"@@ -1 +1 @@",
				"+//",
			].join("\n");
			const { verdictCard } = await evaluateCorrectnessWall({
				kind: "code-edit",
				diffText: diff,
				approvedWriteScope: ["packages/adaptorch-wpl/**"],
				previewOnly: false,
				runIds: ["run-021"],
				client,
			});
			expect(verdictCard.verdict).toBe("PASS");
		} finally {
			restoreEnv(saved);
		}
	});

	it("createLiveAdaptOrchClient matches extension wiring", () => {
		const client = createLiveAdaptOrchClient(async () => ({ run_id: "x", status: "completed" }));
		expect(client).toBeDefined();
	});
});
