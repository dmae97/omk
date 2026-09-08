// Structural shapes on purpose: importing the core types here would put cli/ in an import cycle.
export interface McpAttachStatus {
	readonly name: string;
	readonly state: string;
	readonly error?: string;
}

/**
 * Startup diagnostics for `AgentSession.attachMcpServers()` results. Ready and
 * intentionally disabled servers are silent; other states remain warnings so
 * broken servers stay visible. Error text never carries env values.
 */
export function mcpAttachDiagnostics(
	statuses: readonly McpAttachStatus[],
): Array<{ type: "warning"; message: string }> {
	return statuses.flatMap((status) => {
		if (status.state === "ready" || (status.state === "failed" && status.error === "disabled by configuration")) {
			return [];
		}
		const reason = status.error ? `: ${status.error}` : "";
		return [{ type: "warning", message: `MCP server "${status.name}" ${status.state}${reason}` }];
	});
}
