import { beforeEach, describe, expect, it, mock, vi } from "bun:test";
import type { SourceMeta } from "../src/capability/types";
import type { MCPServerConfig, MCPServerConnection, MCPToolDefinition, MCPTransport } from "../src/mcp/types";

const connectToServerMock = vi.fn();
const disconnectServerMock = vi.fn();
const listToolsMock = vi.fn();

mock.module("../src/mcp/client", () => ({
	connectToServer: connectToServerMock,
	disconnectServer: disconnectServerMock,
	getPrompt: vi.fn(),
	listPrompts: vi.fn(),
	listResources: vi.fn(),
	listResourceTemplates: vi.fn(),
	listTools: listToolsMock,
	readResource: vi.fn(),
	serverSupportsPrompts: vi.fn(() => false),
	serverSupportsResources: vi.fn(() => false),
	subscribeToResources: vi.fn(),
	unsubscribeFromResources: vi.fn(),
}));

import { MCPManager } from "../src/mcp/manager";

function createTransport(): MCPTransport {
	return {
		connected: true,
		async request() {
			throw new Error("request not implemented");
		},
		async notify() {},
		async close() {},
	};
}

function createConnection(name: string, config: MCPServerConfig, transport: MCPTransport): MCPServerConnection {
	return {
		name,
		config,
		transport,
		serverInfo: { name: "mock", version: "1.0.0" },
		capabilities: { tools: {} },
	};
}

function createSource(path: string): SourceMeta {
	return {
		provider: "mcp-json",
		providerName: "MCP JSON",
		path,
		level: "project",
	};
}

beforeEach(() => {
	connectToServerMock.mockReset();
	disconnectServerMock.mockReset();
	listToolsMock.mockReset();

	disconnectServerMock.mockImplementation(async (connection: MCPServerConnection) => {
		await connection.transport.close();
	});
	listToolsMock.mockResolvedValue([] satisfies MCPToolDefinition[]);
});

describe("MCPManager reconnect behavior", () => {
	it("wires stdio transport onClose to reconnectServer", async () => {
		const manager = new MCPManager("/tmp");
		const serverName = "stdio-server";
		const config: MCPServerConfig = { type: "stdio", command: "mock-server" };
		const transport = createTransport();
		connectToServerMock.mockResolvedValueOnce(createConnection(serverName, config, transport));

		await manager.connectServers({ [serverName]: config }, { [serverName]: createSource("/tmp/.mcp.json") });

		const connection = manager.getConnection(serverName);
		expect(connection).toBeDefined();
		expect(typeof connection?.transport.onClose).toBe("function");

		const reconnectSpy = vi.spyOn(manager, "reconnectServer").mockResolvedValue(null);
		connection?.transport.onClose?.();
		expect(reconnectSpy).toHaveBeenCalledWith(serverName);
	});

	it("stops reconnect retries after disconnectAll increments epoch", async () => {
		const manager = new MCPManager("/tmp");
		const serverName = "epoch-server";
		const config: MCPServerConfig = { type: "stdio", command: "mock-server" };
		const firstReconnectAttempt = Promise.withResolvers<void>();
		let connectCalls = 0;

		connectToServerMock.mockImplementation(async () => {
			connectCalls += 1;
			if (connectCalls === 1) {
				return createConnection(serverName, config, createTransport());
			}
			if (connectCalls === 2) {
				firstReconnectAttempt.resolve();
				throw new Error("ECONNREFUSED");
			}
			return createConnection(serverName, config, createTransport());
		});

		await manager.connectServers({ [serverName]: config }, { [serverName]: createSource("/tmp/.mcp.json") });

		const sleepGate = Promise.withResolvers<void>();
		const sleepSpy = vi.spyOn(Bun, "sleep").mockImplementation(async () => sleepGate.promise);

		const reconnectPromise = manager.reconnectServer(serverName);
		await firstReconnectAttempt.promise;
		await manager.disconnectAll();
		sleepGate.resolve();

		const result = await reconnectPromise;
		expect(result).toBeNull();
		expect(connectCalls).toBe(2);

		sleepSpy.mockRestore();
	});
});
