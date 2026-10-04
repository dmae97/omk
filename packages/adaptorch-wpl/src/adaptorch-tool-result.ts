/** Decode the canonical MCP text envelope without discarding the decoded evidence fields. */
export function decodeAdaptOrchToolResult(raw: unknown): unknown {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
	const record = raw as Record<string, unknown>;
	if (record.isError === true) throw new Error("AdaptOrch MCP tool reported an error");
	if (!Object.hasOwn(record, "content")) return raw;
	if (!Array.isArray(record.content) || record.content.length !== 1) {
		throw new Error("AdaptOrch MCP tool returned an ambiguous envelope");
	}
	const block = record.content[0];
	if (typeof block !== "object" || block === null || block.type !== "text" || typeof block.text !== "string") {
		throw new Error("AdaptOrch MCP tool returned an invalid text envelope");
	}
	try {
		return JSON.parse(block.text) as unknown;
	} catch {
		throw new Error("AdaptOrch MCP tool returned invalid JSON");
	}
}
