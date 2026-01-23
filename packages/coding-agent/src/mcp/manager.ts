/**
 * MCP Server Manager.
 *
 * Discovers, connects to, and manages MCP servers.
 * Handles tool loading and lifecycle.
 */

import { logger } from "@oh-my-pi/pi-utils";
import type { TSchema } from "@sinclair/typebox";
import type { CustomTool } from "$c/extensibility/custom-tools/types";
import { connectToServer, disconnectServer, listTools } from "./client";
import { loadAllMCPConfigs, validateServerConfig } from "./config";
import type { MCPToolDetails } from "./tool-bridge";
import { DeferredMCPTool, MCPTool } from "./tool-bridge";
import type { MCPToolCache } from "./tool-cache";
import type { MCPServerConfig, MCPServerConnection, MCPToolDefinition } from "./types";

type SourceMeta = import("../capability/types").SourceMeta;

type ToolLoadResult = {
	connection: MCPServerConnection;
	serverTools: MCPToolDefinition[];
};

type TrackedPromise<T> = {
	promise: Promise<T>;
	status: "pending" | "fulfilled" | "rejected";
	value?: T;
	reason?: unknown;
};

const STARTUP_TIMEOUT_MS = 250;

function trackPromise<T>(promise: Promise<T>): TrackedPromise<T> {
	const tracked: TrackedPromise<T> = { promise, status: "pending" };
	promise.then(
		(value) => {
			tracked.status = "fulfilled";
			tracked.value = value;
		},
		(reason) => {
			tracked.status = "rejected";
			tracked.reason = reason;
		},
	);
	return tracked;
}

function delay(ms: number): Promise<void> {
	return Bun.sleep(ms);
}

/** Result of loading MCP tools */
export interface MCPLoadResult {
	/** Loaded tools as CustomTool instances */
	tools: CustomTool<TSchema, MCPToolDetails>[];
	/** Connection errors by server name */
	errors: Map<string, string>;
	/** Connected server names */
	connectedServers: string[];
	/** Extracted Exa API keys from filtered MCP servers */
	exaApiKeys: string[];
}

/** Options for discovering and connecting to MCP servers */
export interface MCPDiscoverOptions {
	/** Whether to load project-level config (default: true) */
	enableProjectConfig?: boolean;
	/** Whether to filter out Exa MCP servers (default: true) */
	filterExa?: boolean;
	/** Called when starting to connect to servers */
	onConnecting?: (serverNames: string[]) => void;
}

/**
 * MCP Server Manager.
 *
 * Manages connections to MCP servers and provides tools to the agent.
 */
export class MCPManager {
	private connections = new Map<string, MCPServerConnection>();
	private tools: CustomTool<TSchema, MCPToolDetails>[] = [];
	private pendingConnections = new Map<string, Promise<MCPServerConnection>>();
	private pendingToolLoads = new Map<string, Promise<ToolLoadResult>>();
	private sources = new Map<string, SourceMeta>();

	constructor(
		private cwd: string,
		private toolCache: MCPToolCache | null = null,
	) {}

	/**
	 * Discover and connect to all MCP servers from .mcp.json files.
	 * Returns tools and any connection errors.
	 */
	async discoverAndConnect(options?: MCPDiscoverOptions): Promise<MCPLoadResult> {
		const { configs, exaApiKeys, sources } = await loadAllMCPConfigs(this.cwd, {
			enableProjectConfig: options?.enableProjectConfig,
			filterExa: options?.filterExa,
		});
		const result = await this.connectServers(configs, sources, options?.onConnecting);
		result.exaApiKeys = exaApiKeys;
		return result;
	}

