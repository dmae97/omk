/**
 * CustomToolAdapter wraps CustomTool instances into AgentTool for use with the agent.
 */

import type { AgentTool, AgentToolResult, AgentToolUpdateCallback, RenderResultOptions } from "@oh-my-pi/pi-agent-core";
import type { Component } from "@oh-my-pi/pi-tui";
import type { Static, TSchema } from "@sinclair/typebox";
import type { Theme } from "$c/modes/theme/theme";
import type { CustomTool, CustomToolContext, LoadedCustomTool } from "./types";

export class CustomToolAdapter<TParams extends TSchema = TSchema, TDetails = any, TTheme extends Theme = Theme>
	implements AgentTool<TParams, TDetails, TTheme>
{
	name: string;
	label: string;
	description: string;
	parameters: TParams;

	constructor(
		private tool: CustomTool<TParams, TDetails>,
		private getContext: () => CustomToolContext,
	) {
		this.name = tool.name;
		this.label = tool.label ?? "";
		this.description = tool.description;
		this.parameters = tool.parameters;
	}

	execute(
		toolCallId: string,
		params: Static<TParams>,
		signal?: AbortSignal,
		onUpdate?: AgentToolUpdateCallback<TDetails, TParams>,
		context?: CustomToolContext,
	) {
		return this.tool.execute(toolCallId, params, onUpdate, context ?? this.getContext(), signal);
	}

	/** Optional custom rendering for tool call display (returns UI component) */
	renderCall(args: Static<TParams>, theme: TTheme): Component | undefined {
		return this.tool.renderCall?.(args, theme);
	}

	/** Optional custom rendering for tool result display (returns UI component) */
	renderResult(result: AgentToolResult<TDetails>, options: RenderResultOptions, theme: TTheme): Component | undefined {
		return this.tool.renderResult?.(result, options, theme);
	}

	/**
	 * Backward-compatible export of factory function for existing callers.
	 * Prefer CustomToolAdapter constructor directly.
	 */
	static wrap<TParams extends TSchema = TSchema, TDetails = any, TTheme extends Theme = Theme>(
		tool: CustomTool<TParams, TDetails>,
		getContext: () => CustomToolContext,
	): AgentTool<TParams, TDetails, TTheme> {
		return new CustomToolAdapter(tool, getContext);
	}

	/**
	 * Wrap all loaded custom tools into AgentTools.
	 */
	static wrapTools<TParams extends TSchema = TSchema, TDetails = any, TTheme extends Theme = Theme>(
		loadedTools: LoadedCustomTool<TParams, TDetails>[],
		getContext: () => CustomToolContext,
	): AgentTool<TParams, TDetails, TTheme>[] {
		return loadedTools.map((lt) => CustomToolAdapter.wrap(lt.tool, getContext));
	}
}
