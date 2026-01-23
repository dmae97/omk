import { randomUUID } from "node:crypto";
import { rmSync, statSync } from "node:fs";
import type {
	AgentEvent,
	AgentTool,
	AgentToolContext,
	AgentToolResult,
	AgentToolUpdateCallback,
} from "@oh-my-pi/pi-agent-core";
import type { CursorMcpCall, CursorExecHandlers as ICursorExecHandlers, ToolResultMessage } from "@oh-my-pi/pi-ai";
import { resolveToCwd } from "$c/tools/path-utils";

interface CursorExecBridgeOptions {
	cwd: string;
	tools: Map<string, AgentTool>;
	getToolContext?: () => AgentToolContext | undefined;
	emitEvent?: (event: AgentEvent) => void;
}

function createToolResultMessage(
	toolCallId: string,
	toolName: string,
	result: AgentToolResult<unknown>,
	isError: boolean,
): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId,
		toolName,
		content: result.content,
		details: result.details,
		isError,
		timestamp: Date.now(),
	};
}

function buildToolErrorResult(message: string): AgentToolResult<unknown> {
	return {
		content: [{ type: "text", text: message }],
		details: {},
	};
}

async function executeTool(
	options: CursorExecBridgeOptions,
	toolName: string,
	toolCallId: string,
	args: Record<string, unknown>,
): Promise<ToolResultMessage> {
	const tool = options.tools.get(toolName);
	if (!tool) {
		const result = buildToolErrorResult(`Tool "${toolName}" not available`);
		return createToolResultMessage(toolCallId, toolName, result, true);
	}

	options.emitEvent?.({ type: "tool_execution_start", toolCallId, toolName, args });

	let result: AgentToolResult<unknown>;
	let isError = false;

	const onUpdate: AgentToolUpdateCallback<unknown> | undefined = options.emitEvent
		? (partialResult) => {
				options.emitEvent?.({
					type: "tool_execution_update",
					toolCallId,
					toolName,
					args,
					partialResult,
				});
			}
		: undefined;

	try {
		result = await tool.execute(
			toolCallId,
			args as Record<string, unknown>,
			undefined,
			onUpdate,
			options.getToolContext?.(),
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		result = buildToolErrorResult(message);
		isError = true;
	}

	options.emitEvent?.({ type: "tool_execution_end", toolCallId, toolName, result, isError });

	return createToolResultMessage(toolCallId, toolName, result, isError);
}

async function executeDelete(options: CursorExecBridgeOptions, pathArg: string, toolCallId: string) {
	const toolName = "delete";
	options.emitEvent?.({ type: "tool_execution_start", toolCallId, toolName, args: { path: pathArg } });

	const absolutePath = resolveToCwd(pathArg, options.cwd);
	let isError = false;
	let result: AgentToolResult<unknown>;

	try {
		const stat = statSync(absolutePath, { throwIfNoEntry: false });
		if (!stat) {
			throw new Error(`File not found: ${pathArg}`);
		}
		if (!stat.isFile()) {
			throw new Error(`Path is not a file: ${pathArg}`);
		}

		rmSync(absolutePath);

		const sizeText = stat.size ? ` (${stat.size} bytes)` : "";
		const message = `Deleted ${pathArg}${sizeText}`;
		result = { content: [{ type: "text", text: message }], details: {} };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		result = buildToolErrorResult(message);
		isError = true;
	}

	options.emitEvent?.({ type: "tool_execution_end", toolCallId, toolName, result, isError });
	return createToolResultMessage(toolCallId, toolName, result, isError);
}

function decodeToolCallId(toolCallId?: string): string {
	return toolCallId && toolCallId.length > 0 ? toolCallId : randomUUID();
}

function decodeMcpArgs(rawArgs: Record<string, Uint8Array>): Record<string, unknown> {
	const decoded: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(rawArgs)) {
		const text = new TextDecoder().decode(value);
		try {
			decoded[key] = JSON.parse(text);
		} catch {
			decoded[key] = text;
		}
	}
	return decoded;
}

