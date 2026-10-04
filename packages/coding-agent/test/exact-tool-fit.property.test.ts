import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { exactToolFit, type NamedTool } from "../src/core/performance-upgrade/exact-tool-fit.ts";

// OMK_MATH A02 invariants for any counter c: 2^G -> N0, including non-monotone ones: bounded
// recounts, a reported cost that is a recount, overflow only once every unpinned group is
// withheld, a withheld set that is a ranked prefix, and "one group fewer overflows". Monotone
// counters also get the shortest fitting prefix.

interface Scenario {
	readonly tools: NamedTool[];
	readonly groupOf: (name: string) => string | undefined;
	readonly groups: string[];
	readonly pinned: ReadonlySet<string>;
}

const scenario: fc.Arbitrary<Scenario> = fc
	.record({
		groupSizes: fc.array(fc.integer({ min: 1, max: 3 }), { maxLength: 9 }),
		ungrouped: fc.integer({ min: 0, max: 2 }),
		pinnedMask: fc.integer({ min: 0, max: 511 }),
		// Sort keys interleave the groups' tools with each other and with ungrouped tools.
		order: fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 29, maxLength: 29 }),
	})
	.map(({ groupSizes, ungrouped, pinnedMask, order }) => {
		const tools: NamedTool[] = [];
		const groupByName = new Map<string, string>();
		groupSizes.forEach((size, group) => {
			for (let index = 0; index < size; index++) {
				const name = `g${group}__t${index}`;
				tools.push({ name });
				groupByName.set(name, `g${group}`);
			}
		});
		for (let index = 0; index < ungrouped; index++) tools.push({ name: `u${index}` });
		const shuffled = tools
			.map((tool, index) => ({ tool, key: order[index] ?? 0 }))
			.sort((left, right) => left.key - right.key)
			.map(({ tool }) => tool);
		const groups = groupSizes.map((_size, group) => `g${group}`);
		const pinned = new Set(groups.filter((_group, index) => (pinnedMask >> index) & 1));
		return { tools: shuffled, groupOf: (name: string) => groupByName.get(name), groups, pinned };
	});

// fc.double piles up at its bounds, so a budget drawn that way was almost always zero.
const budgetFraction = fc.integer({ min: 0, max: 120 }).map((percent) => percent / 100);
const projectionKey = (tools: readonly NamedTool[]): string => tools.map((tool) => tool.name).join(",");

function kept(input: Scenario, withheld: ReadonlySet<string>): NamedTool[] {
	return input.tools.filter((tool) => {
		const group = input.groupOf(tool.name);
		return group === undefined || !withheld.has(group);
	});
}

/** Documented ranking without trusted utility: largest standalone cost first, then group name. */
function ranking(input: Scenario, count: (tools: readonly NamedTool[]) => number): string[] {
	const withheldable = input.groups.filter((group) => !input.pinned.has(group));
	const cost = new Map(
		withheldable.map((group) => [group, count(input.tools.filter((tool) => input.groupOf(tool.name) === group))]),
	);
	return withheldable.sort((left, right) => (cost.get(right) ?? 0) - (cost.get(left) ?? 0) || (left < right ? -1 : 1));
}

interface Checked {
	readonly order: string[];
	readonly withheld: string[];
	readonly overflow: boolean;
}

function checkInvariants(input: Scenario, budget: number, count: (tools: readonly NamedTool[]) => number): Checked {
	let calls = 0;
	const counted = (tools: readonly NamedTool[]): number => {
		calls++;
		return count(tools);
	};
	const fit = exactToolFit({
		tools: input.tools,
		groupOf: input.groupOf,
		budgetTokens: budget,
		count: counted,
		pinnedGroups: input.pinned,
	});
	const order = ranking(input, count);
	const withheld = fit.withheld.map((entry) => entry.group);

	expect(fit.recounts).toBe(calls);
	expect(fit.recounts).toBeLessThanOrEqual(2 * order.length + 3);
	expect(fit.tokens).toBe(count(fit.tools));
	expect(fit.overflow).toBe(fit.tokens > budget);
	expect(withheld).toEqual(order.slice(0, withheld.length));
	expect(projectionKey(fit.tools)).toBe(projectionKey(kept(input, new Set(withheld))));
	if (count(input.tools) <= budget) expect(withheld).toEqual([]);
	if (fit.overflow) expect(withheld).toEqual(order);
	if (!fit.overflow && withheld.length > 0) {
		const oneFewer = new Set(withheld.slice(0, -1));
		expect(count(kept(input, oneFewer))).toBeGreaterThan(budget);
	}
	return { order, withheld, overflow: fit.overflow };
}

describe("exactToolFit invariants", () => {
	it("hold for arbitrary, non-monotone projection costs", () => {
		let withheldFits = 0;
		fc.assert(
			fc.property(scenario, fc.func(fc.integer({ min: 0, max: 60 })), budgetFraction, (input, price, fraction) => {
				const count = (tools: readonly NamedTool[]): number => price(projectionKey(tools));
				const budget = Math.floor(count(input.tools) * fraction);
				const result = checkInvariants(input, budget, count);
				if (!result.overflow && result.withheld.length > 0) withheldFits++;
			}),
			{ numRuns: 1000, seed: 924_820 },
		);
		expect(withheldFits).toBeGreaterThan(100);
	});

	it("withhold the shortest fitting ranked prefix when costs are monotone", () => {
		const counters = fc.constantFrom("additive", "serialized", "superadditive");
		let withheldFits = 0;
		fc.assert(
			fc.property(
				scenario,
				fc.nat({ max: 8 }),
				fc.func(fc.nat({ max: 12 })),
				counters,
				budgetFraction,
				(input, wrapper, weight, kind, fraction) => {
					// Each counter only grows when a tool is added. The serialized one is ceil(length / 4)
					// over the projection, which is not additive; the superadditive one makes the
					// standalone-cost estimate overshoot, so the downward correction runs.
					const sum = (tools: readonly NamedTool[]): number =>
						tools.reduce((total, tool) => total + 1 + weight(tool.name), 0);
					const count = (tools: readonly NamedTool[]): number => {
						if (kind === "additive") return wrapper + sum(tools);
						if (kind === "superadditive") return wrapper + sum(tools) + Math.floor(sum(tools) ** 2 / 40);
						const wire = tools.map((tool) => ({ name: tool.name, d: "x".repeat(weight(tool.name)) }));
						return Math.ceil(JSON.stringify(wire).length / 4);
					};
					const budget = Math.floor(count(input.tools) * fraction);
					const { order, withheld, overflow } = checkInvariants(input, budget, count);
					const shortest = [...order.keys(), order.length].find(
						(prefix) => count(kept(input, new Set(order.slice(0, prefix)))) <= budget,
					);
					if (shortest === undefined) expect(overflow).toBe(true);
					else expect(withheld).toEqual(order.slice(0, shortest));
					if (!overflow && withheld.length > 0) withheldFits++;
				},
			),
			{ numRuns: 1000, seed: 924_820 },
		);
		expect(withheldFits).toBeGreaterThan(150);
	});
});
