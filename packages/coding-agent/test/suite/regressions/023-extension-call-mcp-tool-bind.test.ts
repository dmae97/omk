/**
 * Wave 4 Part 2 — harness binds callMcpTool onto ExtensionAPI via shared runtime.
 *
 * Load-time factories may capture omk.callMcpTool (always a function on the API).
 * The handler is filled at bindCore; until then invocations throw a clear error.
 * Live OA use remains gated by OMK_WALL_OA_TRANSPORT=mcp (operator opt-in).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	autoWireLiveAdaptOrch,
	resolveOaClientForEvaluation,
	setWallAdaptOrchCallTool,
} from "../../../examples/extensions/correctness-wall/adjudication-fixture.ts";
import { AuthStorage } from "../../../src/core/auth-storage.ts";
import { createEventBus } from "../../../src/core/event-bus.ts";
import { createExtensionRuntime, loadExtensionFromFactory } from "../../../src/core/extensions/loader.ts";
import { ExtensionRunner } from "../../../src/core/extensions/runner.ts";
import type { ExtensionActions, ExtensionAPI, ExtensionContextActions } from "../../../src/core/extensions/types.ts";
import { ModelRegistry } from "../../../src/core/model-registry.ts";
import { SessionManager } from "../../../src/core/session-manager.ts";

const extensionActionsBase: ExtensionActions = {
	sendMessage: () => {},
	sendUserMessage: () => {},
	appendEntry: () => {},
	setSessionName: () => {},
	getSessionName: () => undefined,
	setLabel: () => {},
	getActiveTools: () => [],
	getAllTools: () => [],
	setActiveTools: () => {},
	refreshTools: () => {},
	getCommands: () => [],
	setModel: async () => false,
	getThinkingLevel: () => "off",
	setThinkingLevel: () => {},
};

const extensionContextActions: ExtensionContextActions = {
	getModel: () => undefined,
	isIdle: () => true,
	getSignal: () => undefined,
	abort: () => {},
	hasPendingMessages: () => false,
	shutdown: () => {},
	getContextUsage: () => undefined,
	compact: () => {},
	getSystemPrompt: () => "",
};

describe("023 extension callMcpTool bind (W4 Part 2 harness)", () => {
	let tempDir: string;

	afterEach(() => {
		setWallAdaptOrchCallTool(undefined);
		if (tempDir && fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("exposes callMcpTool on ExtensionAPI at load time (capture-safe)", async () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "omk-023-"));
		let captured: ExtensionAPI | undefined;
		const runtime = createExtensionRuntime();
		const eventBus = createEventBus();
		await loadExtensionFromFactory(
			(omk) => {
				captured = omk;
			},
			tempDir,
			eventBus,
			runtime,
			"<023-load>",
		);
		expect(captured).toBeDefined();
		expect(typeof captured!.callMcpTool).toBe("function");
	});

	it("throws until bindCore provides a handler", async () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "omk-023-"));
		let api: ExtensionAPI | undefined;
		const runtime = createExtensionRuntime();
		const eventBus = createEventBus();
		await loadExtensionFromFactory(
			(omk) => {
				api = omk;
			},
			tempDir,
			eventBus,
			runtime,
			"<023-unbound>",
		);
		await expect(api!.callMcpTool!("adaptorch", "adaptorch_get_run", { run_id: "r1" })).rejects.toThrow(/not bound/i);
	});

	it("delegates to the bindCore callMcpTool handler after bind", async () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "omk-023-"));
		let api: ExtensionAPI | undefined;
		const runtime = createExtensionRuntime();
		const eventBus = createEventBus();
		const extension = await loadExtensionFromFactory(
			(omk) => {
				api = omk;
			},
			tempDir,
			eventBus,
			runtime,
			"<023-bound>",
		);

		const authStorage = AuthStorage.create(path.join(tempDir, "auth.json"));
		const modelRegistry = ModelRegistry.create(authStorage);
		const sessionManager = SessionManager.inMemory();
		const runner = new ExtensionRunner([extension], runtime, tempDir, sessionManager, modelRegistry);

		const calls: Array<{ server: string; name: string; args: Record<string, unknown> }> = [];
		runner.bindCore(
			{
				...extensionActionsBase,
				callMcpTool: async (server, name, args) => {
					calls.push({ server, name, args });
					return { ok: true, server, name, args };
				},
			},
			extensionContextActions,
		);

		const result = await api!.callMcpTool!("adaptorch", "adaptorch_get_run", { run_id: "run-023" });
		expect(calls).toEqual([{ server: "adaptorch", name: "adaptorch_get_run", args: { run_id: "run-023" } }]);
		expect(result).toEqual({
			ok: true,
			server: "adaptorch",
			name: "adaptorch_get_run",
			args: { run_id: "run-023" },
		});
	});

	it("autoWireLiveAdaptOrch uses bound callMcpTool when transport=mcp", async () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "omk-023-"));
		let api: ExtensionAPI | undefined;
		const runtime = createExtensionRuntime();
		const eventBus = createEventBus();
		const extension = await loadExtensionFromFactory(
			(omk) => {
				api = omk;
				// Same path as correctness-wall extension entry.
				autoWireLiveAdaptOrch(omk);
			},
			tempDir,
			eventBus,
			runtime,
			"<023-wall>",
		);

		const authStorage = AuthStorage.create(path.join(tempDir, "auth.json"));
		const modelRegistry = ModelRegistry.create(authStorage);
		const sessionManager = SessionManager.inMemory();
		const runner = new ExtensionRunner([extension], runtime, tempDir, sessionManager, modelRegistry);
		runner.bindCore(
			{
				...extensionActionsBase,
				callMcpTool: async (_server, name, args) => {
					const runId = (args as { run_id: string }).run_id;
					if (name === "adaptorch_get_run") return { run_id: runId, status: "completed" };
					if (name === "adaptorch_get_artifacts") return [];
					if (name === "adaptorch_get_traces") return [];
					throw new Error(name);
				},
			},
			extensionContextActions,
		);

		const saved = process.env.OMK_WALL_OA_TRANSPORT;
		try {
			process.env.OMK_WALL_OA_TRANSPORT = "mcp";
			const { client } = await resolveOaClientForEvaluation({
				previewOnly: false,
				runIds: ["run-023-live"],
			});
			expect(client).toBeDefined();
			const run = await client!.getRun("run-023-live");
			expect(run).toEqual({ run_id: "run-023-live", status: "completed" });
		} finally {
			if (saved === undefined) delete process.env.OMK_WALL_OA_TRANSPORT;
			else process.env.OMK_WALL_OA_TRANSPORT = saved;
		}

		// Capture still works after bind (same API object).
		expect(typeof api!.callMcpTool).toBe("function");
	});
});
