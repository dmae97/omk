/**
 * MCP to CustomTool bridge.
 *
 * Converts MCP tool definitions to CustomTool format for the agent.
 */
import type { AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import type { TSchema } from "@sinclair/typebox";
import type { SourceMeta } from "../capability/types";
import type {
	CustomTool,
	CustomToolContext,
	CustomToolResult,
	RenderResultOptions,
} from "../extensibility/custom-tools/types";
import type { Theme } from "../modes/theme/theme";
import { ToolAbortError, throwIfAborted } from "../tools/tool-errors";
import { callTool } from "./client";
import { renderMCPCall, renderMCPResult } from "./render";
import type { MCPContent, MCPServerConnection, MCPToolDefinition } from "./types";

function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
	if (!signal) return promise;
	if (signal.aborted) {
		return Promise.reject(signal.reason instanceof Error ? signal.reason : new ToolAbortError());
	}

	const { promise: wrapped, resolve, reject } = Promise.withResolvers<T>();
	const onAbort = () => {
		reject(signal.reason instanceof Error ? signal.reason : new ToolAbortError());
	};

	signal.addEventListener("abort", onAbort, { once: true });
	promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
	return wrapped;
}

/** Details included in MCP tool results for rendering */
export interface MCPToolDetails {
	/** Server name */
	serverName: string;
	/** Original MCP tool name */
	mcpToolName: string;
	/** Whether the call resulted in an error */
	isError?: boolean;
	/** Raw content from MCP response */
	rawContent?: MCPContent[];
	/** Provider ID (e.g., "claude", "mcp-json") */
	provider?: string;
	/** Provider display name (e.g., "Claude Code", "MCP Config") */
	providerName?: string;
}

/**
 * Convert JSON Schema from MCP to TypeBox-compatible schema.
 * MCP uses standard JSON Schema, TypeBox uses a compatible subset.
 *
 * Also normalizes schemas to work around common issues:
 * - Adds `properties: {}` to object schemas missing it (some LLM providers require this)
 */
function convertSchema(mcpSchema: MCPToolDefinition["inputSchema"]): TSchema {
	// Normalize: object schemas must have properties field for some providers
	if (mcpSchema.type === "object" && !("properties" in mcpSchema)) {
		return { ...mcpSchema, properties: {} } as unknown as TSchema;
	}
	return mcpSchema as unknown as TSchema;
}

/**
 * Format MCP content for LLM consumption.
 */
function formatMCPContent(content: MCPContent[]): string {
	const parts: string[] = [];

	for (const item of content) {
		switch (item.type) {
			case "text":
				parts.push(item.text);
				break;
			case "image":
				parts.push(`[Image: ${item.mimeType}]`);
				break;
			case "resource":
				if (item.resource.text) {
					parts.push(`[Resource: ${item.resource.uri}]\n${item.resource.text}`);
				} else {
					parts.push(`[Resource: ${item.resource.uri}]`);
				}
				break;
		}
	}

	return parts.join("\n\n");
}

/**
 * Create a unique tool name for an MCP tool.
 *
 * Prefixes with server name to avoid conflicts. If the tool name already
 * starts with the server name (e.g., server "puppeteer" with tool
 * "puppeteer_screenshot"), strips the redundant prefix to produce
 * "mcp_puppeteer_screenshot" instead of "mcp_puppeteer_puppeteer_screenshot".
 */
function sanitizeMCPToolNamePart(value: string, fallback: string): string {
	const sanitized = value
		.toLowerCase()
		.replace(/[^a-z_]+/g, "_")
		.replace(/_+/g, "_")
		.replace(/^_+|_+$/g, "");

	return sanitized.length > 0 ? sanitized : fallback;
}

export function createMCPToolName(serverName: string, toolName: string): string {
	const sanitizedServerName = sanitizeMCPToolNamePart(serverName, "server");
	const sanitizedToolName = sanitizeMCPToolNamePart(toolName, "tool");

	// Strip redundant server name prefix from tool name if present
	const prefixWithUnderscore = `${sanitizedServerName}_`;

	let normalizedToolName = sanitizedToolName;
	if (sanitizedToolName.startsWith(prefixWithUnderscore)) {
		normalizedToolName = sanitizedToolName.slice(prefixWithUnderscore.length);
	}

	return `mcp_${sanitizedServerName}_${normalizedToolName}`;
}

/**
 * Parse an MCP tool name back to server and tool components.
 *
 * Note: This returns the normalized tool name (with server prefix stripped).
 * The original MCP tool name may have had the server name as a prefix.
 */
export function parseMCPToolName(name: string): { serverName: string; toolName: string } | null {
	if (!name.startsWith("mcp_")) return null;

	const rest = name.slice(4);
	const underscoreIdx = rest.indexOf("_");
	if (underscoreIdx === -1) return null;

	return {
		serverName: rest.slice(0, underscoreIdx),
		toolName: rest.slice(underscoreIdx + 1),
	};
}

/**
 * CustomTool wrapping an MCP tool with an active connection.
 */
export class MCPTool implements CustomTool<TSchema, MCPToolDetails> {
	readonly name: string;
	readonly label: string;
	readonly description: string;
	readonly parameters: TSchema;
	/** Original MCP tool name (before normalization) */
	readonly mcpToolName: string;
	/** Server name */
	readonly mcpServerName: string;

	/** Create MCPTool instances for all tools from an MCP server connection */
	static fromTools(connection: MCPServerConnection, tools: MCPToolDefinition[]): MCPTool[] {
		return tools.map(tool => new MCPTool(connection, tool));
	}

