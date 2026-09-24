/** Lazy MCP connections with bounded startup, per-server failure isolation and generation ownership. */
import type { TSchema } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import { McpConnectionQueue } from "./connection-queue.ts";
import {
	connectMcpRuntime,
	type McpManagerOptions,
	type McpServerStatus,
	type ServerRuntime,
} from "./manager-runtime.ts";
import { mcpPublicDiagnostic, publicMcpServerVersion } from "./public-diagnostic.ts";
import type { McpToolDetails } from "./tools.ts";

export type { McpManagerOptions, McpServerConfig, McpServerState, McpServerStatus } from "./manager-runtime.ts";

export class McpManager {
	private readonly runtimes = new Map<string, ServerRuntime>();
	private readonly options: McpManagerOptions;
	private readonly connections: McpConnectionQueue;

	constructor(options: McpManagerOptions) {
		this.options = options;
		this.connections = new McpConnectionQueue(options.connectionConcurrency ?? 4);
		for (const config of options.servers) {
			if (this.runtimes.has(config.name)) continue; // First definition wins; inventory already applies precedence.
			this.runtimes.set(config.name, { config, state: "idle", tools: [], quarantinedTools: [], generation: 0 });
		}
	}

	/** Configured server names, in configuration order. */
	get serverNames(): string[] {
		return [...this.runtimes.keys()];
	}

	/** Current status per server. Safe to call before any connection attempt. */
	status(): McpServerStatus[] {
		return [...this.runtimes.values()].map((runtime) => ({
			name: runtime.config.name,
			state: runtime.state,
			toolCount: runtime.tools.length,
			error: runtime.error,
			serverVersion: publicMcpServerVersion(runtime.client),
			...(runtime.quarantinedTools.length > 0 ? { quarantinedTools: runtime.quarantinedTools } : {}),
		}));
	}

	/** Wait for every enabled attempt, then return the full admitted catalog in configuration order. */
	async listToolDefinitions(): Promise<ToolDefinition<TSchema, McpToolDetails>[]> {
		await Promise.all([...this.runtimes.values()].map((runtime) => this.ensureConnected(runtime)));
		const tools: ToolDefinition<TSchema, McpToolDetails>[] = [];
		const seen = new Set<string>();
		for (const runtime of this.runtimes.values()) {
			for (const tool of runtime.tools) {
				if (seen.has(tool.name)) continue;
				seen.add(tool.name);
				tools.push(tool);
			}
		}
		return tools;
	}

	/** Connect a single server by name using the same capacity and single-flight as listing. */
	async connect(name: string): Promise<McpServerStatus> {
		const runtime = this.runtimes.get(name);
		if (!runtime) return { name, state: "failed", toolCount: 0, error: `Unknown MCP server "${name}"` };
		await this.ensureConnected(runtime);
		return {
			name,
			state: runtime.state,
			toolCount: runtime.tools.length,
			error: runtime.error,
			serverVersion: publicMcpServerVersion(runtime.client),
			...(runtime.quarantinedTools.length > 0 ? { quarantinedTools: runtime.quarantinedTools } : {}),
		};
	}

	/**
	 * Invalidate queued/active generations before closing their clients. Slots for
	 * started work remain occupied until settlement, not merely until close is requested.
	 * The manager can be explicitly connected again after close.
	 */
	close(): void {
		for (const runtime of this.runtimes.values()) {
			runtime.generation += 1;
			runtime.client?.close();
			runtime.client = undefined;
			runtime.pendingClient?.close();
			runtime.pendingClient = undefined;
			runtime.tools = [];
			runtime.quarantinedTools = [];
			if (runtime.state === "ready" || runtime.state === "connecting" || runtime.state === "queued")
				runtime.state = "idle";
		}
		this.connections.cancelQueued();
	}

	/**
	 * Ping ready servers; idle/queued servers are not spawned by a probe. Failed
	 * servers retry only on explicit recovery, using the same startup queue.
	 */
	async checkHealth(options?: { pingTimeoutMs?: number; reconnectFailed?: boolean }): Promise<McpServerStatus[]> {
		const work: Promise<void>[] = [];
		for (const runtime of this.runtimes.values()) {
			if (runtime.state === "ready" && runtime.client) {
				work.push(this.pingRuntime(runtime, options?.pingTimeoutMs));
			} else if (runtime.state === "failed" && options?.reconnectFailed && !runtime.config.disabled) {
				runtime.state = "idle";
				runtime.error = undefined;
				work.push(this.ensureConnected(runtime));
			}
		}
		await Promise.all(work);
		return this.status();
	}

	private async pingRuntime(runtime: ServerRuntime, timeoutMs?: number): Promise<void> {
		const client = runtime.client;
		if (!client) return;
		try {
			await client.ping(timeoutMs);
		} catch (error) {
			if (runtime.client !== client) return; // A newer owner already handled it.
			runtime.client = undefined;
			client.close();
			runtime.tools = [];
			runtime.quarantinedTools = [];
			runtime.state = "failed";
			runtime.error = mcpPublicDiagnostic(error, "health");
		}
	}

	private ensureConnected(runtime: ServerRuntime): Promise<void> {
		if (runtime.config.disabled) {
			runtime.state = "failed";
			runtime.error = "disabled by configuration";
			return Promise.resolve();
		}
		if (runtime.state === "ready" || runtime.state === "failed") return Promise.resolve();
		if (runtime.connecting) {
			if (runtime.connectingGeneration === runtime.generation) return runtime.connecting;
			return runtime.connecting.then(() => this.ensureConnected(runtime));
		}

		runtime.state = "queued";
		const generation = runtime.generation;
		runtime.connectingGeneration = generation;
		const attempt = this.connections
			.run(async () => {
				if (runtime.generation !== generation) return;
				runtime.state = "connecting";
				await connectMcpRuntime(runtime, generation, this.options);
			})
			.finally(() => {
				if (runtime.connecting === attempt) {
					runtime.connecting = undefined;
					runtime.connectingGeneration = undefined;
				}
				if (runtime.generation === generation) runtime.pendingClient = undefined;
			});
		runtime.connecting = attempt;
		return attempt;
	}
}
