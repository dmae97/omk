/**
 * Wave 4 — Extension auto-wiring: when the host exposes `callMcpTool`,
 * the correctness-wall extension injects a live AdaptOrch transport automatically.
 *
 * "extension 연결 자동화": the extension entry calls autoWireLiveAdaptOrch(omk).
 * Capability is provided automatically; live-transport USE is still gated by
 * OMK_WALL_OA_TRANSPORT=mcp (explicit operator opt-in).
 */
import { afterEach, describe, expect, it } from "vitest";
import { evaluateCorrectnessWall } from "../../../../adaptorch-wpl/src/index.ts";
import {
	ADAPTORCH_MCP_SERVER,
	autoWireLiveAdaptOrch,
	buildLiveCallToolFromCapability,
	resolveOaClientForEvaluation,
	setWallAdaptOrchCallTool,
} from "../../../examples/extensions/correctness-wall/adjudication-fixture.ts";

function saveEnv(): Record<string, string | undefined> {
	return { OMK_WALL_OA_TRANSPORT: process.env.OMK_WALL_OA_TRANSPORT };
}
function restoreEnv(saved: Record<string, string | undefined>): void {
	if (saved.OMK_WALL_OA_TRANSPORT === undefined) delete process.env.OMK_WALL_OA_TRANSPORT;
	else process.env.OMK_WALL_OA_TRANSPORT = saved.OMK_WALL_OA_TRANSPORT;
}

describe("buildLiveCallToolFromCapability", () => {
	it("returns undefined when host has no callMcpTool capability", () => {
		expect(buildLiveCallToolFromCapability({})).toBeUndefined();
	});

	it("forwards (name, args) to callMcpTool with the adaptorch server name", async () => {
		const calls: Array<{ server: string; name: string; args: unknown }> = [];
		const fn = buildLiveCallToolFromCapability({
			callMcpTool: async (server, name, args) => {
				calls.push({ server, name, args });
				return { run_id: (args as { run_id: string }).run_id, status: "completed" };
			},
		});
		expect(fn).toBeDefined();
		const result = await fn!("adaptorch_get_run", { run_id: "run-xyz" });
		expect(calls).toEqual([{ server: ADAPTORCH_MCP_SERVER, name: "adaptorch_get_run", args: { run_id: "run-xyz" } }]);
		expect(result).toEqual({ run_id: "run-xyz", status: "completed" });
	});
});

describe("autoWireLiveAdaptOrch (extension entry wiring)", () => {
	afterEach(() => {
		setWallAdaptOrchCallTool(undefined);
	});

	it("injects live transport when host exposes callMcpTool + transport=mcp", async () => {
		const saved = saveEnv();
		try {
			process.env.OMK_WALL_OA_TRANSPORT = "mcp";
			autoWireLiveAdaptOrch({
				callMcpTool: async (_server, name, args) => {
					const runId = (args as { run_id: string }).run_id;
					if (name === "adaptorch_get_run") return { run_id: runId, status: "completed" };
					if (name === "adaptorch_get_artifacts") return [{ path: "a.md", size_bytes: 1 }];
					if (name === "adaptorch_get_traces") return [{ kind: "w", level: "info" }];
					throw new Error(name);
				},
			});
			const { client } = await resolveOaClientForEvaluation({
				previewOnly: false,
				runIds: ["run-022"],
			});
			expect(client).toBeDefined();
			const diff = [
				"--- a/packages/adaptorch-wpl/src/t.ts",
				"+++ b/packages/adaptorch-wpl/src/t.ts",
				"@@ -1 +1 @@",
				"+// auto-wired",
			].join("\n");
			const { verdictCard } = await evaluateCorrectnessWall({
				kind: "code-edit",
				diffText: diff,
				approvedWriteScope: ["packages/adaptorch-wpl/**"],
				previewOnly: false,
				runIds: ["run-022"],
				client,
			});
			expect(verdictCard.verdict).toBe("PASS");
		} finally {
			restoreEnv(saved);
		}
	});

	it("is a no-op when host has no callMcpTool capability (fixture fallback)", async () => {
		autoWireLiveAdaptOrch({});
		// Without OMK_WALL_OA_FIXTURE_PATH and no callTool, resolveOaClientForEvaluation returns no client.
		const { client } = await resolveOaClientForEvaluation({
			previewOnly: false,
			runIds: ["run-022b"],
		});
		expect(client).toBeUndefined();
	});

	it("does not enable live transport when env is fixture (capability present but gate off)", async () => {
		const saved = saveEnv();
		try {
			delete process.env.OMK_WALL_OA_TRANSPORT; // default = fixture
			autoWireLiveAdaptOrch({
				callMcpTool: async () => ({ run_id: "x", status: "completed" }),
			});
			const { client } = await resolveOaClientForEvaluation({
				previewOnly: false,
				runIds: ["run-022c"],
			});
			// No fixture path configured -> no client; live gate is off even though capability is present.
			expect(client).toBeUndefined();
		} finally {
			restoreEnv(saved);
		}
	});
});
