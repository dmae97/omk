import { setImmediate } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import { McpClient, type McpToolSchema } from "../../src/core/mcp/client.ts";
import { McpManager } from "../../src/core/mcp/manager.ts";
import { phase3Gate } from "../fixtures/phase3-gate.ts";

// No native transport is started here. Close requests and observations are independent gates.
class ControlledClient extends McpClient {
	readonly connection = phase3Gate<void>();
	readonly catalog = phase3Gate<McpToolSchema[]>();
	readonly physicalClose = phase3Gate<void>();
	closeRequests = 0;

	override connect(): Promise<void> {
		return this.connection.promise;
	}
	override listTools(): Promise<McpToolSchema[]> {
		return this.catalog.promise;
	}
	override close(): void {
		this.closeRequests++;
	}
	override waitForTransportClose(): Promise<void> {
		return this.physicalClose.promise;
	}

	admit(name = "echo"): void {
		this.connection.resolve();
		this.catalog.resolve([{ name, description: "Echo input", inputSchema: { type: "object" } }]);
	}
}

function fixture(names = ["alpha"]) {
	const clients: ControlledClient[] = [];
	const manager = new McpManager({
		servers: names.map((name) => ({ name, command: "unused" })),
		connectionConcurrency: 1,
		createClient: (options) => {
			const client = new ControlledClient(options);
			clients.push(client);
			return client;
		},
	});
	return { manager, clients };
}

async function cleanup(manager: McpManager, clients: ControlledClient[]): Promise<void> {
	manager.close();
	for (const client of clients) {
		client.admit();
		client.physicalClose.resolve();
	}
	await manager.closeAndWait();
}

describe("MCP physical close proof", () => {
	it("keeps repeated closeAndWait calls pending until physical close is observed", async () => {
		const { manager, clients } = fixture();
		try {
			const ready = manager.connect("alpha");
			clients[0].admit();
			await ready;
			const completed = vi.fn();
			const first = manager.closeAndWait().then(completed);
			const second = manager.closeAndWait().then(completed);
			await setImmediate();
			expect(clients[0].closeRequests).toBe(1);
			expect(manager.status()[0]).toMatchObject({ state: "idle", toolCount: 0, retiring: true });
			expect(completed).not.toHaveBeenCalled();
			clients[0].physicalClose.resolve();
			await Promise.all([first, second]);
			expect(completed).toHaveBeenCalledTimes(2);
			expect(manager.status()[0].retiring).toBeUndefined();
		} finally {
			await cleanup(manager, clients);
		}
	});

	it("does not construct a replacement while an already-connected client is retiring", async () => {
		const { manager, clients } = fixture();
		try {
			const first = manager.connect("alpha");
			clients[0].admit();
			await first;
			manager.close();
			const next = manager.connect("alpha");
			await setImmediate();
			expect(clients).toHaveLength(1);
			expect(manager.status()[0].retiring).toBe(true);
			clients[0].physicalClose.resolve();
			await setImmediate();
			expect(clients).toHaveLength(2);
			clients[1].admit("new");
			expect((await next).state).toBe("ready");
			expect((await manager.listToolDefinitions()).map((t) => t.name)).toEqual(["alpha__new"]);
		} finally {
			await cleanup(manager, clients);
		}
	});

	it("holds failed-start capacity until physical close before starting another server", async () => {
		const { manager, clients } = fixture(["broken", "healthy"]);
		try {
			const listing = manager.listToolDefinitions();
			clients[0].connection.reject(new Error("handshake failed"));
			await setImmediate();
			expect(clients).toHaveLength(1);
			expect(clients[0].closeRequests).toBe(1);
			expect(manager.status()[1].state).toBe("queued");
			clients[0].physicalClose.resolve();
			await setImmediate();
			expect(clients).toHaveLength(2);
			clients[1].admit();
			expect((await listing).map((t) => t.name)).toEqual(["healthy__echo"]);
		} finally {
			await cleanup(manager, clients);
		}
	});

	it("does not resurrect a reconnect invalidated by a later close during catalog loading", async () => {
		const { manager, clients } = fixture();
		try {
			const first = manager.connect("alpha");
			clients[0].connection.resolve();
			await setImmediate();
			manager.close();
			const stale = manager.connect("alpha");
			manager.close();
			clients[0].catalog.resolve([{ name: "stale" }]);
			clients[0].physicalClose.resolve();
			await Promise.all([first, stale]);
			expect(clients).toHaveLength(1);
			expect(manager.status()[0]).toMatchObject({ state: "idle", toolCount: 0 });
		} finally {
			await cleanup(manager, clients);
		}
	});

	it.each(["reject", "throw", "missing"])("retains ownership when close proof is %s", async (failure) => {
		const { manager, clients } = fixture();
		const first = manager.connect("alpha");
		clients[0].admit();
		await first;
		if (failure === "throw") {
			vi.spyOn(clients[0], "waitForTransportClose").mockImplementation(() => {
				throw new Error("private-detail");
			});
		} else if (failure === "missing") {
			Object.defineProperty(clients[0], "waitForTransportClose", { value: undefined });
		}
		const joined = vi.fn();
		void manager.closeAndWait().then(joined);
		if (failure === "reject") clients[0].physicalClose.reject(new Error("private-detail"));
		const reconnected = vi.fn();
		void manager.connect("alpha").then(reconnected);
		await setImmediate();
		expect(joined).not.toHaveBeenCalled();
		expect(reconnected).not.toHaveBeenCalled();
		expect(clients).toHaveLength(1);
		expect(manager.status()[0]).toMatchObject({
			state: "idle",
			toolCount: 0,
			retiring: true,
			error: "mcp.transport_retirement_unconfirmed",
		});
		expect(JSON.stringify(manager.status())).not.toContain("private-detail");
		// Unknown proof intentionally remains unresolved; this double owns no process or timer.
	});
});
