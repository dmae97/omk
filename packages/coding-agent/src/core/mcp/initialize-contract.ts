function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Validate the negotiated version before a client can publish its ready state. */
export function parseMcpInitializeResult(
	result: unknown,
	serverName: string,
	supportedVersions: readonly string[],
): { readonly name?: string; readonly version?: string } {
	if (!isRecord(result) || typeof result.protocolVersion !== "string") {
		throw new Error(`MCP server "${serverName}" returned an invalid initialize result (missing protocolVersion)`);
	}
	if (!supportedVersions.includes(result.protocolVersion)) {
		throw new Error(`MCP server "${serverName}" requested unsupported protocol version "${result.protocolVersion}"`);
	}
	if (!isRecord(result.serverInfo)) return {};
	const { name, version } = result.serverInfo;
	return {
		name: typeof name === "string" ? name : undefined,
		version: typeof version === "string" ? version : undefined,
	};
}
