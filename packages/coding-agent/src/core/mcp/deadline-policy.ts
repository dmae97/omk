/** Node's timer range is part of the request contract, not an implicit coercion. */
export const MCP_MAX_TIMEOUT_MS = 2_147_483_647;
export function validateMcpTimeoutMs(value: number): number {
	if (!Number.isSafeInteger(value) || value < 0 || value > MCP_MAX_TIMEOUT_MS) {
		throw new RangeError("mcp.invalid_timeout_ms");
	}
	return value;
}
