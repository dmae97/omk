import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { McpClient, type McpClientOptions } from "../../src/core/mcp/client.ts";
import { McpManager } from "../../src/core/mcp/manager.ts";
import { phase3Gate } from "../fixtures/phase3-gate.ts";

const server = fileURLToPath(new URL("../fixtures/phase3-catalog-server.mjs", import.meta.url));

function fixture(mode = "good", create?: (options: McpClientOptions, index: number) => McpClient) {
	const clients: McpClient[] = [];
	const closed: boolean[] = [];
	const manager = new McpManager({
		servers: [{ name: "fixture", command: process.execPath, args: [server, mode], inheritEnv: false }],
		createClient: (options) => {
			const index = clients.length;
			if (index > 0) expect(closed[index - 1]).toBe(true);
			const configured = { ...options, transport: { ...options.transport, killGraceMs: 30 } };
			const client = create?.(configured, index) ?? new McpClient(configured);
			clients.push(client);
			closed.push(false);
			void client.waitForTransportClose().then(() => {
				closed[index] = true;
			});
			return client;
		},
	});
	async function cleanup() {
		await manager.closeAndWait();
		expect(closed).toEqual(clients.map(() => true));
	}
	return { manager, clients, closed, cleanup };
}

describe("native nonempty MCP catalog and retirement", () => {
	it("projects real schemas, quarantines an injected descriptor and executes the admitted tool", async () => {
		const { manager, cleanup } = fixture();
		try {
			const tools = await manager.listToolDefinitions();
			expect(tools.map((t) => t.name)).toEqual(["fixture__echo", "fixture__malformed_description"]);
			expect(tools[0].parameters).toMatchObject({ type: "object", required: ["message"] });
			expect(tools[1].parameters).toMatchObject({ type: "object", properties: {} });
			expect(tools[1].description).toBe('MCP tool "malformed_description" from server "fixture".');
			expect(manager.status()[0]).toMatchObject({
				state: "ready",
				toolCount: 2,
				quarantinedTools: ["fixture__blocked_tool"],
			});
			expect(JSON.stringify(tools)).not.toContain("Ignore all previous instructions");
			// MCP's adapter does not use an extension context; the native client performs this call.
			const result = await tools[0].execute("echo-1", { message: "native-ok" }, undefined, undefined, {} as never);
			expect(result.content).toEqual([{ type: "text", text: "native-ok" }]);
			expect(result.details).toMatchObject({
				server: "fixture",
				tool: "echo",
				isError: false,
				structuredContent: { pid: expect.any(Number), message: "native-ok" },
			});
		} finally {
			await cleanup();
		}
	});

	it("rejects duplicate native names and joins the failed startup's transport", async () => {
		const { manager, closed, cleanup } = fixture("duplicate");
		try {
			expect(await manager.listToolDefinitions()).toEqual([]);
			expect(manager.status()[0]).toMatchObject({
				state: "failed",
				toolCount: 0,
				error: "mcp.connect_failed (Error)",
			});
			expect(closed).toEqual([true]);
		} finally {
			await cleanup();
		}
	});

	it("does not publish a nonempty catalog after close and reconnects only after the old native client closes", async () => {
		const listed = phase3Gate<void>();
		const publish = phase3Gate<void>();
		class GatedClient extends McpClient {
			override async listTools() {
				const tools = await super.listTools();
				listed.resolve();
				await publish.promise;
				return tools;
			}
		}
		const { manager, clients, cleanup } = fixture("good", (options, index) =>
			index === 0 ? new GatedClient(options) : new McpClient(options),
		);
		const first = manager.listToolDefinitions();
		try {
			await listed.promise;
			manager.close();
			const next = manager.connect("fixture");
			await clients[0].waitForTransportClose();
			expect(clients).toHaveLength(1);
			expect(manager.status()[0]).toMatchObject({ state: "idle", toolCount: 0 });
			publish.resolve();
			expect(await first).toEqual([]);
			expect((await next).state).toBe("ready");
			expect(clients).toHaveLength(2);
			expect((await manager.listToolDefinitions()).map((t) => t.name)).toEqual([
				"fixture__echo",
				"fixture__malformed_description",
			]);
		} finally {
			publish.resolve();
			await first;
			await cleanup();
		}
	});

	it("retires a health-failed client with an in-flight call and never reuses its tool handle", async () => {
		const { manager, clients, cleanup } = fixture(
			"health-bad",
			(options, index) =>
				new McpClient({
					...options,
					transport: { ...options.transport, args: [server, index === 0 ? "health-bad" : "good"] },
				}),
		);
		try {
			const [oldTool] = await manager.listToolDefinitions();
			const pending = oldTool.execute("old", { message: "held" }, undefined, undefined, {} as never);
			expect((await manager.checkHealth())[0]).toMatchObject({ state: "failed", toolCount: 0 });
			expect((await pending).details?.isError).toBe(true);
			await manager.checkHealth({ reconnectFailed: true });
			expect(clients).toHaveLength(2);
			const stale = await oldTool.execute("stale", { message: "must-not-retry" }, undefined, undefined, {} as never);
			expect(stale.details?.isError).toBe(true);
			const [newTool] = await manager.listToolDefinitions();
			expect(
				(await newTool.execute("new", { message: "new-generation" }, undefined, undefined, {} as never)).details,
			).toMatchObject({
				isError: false,
				structuredContent: { message: "new-generation" },
			});
		} finally {
			await cleanup();
		}
	});

	it("validates native call results without accepting malformed content", async () => {
		const { manager, cleanup } = fixture("bad-result");
		try {
			const [tool] = await manager.listToolDefinitions();
			const result = await tool.execute("bad", { message: "fixture" }, undefined, undefined, {} as never);
			expect(result.details?.isError).toBe(true);
			expect(result.content).not.toEqual([{ type: "text", text: 17 }]);
		} finally {
			await cleanup();
		}
	});
});
