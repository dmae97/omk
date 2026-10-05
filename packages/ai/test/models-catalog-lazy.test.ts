import { afterEach, describe, expect, it, vi } from "vitest";
import type { Model, Usage } from "../src/types.ts";

/**
 * models.ts must not evaluate models.generated until getModel/getModels/getProviders.
 * Helpers (modelsAreEqual, clampThinkingLevel, calculateCost) stay catalog-free.
 */
describe("models.generated lazy catalog", () => {
	afterEach(async () => {
		vi.resetModules();
	});

	it("does not load models.generated for helpers-only import", async () => {
		const models = await import("../src/models.ts");
		models.resetBuiltInModelsCatalogForTest();
		expect(models.isBuiltInModelsCatalogLoaded()).toBe(false);

		expect(
			models.modelsAreEqual(
				{ id: "a", provider: "p" } as Model<"openai-completions">,
				{ id: "a", provider: "p" } as Model<"openai-completions">,
			),
		).toBe(true);
		expect(models.isBuiltInModelsCatalogLoaded()).toBe(false);

		const faux = {
			id: "x",
			name: "x",
			api: "openai-completions",
			provider: "mock",
			baseUrl: "http://127.0.0.1",
			reasoning: false,
			input: ["text"] as const,
			cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 1000,
			maxTokens: 100,
		} satisfies Model<"openai-completions">;
		const usage: Usage = {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		};
		models.calculateCost(faux, usage);
		expect(models.isBuiltInModelsCatalogLoaded()).toBe(false);
	});

	it("loads models.generated on first getProviders", async () => {
		const models = await import("../src/models.ts");
		models.resetBuiltInModelsCatalogForTest();
		expect(models.isBuiltInModelsCatalogLoaded()).toBe(false);
		const providers = models.getProviders();
		expect(providers.length).toBeGreaterThan(0);
		expect(models.isBuiltInModelsCatalogLoaded()).toBe(true);
	});
});
