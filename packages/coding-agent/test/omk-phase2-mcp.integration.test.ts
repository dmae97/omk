import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { McpClient } from "../src/core/mcp/client.ts";

it("recovers from 129 serialization failures and rejects false-success server replies over actual stdio", async () => {
	const client = new McpClient({
		name: "phase2-fixture",
		requestTimeoutMs: 1000,
		handshakeTimeoutMs: 2000,
		transport: {
			command: process.execPath,
			args: [fileURLToPath(new URL("./fixtures/omk-phase2-server.mjs", import.meta.url))],
			inheritEnv: false,
			killGraceMs: 25,
		},
	});
	try {
		await client.connect();
		const cycle: { self?: unknown } = {};
		cycle.self = cycle;
		for (let i = 0; i < 129; i++) await expect(client.callTool("echo", cycle)).rejects.toThrow();
		await expect(client.ping()).resolves.toBeUndefined();
		await expect(client.callTool("echo", { rawResult: { content: [], isError: "true" } })).rejects.toThrow(
			"mcp.invalid_tool_result",
		);
		expect((await client.callTool("echo", {})).isError).toBe(false);
	} finally {
		client.close();
	}
}, 10000);
