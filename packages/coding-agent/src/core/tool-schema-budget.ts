import type { AgentTool } from "omk-agent-core";
import { type CompactionSettings, getCompactionHeadroomThreshold } from "./compaction/compaction-headroom.ts";
import { MCP_TOOL_NAME_SEPARATOR } from "./mcp/tools.ts";
import { exactToolFit, type WithheldGroup } from "./performance-upgrade/exact-tool-fit.ts";
import { serializePromptToolSchemas } from "./prompt-tool-projection.ts";

/** A tool group (one MCP server) left out of provider requests because its schemas overflow the budget. */
export type WithheldToolGroup = WithheldGroup;

export interface ToolSchemaFit {
	readonly tools: AgentTool[];
	readonly withheld: readonly WithheldToolGroup[];
}

export interface ToolSchemaFitInput {
	readonly tools: readonly AgentTool[];
	/** Group of a tool that may be withheld; `undefined` marks a tool sent with every request. */
	readonly groupOf: (toolName: string) => string | undefined;
	readonly budgetTokens: number;
	readonly countTokens: (text: string) => number;
}

/** Server segment of a namespaced MCP tool name (`server__tool`). */
export function mcpToolGroup(toolName: string): string {
	const end = toolName.indexOf(MCP_TOOL_NAME_SEPARATOR);
	return end > 0 ? toolName.slice(0, end) : toolName;
}

/** Tools whose group is not withheld, in their original order. */
export function withoutGroups(
	tools: readonly AgentTool[],
	groupOf: (toolName: string) => string | undefined,
	withheld: ReadonlySet<string>,
): AgentTool[] {
	return tools.filter((tool) => {
		const group = groupOf(tool.name);
		return group === undefined || !withheld.has(group);
	});
}

/**
 * Withhold whole groups, largest schema first, until the remaining schemas fit the budget.
 * A server's tools leave together because they depend on each other. The remaining request
 * projection is recounted after each withheld group, because a tokenizer does not price groups
 * additively. Ungrouped tools are always sent, so an impossible budget still returns them and
 * admission's input ceiling, not this fit, decides whether the turn is rejected.
 */
export function fitToolSchemas(input: ToolSchemaFitInput): ToolSchemaFit {
	const fit = exactToolFit({
		tools: input.tools,
		groupOf: input.groupOf,
		budgetTokens: input.budgetTokens,
		count: (tools) => input.countTokens(serializePromptToolSchemas(tools)),
	});
	return { tools: fit.tools, withheld: fit.withheld };
}

export interface ToolSchemaBudgetInput {
	readonly contextWindow: number;
	readonly inputCeilingTokens: number;
	readonly settings: CompactionSettings;
	readonly systemPromptTokens: number;
}

/**
 * Tokens the tool schemas may use while a fully compacted session (kept tail plus summary
 * reserve) still sits under the compaction trigger. Beyond it compaction stops making
 * progress: every turn compacts, and admission finally rejects even an empty history.
 */
export function toolSchemaBudgetTokens(input: ToolSchemaBudgetInput): number {
	const { settings, inputCeilingTokens } = input;
	const trigger = settings.enabled
		? getCompactionHeadroomThreshold(input.contextWindow, settings, inputCeilingTokens)?.triggerTokens
		: undefined;
	const limit = Math.min(trigger ?? inputCeilingTokens, inputCeilingTokens);
	const historyFloor = settings.keepRecentTokens + settings.reserveTokens;
	return Math.max(0, limit - historyFloor - input.systemPromptTokens);
}

/** `notion (45 tools, ~92.7k tokens), runpod (68 tools, ~45.2k tokens)` */
export function describeWithheldToolGroups(withheld: readonly WithheldToolGroup[]): string {
	return withheld
		.map((group) => `${group.group} (${group.toolCount} tools, ~${(group.tokens / 1000).toFixed(1)}k tokens)`)
		.join(", ");
}
