import { describe, expect, it, vi } from "vitest";
import type { McpClient, McpClientOptions } from "../../src/core/mcp/client.ts";
import { McpManager } from "../../src/core/mcp/manager.ts";

/**
 * Health-check behavior is exercised with injected clients so no processes
 * are spawned; the real protocol ping is covered in client.test.ts against
 * fake-server.mjs.
 */

type FakeBehavior = { pingError?: Error; connectError?: Error; serverVersion?: string };

function fakeClient(behavior: FakeBehavior): McpClient {
	return {
		connect: async () => {
			if (behavior.connectError) throw behavior.connectError;
		},
		listTools: async () => [{ name: "echo" }],
		callTool: async () => ({ content: [], isError: false }),
		ping: async () => {
			if (behavior.pingError) throw behavior.pingError;
		},
		close: () => {},
		serverInfo: { name: "fake", version: behavior.serverVersion ?? "1.0.0" },
	} as unknown as McpClient;
}

function makeManager(
	behaviors: Record<string, FakeBehavior>,
	extraServers: readonly { name: string; disabled?: boolean }[] = [],
) {
	const created: string[] = [];
	const manager = new McpManager({
		servers: [
			...Object.keys(behaviors).map((name) => ({ name, command: "fake" })),
			...extraServers.map((s) => ({ name: s.name, command: "fake", disabled: s.disabled })),
		],
		createClient: (options: McpClientOptions) => {
			created.push(options.name);
			return fakeClient(behaviors[options.name] ?? {});
		},
	});
	return { manager, created };
}

describe("McpManager.checkHealth", () => {
	it("does not publish untrusted version suffixes or free-form server metadata", async () => {
		const { manager } = makeManager({ alpha: { serverVersion: "v1.2.3+fixture-secret" } });
		try {
			expect((await manager.connect("alpha")).serverVersion).toBe("1.2.3");
			expect(manager.status()[0].serverVersion).toBe("1.2.3");
		} finally {
			manager.close();
		}
		const malformed = makeManager({ alpha: { serverVersion: "fixture-secret" } }).manager;
		try {
			expect((await malformed.connect("alpha")).serverVersion).toBeUndefined();
		} finally {
			malformed.close();
		}
	});

	it("keeps status usable when a custom client's serverInfo getter throws", async () => {
		const manager = new McpManager({
			servers: [{ name: "alpha", command: "fake" }],
			createClient: () =>
				({
					...fakeClient({}),
					get serverInfo() {
						throw new Error("fixture-secret");
					},
				}) as unknown as McpClient,
		});
		try {
			await expect(manager.connect("alpha")).resolves.toMatchObject({ state: "ready", serverVersion: undefined });
			expect(manager.status()[0].serverVersion).toBeUndefined();
		} finally {
			manager.close();
		}
	});
	it("does not publish a server-supplied secret in connect or health errors", async () => {
		const connect = makeManager({ broken: { connectError: new Error("fixture-secret") } }).manager;
		await connect.connect("broken");
		expect(connect.status()[0].error).not.toContain("fixture-secret");
		const health = makeManager({ broken: { pingError: new Error("fixture-secret") } }).manager;
		await health.connect("broken");
		expect((await health.checkHealth())[0].error).not.toContain("fixture-secret");
	});
	it("keeps a ready server ready when the ping succeeds", async () => {
		const { manager } = makeManager({ alpha: {} });
		await manager.connect("alpha");
		const status = await manager.checkHealth();
		expect(status).toEqual([expect.objectContaining({ name: "alpha", state: "ready", toolCount: 1 })]);
	});

	it("marks a silently dead server failed and isolates the rest", async () => {
		const { manager } = makeManager({ alpha: { pingError: new Error("process exited") }, beta: {} });
		await manager.connect("alpha");
		await manager.connect("beta");
		const status = await manager.checkHealth();
		const alpha = status.find((s) => s.name === "alpha");
		const beta = status.find((s) => s.name === "beta");
		expect(alpha?.state).toBe("failed");
		expect(alpha?.error).toBe("mcp.health_failed (Error)");
		expect(alpha?.toolCount).toBe(0);
		expect(beta?.state).toBe("ready");
	});

	it("does not spawn anything for idle servers (lazy-connect stays lazy)", async () => {
		const { manager, created } = makeManager({ alpha: {} });
		const status = await manager.checkHealth();
		expect(status[0].state).toBe("idle");
		expect(created).toEqual([]);
	});

	it("leaves failed servers alone unless reconnectFailed is set", async () => {
		const { manager, created } = makeManager({ alpha: { connectError: new Error("spawn blew up") } });
		await manager.connect("alpha");
		expect(created).toEqual(["alpha"]);
		const status = await manager.checkHealth();
		expect(status[0].state).toBe("failed");
		expect(status[0].error).toBe("mcp.connect_failed (Error)");
		expect(created).toEqual(["alpha"]); // no re-attempt
	});

	it("re-attempts failed servers when reconnectFailed is set", async () => {
		let failFirst = true;
		const created: string[] = [];
		const manager = new McpManager({
			servers: [{ name: "alpha", command: "fake" }],
			createClient: (options: McpClientOptions) => {
				created.push(options.name);
				const behavior: FakeBehavior = failFirst ? { connectError: new Error("boom") } : {};
				return fakeClient(behavior);
			},
		});
		await manager.connect("alpha");
		expect(manager.status()[0].state).toBe("failed");
		failFirst = false;
		const status = await manager.checkHealth({ reconnectFailed: true });
		expect(status[0].state).toBe("ready");
		expect(created).toEqual(["alpha", "alpha"]);
	});

	it("never reconnects a configuration-disabled server", async () => {
		const { manager, created } = makeManager({}, [{ name: "off-server", disabled: true }]);
		await manager.listToolDefinitions(); // marks disabled as failed
		expect(manager.status()[0]).toMatchObject({ name: "off-server", state: "failed" });
		const status = await manager.checkHealth({ reconnectFailed: true });
		expect(status[0]).toMatchObject({ name: "off-server", state: "failed", error: "disabled by configuration" });
		expect(created).toEqual([]);
	});

	it("recovers a ping-killed server on the next reconnect cycle", async () => {
		const { manager } = makeManager({ alpha: {} });
		await manager.connect("alpha");
		// Kill it silently: make the ping throw without the transport noticing.
		const runtime = manager as unknown as {
			runtimes: Map<string, { client?: { ping: () => Promise<void> } }>;
		};
		const clientRef = runtime.runtimes.get("alpha")?.client;
		if (clientRef)
			clientRef.ping = vi.fn(async () => {
				throw new Error("write EPIPE");
			});
		const afterKill = await manager.checkHealth();
		expect(afterKill[0].state).toBe("failed");
		const afterRetry = await manager.checkHealth({ reconnectFailed: true });
		expect(afterRetry[0].state).toBe("ready");
	});
});