	constructor(
		private readonly connection: MCPServerConnection,
		private readonly tool: MCPToolDefinition,
	) {
		this.name = createMCPToolName(connection.name, tool.name);
		this.label = `${connection.name}/${tool.name}`;
		this.description = tool.description ?? `MCP tool from ${connection.name}`;
		this.parameters = convertSchema(tool.inputSchema);
		this.mcpToolName = tool.name;
		this.mcpServerName = connection.name;
	}

	renderCall(args: unknown, theme: Theme) {
		return renderMCPCall((args ?? {}) as Record<string, unknown>, theme, this.label);
	}

	renderResult(result: CustomToolResult<MCPToolDetails>, options: RenderResultOptions, theme: Theme, args?: unknown) {
		return renderMCPResult(result, options, theme, (args ?? {}) as Record<string, unknown>);
	}

	async execute(
		_toolCallId: string,
		params: unknown,
		_onUpdate: AgentToolUpdateCallback<MCPToolDetails> | undefined,
		_ctx: CustomToolContext,
		signal?: AbortSignal,
	): Promise<CustomToolResult<MCPToolDetails>> {
		throwIfAborted(signal);
		try {
			const result = await callTool(this.connection, this.tool.name, params as Record<string, unknown>, { signal });

			const text = formatMCPContent(result.content);
			const details: MCPToolDetails = {
				serverName: this.connection.name,
				mcpToolName: this.tool.name,
				isError: result.isError,
				rawContent: result.content,
				provider: this.connection._source?.provider,
				providerName: this.connection._source?.providerName,
			};

			if (result.isError) {
				return {
					content: [{ type: "text", text: `Error: ${text}` }],
					details,
				};
			}

			return {
				content: [{ type: "text", text }],
				details,
			};
		} catch (error) {
			if (error instanceof ToolAbortError) {
				throw error;
			}
			if (error instanceof Error && error.name === "AbortError") {
				throw new ToolAbortError();
			}
			if (signal?.aborted) {
				throw new ToolAbortError();
			}
			const message = error instanceof Error ? error.message : String(error);
			return {
				content: [{ type: "text", text: `MCP error: ${message}` }],
				details: {
					serverName: this.connection.name,
					mcpToolName: this.tool.name,
					isError: true,
					provider: this.connection._source?.provider,
					providerName: this.connection._source?.providerName,
				},
			};
		}
	}
}

/**
 * CustomTool wrapping an MCP tool with deferred connection resolution.
 */
export class DeferredMCPTool implements CustomTool<TSchema, MCPToolDetails> {
	readonly name: string;
	readonly label: string;
	readonly description: string;
	readonly parameters: TSchema;
	/** Original MCP tool name (before normalization) */
	readonly mcpToolName: string;
	/** Server name */
	readonly mcpServerName: string;
	readonly #fallbackProvider: string | undefined;
	readonly #fallbackProviderName: string | undefined;

	/** Create DeferredMCPTool instances for all tools from an MCP server */
	static fromTools(
		serverName: string,
		tools: MCPToolDefinition[],
		getConnection: () => Promise<MCPServerConnection>,
		source?: SourceMeta,
	): DeferredMCPTool[] {
		return tools.map(tool => new DeferredMCPTool(serverName, tool, getConnection, source));
	}

	constructor(
		private readonly serverName: string,
		private readonly tool: MCPToolDefinition,
		private readonly getConnection: () => Promise<MCPServerConnection>,
		source?: SourceMeta,
	) {
		this.name = createMCPToolName(serverName, tool.name);
		this.label = `${serverName}/${tool.name}`;
		this.description = tool.description ?? `MCP tool from ${serverName}`;
		this.parameters = convertSchema(tool.inputSchema);
		this.mcpToolName = tool.name;
		this.mcpServerName = serverName;
		this.#fallbackProvider = source?.provider;
		this.#fallbackProviderName = source?.providerName;
	}

	renderCall(args: unknown, theme: Theme) {
		return renderMCPCall((args ?? {}) as Record<string, unknown>, theme, this.label);
	}

	renderResult(result: CustomToolResult<MCPToolDetails>, options: RenderResultOptions, theme: Theme, args?: unknown) {
		return renderMCPResult(result, options, theme, (args ?? {}) as Record<string, unknown>);
	}

	async execute(
		_toolCallId: string,
		params: unknown,
		_onUpdate: AgentToolUpdateCallback<MCPToolDetails> | undefined,
		_ctx: CustomToolContext,
		signal?: AbortSignal,
	): Promise<CustomToolResult<MCPToolDetails>> {
		throwIfAborted(signal);
		try {
			const connection = await withAbort(this.getConnection(), signal);
			throwIfAborted(signal);
			const result = await callTool(connection, this.tool.name, params as Record<string, unknown>, { signal });

			const text = formatMCPContent(result.content);
			const details: MCPToolDetails = {
				serverName: this.serverName,
				mcpToolName: this.tool.name,
				isError: result.isError,
				rawContent: result.content,
				provider: connection._source?.provider ?? this.#fallbackProvider,
				providerName: connection._source?.providerName ?? this.#fallbackProviderName,
			};

			if (result.isError) {
				return {
					content: [{ type: "text", text: `Error: ${text}` }],
					details,
				};
			}

			return {
				content: [{ type: "text", text }],
				details,
			};
		} catch (error) {
			if (error instanceof ToolAbortError) {
				throw error;
			}
			if (error instanceof Error && error.name === "AbortError") {
				throw new ToolAbortError();
			}
			if (signal?.aborted) {
				throw new ToolAbortError();
			}
			const message = error instanceof Error ? error.message : String(error);
			return {
				content: [{ type: "text", text: `MCP error: ${message}` }],
				details: {
					serverName: this.serverName,
					mcpToolName: this.tool.name,
					isError: true,
					provider: this.#fallbackProvider,
					providerName: this.#fallbackProviderName,
				},
			};
		}
	}
}
