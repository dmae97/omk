import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { MCPManager } from "../src/mcp/manager";
import type { MCPServerConfig, MCPServerConnection, MCPToolDefinition } from "../src/mcp/types";

const connectToServerMock = vi.fn();
const disconnectServerMock = vi.fn();
const getPromptMock = vi.fn();
const listPromptsMock = vi.fn();
const listResourcesMock = vi.fn();
const listResourceTemplatesMock = vi.fn();
const listToolsMock = vi.fn();
const readResourceMock = vi.fn();
const serverSupportsPromptsMock = vi.fn();
const serverSupportsResourcesMock = vi.fn();
const subscribeToResourcesMock = vi.fn();
const unsubscribeFromResourcesMock = vi.fn();

vi.mock("../src/mcp/client", () => ({
	connectToServer: connectToServerMock,
	disconnectServer: disconnectServerMock,
	getPrompt: getPromptMock,
	listPrompts: listPromptsMock,
	listResources: listResourcesMock,
	listResourceTemplates: listResourceTemplatesMock,
	listTools: listToolsMock,
	readResource: readResourceMock,
	serverSupportsPrompts: serverSupportsPromptsMock,
	serverSupportsResources: serverSupportsResourcesMock,
	subscribeToResources: subscribeToResourcesMock,
	unsubscribeFromResources: unsubscribeFromResourcesMock,
}));

function createConnection(name: string): MCPServerConnection {
	const config: MCPServerConfig = { command: "echo" };
	return {
		name,
		config,
		transport: {
			connected: true,
			request: async () => {
				throw new Error("request not implemented in test");
			},
			notify: async () => {},
			close: async () => {},
		},
		serverInfo: { name, version: "1.0.0" },
		capabilities: { resources: { subscribe: true } },
		resources: [{ uri: "test://resource", name: "resource" }],
	};
}

describe("MCPManager notifications epoch handling", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		disconnectServerMock.mockResolvedValue(undefined);
		listToolsMock.mockResolvedValue([] satisfies MCPToolDefinition[]);
		serverSupportsResourcesMock.mockReturnValue(false);
		serverSupportsPromptsMock.mockReturnValue(false);
		listResourcesMock.mockResolvedValue([]);
		listResourceTemplatesMock.mockResolvedValue([]);
		listPromptsMock.mockResolvedValue([]);
		unsubscribeFromResourcesMock.mockResolvedValue(undefined);
		subscribeToResourcesMock.mockResolvedValue(undefined);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("does not unsubscribe when an old subscribe resolves after notifications are re-enabled", async () => {
		const firstSubscribe = Promise.withResolvers<void>();
		let subscribeCallCount = 0;
		subscribeToResourcesMock.mockImplementation(() => {
			subscribeCallCount += 1;
			if (subscribeCallCount === 1) {
				return firstSubscribe.promise;
			}
			return Promise.resolve();
		});
		connectToServerMock.mockResolvedValue(createConnection("server-a"));

		const manager = new MCPManager(process.cwd());
		await manager.connectServers({ "server-a": { command: "echo" } }, {});

		manager.setNotificationsEnabled(true);
		manager.setNotificationsEnabled(false);
		manager.setNotificationsEnabled(true);

		firstSubscribe.resolve();
		await Promise.resolve();
		await Promise.resolve();

		expect(subscribeToResourcesMock).toHaveBeenCalledTimes(2);
		expect(unsubscribeFromResourcesMock).toHaveBeenCalledTimes(0);
	});
});