function formatMcpToolErrorMessage(toolName: string, availableTools: string[]): string {
	const list = availableTools.length > 0 ? availableTools.join(", ") : "none";
	return `MCP tool "${toolName}" not found. Available tools: ${list}`;
}

export class CursorExecHandlers implements ICursorExecHandlers {
	constructor(private options: CursorExecBridgeOptions) {}

	async read(args: Parameters<NonNullable<ICursorExecHandlers["read"]>>[0]) {
		const toolCallId = decodeToolCallId(args.toolCallId);
		const toolResultMessage = await executeTool(this.options, "read", toolCallId, { path: args.path });
		return toolResultMessage;
	}

	async ls(args: Parameters<NonNullable<ICursorExecHandlers["ls"]>>[0]) {
		const toolCallId = decodeToolCallId(args.toolCallId);
		const toolResultMessage = await executeTool(this.options, "ls", toolCallId, { path: args.path });
		return toolResultMessage;
	}

	async grep(args: Parameters<NonNullable<ICursorExecHandlers["grep"]>>[0]) {
		const toolCallId = decodeToolCallId(args.toolCallId);
		const toolResultMessage = await executeTool(this.options, "grep", toolCallId, {
			pattern: args.pattern,
			path: args.path || undefined,
			glob: args.glob || undefined,
			output_mode: args.outputMode || undefined,
			context: args.context ?? args.contextBefore ?? args.contextAfter ?? undefined,
			ignore_case: args.caseInsensitive || undefined,
			type: args.type || undefined,
			head_limit: args.headLimit ?? undefined,
			multiline: args.multiline || undefined,
		});
		return toolResultMessage;
	}

	async write(args: Parameters<NonNullable<ICursorExecHandlers["write"]>>[0]) {
		const toolCallId = decodeToolCallId(args.toolCallId);
		const content = args.fileText ?? new TextDecoder().decode(args.fileBytes ?? new Uint8Array());
		const toolResultMessage = await executeTool(this.options, "write", toolCallId, {
			path: args.path,
			content,
		});
		return toolResultMessage;
	}

	async delete(args: Parameters<NonNullable<ICursorExecHandlers["delete"]>>[0]) {
		const toolCallId = decodeToolCallId(args.toolCallId);
		const toolResultMessage = await executeDelete(this.options, args.path, toolCallId);
		return toolResultMessage;
	}

	async shell(args: Parameters<NonNullable<ICursorExecHandlers["shell"]>>[0]) {
		const toolCallId = decodeToolCallId(args.toolCallId);
		const timeoutSeconds =
			args.timeout && args.timeout > 0
				? args.timeout > 1000
					? Math.ceil(args.timeout / 1000)
					: args.timeout
				: undefined;
		const toolResultMessage = await executeTool(this.options, "bash", toolCallId, {
			command: args.command,
			workdir: args.workingDirectory || undefined,
			timeout: timeoutSeconds,
		});
		return toolResultMessage;
	}

	async diagnostics(args: Parameters<NonNullable<ICursorExecHandlers["diagnostics"]>>[0]) {
		const toolCallId = decodeToolCallId(args.toolCallId);
		const toolResultMessage = await executeTool(this.options, "lsp", toolCallId, {
			action: "diagnostics",
			file: args.path,
		});
		return toolResultMessage;
	}

	async mcp(call: CursorMcpCall) {
		const toolName = call.toolName || call.name;
		const toolCallId = decodeToolCallId(call.toolCallId);
		const tool = this.options.tools.get(toolName);
		if (!tool) {
			const availableTools = Array.from(this.options.tools.keys()).filter((name) => name.startsWith("mcp_"));
			const message = formatMcpToolErrorMessage(toolName, availableTools);
			const toolResult: ToolResultMessage = {
				role: "toolResult",
				toolCallId,
				toolName,
				content: [{ type: "text", text: message }],
				details: {},
				isError: true,
				timestamp: Date.now(),
			};
			return toolResult;
		}

		const args = Object.keys(call.args ?? {}).length > 0 ? call.args : decodeMcpArgs(call.rawArgs ?? {});
		const toolResultMessage = await executeTool(this.options, toolName, toolCallId, args);
		return toolResultMessage;
	}
}
