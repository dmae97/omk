/**
 * AdaptOrch transport that maps introspection tools to fixture or no-op (Wave 2 stub).
 * Production MCP wiring replaces this adapter without changing evaluateCorrectnessWall.
 */

import { AdaptOrchClient, type AdaptOrchTransport } from "./adaptorch-client.ts";
import type { InMemoryAdaptOrchFixture } from "./in-memory-adaptorch.ts";
import { createInMemoryAdaptOrchClient } from "./in-memory-adaptorch.ts";

const INTROSPECTION_TOOLS = new Set(["adaptorch_get_run", "adaptorch_get_artifacts", "adaptorch_get_traces"]);

export type McpIntrospectionMode = "fixture" | "unavailable";

export interface CreateMcpIntrospectionTransportOptions {
	mode: McpIntrospectionMode;
	/** Required when mode is fixture. */
	fixture?: InMemoryAdaptOrchFixture;
}

/**
 * Returns an {@link AdaptOrchClient} backed by fixture runs, or one that fails introspection
 * with a stable error when mode is unavailable (no network).
 */
export function createMcpIntrospectionClient(options: CreateMcpIntrospectionTransportOptions): AdaptOrchClient {
	if (options.mode === "fixture") {
		if (options.fixture === undefined) {
			throw new Error("fixture is required when mode is fixture");
		}
		return createInMemoryAdaptOrchClient(options.fixture);
	}
	const transport: AdaptOrchTransport = {
		async callTool(name: string, _args: Record<string, unknown>) {
			if (INTROSPECTION_TOOLS.has(name)) {
				throw new Error("AdaptOrch MCP transport unavailable (configure MCP or use OA fixture)");
			}
			throw new Error(`unexpected AdaptOrch tool call in unavailable mode: ${name}`);
		},
	};
	return new AdaptOrchClient(transport);
}
