/**
 * Live AdaptOrch MCP transport adapter (Wave 4) — inject session `callTool` at the boundary.
 */

import { AdaptOrchClient, type AdaptOrchTransport } from "./adaptorch-client.ts";

export type AdaptOrchCallToolFn = AdaptOrchTransport["callTool"];

/**
 * Build an {@link AdaptOrchClient} that forwards introspection (and other) tools to MCP.
 * Caller supplies `callTool` from an MCP SDK or harness; this package does not open network I/O.
 */
export function createLiveAdaptOrchClient(callTool: AdaptOrchCallToolFn): AdaptOrchClient {
	const transport: AdaptOrchTransport = { callTool };
	return new AdaptOrchClient(transport);
}

/** Env `OMK_WALL_OA_TRANSPORT`: fixture (default) | mcp | live (alias of mcp). */
export type OaTransportMode = "fixture" | "mcp";

export function parseOaTransportModeFromEnv(): OaTransportMode {
	const raw = process.env.OMK_WALL_OA_TRANSPORT?.trim().toLowerCase();
	if (raw === "mcp" || raw === "live") return "mcp";
	return "fixture";
}
