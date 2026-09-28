import { describe, expect, it } from "vitest";
import { type AdmissionKeyInput, admissionKey } from "../src/core/performance-upgrade/admission-key.ts";
import { exactToolFit } from "../src/core/performance-upgrade/exact-tool-fit.ts";

interface Named {
	readonly name: string;
}

describe("exactToolFit", () => {
	const groupOf = (name: string): string | undefined => (name.includes("__") ? name.split("__")[0] : undefined);
	const perRequest = (tools: readonly Named[]): number => 10 + 5 * tools.length;
	const names = (tools: readonly Named[]): string[] => tools.map((tool) => tool.name);
	const catalog: Named[] = [{ name: "read" }, { name: "a__1" }, { name: "a__2" }, { name: "b__1" }, { name: "b__2" }];

	it("reports the recounted cost and never hides ungrouped tools on overflow", () => {
		const fit = exactToolFit({ tools: catalog, groupOf, budgetTokens: 5, count: perRequest });

		expect(names(fit.tools)).toEqual(["read"]);
		expect(fit.tokens).toBe(perRequest([{ name: "read" }]));
		expect(fit.overflow).toBe(true);
	});

	it("returns the input untouched with one count when it already fits", () => {
		const fit = exactToolFit({ tools: catalog, groupOf, budgetTokens: 100, count: perRequest });

		expect(names(fit.tools)).toEqual(names(catalog));
		expect(fit.withheld).toEqual([]);
		expect(fit.recounts).toBe(1);
	});

	it("keeps pinned groups and withholds the lowest trusted utility density first", () => {
		const utility = new Map([
			["a", 1],
			["b", 9],
		]);
		const pinned = exactToolFit({
			tools: catalog,
			groupOf,
			budgetTokens: 30,
			count: perRequest,
			pinnedGroups: new Set(["a"]),
		});
		const valued = exactToolFit({
			tools: catalog,
			groupOf,
			budgetTokens: 30,
			count: perRequest,
			utilityOfGroup: (group) => utility.get(group) ?? 0,
		});

		expect(names(pinned.tools)).toEqual(["read", "a__1", "a__2"]);
		expect(names(valued.tools)).toEqual(["read", "b__1", "b__2"]);
		expect(valued.withheld.map((group) => group.group)).toEqual(["a"]);
	});

	it("withholds the shortest sufficient prefix with a bounded number of recounts", () => {
		const groups = Array.from({ length: 20 }, (_, index) => ({ name: `g${String(index).padStart(2, "0")}__tool` }));
		const tools: Named[] = [{ name: "read" }, ...groups];
		// 21 tools cost 115; withholding exactly ten single-tool groups reaches 65.
		const fit = exactToolFit({ tools, groupOf, budgetTokens: 65, count: perRequest });

		expect(fit.withheld).toHaveLength(10);
		expect(fit.tokens).toBe(65);
		expect(fit.overflow).toBe(false);
		// Initial count, one per group, the empty wrapper, then verify and confirm the prefix.
		expect(fit.recounts).toBeLessThanOrEqual(1 + groups.length + 1 + 2);
	});

	it("rejects an invalid budget, counter result or utility", () => {
		expect(() => exactToolFit({ tools: catalog, groupOf, budgetTokens: Number.NaN, count: perRequest })).toThrow(
			RangeError,
		);
		expect(() => exactToolFit({ tools: catalog, groupOf, budgetTokens: 1, count: () => Number.NaN })).toThrow(
			/invalid cost/u,
		);
		expect(() =>
			exactToolFit({ tools: catalog, groupOf, budgetTokens: 1, count: perRequest, utilityOfGroup: () => -1 }),
		).toThrow(/utility/u);
	});
});

describe("admissionKey", () => {
	const base: AdmissionKeyInput = {
		provider: "test",
		modelId: "model",
		contextWindow: 262_000,
		ceiling: 219_416,
		settings: { enabled: true, reserveTokens: 8192 },
		systemPrompt: "system",
		counterId: "counter",
		counterEpoch: 1,
		schemas: '[{"name":"read"}]',
		toolGroups: [["read", null]],
	};

	it("is a stable content hash that changes with every fitted input", () => {
		expect(admissionKey(base)).toMatch(/^[0-9a-f]{64}$/u);
		expect(admissionKey({ ...base })).toBe(admissionKey(base));
		const variants: AdmissionKeyInput[] = [
			{ ...base, modelId: "other" },
			{ ...base, provider: "other" },
			// Same joined `provider/id` text, different split.
			{ ...base, provider: "test/model", modelId: "" },
			{ ...base, contextWindow: 128_000 },
			{ ...base, ceiling: 100_000 },
			{ ...base, settings: { enabled: false, reserveTokens: 8192 } },
			{ ...base, systemPrompt: "System" },
			{ ...base, counterId: "other" },
			{ ...base, counterEpoch: 2 },
			{ ...base, schemas: '[{"name":"read","description":"x"}]' },
			{ ...base, toolGroups: [["read", "mcp"]] },
		];
		for (const variant of variants) expect(admissionKey(variant)).not.toBe(admissionKey(base));
	});
});
