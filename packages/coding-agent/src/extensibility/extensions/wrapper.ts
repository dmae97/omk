/**
 * Tool wrappers for extensions.
 */

import type { AgentTool, AgentToolContext, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import type { ImageContent, TextContent } from "@oh-my-pi/pi-ai";
import type { Static, TSchema } from "@sinclair/typebox";
import type { Theme } from "$c/modes/theme/theme";
import type { ExtensionRunner } from "./runner";
import type { RegisteredTool, ToolCallEventResult, ToolResultEventResult } from "./types";

/**
 * Adapts a RegisteredTool into an AgentTool.
 */
export class RegisteredToolAdapter implements AgentTool<any, any, any> {
	readonly name: string;
	readonly label: string;
	readonly description: string;
	readonly parameters: any;

	constructor(
		private registeredTool: RegisteredTool,
		private runner: ExtensionRunner,
	) {
		const { definition } = registeredTool;
		this.name = definition.name;
		this.label = definition.label || "";
		this.description = definition.description;
		this.parameters = definition.parameters;
	}

	async execute(
		toolCallId: string,
		params: any,
		signal?: AbortSignal,
		onUpdate?: AgentToolUpdateCallback<any>,
		_context?: AgentToolContext,
	) {
		return this.registeredTool.definition.execute(toolCallId, params, onUpdate, this.runner.createContext(), signal);
	}

	renderCall?(args: any, theme: any) {
		return this.registeredTool.definition.renderCall?.(args, theme as Theme);
	}

	renderResult?(result: any, options: any, theme: any) {
		return this.registeredTool.definition.renderResult?.(
			result,
			{ expanded: options.expanded, isPartial: options.isPartial, spinnerFrame: options.spinnerFrame },
			theme as Theme,
		);
	}
}

/**
 * Backward-compatible factory function wrapper.
 */
export function wrapRegisteredTool(registeredTool: RegisteredTool, runner: ExtensionRunner): AgentTool {
	return new RegisteredToolAdapter(registeredTool, runner);
}

/**
 * Wrap all registered tools into AgentTools.
 */
export function wrapRegisteredTools(registeredTools: RegisteredTool[], runner: ExtensionRunner): AgentTool[] {
	return registeredTools.map((rt) => wrapRegisteredTool(rt, runner));
}

/**
 * Wraps a tool with extension callbacks for interception.
 * - Emits tool_call event before execution (can block)
 * - Emits tool_result event after execution (can modify result)
 */
export class ExtensionToolWrapper<TParameters extends TSchema = TSchema, TDetails = unknown>
	implements AgentTool<TParameters, TDetails>
{
	name: string;
	label: string;
	description: string;
	parameters: TParameters;
	renderCall?: AgentTool<TParameters, TDetails>["renderCall"];
	renderResult?: AgentTool<TParameters, TDetails>["renderResult"];

	constructor(
		private tool: AgentTool<TParameters, TDetails>,
		private runner: ExtensionRunner,
	) {
		this.name = tool.name;
		this.label = tool.label ?? "";
		this.description = tool.description;
		this.parameters = tool.parameters;
		this.renderCall = tool.renderCall;
		this.renderResult = tool.renderResult;
	}

	async execute(
		toolCallId: string,
		params: Static<TParameters>,
		signal?: AbortSignal,
		onUpdate?: AgentToolUpdateCallback<TDetails, TParameters>,
		context?: AgentToolContext,
	) {
		// Emit tool_call event - extensions can block execution
		if (this.runner.hasHandlers("tool_call")) {
			try {
				const callResult = (await this.runner.emitToolCall({
					type: "tool_call",
					toolName: this.tool.name,
					toolCallId,
					input: params as Record<string, unknown>,
				})) as ToolCallEventResult | undefined;

				if (callResult?.block) {
					const reason = callResult.reason || "Tool execution was blocked by an extension";
					throw new Error(reason);
				}
			} catch (err) {
				if (err instanceof Error) {
					throw err;
				}
				throw new Error(`Extension failed, blocking execution: ${String(err)}`);
			}
		}

		// Execute the actual tool
		let result: { content: any; details?: TDetails };
		let executionError: Error | undefined;

		try {
			result = await this.tool.execute(toolCallId, params, signal, onUpdate, context);
		} catch (err) {
			executionError = err instanceof Error ? err : new Error(String(err));
			result = {
				content: [{ type: "text", text: executionError.message }],
				details: undefined as TDetails,
			};
		}

		// Emit tool_result event - extensions can modify the result and error status
		if (this.runner.hasHandlers("tool_result")) {
			const resultResult = (await this.runner.emit({
				type: "tool_result",
				toolName: this.tool.name,
				toolCallId,
				input: params as Record<string, unknown>,
				content: result.content,
				details: result.details,
				isError: !!executionError,
			})) as ToolResultEventResult | undefined;

			if (resultResult) {
				const modifiedContent: (TextContent | ImageContent)[] = resultResult.content ?? result.content;
				const modifiedDetails = (resultResult.details ?? result.details) as TDetails;

				// Extension can override error status
				if (resultResult.isError === true && !executionError) {
					// Extension marks a successful result as error
					const textBlocks = (modifiedContent ?? []).filter((c): c is TextContent => c.type === "text");
					const errorText = textBlocks.map((t) => t.text).join("\n") || "Tool result marked as error by extension";
					throw new Error(errorText);
				}
				if (resultResult.isError === false && executionError) {
					// Extension clears the error - return success
					return { content: modifiedContent, details: modifiedDetails };
				}

				// Error status unchanged, but content/details may be modified
				if (executionError) {
					throw executionError;
				}
				return { content: modifiedContent, details: modifiedDetails };
			}
		}

		// No extension modification
		if (executionError) {
			throw executionError;
		}
		return result;
	}
}
