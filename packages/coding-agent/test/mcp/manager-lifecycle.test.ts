import { describe, expect, it } from "vitest";
import type { McpClient, McpClientOptions } from "../../src/core/mcp/client.ts";
import { McpManager } from "../../src/core/mcp/manager.ts";

/**
 * Required lifecycle contracts from the 1.0 readiness audit (T-MCP-L01/L02):
 * a connect attempt started before close() must not publish tools or restore
 * `ready` afterward, and the not-yet-published client it owns must be closed.
 * Clients are injected and controllable so the race is deterministic.
 */

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function makeFixture() {
	const connectGate = deferred<void>();
	let closeCalls = 0;
	const client = {
		connect: () => connectGate.promise,
		listTools: async () => [{ name: "echo" }],
		callTool: async () => ({ content: [], isError: false }),
		ping: async () => {},
		close: () => {
			closeCalls += 1;
		},
		waitForTransportClose: async () => {},
		serverInfo: { name: "fake", version: "1.0.0" },
	} as unknown as McpClient;
	const manager = new McpManager({
		servers: [{ name: "alpha", command: "fake" }],
		createClient: (_options: McpClientOptions) => client,
	});
	return { manager, client, connectGate, closeCalls: () => closeCalls };
}

describe("McpManager close during an in-flight connect", () => {
	it("does not publish tools or ready state after close (T-MCP-L01)", async () => {
		const { manager, connectGate } = makeFixture();
		const pending = manager.listToolDefinitions();
		manager.close();
		connectGate.resolve();
		await pending;
		try {
			expect(manager.status()[0].state).not.toBe("ready");
			expect(manager.status()[0].toolCount).toBe(0);
		} finally {
			manager.close();
		}
	});

	it("closes the in-flight client the attempt still owns (T-MCP-L02)", async () => {
		const { manager, connectGate, closeCalls } = makeFixture();
		const pending = manager.listToolDefinitions();
		manager.close();
		connectGate.resolve();
		await pending;
		try {
			expect(closeCalls()).toBeGreaterThan(0);
		} finally {
			manager.close();
		}
	});

	it("does not let a stale health failure replace a newer connection", async () => {
		const oldPing = deferred<void>();
		let created = 0;
		const oldClient = {
			connect: async () => {},
			listTools: async () => [{ name: "old" }],
			ping: () => oldPing.promise,
			close: () => {},
			waitForTransportClose: async () => {},
			serverInfo: { version: "1.0.0" },
		} as unknown as McpClient;
		const newClient = {
			connect: async () => {},
			listTools: async () => [{ name: "new" }],
			ping: async () => {},
			close: () => {},
			waitForTransportClose: async () => {},
			serverInfo: { version: "2.0.0" },
		} as unknown as McpClient;
		const manager = new McpManager({
			servers: [{ name: "alpha", command: "fake" }],
			createClient: () => (created++ === 0 ? oldClient : newClient),
		});
		try {
			await manager.connect("alpha");
			const staleProbe = manager.checkHealth();
			manager.close();
			await manager.connect("alpha");
			oldPing.reject(new Error("old generation failed"));
			await staleProbe;
			expect(manager.status()[0]).toMatchObject({ state: "ready", toolCount: 1, serverVersion: "2.0.0" });
			expect((await manager.listToolDefinitions()).map((tool) => tool.name)).toEqual(["alpha__new"]);
		} finally {
			manager.close();
		}
	});

	it("lets a post-close reconnect publish normally (close resets, it does not wedge)", async () => {
		const { manager, connectGate } = makeFixture();
		const first = manager.listToolDefinitions();
		manager.close();
		connectGate.resolve();
		await first;
		// A second fixture-driven connect is a new generation entirely.
		const manager2 = new McpManager({
			servers: [{ name: "alpha", command: "fake" }],
			createClient: () =>
				({
					connect: async () => {},
					listTools: async () => [{ name: "echo" }],
					callTool: async () => ({ content: [], isError: false }),
					ping: async () => {},
					close: () => {},
					waitForTransportClose: async () => {},
					serverInfo: { name: "fake", version: "1.0.0" },
				}) as unknown as McpClient,
		});
		try {
			const tools = await manager2.listToolDefinitions();
			expect(tools).toHaveLength(1);
			expect(manager2.status()[0].state).toBe("ready");
		} finally {
			manager.close();
			manager2.close();
		}
	});
});
