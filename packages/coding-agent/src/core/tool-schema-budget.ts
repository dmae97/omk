import type { AgentTool } from "omk-agent-core";
import { type CompactionSettings, getCompactionHeadroomThreshold } from "./compaction/compaction-headroom.ts";
import { MCP_TOOL_NAME_SEPARATOR } from "./mcp/tools.ts";
import { serializePromptToolSchemas } from "./prompt-tool-projection.ts";

/** A tool group (one MCP server) left out of provider requests because its schemas overflow the budget. */
export interface WithheldToolGroup {
	readonly group: string;
	readonly toolCount: number;
	readonly tokens: number;
}

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
 * A server's tools leave together because they depend on each other. Ungrouped tools are
 * always sent, so an impossible budget still returns them.
 */
export function fitToolSchemas(input: ToolSchemaFitInput): ToolSchemaFit {
	const cost = (tools: readonly AgentTool[]): number => input.countTokens(serializePromptToolSchemas(tools));
	let remaining = cost(input.tools);
	if (remaining <= input.budgetTokens) return { tools: [...input.tools], withheld: [] };
	const members = new Map<string, AgentTool[]>();
	for (const tool of input.tools) {
		const group = input.groupOf(tool.name);
		if (group === undefined) continue;
		const list = members.get(group);
		if (list) list.push(tool);
		else members.set(group, [tool]);
	}
	const ranked = [...members]
		.map(([group, tools]) => ({ group, toolCount: tools.length, tokens: cost(tools) }))
		.sort((left, right) => right.tokens - left.tokens || (left.group < right.group ? -1 : 1));
	const withheld: WithheldToolGroup[] = [];
	for (const group of ranked) {
		if (remaining <= input.budgetTokens) break;
		withheld.push(group);
		// Array serialization is additive up to separators, so one pass prices every group.
		remaining -= group.tokens;
	}
	const dropped = new Set(withheld.map((group) => group.group));
	return { tools: withoutGroups(input.tools, input.groupOf, dropped), withheld };
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
