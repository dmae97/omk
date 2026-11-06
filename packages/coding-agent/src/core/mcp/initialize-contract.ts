import { McpFailure } from "./failure.ts";

/** Protocol revision this client offers; matches LATEST_PROTOCOL_VERSION of @modelcontextprotocol/sdk 1.32. */
export const MCP_PROTOCOL_VERSION = "2025-11-25";
/**
 * Protocol revisions this client accepts from a server. A server that does not
 * speak the offered revision answers with its own latest one, so every older
 * stdio revision whose tools surface this client uses is listed. The handshake
 * fails closed on any other value instead of guessing at forward compatibility.
 */
export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [
	"2024-11-05",
	"2025-03-26",
	"2025-06-18",
	MCP_PROTOCOL_VERSION,
];

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
		throw new McpFailure(
			"mcp.invalid_initialize_result",
			`MCP server "${serverName}" returned an invalid initialize result (missing protocolVersion)`,
		);
	}
	if (!supportedVersions.includes(result.protocolVersion)) {
		throw new McpFailure(
			"mcp.unsupported_protocol",
			`MCP server "${serverName}" requested unsupported protocol version "${result.protocolVersion}"`,
		);
	}
	if (!isRecord(result.serverInfo)) return {};
	const { name, version } = result.serverInfo;
	return {
		name: typeof name === "string" ? name : undefined,
		version: typeof version === "string" ? version : undefined,
	};
}