	/**
	 * Connect to specific MCP servers.
	 * Connections are made in parallel for faster startup.
	 */
	async connectServers(
		configs: Record<string, MCPServerConfig>,
		sources: Record<string, SourceMeta>,
		onConnecting?: (serverNames: string[]) => void,
	): Promise<MCPLoadResult> {
		type ConnectionTask = {
			name: string;
			config: MCPServerConfig;
			tracked: TrackedPromise<ToolLoadResult>;
			toolsPromise: Promise<ToolLoadResult>;
		};

		const errors = new Map<string, string>();
		const connectedServers = new Set<string>();
		const allTools: CustomTool<TSchema, MCPToolDetails>[] = [];
		const reportedErrors = new Set<string>();
		let allowBackgroundLogging = false;

		// Prepare connection tasks
		const connectionTasks: ConnectionTask[] = [];

		for (const [name, config] of Object.entries(configs)) {
			if (sources[name]) {
				this.sources.set(name, sources[name]);
				const existing = this.connections.get(name);
				if (existing) {
					existing._source = sources[name];
				}
			}

			// Skip if already connected
			if (this.connections.has(name)) {
				connectedServers.add(name);
				continue;
			}

			if (this.pendingConnections.has(name) || this.pendingToolLoads.has(name)) {
				continue;
			}

			// Validate config
			const validationErrors = validateServerConfig(name, config);
			if (validationErrors.length > 0) {
				errors.set(name, validationErrors.join("; "));
				reportedErrors.add(name);
				continue;
			}

			const connectionPromise = connectToServer(name, config).then(
				(connection) => {
					if (sources[name]) {
						connection._source = sources[name];
					}
					if (this.pendingConnections.get(name) === connectionPromise) {
						this.pendingConnections.delete(name);
						this.connections.set(name, connection);
					}
					return connection;
				},
				(error) => {
					if (this.pendingConnections.get(name) === connectionPromise) {
						this.pendingConnections.delete(name);
					}
					throw error;
				},
			);
			this.pendingConnections.set(name, connectionPromise);

			const toolsPromise = connectionPromise.then(async (connection) => {
				const serverTools = await listTools(connection);
				return { connection, serverTools };
			});
			this.pendingToolLoads.set(name, toolsPromise);

			const tracked = trackPromise(toolsPromise);
			connectionTasks.push({ name, config, tracked, toolsPromise });

			void toolsPromise
				.then(({ connection, serverTools }) => {
					if (this.pendingToolLoads.get(name) !== toolsPromise) return;
					this.pendingToolLoads.delete(name);
					const customTools = MCPTool.fromTools(connection, serverTools);
					this.replaceServerTools(name, customTools);
					void this.toolCache?.set(name, config, serverTools);
				})
				.catch((error) => {
					if (this.pendingToolLoads.get(name) !== toolsPromise) return;
					this.pendingToolLoads.delete(name);
					if (!allowBackgroundLogging || reportedErrors.has(name)) return;
					const message = error instanceof Error ? error.message : String(error);
					logger.error("MCP tool load failed", { path: `mcp:${name}`, error: message });
				});
		}

		// Notify about servers we're connecting to
		if (connectionTasks.length > 0 && onConnecting) {
			onConnecting(connectionTasks.map((task) => task.name));
		}

		if (connectionTasks.length > 0) {
			await Promise.race([
				Promise.allSettled(connectionTasks.map((task) => task.tracked.promise)),
				delay(STARTUP_TIMEOUT_MS),
			]);

			const cachedTools = new Map<string, MCPToolDefinition[]>();
			const pendingTasks = connectionTasks.filter((task) => task.tracked.status === "pending");

			if (pendingTasks.length > 0) {
				if (this.toolCache) {
					await Promise.all(
						pendingTasks.map(async (task) => {
							const cached = await this.toolCache?.get(task.name, task.config);
							if (cached) {
								cachedTools.set(task.name, cached);
							}
						}),
					);
				}

				const pendingWithoutCache = pendingTasks.filter((task) => !cachedTools.has(task.name));
				if (pendingWithoutCache.length > 0) {
					await Promise.allSettled(pendingWithoutCache.map((task) => task.tracked.promise));
				}
			}

			for (const task of connectionTasks) {
				const { name } = task;
				if (task.tracked.status === "fulfilled") {
					const value = task.tracked.value;
					if (!value) continue;
					const { connection, serverTools } = value;
					connectedServers.add(name);
					allTools.push(...MCPTool.fromTools(connection, serverTools));
				} else if (task.tracked.status === "rejected") {
					const message =
						task.tracked.reason instanceof Error ? task.tracked.reason.message : String(task.tracked.reason);
					errors.set(name, message);
					reportedErrors.add(name);
				} else {
					const cached = cachedTools.get(name);
					if (cached) {
						const source = this.sources.get(name);
						allTools.push(...DeferredMCPTool.fromTools(name, cached, () => this.waitForConnection(name), source));
					}
				}
			}
		}

		// Update cached tools
		this.tools = allTools;
		allowBackgroundLogging = true;

		return {
			tools: allTools,
			errors,
			connectedServers: Array.from(connectedServers),
			exaApiKeys: [], // Will be populated by discoverAndConnect
		};
	}

