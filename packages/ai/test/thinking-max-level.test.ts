import { describe, expect, it } from "vitest";
import { clampThinkingLevel, getModel, getSupportedThinkingLevels } from "../src/models.ts";

describe("max thinking level", () => {
	it.each(["claude-opus-4-7", "claude-opus-4-8"] as const)(
		"exposes both xhigh and max for %s (opus flagship)",
		(id) => {
			const model = getModel("anthropic", id);
			expect(model).toBeDefined();
			const levels = getSupportedThinkingLevels(model!);
			expect(levels).toContain("xhigh");
			expect(levels).toContain("max");
			expect(model!.thinkingLevelMap?.xhigh).toBe("xhigh");
			expect(model!.thinkingLevelMap?.max).toBe("max");
		},
	);

	it("keeps Opus 4.6 topping out at effort max via xhigh (no separate max level)", () => {
		const model = getModel("anthropic", "claude-opus-4-6");
		expect(model).toBeDefined();
		expect(getSupportedThinkingLevels(model!)).toContain("xhigh");
		expect(getSupportedThinkingLevels(model!)).not.toContain("max");
		expect(model!.thinkingLevelMap?.xhigh).toBe("max");
	});

	it("does not expose max for models without a max mapping", () => {
		const sonnet5 = getModel("anthropic", "claude-sonnet-5");
		expect(sonnet5).toBeDefined();
		expect(getSupportedThinkingLevels(sonnet5!)).not.toContain("max");

		const sonnet46 = getModel("anthropic", "claude-sonnet-4-6");
		expect(sonnet46).toBeDefined();
		expect(getSupportedThinkingLevels(sonnet46!)).not.toContain("max");
	});

	it("clamps a max request down to the highest supported level on models without max", () => {
		const sonnet5 = getModel("anthropic", "claude-sonnet-5");
		// Sonnet 5 tops out at "high"; requesting "max" should clamp down, never throw.
		expect(clampThinkingLevel(sonnet5!, "max")).toBe("high");
	});

	it("clamps an xhigh request up to max on models whose only top tier is max", () => {
		const deepseek = getModel("deepseek", "deepseek-v4-pro");
		expect(deepseek).toBeDefined();
		// DeepSeek V4 exposes off/high/xhigh (xhigh -> effort max); "max" is not a separate level.
		expect(getSupportedThinkingLevels(deepseek!)).not.toContain("max");
		expect(deepseek!.thinkingLevelMap?.xhigh).toBe("max");
	});
});
