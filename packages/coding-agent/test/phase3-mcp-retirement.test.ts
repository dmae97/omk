import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { McpClient } from "../src/core/mcp/client.ts";
import { McpManager } from "../src/core/mcp/manager.ts";

const fixture = fileURLToPath(new URL("./fixtures/phase3-mcp-server.mjs", import.meta.url));
it("waits for physical transport closure before a same-server reconnect", async () => {
	const clients: McpClient[] = [];
	let firstClosed = false;
	const manager = new McpManager({
		servers: [{ name: "fixture", command: process.execPath, args: [fixture], inheritEnv: false }],
		createClient: (options) => {
			if (clients.length > 0) expect(firstClosed).toBe(true);
			const client = new McpClient({ ...options, transport: { ...options.transport, killGraceMs: 40 } });
			clients.push(client);
			if (clients.length === 1)
				void client.waitForTransportClose().then(() => {
					firstClosed = true;
				});
			return client;
		},
	});
	try {
		expect((await manager.connect("fixture")).state).toBe("ready");
		manager.close();
		expect((await manager.connect("fixture")).state).toBe("ready");
		expect(clients.length).toBe(2);
	} finally {
		await manager.closeAndWait();
	}
}, 5000);
