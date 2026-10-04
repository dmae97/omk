/** Structural result boundary for negotiated MCP versions; not an outputSchema validator. */
export interface ValidatedMcpCallResult {
	readonly content: readonly { readonly type: string; readonly [key: string]: unknown }[];
	readonly isError: boolean;
	readonly structuredContent?: Record<string, unknown>;
}
function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function invalid(): never {
	throw new Error("mcp.invalid_tool_result");
}

export function validateMcpCallResult(value: unknown): ValidatedMcpCallResult {
	if (!record(value) || !Array.isArray(value.content)) invalid();
	if (value.isError !== undefined && typeof value.isError !== "boolean") invalid();
	if (value.structuredContent !== undefined && !record(value.structuredContent)) invalid();
	const content: Array<{ type: string; [key: string]: unknown }> = [];
	for (const block of value.content) {
		if (!record(block) || typeof block.type !== "string" || block.type.length === 0) invalid();
		switch (block.type) {
			case "text":
				if (typeof block.text !== "string") invalid();
				break;
			case "image":
			case "audio":
				if (typeof block.data !== "string" || typeof block.mimeType !== "string") invalid();
				break;
			case "resource_link":
				if (typeof block.uri !== "string" || typeof block.name !== "string") invalid();
				break;
			case "resource":
				if (
					!record(block.resource) ||
					typeof block.resource.uri !== "string" ||
					(typeof block.resource.text !== "string" && typeof block.resource.blob !== "string")
				)
					invalid();
				break;
			default:
				// Preserve explicitly typed extension blocks. No safety meaning is inferred.
				break;
		}
		content.push({ ...block, type: block.type });
	}
	return {
		content,
		isError: value.isError === true,
		...(value.structuredContent === undefined
			? {}
			: { structuredContent: value.structuredContent as Record<string, unknown> }),
	};
}
