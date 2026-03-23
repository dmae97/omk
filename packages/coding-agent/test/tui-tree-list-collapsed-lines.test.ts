import { describe, expect, it } from "bun:test";
import { renderTreeList } from "../src/tui/tree-list";

const stubTheme = {
	fg: (_color: string, text: string) => text,
	tree: { branch: "├", last: "└", vertical: "│", horizontal: "─", hook: "╰" },
} as Parameters<typeof renderTreeList>[1];

describe("renderTreeList maxCollapsedLines", () => {
	it("skips oversized first item instead of rendering broken fragments", () => {
		const largeGroup = Array.from({ length: 15 }, (_, i) => `line-${i}`);
		const smallGroup = ["a", "b"];

		const collapsed = renderTreeList(
			{
				items: [largeGroup, smallGroup],
				expanded: false,
				maxCollapsedLines: 6,
				itemType: "match",
				renderItem: group => group,
			},
			stubTheme,
		);

		const contentLines = collapsed.filter(l => !l.includes("more match"));
		expect(contentLines.length).toBeLessThanOrEqual(6);
		const summaryLine = collapsed.find(l => l.includes("more match"));
		expect(summaryLine).toBeDefined();
	});

	it("fits items within budget and skips those that exceed it", () => {
		const items = [["a", "b"], ["c", "d", "e"], ["f"]];

		const collapsed = renderTreeList(
			{
				items,
				expanded: false,
				maxCollapsedLines: 4,
				itemType: "match",
				renderItem: group => group,
			},
			stubTheme,
		);

		const contentLines = collapsed.filter(l => !l.includes("more match"));
		expect(contentLines.length).toBeLessThanOrEqual(4);
		expect(contentLines.length).toBe(2);
		const summaryLine = collapsed.find(l => l.includes("more match"));
		expect(summaryLine).toBeDefined();
		expect(summaryLine).toContain("2");
	});

	it("does not cap lines in expanded mode", () => {
		const largeGroup = Array.from({ length: 15 }, (_, i) => `line-${i}`);

		const expanded = renderTreeList(
			{
				items: [largeGroup],
				expanded: true,
				maxCollapsedLines: 6,
				itemType: "match",
				renderItem: group => group,
			},
			stubTheme,
		);

		expect(expanded.length).toBe(15);
		expect(expanded.some(l => l.includes("more"))).toBe(false);
	});

	it("shows correct remaining count when multiple items are hidden", () => {
		const items = [
			["a1", "a2", "a3"],
			["b1", "b2", "b3"],
			["c1", "c2"],
		];

		const collapsed = renderTreeList(
			{
				items,
				expanded: false,
				maxCollapsedLines: 4,
				itemType: "change",
				renderItem: group => group,
			},
			stubTheme,
		);

		const summaryLine = collapsed.find(l => l.includes("more change"));
		expect(summaryLine).toBeDefined();
		expect(summaryLine).toContain("2");
	});

	it("renders all items when total lines fit within budget", () => {
		const items = [["a"], ["b"], ["c"]];

		const collapsed = renderTreeList(
			{
				items,
				expanded: false,
				maxCollapsedLines: 10,
				itemType: "item",
				renderItem: group => group,
			},
			stubTheme,
		);

		expect(collapsed.length).toBe(3);
		expect(collapsed.some(l => l.includes("more"))).toBe(false);
	});

	it("uses non-last tree branch when summary line follows", () => {
		const items = [["a"], ["b", "c"]];

		const collapsed = renderTreeList(
			{
				items,
				expanded: false,
				maxCollapsedLines: 1,
				itemType: "item",
				renderItem: group => group,
			},
			stubTheme,
		);

		expect(collapsed.length).toBe(2);
		expect(collapsed[0]).toContain("├");
		expect(collapsed[0]).toContain("a");
		expect(collapsed[1]).toContain("└");
		expect(collapsed[1]).toContain("more item");
	});

	it("uses last tree branch when no summary follows", () => {
		const items = [["a"]];

		const collapsed = renderTreeList(
			{
				items,
				expanded: false,
				maxCollapsedLines: 10,
				itemType: "item",
				renderItem: group => group,
			},
			stubTheme,
		);

		expect(collapsed.length).toBe(1);
		expect(collapsed[0]).toContain("└");
		expect(collapsed.some(l => l.includes("more"))).toBe(false);
	});

	it("budget=0 shows only summary line", () => {
		const items = [["a"], ["b"]];

		const collapsed = renderTreeList(
			{
				items,
				expanded: false,
				maxCollapsedLines: 0,
				itemType: "item",
				renderItem: group => group,
			},
			stubTheme,
		);

		expect(collapsed.length).toBe(1);
		expect(collapsed[0]).toContain("2 more items");
	});

	it("budget exactly matching total lines shows no summary", () => {
		const items = [["a", "b"], ["c"]];

		const collapsed = renderTreeList(
			{
				items,
				expanded: false,
				maxCollapsedLines: 3,
				itemType: "item",
				renderItem: group => group,
			},
			stubTheme,
		);

		expect(collapsed.length).toBe(3);
		expect(collapsed.some(l => l.includes("more"))).toBe(false);
	});

	it("empty items do not inflate remaining count", () => {
		const items = [["a"], [], ["b"]];

		const collapsed = renderTreeList(
			{
				items,
				expanded: false,
				maxCollapsedLines: 10,
				itemType: "item",
				renderItem: group => group,
			},
			stubTheme,
		);

		expect(collapsed.length).toBe(2);
		expect(collapsed.some(l => l.includes("more"))).toBe(false);
	});

	it("maxCollapsed limits items even when line budget has room", () => {
		const items = [["a"], ["b"], ["c"], ["d"]];

		const collapsed = renderTreeList(
			{
				items,
				expanded: false,
				maxCollapsed: 2,
				maxCollapsedLines: 100,
				itemType: "item",
				renderItem: group => group,
			},
			stubTheme,
		);

		const contentLines = collapsed.filter(l => !l.includes("more item"));
		expect(contentLines.length).toBe(2);
		const summaryLine = collapsed.find(l => l.includes("more item"));
		expect(summaryLine).toBeDefined();
		expect(summaryLine).toContain("2");
	});
});
