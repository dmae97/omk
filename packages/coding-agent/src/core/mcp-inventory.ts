/**
 * Read-only MCP inventory reader.
 *
 * Aggregates MCP server configuration from up to three on-disk sources without
 * starting, stopping, or modifying any server. Secret values from `env` are
 * never exposed — only the key names are returned to callers.
 *
 * Source precedence (later wins on name collision):
 *   1. ~/.kimi/mcp.json           (global, legacy/kimi)
 *   2. ~/.omk/mcp.json            (global, omk)
 *   3. <cwd>/.omk/mcp.json        (project, highest priority)
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface McpServerEntry {
	name: string;
	source: string;
	commandSummary: string;
	envKeys: string[];
	argsCount: number;
	autoApproveCount: number;
	startupTimeoutSec?: number;
	overriddenBy?: string;
}

export interface McpInventory {
	entries: McpServerEntry[];
	sources: { path: string; exists: boolean; serverCount: number }[];
	errors: { path: string; message: string }[];
}

interface RawServer {
	command?: unknown;
	args?: unknown;
	env?: unknown;
	autoApprove?: unknown;
	startup_timeout_sec?: unknown;
}

function readJsonSafe(filePath: string): { value: unknown; error?: string } {
	try {
		const raw = fs.readFileSync(filePath, "utf8");
		return { value: JSON.parse(raw) };
	} catch (err) {
		if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
			return { value: null };
		}
		return { value: null, error: err instanceof Error ? err.message : String(err) };
	}
}

function summarizeCommand(server: RawServer): string {
	if (typeof server.command !== "string" || !server.command) {
		return "<unknown>";
	}
	const base = path.basename(server.command);
	if (Array.isArray(server.args) && server.args.length > 0) {
		const first = server.args.find((a) => typeof a === "string" && !a.startsWith("-")) as string | undefined;
		if (first) {
			return `${base} ${first}`.trim();
		}
	}
	return base;
}

function toEntry(name: string, server: RawServer, source: string): McpServerEntry {
	const envKeys =
		server.env && typeof server.env === "object" && !Array.isArray(server.env)
			? Object.keys(server.env as Record<string, unknown>)
			: [];
	const argsCount = Array.isArray(server.args) ? server.args.length : 0;
	const autoApproveCount = Array.isArray(server.autoApprove) ? server.autoApprove.length : 0;
	const startupTimeoutSec = typeof server.startup_timeout_sec === "number" ? server.startup_timeout_sec : undefined;
	return {
		name,
		source,
		commandSummary: summarizeCommand(server),
		envKeys,
		argsCount,
		autoApproveCount,
		startupTimeoutSec,
	};
}

function extractServers(raw: unknown): Record<string, RawServer> {
	if (!raw || typeof raw !== "object") return {};
	const root = raw as Record<string, unknown>;
	const candidate = root.mcpServers ?? root.servers ?? root.mcp_servers;
	if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return {};
	return candidate as Record<string, RawServer>;
}

/**
 * Build the MCP inventory by merging all configured sources.
 * The returned object is safe to render in the UI — env values are never included.
 */
export function loadMcpInventory(cwd: string = process.cwd(), home: string = os.homedir()): McpInventory {
	const candidatePaths = [
		path.join(home, ".kimi", "mcp.json"),
		path.join(home, ".omk", "mcp.json"),
		path.join(cwd, ".omk", "mcp.json"),
	];

	const sources: McpInventory["sources"] = [];
	const errors: McpInventory["errors"] = [];
	const merged = new Map<string, McpServerEntry>();

	for (const filePath of candidatePaths) {
		const exists = fs.existsSync(filePath);
		const { value, error } = readJsonSafe(filePath);
		if (error) {
			errors.push({ path: filePath, message: error });
		}
		const servers = extractServers(value);
		const names = Object.keys(servers).sort();
		sources.push({ path: filePath, exists, serverCount: names.length });

		for (const name of names) {
			const server = servers[name];
			if (!server || typeof server !== "object") continue;
			const entry = toEntry(name, server as RawServer, filePath);
			const previous = merged.get(name);
			if (previous) {
				previous.overriddenBy = filePath;
			}
			merged.set(name, entry);
		}
	}

	const entries = Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name));
	return { entries, sources, errors };
}
