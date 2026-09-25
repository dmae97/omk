import type { AgentTool } from "omk-agent-core";

/** Price provider tool schemas, not executable objects, labels or runtime state. */
export function serializePromptToolSchemas(tools: readonly AgentTool[]): string {
	try {
		const wire = tools.map((tool) => ({
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters,
		}));
		return JSON.stringify(wire);
	} catch {
		// Never interpolate schema data or arbitrary getter/serializer failures.
		throw new TypeError("tool schemas are not JSON-serializable");
	}
}
