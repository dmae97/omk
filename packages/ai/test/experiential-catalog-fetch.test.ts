import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchExperientialModels } from "../scripts/catalog-experiential.ts";

beforeEach(() => vi.stubEnv("EXPLABS_API_KEY", "fixture-only"));
afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

function catalog(tools = true) {
	return {
		total: 1,
		models: [
			{
				model: {
					slug: "fixture",
					display_name: "Fixture",
					context_window: 128000,
					max_output_tokens: 8192,
					input_modalities: ["text"],
					output_modalities: ["text"],
					supported_params: { tools },
				},
				providers: [
					{ id: "route", provider: "fixture", provider_model_id: "fixture", status: "active", routable: true },
				],
			},
		],
	};
}
function responses(publicBody: unknown, surface: Record<string, unknown>) {
	vi.stubGlobal(
		"fetch",
		vi
			.fn()
			.mockResolvedValueOnce(Response.json(publicBody))
			.mockResolvedValueOnce(Response.json({ data: [{ id: "fixture", ...surface }] })),
	);
}

describe("Experiential catalog fetch boundary", () => {
	it("lets an explicit callable-surface tool rejection override public metadata", async () => {
		responses(catalog(), { supports_tools: false });
		await expect(fetchExperientialModels()).rejects.toThrow("no callable tool-capable");
	});
	it("accepts callable tool support even when public supported_params lags", async () => {
		responses(catalog(false), { supports_tools: true, context_window_tokens: 262144, maximum_output_tokens: 32768 });
		expect(await fetchExperientialModels()).toMatchObject([{ contextWindow: 262144, maxTokens: 32768 }]);
	});
	it("uses callable-surface context and output limits instead of upstream limits", async () => {
		responses(catalog(), { supports_tools: true, context_window_tokens: 262144, maximum_output_tokens: 32768 });
		expect(await fetchExperientialModels()).toMatchObject([{ contextWindow: 262144, maxTokens: 32768 }]);
	});
	it("rejects an incomplete empty page instead of truncating the provider", async () => {
		responses({ total: 1, models: [] }, { supports_tools: true });
		await expect(fetchExperientialModels()).rejects.toThrow("Incomplete Experiential");
	});
});
