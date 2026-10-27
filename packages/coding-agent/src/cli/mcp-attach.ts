/**
 * `OMK_SESSION_CONTROL`: default on; `0`/`false`/`off` opts out (inline parse: importing core/env-flag here would
 * add a cli/ edge). `required` is true only when the variable is set to a non-opt-out value: then a control start
 * failure closes the session and throws as before. By default an unsupported session (Windows, `--no-session`, not
 * owned) just runs without live control.
 */
export function sessionControlMode(raw: string | undefined = process.env.OMK_SESSION_CONTROL): {
	readonly enabled: boolean;
	readonly required: boolean;
} {
	if (raw === undefined) return { enabled: true, required: false };
	const enabled = !["0", "false", "off"].includes(raw.trim().toLowerCase());
	return { enabled, required: enabled };
}

// Structural shapes on purpose: importing the core types here would put cli/ in an import cycle.
export async function attachSessionTransports(
	session: {
		attachMcpServers(): Promise<McpAttachStatus[]>;
		startControl(): Promise<void>;
		close(): Promise<void>;
	},
	control: boolean | { readonly enabled: boolean; readonly required: boolean } = sessionControlMode(),
): Promise<Array<{ type: "warning"; message: string }>> {
	const mode = typeof control === "boolean" ? { enabled: control, required: control } : control;
	const diagnostics = mcpAttachDiagnostics(await session.attachMcpServers());
	if (mode.enabled) {
		try {
			await session.startControl();
		} catch (error) {
			if (!mode.required) return diagnostics;
			await session.close();
			throw error;
		}
	}
	return diagnostics;
}

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
