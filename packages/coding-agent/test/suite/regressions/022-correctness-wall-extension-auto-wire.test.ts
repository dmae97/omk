/**
 * Wave 4 — Extension auto-wiring: when the host exposes `callMcpTool`,
 * the correctness-wall extension injects a live AdaptOrch transport automatically.
 *
 * "extension 연결 자동화": the extension entry calls autoWireLiveAdaptOrch(omk).
 * Capability is provided automatically; live-transport USE is still gated by
 * OMK_WALL_OA_TRANSPORT=mcp (explicit operator opt-in).
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { evaluateCorrectnessWall } from "../../../../adaptorch-wpl/src/index.ts";
import {
	ADAPTORCH_MCP_SERVER,
	autoWireLiveAdaptOrch,
	buildLiveCallToolFromCapability,
	resolveOaClientForEvaluation,
	setWallAdaptOrchCallTool,
} from "../../../examples/extensions/correctness-wall/adjudication-fixture.ts";
import correctnessWall from "../../../examples/extensions/correctness-wall/index.ts";
import type { ExtensionAPI, ExtensionContext } from "../../../src/core/extensions/types.ts";

type RecordedHandler = (event: unknown, ctx: unknown) => Promise<unknown> | unknown;

function saveEnv(): Record<string, string | undefined> {
	return {
		OMK_PATCH_SAFETY_WALL_MODE: process.env.OMK_PATCH_SAFETY_WALL_MODE,
		OMK_WALL_OA_FIXTURE_PATH: process.env.OMK_WALL_OA_FIXTURE_PATH,
		OMK_WALL_OA_TRANSPORT: process.env.OMK_WALL_OA_TRANSPORT,
		OMK_WALL_RUN_IDS: process.env.OMK_WALL_RUN_IDS,
		OMK_WALL_SCOPE: process.env.OMK_WALL_SCOPE,
	};
}
function restoreEnv(saved: Record<string, string | undefined>): void {
	for (const [key, value] of Object.entries(saved)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
}

function createHookApi(
	callMcpTool?: NonNullable<ExtensionAPI["callMcpTool"]>,
	mcpBound: boolean = callMcpTool !== undefined,
): {
	omk: ExtensionAPI;
	handlers: Map<string, RecordedHandler[]>;
} {
	const handlers = new Map<string, RecordedHandler[]>();
	const omk = {
		...(callMcpTool === undefined ? {} : { callMcpTool }),
		isMcpToolBound(): boolean {
			return mcpBound;
		},
		on(event: string, handler: RecordedHandler): void {
			const existing = handlers.get(event) ?? [];
			existing.push(handler);
			handlers.set(event, existing);
		},
		registerTool(): void {},
	} as unknown as ExtensionAPI;
	return { omk, handlers };
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

	it("falls back to preview when the live MCP facade is unbound", async () => {
		const saved = saveEnv();
		const cwd = mkdtempSync(join(tmpdir(), "omk-wall-022-"));
		try {
			delete process.env.OMK_WALL_OA_FIXTURE_PATH;
			process.env.OMK_PATCH_SAFETY_WALL_MODE = "shadow";
			process.env.OMK_WALL_OA_TRANSPORT = "mcp";
			process.env.OMK_WALL_RUN_IDS = "run-022-no-host";
			process.env.OMK_WALL_SCOPE = "packages/adaptorch-wpl/**";
			const { omk, handlers } = createHookApi(async () => {
				throw new Error(
					"Extension callMcpTool is not bound. The session must provide a callMcpTool handler via bindCore.",
				);
			}, false);
			correctnessWall(omk);
			const handler = handlers.get("tool_call")?.[0];
			expect(handler).toBeDefined();
			await expect(
				handler!(
					{
						type: "tool_call",
						toolCallId: "tc-022-no-host",
						toolName: "write",
						input: { path: "packages/adaptorch-wpl/src/example.ts", content: "export {};" },
					},
					{ cwd, hasUI: false } as ExtensionContext,
				),
			).resolves.toBeUndefined();
			const telemetry = JSON.parse(
				readFileSync(join(cwd, ".omk", "wall-cache", "shadow-telemetry.ndjson"), "utf8").trim(),
			) as { previewOnly: boolean; usedOaFixture: boolean };
			expect(telemetry).toMatchObject({ previewOnly: true, usedOaFixture: false });
		} finally {
			restoreEnv(saved);
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("uses live read-only OA adjudication for the edit/write hook without a fixture", async () => {
		const saved = saveEnv();
		const cwd = mkdtempSync(join(tmpdir(), "omk-wall-022-"));
		const calls: string[] = [];
		try {
			delete process.env.OMK_WALL_OA_FIXTURE_PATH;
			process.env.OMK_WALL_OA_TRANSPORT = "mcp";
			process.env.OMK_WALL_RUN_IDS = "run-022-hook";
			process.env.OMK_WALL_SCOPE = "packages/adaptorch-wpl/**";
			const { omk, handlers } = createHookApi(async (_server, name, args) => {
				calls.push(name);
				const runId = (args as { run_id: string }).run_id;
				if (name === "adaptorch_get_run") return { run_id: runId, status: "completed" };
				if (name === "adaptorch_get_artifacts") return [{ path: "artifact.md", size_bytes: 1 }];
				if (name === "adaptorch_get_traces") return [{ kind: "span", level: "info" }];
				throw new Error(name);
			});
			correctnessWall(omk);
			const handler = handlers.get("tool_call")?.[0];
			expect(handler).toBeDefined();
			await expect(
				handler!(
					{
						type: "tool_call",
						toolCallId: "tc-022",
						toolName: "write",
						input: { path: "packages/adaptorch-wpl/src/example.ts", content: "export {};" },
					},
					{ cwd, hasUI: false } as ExtensionContext,
				),
			).resolves.toBeUndefined();
			expect(calls).toEqual(["adaptorch_get_run", "adaptorch_get_artifacts", "adaptorch_get_traces"]);
		} finally {
			restoreEnv(saved);
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
