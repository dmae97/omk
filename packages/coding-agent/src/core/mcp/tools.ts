/**
 * Adapt an MCP tool into a harness `ToolDefinition`.
 *
 * Two things make this small:
 * - `validateToolArguments` already accepts a plain JSON Schema, so an MCP
 *   `inputSchema` is passed through with only its root coerced instead of being
 *   re-modelled in TypeBox.
 * - MCP content blocks are already text/image, which is exactly what the
 *   harness renders.
 *
 * Naming: tools are exposed as `<server>__<tool>` so two servers can ship a
 * `search` without colliding, and so a model can tell where a tool came from.
 */

import type { ImageContent, TextContent } from "omk-ai";
import type { TSchema } from "typebox";
import type { AgentToolResult, ToolDefinition } from "../extensions/types.ts";
import type { McpClient, McpContentBlock, McpToolSchema } from "./client.ts";
import { capMcpContent, mcpOutputCapEnabled } from "./output-cap.ts";

/** Tool-name separator between the server label and the server's own tool name. */
export const MCP_TOOL_NAME_SEPARATOR = "__";
/** Providers reject long tool names; this is the common ceiling. */
export const MAX_TOOL_NAME_LENGTH = 64;

/** Empty-object schema used when a server omits `inputSchema`. */
const EMPTY_OBJECT_SCHEMA = { type: "object", properties: {} } as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Coerce a server-supplied schema root into the object shape providers require.
 *
 * Tool arguments always arrive as a JSON object, so a root typed as anything
 * else is a server bug — `mcp-obsidian@1.0.0` answers `tools/list` with
 * `{ "$schema": "http://json-schema.org/draft-07/schema#" }`, and xAI ends the
 * whole run with `400 "tool parameter root must be an object type"`. Fixing it
 * here, at the boundary, degrades one schema instead of the session, and covers
 * every provider rather than only the ones that re-normalize tool payloads.
 *
 * Already-valid schemas are returned by identity: no per-tool copy, and TypeBox
 * symbols and prototypes survive untouched.
 */
function toObjectRootSchema(schema: Record<string, unknown> | undefined): Record<string, unknown> {
	if (!isRecord(schema)) return EMPTY_OBJECT_SCHEMA;
	if (schema.type === "object" && isRecord(schema.properties)) return schema;
	const root: Record<string, unknown> = { ...schema, type: "object" };
	if (!isRecord(root.properties)) root.properties = {};
	return root;
}

export interface McpToolDetails {
	readonly server: string;
	readonly tool: string;
	readonly isError: boolean;
	readonly structuredContent?: unknown;
}

/** Added in front of a label whose first character is not a letter. */
const TOOL_NAME_PREFIX = "mcp_";
/** Stands in for a label that sanitizes to nothing. */
const TOOL_NAME_FALLBACK = "mcp";

/**
 * Reduce an arbitrary label to the character set providers accept for tool names,
 * and guarantee the first character is a letter.
 *
 * The character set alone is not enough. Kimi's anthropic-messages endpoint ends the
 * whole run with `400 "function name is invalid, must start with a letter and can
 * contain letters, numbers, underscores, and dashes"` when any tool name starts with
 * a digit. An MCP server literally named `21st` produced `21st__search`, so every
 * `k3`/`k3.1-pro` request carrying that server's tools failed, while the same request
 * without tools succeeded. Prefixing here degrades the label, not the session.
 *
 * Renaming is visible: an allowlist or deny list that names the old shape (for example
 * `21st__search`) must be updated to `mcp_21st__search`.
 */
export function sanitizeToolNameSegment(segment: string): string {
	const cleaned = segment.replace(/[^a-zA-Z0-9_-]/gu, "_").replace(/_{2,}/gu, "_");
	if (/^[a-zA-Z]/u.test(cleaned)) return cleaned;
	// Leading underscores are dropped so the result does not read as two separators.
	const remainder = cleaned.replace(/^_+/u, "");
	return remainder.length === 0 ? TOOL_NAME_FALLBACK : `${TOOL_NAME_PREFIX}${remainder}`;
}

