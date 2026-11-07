#!/usr/bin/env node
/**
 * Connect only the selected enabled MCP servers, report safe status, then join
 * their transport closure. Never prints configured env values or server stderr.
 *
 * Usage: node scripts/mcp-smoke.mjs [serverName ...]
 * OMK_MCP_SMOKE_HANDSHAKE_MS overrides startup_timeout_sec (positive integer ms).
 * Exit 1 means failed/unknown servers or an invalid override, not a healthy probe.
 */
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { loadMcpServerConfigs } = await jiti.import("../packages/coding-agent/src/core/mcp/config.ts");
const { validateMcpTimeoutMs } = await jiti.import("../packages/coding-agent/src/core/mcp/deadline-policy.ts");
const { McpManager } = await jiti.import("../packages/coding-agent/src/core/mcp/manager.ts");
const { mcpPublicDiagnostic } = await jiti.import("../packages/coding-agent/src/core/mcp/public-diagnostic.ts");

async function smoke() {
	const only = new Set(process.argv.slice(2));
	const all = loadMcpServerConfigs(process.cwd());
	if ([...only].some((name) => !all.some((server) => server.name === name))) {
		console.error("Unknown MCP server requested; check the configured names.");
		return 1;
	}
	let handshakeOverride;
	if (process.env.OMK_MCP_SMOKE_HANDSHAKE_MS !== undefined) {
		try {
			handshakeOverride = validateMcpTimeoutMs(Number(process.env.OMK_MCP_SMOKE_HANDSHAKE_MS));
			if (handshakeOverride === 0) throw new RangeError();
		} catch {
			console.error("OMK_MCP_SMOKE_HANDSHAKE_MS must be a positive integer within Node's timer range.");
			return 1;
		}
	}
	const selected = only.size > 0 ? all.filter((server) => only.has(server.name)) : all;
	const servers = selected.filter((server) => !server.disabled);
	const skipped = selected.length - servers.length;
	if (skipped > 0) console.log(`Skipping ${skipped} disabled MCP server(s).`);
	if (servers.length === 0) {
		console.log("No enabled stdio MCP servers configured.");
		return 0;
	}

	console.log(`Connecting ${servers.length} MCP server(s)...\n`);
	const started = Date.now();
	const manager = new McpManager({
		servers: servers.map((server) => ({
			...server,
			...(handshakeOverride === undefined ? {} : { handshakeTimeoutMs: handshakeOverride }),
		})),
		cwd: process.cwd(),
		clientInfo: { name: "omk-mcp-smoke", version: "1" },
	});
	try {
		const tools = await manager.listToolDefinitions();
		let ready = 0;
		for (const status of manager.status()) {
			const mark = status.state === "ready" ? "OK  " : "FAIL";
			if (status.state === "ready") ready++;
			const detail = status.state === "ready" ? `${status.toolCount} tools (v${status.serverVersion ?? "?"})` : status.error;
			console.log(`${mark} ${status.name.padEnd(20)} ${detail}`);
		}
		console.log(`\n${ready}/${servers.length} servers ready, ${tools.length} tools exposed, ${Date.now() - started}ms`);
		return ready === servers.length ? 0 : 1;
	} catch (error) {
		console.error(mcpPublicDiagnostic(error, "connect"));
		return 1;
	} finally {
		await manager.closeAndWait();
	}
}

process.exitCode = await smoke();