	private replaceServerTools(name: string, tools: CustomTool<TSchema, MCPToolDetails>[]): void {
		this.tools = this.tools.filter((t) => !t.name.startsWith(`mcp_${name}_`));
		this.tools.push(...tools);
	}

	/**
	 * Get all loaded tools.
	 */
	getTools(): CustomTool<TSchema, MCPToolDetails>[] {
		return this.tools;
	}

	/**
	 * Get a specific connection.
	 */
	getConnection(name: string): MCPServerConnection | undefined {
		return this.connections.get(name);
	}

	/**
	 * Get the source metadata for a server.
	 */
	getSource(name: string): SourceMeta | undefined {
		return this.sources.get(name) ?? this.connections.get(name)?._source;
	}

	/**
	 * Wait for a connection to complete (or fail).
	 */
	async waitForConnection(name: string): Promise<MCPServerConnection> {
		const connection = this.connections.get(name);
		if (connection) return connection;
		const pending = this.pendingConnections.get(name);
		if (pending) return pending;
		throw new Error(`MCP server not connected: ${name}`);
	}

	/**
	 * Get all connected server names.
	 */
	getConnectedServers(): string[] {
		return Array.from(this.connections.keys());
	}

	/**
	 * Disconnect from a specific server.
	 */
	async disconnectServer(name: string): Promise<void> {
		this.pendingConnections.delete(name);
		this.pendingToolLoads.delete(name);
		this.sources.delete(name);

		const connection = this.connections.get(name);
		if (connection) {
			await disconnectServer(connection);
			this.connections.delete(name);
		}

		// Remove tools from this server
		this.tools = this.tools.filter((t) => !t.name.startsWith(`mcp_${name}_`));
	}

	/**
	 * Disconnect from all servers.
	 */
	async disconnectAll(): Promise<void> {
		const promises = Array.from(this.connections.values()).map((conn) => disconnectServer(conn));
		await Promise.allSettled(promises);

		this.pendingConnections.clear();
		this.pendingToolLoads.clear();
		this.sources.clear();
		this.connections.clear();
		this.tools = [];
	}

	/**
	 * Refresh tools from a specific server.
	 */
	async refreshServerTools(name: string): Promise<void> {
		const connection = this.connections.get(name);
		if (!connection) return;

		// Clear cached tools
		connection.tools = undefined;

		// Reload tools
		const serverTools = await listTools(connection);
		const customTools = MCPTool.fromTools(connection, serverTools);
		void this.toolCache?.set(name, connection.config, serverTools);

		// Replace tools from this server
		this.replaceServerTools(name, customTools);
	}

	/**
	 * Refresh tools from all servers.
	 */
	async refreshAllTools(): Promise<void> {
		const promises = Array.from(this.connections.keys()).map((name) => this.refreshServerTools(name));
		await Promise.allSettled(promises);
	}
}

/**
 * Create an MCP manager and discover servers.
 * Convenience function for quick setup.
 */
export async function createMCPManager(
	cwd: string,
	options?: MCPDiscoverOptions,
): Promise<{
	manager: MCPManager;
	result: MCPLoadResult;
}> {
	const manager = new MCPManager(cwd);
	const result = await manager.discoverAndConnect(options);
	return { manager, result };
}
