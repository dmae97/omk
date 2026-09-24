import type { TSchema } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import { detectMcpDescriptorPromptInjection, MCP_QUARANTINE_PATTERN_SIGNAL_THRESHOLD } from "../mcp-public-presets.ts";
import { McpClient, type McpClientOptions } from "./client.ts";
import { mcpPublicDiagnostic } from "./public-diagnostic.ts";
import { createMcpToolDefinition, type McpToolDetails } from "./tools.ts";

export type McpServerState = "idle" | "queued" | "connecting" | "ready" | "failed";

export interface McpServerConfig {
	readonly name: string;
	readonly command: string;
	readonly args?: readonly string[];
	readonly env?: Readonly<Record<string, string>>;
	readonly cwd?: string;
	/** Explicit environment inheritance policy. Omitted preserves the transport default. */
	readonly inheritEnv?: boolean;
	/** Skip this server without removing it from configuration. */
	readonly disabled?: boolean;
	readonly requestTimeoutMs?: number;
	readonly handshakeTimeoutMs?: number;
}

export interface McpServerStatus {
	readonly name: string;
	readonly state: McpServerState;
	readonly toolCount: number;
	/** Failure reason when `state` is `failed`. Never contains configured env values. */
	readonly error?: string;
	readonly serverVersion?: string;
	/** Tool names excluded because their descriptions carried prompt-injection payloads. */
	readonly quarantinedTools?: readonly string[];
}

export interface McpManagerOptions {
	readonly servers: readonly McpServerConfig[];
	readonly cwd?: string;
	readonly clientInfo?: { readonly name: string; readonly version: string };
	readonly callTimeoutMs?: number;
	/** Concurrent connect/handshake/catalog attempts, default 4. Does not limit enabled servers. */
	readonly connectionConcurrency?: number;
	/** Injected for tests so the manager can be exercised without spawning processes. */
	readonly createClient?: (options: McpClientOptions) => McpClient;
}

export interface ServerRuntime {
	readonly config: McpServerConfig;
	state: McpServerState;
	client?: McpClient;
	tools: ToolDefinition<TSchema, McpToolDetails>[];
	quarantinedTools: string[];
	error?: string;
	connecting?: Promise<void>;
	connectingGeneration?: number;
	/** Client owned by the in-flight attempt, not yet published. */
	pendingClient?: McpClient;
	generation: number;
}

/** Isolates one attempt, including construction errors, under its generation owner. */
export async function connectMcpRuntime(
	runtime: ServerRuntime,
	generation: number,
	options: McpManagerOptions,
): Promise<void> {
	let client: McpClient | undefined;
	const isCurrent = () => runtime.generation === generation && runtime.pendingClient === client;
	try {
		const clientOptions: McpClientOptions = {
			name: runtime.config.name,
			clientInfo: options.clientInfo,
			requestTimeoutMs: runtime.config.requestTimeoutMs,
			handshakeTimeoutMs: runtime.config.handshakeTimeoutMs,
			transport: {
				command: runtime.config.command,
				args: runtime.config.args,
				env: runtime.config.env,
				inheritEnv: runtime.config.inheritEnv,
				cwd: runtime.config.cwd ?? options.cwd,
			},
		};
		const ownedClient = options.createClient?.(clientOptions) ?? new McpClient(clientOptions);
		client = ownedClient;
		runtime.pendingClient = client;
		await client.connect();
		if (!isCurrent()) {
			client.close();
			return;
		}
		const schemas = await client.listTools();
		if (!isCurrent()) {
			client.close();
			return;
		}
		const definitions = schemas.map((schema) =>
			createMcpToolDefinition(runtime.config.name, ownedClient, schema, {
				callTimeoutMs: options.callTimeoutMs,
			}),
		);
		const admitted: typeof definitions = [];
		const quarantined: string[] = [];
		for (const definition of definitions) {
			if (
				detectMcpDescriptorPromptInjection(definition.description ?? "").patternSignal >
				MCP_QUARANTINE_PATTERN_SIGNAL_THRESHOLD
			) {
				quarantined.push(definition.name);
			} else {
				admitted.push(definition);
			}
		}
		runtime.client = client;
		runtime.pendingClient = undefined;
		runtime.tools = admitted;
		runtime.quarantinedTools = quarantined;
		runtime.state = "ready";
		runtime.error = undefined;
	} catch (error) {
		client?.close();
		if (!isCurrent()) return;
		runtime.client = undefined;
		runtime.tools = [];
		runtime.quarantinedTools = [];
		runtime.state = "failed";
		runtime.error = mcpPublicDiagnostic(error, "connect");
	}
}
