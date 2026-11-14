import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchGroqModels } from "../scripts/catalog-groq.ts";
import { getModels } from "../src/models.ts";

const committed = getModels("groq");
const row = {
	id: "qwen/qwen3.8-27b",
	name: "Qwen 3.8 27B",
	active: true,
	context_window: 131072,
	max_completion_tokens: 16384,
	input_modalities: ["text", "image"],
	output_modalities: ["text"],
	supported_features: ["tools", "reasoning"],
	pricing: { prompt: "0.0000008", completion: "0.000004", input_cache_read: "0.0000004" },
};
function respond(data: unknown) {
	vi.stubEnv("GROQ_API_KEY", "fixture-only");
	const fetch = vi.fn().mockResolvedValue(Response.json(data));
	vi.stubGlobal("fetch", fetch);
	return fetch;
}
afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

describe("authenticated Groq catalog", () => {
	it("keeps the metadata catalog without a credential and makes no request", async () => {
		vi.stubEnv("GROQ_API_KEY", "");
		const fetch = vi.fn();
		vi.stubGlobal("fetch", fetch);
		expect(await fetchGroqModels(committed)).toEqual(committed);
		expect(fetch).not.toHaveBeenCalled();
	});
	it("uses live tools, modalities, limits and per-token pricing over stale metadata", async () => {
		const fetch = respond({ data: [row] });
		expect(await fetchGroqModels(committed)).toMatchObject([
			{
				id: row.id,
				provider: "groq",
				contextWindow: 131072,
				maxTokens: 16384,
				input: ["text", "image"],
				reasoning: true,
				cost: { input: expect.closeTo(0.8), output: 4, cacheRead: expect.closeTo(0.4) },
			},
		]);
		expect(fetch).toHaveBeenCalledWith(
			"https://api.groq.com/openai/v1/models",
			expect.objectContaining({ redirect: "error" }),
		);
	});
	it("excludes inactive, audio and explicitly non-tool rows", async () => {
		respond({
			data: [
				row,
				{ ...row, id: "inactive", active: false },
				{ ...row, id: "audio", output_modalities: ["speech"] },
				{ ...row, id: "transcription", input_modalities: ["audio"] },
				{ ...row, id: "guard", supported_features: [] },
			],
		});
		expect((await fetchGroqModels(committed)).map((model) => model.id)).toEqual([row.id]);
	});
	it("can join a minimal legacy API row only to known tool metadata", async () => {
		const known = committed[0]!;
		respond({
			data: [
				{ id: known.id, active: true },
				{ id: "unknown", active: true },
			],
		});
		expect((await fetchGroqModels(committed)).map((model) => model.id)).toEqual([known.id]);
	});
	it.each([
		{ data: [] },
		{ data: [row], has_more: true },
		{ data: [row], total: 2 },
		{ data: [row, row] },
		{ data: [{ ...row, context_window: -1 }] },
		{ data: [{ ...row, pricing: { prompt: "NaN" } }] },
		{ data: [{ ...row, pricing: { prompt: "1e308" } }] },
		{ data: [{ ...row, supported_features: "tools" }] },
		{ data: [{ ...row, active: "false" }] },
	])("rejects incomplete or invalid catalogs: %j", async (body) => {
		respond(body);
		await expect(fetchGroqModels(committed)).rejects.toThrow(/Groq/);
	});
	it("does not replace the catalog on an HTTP failure", async () => {
		respond({});
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("forbidden", { status: 403 })));
		await expect(fetchGroqModels(committed)).rejects.toThrow("Groq models HTTP 403");
	});
});