/**
 * Build the exposed tool name. Over-long names keep the server prefix and
 * truncate the tool segment, because the prefix is what disambiguates.
 */
export function buildMcpToolName(serverName: string, toolName: string): string {
	const server = sanitizeToolNameSegment(serverName);
	const tool = sanitizeToolNameSegment(toolName);
	const full = `${server}${MCP_TOOL_NAME_SEPARATOR}${tool}`;
	if (full.length <= MAX_TOOL_NAME_LENGTH) return full;
	const room = MAX_TOOL_NAME_LENGTH - server.length - MCP_TOOL_NAME_SEPARATOR.length;
	if (room <= 0) return full.slice(0, MAX_TOOL_NAME_LENGTH);
	return `${server}${MCP_TOOL_NAME_SEPARATOR}${tool.slice(0, room)}`;
}

/** Map MCP content blocks onto the harness content union, dropping unrenderable kinds. */
export function mapMcpContent(blocks: readonly McpContentBlock[]): (TextContent | ImageContent)[] {
	const out: (TextContent | ImageContent)[] = [];
	for (const block of blocks) {
		if (block.type === "text" && typeof block.text === "string") {
			out.push({ type: "text", text: block.text });
			continue;
		}
		if (block.type === "image" && typeof block.data === "string" && typeof block.mimeType === "string") {
			out.push({ type: "image", data: block.data, mimeType: block.mimeType });
			continue;
		}
		if (block.type === "resource" && typeof block.resource === "object" && block.resource !== null) {
			const resource = block.resource as Record<string, unknown>;
			if (typeof resource.text === "string") {
				out.push({ type: "text", text: resource.text });
				continue;
			}
		}
		// Unknown block kinds are summarized rather than dropped silently.
		out.push({ type: "text", text: `[unsupported MCP content block: ${String(block.type)}]` });
	}
	return out;
}

export interface CreateMcpToolDefinitionOptions {
	/** Per-call deadline. Falls back to the client's default. */
	readonly callTimeoutMs?: number;
	/**
	 * Outer tool-runner timeout. Set a little above the MCP deadline so a
	 * configured `tool_timeout_sec` is not cut short by a global or prefix default.
	 */
	readonly toolTimeoutMs?: number;
}

/**
 * Wrap one MCP tool. The returned definition executes in `parallel` mode: MCP
 * tools declare no filesystem claims, so the DAG scheduler cannot prove a
 * conflict and must not serialize them by default.
 */
export function createMcpToolDefinition(
	serverName: string,
	client: McpClient,
	tool: McpToolSchema,
	options: CreateMcpToolDefinitionOptions = {},
): ToolDefinition<TSchema, McpToolDetails> {
	const exposedName = buildMcpToolName(serverName, tool.name);
	const parameters = toObjectRootSchema(tool.inputSchema) as unknown as TSchema;

	return {
		name: exposedName,
		label: tool.title ?? tool.name,
		description: tool.description ?? `MCP tool "${tool.name}" from server "${serverName}".`,
		parameters,
		executionMode: "parallel",
		...(options.toolTimeoutMs !== undefined ? { timeoutMs: options.toolTimeoutMs } : {}),
		async execute(toolCallId, params, signal, _onUpdate, ctx): Promise<AgentToolResult<McpToolDetails>> {
			try {
				const result = await client.callTool(tool.name, params, options.callTimeoutMs, signal);
				const mapped = mapMcpContent(result.content);
				const content = mcpOutputCapEnabled()
					? capMcpContent(mapped, () => ({
							sessionFile: ctx?.sessionManager?.getSessionFile?.(),
							cwd: ctx?.cwd ?? process.cwd(),
							toolCallId,
						}))
					: mapped;
				return {
					content: content.length > 0 ? content : [{ type: "text", text: "(no content)" }],
					details: {
						server: serverName,
						tool: tool.name,
						isError: result.isError,
						structuredContent: result.structuredContent,
					},
				};
			} catch (error) {
				// A dead or hung server degrades this one tool call, not the turn.
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: message }],
					details: { server: serverName, tool: tool.name, isError: true },
				};
			}
		},
	};
}
