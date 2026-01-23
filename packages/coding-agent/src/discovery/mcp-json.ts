/**
 * MCP JSON Provider
 *
 * Discovers standalone mcp.json / .mcp.json files in the project root.
 * This is a fallback for projects that have a standalone mcp.json without any config directory.
 *
 * Priority: 5 (low, as this is a fallback after tool-specific providers)
 */

import { join } from "node:path";
import { readFile } from "$c/capability/fs";
import { registerProvider } from "$c/capability/index";
import { type MCPServer, mcpCapability } from "$c/capability/mcp";
import type { LoadContext, LoadResult, SourceMeta } from "$c/capability/types";
import { createSourceMeta, expandEnvVarsDeep, parseJSON } from "./helpers";

const PROVIDER_ID = "mcp-json";
const DISPLAY_NAME = "MCP Config";

/**
 * Raw MCP JSON format (matches Claude Desktop's format).
 */
interface MCPConfigFile {
	mcpServers?: Record<
		string,
		{
			command?: string;
			args?: string[];
			env?: Record<string, string>;
			url?: string;
			headers?: Record<string, string>;
			type?: "stdio" | "sse" | "http";
		}
	>;
}

/**
 * Transform raw MCP config to canonical MCPServer format.
 */
function transformMCPConfig(config: MCPConfigFile, source: SourceMeta): MCPServer[] {
	const servers: MCPServer[] = [];

	if (config.mcpServers) {
		for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
			const server: MCPServer = {
				name,
				command: serverConfig.command,
				args: serverConfig.args,
				env: serverConfig.env,
				url: serverConfig.url,
				headers: serverConfig.headers,
				transport: serverConfig.type,
				_source: source,
			};

			// Expand environment variables
			if (server.command) server.command = expandEnvVarsDeep(server.command);
			if (server.args) server.args = expandEnvVarsDeep(server.args);
			if (server.env) server.env = expandEnvVarsDeep(server.env);
			if (server.url) server.url = expandEnvVarsDeep(server.url);
			if (server.headers) server.headers = expandEnvVarsDeep(server.headers);

			servers.push(server);
		}
	}

	return servers;
}

/**
 * Load MCP servers from a JSON file.
 */
async function loadMCPJsonFile(
	_ctx: LoadContext,
	path: string,
	level: "user" | "project",
): Promise<LoadResult<MCPServer>> {
	const warnings: string[] = [];
	const items: MCPServer[] = [];

	const content = await readFile(path);
	if (content === null) {
		return { items, warnings };
	}

	const config = parseJSON<MCPConfigFile>(content);
	if (!config) {
		warnings.push(`Failed to parse JSON in ${path}`);
		return { items, warnings };
	}

	const source = createSourceMeta(PROVIDER_ID, path, level);
	const servers = transformMCPConfig(config, source);
	items.push(...servers);

	return { items, warnings };
}

/**
 * MCP JSON Provider loader.
 */
async function load(ctx: LoadContext): Promise<LoadResult<MCPServer>> {
	const filenames = ["mcp.json", ".mcp.json"];
	const results = await Promise.all(
		filenames.map((filename) => loadMCPJsonFile(ctx, join(ctx.cwd, filename), "project")),
	);

	const allItems = results.flatMap((r) => r.items);
	const allWarnings = results.flatMap((r) => r.warnings ?? []);

	return {
		items: allItems,
		warnings: allWarnings.length > 0 ? allWarnings : undefined,
	};
}

// Register provider
registerProvider(mcpCapability.id, {
	id: PROVIDER_ID,
	displayName: DISPLAY_NAME,
	description: "Load MCP servers from standalone mcp.json or .mcp.json in project root",
	priority: 5,
	load,
});
