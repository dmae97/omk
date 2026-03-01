import { afterEach, describe, expect, it, vi } from "bun:test";
import { githubCopilotModelManagerOptions } from "../src/provider-models/openai-compat";

const originalFetch = global.fetch;

afterEach(() => {
	global.fetch = originalFetch;
	vi.restoreAllMocks();
});

function getHeaderValue(headers: unknown, key: string): string | undefined {
	if (!headers) return undefined;
	if (headers instanceof Headers) {
		return headers.get(key) ?? undefined;
	}
	if (Array.isArray(headers)) {
		for (const item of headers) {
			if (!Array.isArray(item) || item.length < 2) continue;
			const [name, value] = item;
			if (typeof name === "string" && name.toLowerCase() === key.toLowerCase() && typeof value === "string") {
				return value;
			}
		}
		return undefined;
	}
	if (typeof headers === "object") {
		for (const [name, value] of Object.entries(headers as Record<string, unknown>)) {
			if (name.toLowerCase() === key.toLowerCase() && typeof value === "string") {
				return value;
			}
		}
	}
	return undefined;
}

async function discoverCopilotModels(payload: unknown) {
	const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input.toString();
		expect(url).toBe("https://api.individual.githubcopilot.com/models");
		expect(init?.method).toBe("GET");
		expect(getHeaderValue(init?.headers, "Authorization")).toBe("Bearer copilot-test-key");
		return new Response(JSON.stringify(payload), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	});
	global.fetch = fetchMock as unknown as typeof fetch;

	const options = githubCopilotModelManagerOptions({ apiKey: "copilot-test-key" });
	expect(options.fetchDynamicModels).toBeDefined();
	const models = await options.fetchDynamicModels?.();
	expect(models).not.toBeNull();
	return { models: models ?? [], fetchMock };
}

describe("github copilot model limits mapping", () => {
	it("uses capabilities.limits max_prompt_tokens as context window when context_length is absent", async () => {
		const { models, fetchMock } = await discoverCopilotModels({
			data: [
				{
					id: "gemini-2.5-pro",
					name: "Gemini 2.5 Pro",
					capabilities: {
						limits: {
							max_context_window_tokens: 1_048_576,
							max_prompt_tokens: 128_000,
							max_output_tokens: 64_000,
						},
					},
				},
			],
		});

		const model = models.find(candidate => candidate.id === "gemini-2.5-pro");
		expect(model).toBeDefined();
		expect(model?.contextWindow).toBe(128_000);
		expect(model?.maxTokens).toBe(64_000);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("prefers explicit context_length/max_completion_tokens when present", async () => {
		const { models } = await discoverCopilotModels({
			data: [
				{
					id: "gpt-5.2-codex",
					name: "GPT-5.2 Codex",
					context_length: 250_000,
					max_completion_tokens: 120_000,
					capabilities: {
						limits: {
							max_context_window_tokens: 400_000,
							max_prompt_tokens: 272_000,
							max_output_tokens: 128_000,
						},
					},
				},
			],
		});

		const model = models.find(candidate => candidate.id === "gpt-5.2-codex");
		expect(model).toBeDefined();
		expect(model?.api).toBe("openai-responses");
		expect(model?.contextWindow).toBe(250_000);
		expect(model?.maxTokens).toBe(120_000);
	});

	it("falls back to max_non_streaming_output_tokens when max_output_tokens is absent", async () => {
		const { models } = await discoverCopilotModels({
			data: [
				{
					id: "claude-opus-4.6",
					name: "Claude Opus 4.6",
					capabilities: {
						limits: {
							max_context_window_tokens: 200_000,
							max_prompt_tokens: 128_000,
							max_non_streaming_output_tokens: 16_000,
						},
					},
				},
			],
		});

		const model = models.find(candidate => candidate.id === "claude-opus-4.6");
		expect(model).toBeDefined();
		expect(model?.contextWindow).toBe(128_000);
		expect(model?.maxTokens).toBe(16_000);
	});
});
