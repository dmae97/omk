/**
 * MCP Configuration File Writer
 *
 * Utilities for reading/writing .omp/mcp.json files at user or project level.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { isEnoent } from "@oh-my-pi/pi-utils";
import { validateServerConfig } from "./config";
import type { MCPConfigFile, MCPServerConfig } from "./types";

/**
 * Get the path to the MCP config file.
 * @param scope - "user" for ~/.omp/mcp.json or "project" for .omp/mcp.json
 * @param cwd - Current working directory (used for project scope)
 */
export function getMCPConfigPath(scope: "user" | "project", cwd: string): string {
	if (scope === "user") {
		return path.join(os.homedir(), ".omp", "mcp.json");
	}
	return path.join(cwd, ".omp", "mcp.json");
}

/**
 * Read an MCP config file.
 * Returns empty config if file doesn't exist.
 */
export async function readMCPConfigFile(filePath: string): Promise<MCPConfigFile> {
	try {
		const content = await fs.promises.readFile(filePath, "utf-8");
		const parsed = JSON.parse(content) as MCPConfigFile;
		return parsed;
	} catch (error) {
		if (isEnoent(error)) {
			// File doesn't exist, return empty config
			return { mcpServers: {} };
		}
		throw error;
	}
}

/**
 * Write an MCP config file atomically.
 * Creates parent directories if they don't exist.
 */
export async function writeMCPConfigFile(filePath: string, config: MCPConfigFile): Promise<void> {
	// Ensure parent directory exists
	const dir = path.dirname(filePath);
	await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });

	// Write to temp file first (atomic write)
	const tmpPath = `${filePath}.tmp`;
	const content = JSON.stringify(config, null, 2);
	await fs.promises.writeFile(tmpPath, content, { encoding: "utf-8", mode: 0o600 });

	// Rename to final path (atomic on most systems)
	await fs.promises.rename(tmpPath, filePath);
}

/**
 * Validate server name.
 * @returns Error message if invalid, undefined if valid
 */
export function validateServerName(name: string): string | undefined {
	if (!name) {
		return "Server name cannot be empty";
	}
	if (name.length > 100) {
		return "Server name is too long (max 100 characters)";
	}
	// Check for invalid characters (only allow alphanumeric, dash, underscore, dot)
	if (!/^[a-zA-Z0-9_.-]+$/.test(name)) {
		return "Server name can only contain letters, numbers, dash, underscore, and dot";
	}
	return undefined;
}

/**
 * Add an MCP server to a config file.
 * Validates the config before writing.
 *
 * @throws Error if server name already exists or validation fails
 */
export async function addMCPServer(filePath: string, name: string, config: MCPServerConfig): Promise<void> {
	// Validate server name
	const nameError = validateServerName(name);
	if (nameError) {
		throw new Error(nameError);
	}

	// Validate the config
	const errors = validateServerConfig(name, config);
	if (errors.length > 0) {
		throw new Error(`Invalid server config: ${errors.join("; ")}`);
	}

	// Read existing config
	const existing = await readMCPConfigFile(filePath);

	// Check for duplicate name
	if (existing.mcpServers?.[name]) {
		throw new Error(`Server "${name}" already exists in ${filePath}`);
	}

	// Add server
	const updated: MCPConfigFile = {
		...existing,
		mcpServers: {
			...existing.mcpServers,
			[name]: config,
		},
	};

	// Write back
	await writeMCPConfigFile(filePath, updated);
}

/**
 * Update an existing MCP server in a config file.
 * If the server doesn't exist, this will add it.
 *
 * @throws Error if validation fails
 */
export async function updateMCPServer(filePath: string, name: string, config: MCPServerConfig): Promise<void> {
	// Validate server name
	const nameError = validateServerName(name);
	if (nameError) {
		throw new Error(nameError);
	}

	// Validate the config
	const errors = validateServerConfig(name, config);
	if (errors.length > 0) {
		throw new Error(`Invalid server config: ${errors.join("; ")}`);
	}

	// Read existing config
	const existing = await readMCPConfigFile(filePath);

	// Update server
	const updated: MCPConfigFile = {
		...existing,
		mcpServers: {
			...existing.mcpServers,
			[name]: config,
		},
	};

	// Write back
	await writeMCPConfigFile(filePath, updated);
}

/**
 * Remove an MCP server from a config file.
 *
 * @throws Error if server doesn't exist
 */
export async function removeMCPServer(filePath: string, name: string): Promise<void> {
	// Read existing config
	const existing = await readMCPConfigFile(filePath);

	// Check if server exists
	if (!existing.mcpServers?.[name]) {
		throw new Error(`Server "${name}" not found in ${filePath}`);
	}

	// Remove server
	const { [name]: _removed, ...remaining } = existing.mcpServers;
	const updated: MCPConfigFile = {
		...existing,
		mcpServers: remaining,
	};

	// Write back
	await writeMCPConfigFile(filePath, updated);
}

/**
 * Get a specific server config from a file.
 * Returns undefined if server doesn't exist.
 */
export async function getMCPServer(filePath: string, name: string): Promise<MCPServerConfig | undefined> {
	const config = await readMCPConfigFile(filePath);
	return config.mcpServers?.[name];
}

/**
 * List all server names in a config file.
 */
export async function listMCPServers(filePath: string): Promise<string[]> {
	const config = await readMCPConfigFile(filePath);
	return Object.keys(config.mcpServers ?? {});
}
