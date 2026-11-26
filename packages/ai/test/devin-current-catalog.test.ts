import { describe, expect, it } from "vitest";
import { devinModels } from "../scripts/catalog-devin.ts";

const models = devinModels();
const model = (id: string) => models.find((entry) => entry.id === id);

describe("Devin account catalog refreshed 2026-10-13", () => {
	it.each([
		"gpt-6-sol-medium",
		"gpt-6-luna-medium",
		"gpt-6-1-sol-medium",
		"gpt-6-1-sol-max-priority",
		"claude-opus-5-5-medium",
		"claude-sonnet-5-5-medium",
		"claude-haiku-5-5-medium",
		"grok-4-7-xhigh",
		"swe-2-1-max",
		"swe-2-flash-max",
	])("includes the server-declared lane %s", (id) => {
		expect(model(id)).toBeDefined();
	});

	it("keeps GPT-6 no-thinking lanes separate from fixed max/priority lanes", () => {
		expect(model("gpt-6-luna-none")?.reasoning).toBe(false);
		expect(model("gpt-6-sol-none-priority")?.thinkingLevelMap).toBeUndefined();
		const fixed = model("gpt-6-1-sol-max-priority");
		expect(fixed?.contextWindow).toBe(1000000);
		expect(fixed?.maxTokens).toBe(128000);
		expect(Object.entries(fixed?.thinkingLevelMap ?? {}).filter(([, value]) => value !== null)).toEqual([
			["max", "max"],
		]);
	});

	it("does not retain unlisted legacy routes or duplicate SWE-2 physical lanes", () => {
		expect(models).toHaveLength(259);
		expect(new Set(models.map((entry) => entry.id)).size).toBe(models.length);
		for (const id of [
			"MODEL_PRIVATE_2",
			"MODEL_PRIVATE_3",
			"inkling-high",
			"swe-2-high",
			"swe-2-medium",
			"swe-2-max",
		]) {
			expect(model(id)).toBeUndefined();
		}
		expect(model("swe-2")?.thinkingLevelMap?.max).toBe("max");
	});
});
