import type { AgentTool } from "omk-agent-core";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { type CompactionSettings, getCompactionHeadroomThreshold } from "../src/core/compaction/index.ts";
import { serializePromptToolSchemas } from "../src/core/prompt-tool-projection.ts";
import { fitToolSchemas, mcpToolGroup, toolSchemaBudgetTokens } from "../src/core/tool-schema-budget.ts";

const countTokens = (text: string): number => Math.ceil(text.length / 4);
const cost = (tools: readonly AgentTool[]): number => countTokens(serializePromptToolSchemas(tools));
const names = (tools: readonly AgentTool[]): string[] => tools.map((tool) => tool.name);
const groupOf = (name: string): string | undefined => (name.includes("__") ? mcpToolGroup(name) : undefined);

function tool(name: string, descriptionChars: number): AgentTool {
	return {
		name,
		label: name,
		description: "d".repeat(descriptionChars),
		parameters: Type.Object({}),
		execute: async () => ({ content: [], details: {} }),
	};
}

const catalog = [
	tool("read", 400),
	tool("big__query", 4000),
	tool("big__create", 4000),
	tool("mid__search", 2000),
	tool("small__get", 400),
	tool("bash", 400),
];

describe("fitToolSchemas", () => {
	it("sends every tool when the schemas fit the budget", () => {
		const fit = fitToolSchemas({ tools: catalog, groupOf, budgetTokens: cost(catalog), countTokens });

		expect(names(fit.tools)).toEqual(names(catalog));
		expect(fit.withheld).toEqual([]);
	});

	it("withholds whole groups, largest schema first, until the rest fits", () => {
		const budgetTokens = cost(catalog) - 1500;

		const fit = fitToolSchemas({ tools: catalog, groupOf, budgetTokens, countTokens });

		expect(fit.withheld.map((group) => group.group)).toEqual(["big"]);
		expect(fit.withheld[0]?.toolCount).toBe(2);
		expect(fit.withheld[0]?.tokens).toBe(cost(catalog.filter((entry) => entry.name.startsWith("big__"))));
		expect(names(fit.tools)).toEqual(["read", "mid__search", "small__get", "bash"]);
		expect(cost(fit.tools)).toBeLessThanOrEqual(budgetTokens);
	});

	it("always keeps ungrouped tools, even when nothing else fits", () => {
		const fit = fitToolSchemas({ tools: catalog, groupOf, budgetTokens: 0, countTokens });

		expect(names(fit.tools)).toEqual(["read", "bash"]);
		expect(fit.withheld.map((group) => group.group)).toEqual(["big", "mid", "small"]);
	});

	it("breaks equal-cost ties by group name so the selection is stable across turns", () => {
		const tied = [tool("beta__x", 1000), tool("alpha__x", 1000), tool("read", 100)];

		const fit = fitToolSchemas({ tools: tied, groupOf, budgetTokens: cost(tied) - 10, countTokens });

		expect(fit.withheld.map((group) => group.group)).toEqual(["alpha"]);
		expect(names(fit.tools)).toEqual(["beta__x", "read"]);
	});

	it("keeps greedy invariants over generated catalogs", () => {
		let seed = 20260927;
		const random = (): number => {
			seed = (seed * 1103515245 + 12345) % 2147483648;
			return seed / 2147483648;
		};
		for (let run = 0; run < 200; run++) {
			const tools: AgentTool[] = [];
			const toolCount = 1 + Math.floor(random() * 12);
			for (let index = 0; index < toolCount; index++) {
				const grouped = random() < 0.75;
				const name = grouped ? `g${Math.floor(random() * 5)}__t${index}` : `core${index}`;
				tools.push(tool(name, Math.floor(random() * 3000)));
			}
			const budgetTokens = Math.floor(random() * cost(tools) * 1.2);

			const fit = fitToolSchemas({ tools, groupOf, budgetTokens, countTokens });

			const withheldGroups = new Set(fit.withheld.map((group) => group.group));
			const expected = tools.filter((entry) => {
				const group = groupOf(entry.name);
				return group === undefined || !withheldGroups.has(group);
			});
			expect(names(fit.tools)).toEqual(names(expected));
			for (let index = 1; index < fit.withheld.length; index++) {
				expect(fit.withheld[index - 1]?.tokens ?? 0).toBeGreaterThanOrEqual(fit.withheld[index]?.tokens ?? 0);
			}
			const everyGroupWithheld = tools.every((entry) => {
				const group = groupOf(entry.name);
				return group === undefined || withheldGroups.has(group);
			});
			if (!everyGroupWithheld) expect(cost(fit.tools)).toBeLessThanOrEqual(budgetTokens + fit.withheld.length);
			const last = fit.withheld.at(-1);
			if (last) {
				// Minimal in greedy order: without the last withheld group the catalog still overflowed.
				const lessWithheld = tools.filter((entry) => {
					const group = groupOf(entry.name);
					return group === undefined || group === last.group || !withheldGroups.has(group);
				});
				expect(cost(lessWithheld)).toBeGreaterThan(budgetTokens - fit.withheld.length);
			}
		}
	});
});

describe("mcpToolGroup", () => {
	it("returns the server segment of a namespaced MCP tool name", () => {
		expect(mcpToolGroup("notion__notion-query-data-sources")).toBe("notion");
		expect(mcpToolGroup("orphan")).toBe("orphan");
	});
});

describe("toolSchemaBudgetTokens", () => {
	const settings: CompactionSettings = {
		enabled: true,
		reserveTokens: 8192,
		keepRecentTokens: 10000,
		maxUsageRatio: 0.7,
	};

	it("keeps a fully compacted session under the compaction trigger", () => {
		const trigger = getCompactionHeadroomThreshold(262000, settings, 219416)?.triggerTokens ?? 0;

		const budget = toolSchemaBudgetTokens({
			contextWindow: 262000,
			inputCeilingTokens: 219416,
			settings,
			systemPromptTokens: 18429,
		});

		expect(trigger).toBeGreaterThan(0);
		expect(budget).toBe(trigger - (10000 + 8192) - 18429);
	});

	it("uses the hard input ceiling when compaction is disabled", () => {
		const budget = toolSchemaBudgetTokens({
			contextWindow: 262000,
			inputCeilingTokens: 219416,
			settings: { ...settings, enabled: false },
			systemPromptTokens: 18429,
		});

		expect(budget).toBe(219416 - (10000 + 8192) - 18429);
	});

	it("never returns a negative budget", () => {
		expect(
			toolSchemaBudgetTokens({ contextWindow: 8000, inputCeilingTokens: 5000, settings, systemPromptTokens: 9000 }),
		).toBe(0);
	});
});
