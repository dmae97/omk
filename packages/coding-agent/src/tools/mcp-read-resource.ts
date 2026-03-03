/**
 * Built-in tool for reading MCP resources by URI.
 *
 * Global tool (not per-server) — resolves the server from the URI
 * by checking which connected server exposes a matching resource.
 */
import type { AgentTool, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import { type Static, Type } from "@sinclair/typebox";
import type { MCPManager } from "../mcp/manager";
import type { OutputMeta } from "./output-meta";
import { toolResult } from "./tool-result";

const mcpReadResourceSchema = Type.Object({
	uri: Type.String({
		description: "Resource URI to read (e.g. test://notes, ibkr://portfolio/positions)",
	}),
});

type McpReadResourceParams = Static<typeof mcpReadResourceSchema>;

export interface McpReadResourceDetails {
	serverName?: string;
	uri: string;
	isError?: boolean;
	meta?: OutputMeta;
}

export class McpReadResourceTool implements AgentTool<typeof mcpReadResourceSchema, McpReadResourceDetails> {
	readonly name = "read_resource";
	readonly label = "MCP Read Resource";
	readonly description =
		"Read a resource from a connected MCP server by URI. " +
		"Use this to inspect MCP resource content when notified of updates or when you need server-provided context.";
	readonly parameters = mcpReadResourceSchema;

	#getMcpManager: () => MCPManager | undefined;

	constructor(getMcpManager: () => MCPManager | undefined) {
		this.#getMcpManager = getMcpManager;
	}

	async execute(
		_toolCallId: string,
		params: McpReadResourceParams,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<McpReadResourceDetails>,
	): Promise<AgentToolResult<McpReadResourceDetails>> {
		const { uri } = params;
		const mcpManager = this.#getMcpManager();

		if (!mcpManager) {
			return toolResult<McpReadResourceDetails>({ uri, isError: true })
				.text("No MCP manager available. MCP servers may not be configured.")
				.done();
		}

		// Find which server has this resource
		const servers = mcpManager.getConnectedServers();
		let targetServer: string | undefined;

		for (const name of servers) {
			const serverResources = mcpManager.getServerResources(name);
			if (serverResources?.resources.some(r => r.uri === uri)) {
				targetServer = name;
				break;
			}
		}

		// If no exact match, try servers with templates whose URI scheme matches
		if (!targetServer) {
			const uriScheme = uri.split("://")[0];
			for (const name of servers) {
				const serverResources = mcpManager.getServerResources(name);
				if (serverResources?.templates.some(t => t.uriTemplate.startsWith(`${uriScheme}://`))) {
					targetServer = name;
					break;
				}
			}
		}

		if (!targetServer) {
			const available = servers
				.flatMap(name => {
					const serverResources = mcpManager.getServerResources(name);
					return (serverResources?.resources ?? []).map(r => `  ${r.uri} (${name})`);
				})
				.join("\n");
			return toolResult<McpReadResourceDetails>({ uri, isError: true })
				.text(`No MCP server has resource "${uri}".\n\nAvailable resources:\n${available || "  (none)"}`)
				.done();
		}

		try {
			const result = await mcpManager.readServerResource(targetServer, uri, { signal });
			if (!result) {
				return toolResult<McpReadResourceDetails>({
					serverName: targetServer,
					uri,
					isError: true,
				})
					.text(`Server "${targetServer}" returned no content for "${uri}".`)
					.done();
			}

			const textParts: string[] = [];
			for (const item of result.contents) {
				if (item.text) {
					textParts.push(item.text);
				} else if (item.blob) {
					textParts.push(`[Binary content: ${item.mimeType ?? "unknown"}, base64 length ${item.blob.length}]`);
				}
			}

			return toolResult<McpReadResourceDetails>({
				serverName: targetServer,
				uri,
			})
				.text(textParts.join("\n---\n") || "(empty resource)")
				.done();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return toolResult<McpReadResourceDetails>({
				serverName: targetServer,
				uri,
				isError: true,
			})
				.text(`MCP resource read error: ${message}`)
				.done();
		}
	}
}
