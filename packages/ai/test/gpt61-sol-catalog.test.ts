import { afterEach, describe, expect, it, vi } from "vitest";
import { applyCurrentThinkingMetadata } from "../scripts/catalog-thinking.ts";
import { getModels, getSupportedThinkingLevels } from "../src/models.ts";
import { streamSimpleOpenAICodexResponses } from "../src/providers/openai-codex-responses.ts";
import type { Api, Context, KnownProvider, Model, ThinkingLevel } from "../src/types.ts";

/**
 * GPT-6.1 Sol (released 2026-09-29) and the GPT-6 family on the ChatGPT/Codex route.
 *
 * Checked 2026-09-30:
 * - OpenAI documents `gpt-6.1-sol`: 1,050,000 context, 128,000 output, effort
 *   low/medium/high/xhigh/max. `none` and `minimal` are not supported.
 *   https://developers.openai.com/api/docs/models/gpt-6.1-sol
 * - models.dev declares the same low-through-max ladder on the `openai`, `azure`,
 *   `opencode`, and `github-copilot` routes; OpenRouter declares it as mandatory.
 * - Codex bundled catalog (openai/codex b1e72963c3, codex-rs/models-manager/models.json):
 *   gpt-6.1-sol, gpt-6-astra, and gpt-6-sol list low..max plus `ultra`; gpt-6-luna stops at
 *   max. context_window is 272,000 and max_context_window 872,000; the client clamps a
 *   configured window to the latter. `ultra` never reaches the wire: the client sends the
 *   model's `multi_agent_reasoning_effort` (xhigh for 6.1 Sol and Astra) or, when that is
 *   unset, the highest listed non-ultra effort (max for gpt-6-sol).
 */

const context: Context = {
	systemPrompt: "Answer accurately.",
	messages: [{ role: "user", content: "Solve this.", timestamp: 0 }],
};

const API_LADDER = ["low", "medium", "high", "xhigh", "max"] as const;
const CODEX_ULTRA_LADDER = [...API_LADDER, "ultra"] as const;

function requireModel(provider: KnownProvider, id: string): Model<Api> {
	const model = getModels(provider).find((candidate) => candidate.id === id);
	if (!model) throw new Error(`Missing ${provider}/${id}`);
	return model;
}

function requireCodexModel(id: string): Model<"openai-codex-responses"> {
	const model = getModels("openai-codex").find((candidate) => candidate.id === id);
	if (!model) throw new Error(`Missing openai-codex/${id}`);
	return model;
}

function mockToken(): string {
	const payload = Buffer.from(
		JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acc_test" } }),
		"utf8",
	).toString("base64");
	return `aaa.${payload}.bbb`;
}

function reasoningEffort(init: RequestInit | undefined): string | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(String(init?.body));
	} catch (error) {
		if (error instanceof SyntaxError) return undefined;
		throw error;
	}
	if (typeof parsed !== "object" || parsed === null || !("reasoning" in parsed)) return undefined;
	const reasoning = parsed.reasoning;
	return typeof reasoning === "object" && reasoning !== null && "effort" in reasoning
		? String(reasoning.effort)
		: undefined;
}

function sseResponse(): Response {
	const event = {
		type: "response.completed",
		response: {
			status: "completed",
			usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: { cached_tokens: 0 } },
		},
	};
	return new Response(`data: ${JSON.stringify(event)}\n\n`, {
		status: 200,
		headers: { "content-type": "text/event-stream" },
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("GPT-6 family on the openai-codex route", () => {
	it.each([
		["gpt-6.1-sol", { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 }],
		["gpt-6-astra", { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 }],
		["gpt-6-sol", { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 }],
		["gpt-6-luna", { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 }],
	] as const)("lists %s with the Codex route limits and OpenAI list prices", (id, cost) => {
		const model = requireCodexModel(id);
		expect(model).toMatchObject({
			api: "openai-codex-responses",
			baseUrl: "https://chatgpt.com/backend-api",
			reasoning: true,
			input: ["text", "image"],
			contextWindow: 872_000,
			maxTokens: 128_000,
			cost,
		});
	});

	it.each(["gpt-6.1-sol", "gpt-6-astra", "gpt-6-sol"])("offers %s the Codex ladder through ultra", (id) => {
		expect(getSupportedThinkingLevels(requireCodexModel(id))).toEqual(CODEX_ULTRA_LADDER);
	});

	it("stops gpt-6-luna at max because Codex lists no ultra for it", () => {
		expect(getSupportedThinkingLevels(requireCodexModel("gpt-6-luna"))).toEqual(API_LADDER);
	});

	it.each([
		["gpt-6.1-sol", "low", "low"],
		["gpt-6.1-sol", "medium", "medium"],
		["gpt-6.1-sol", "high", "high"],
		["gpt-6.1-sol", "xhigh", "xhigh"],
		["gpt-6.1-sol", "max", "max"],
		["gpt-6.1-sol", "ultra", "xhigh"],
		["gpt-6.1-sol", "minimal", "low"],
		["gpt-6-astra", "ultra", "xhigh"],
		["gpt-6-sol", "ultra", "max"],
		["gpt-6-luna", "max", "max"],
		["gpt-6-luna", "ultra", "max"],
	] as const)("sends %s %s as reasoning effort %s", async (id, reasoning: ThinkingLevel, wire) => {
		const efforts: Array<string | undefined> = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
				efforts.push(reasoningEffort(init));
				return sseResponse();
			}),
		);

		await streamSimpleOpenAICodexResponses(requireCodexModel(id), context, {
			apiKey: mockToken(),
			reasoning,
			transport: "sse",
		}).result();

		expect(efforts).toEqual([wire]);
	});
});

describe("GPT-6.1 Sol on API routes", () => {
	it.each([
		["openai", "gpt-6.1-sol"],
		["azure-openai-responses", "gpt-6.1-sol"],
		["opencode", "gpt-6.1-sol"],
		["github-copilot", "gpt-6.1-sol"],
	] as const)("exposes %s/%s with the documented low-through-max ladder and no off", (provider, id) => {
		const model = requireModel(provider, id);
		expect(model.api).toMatch(/responses$/);
		expect(model.contextWindow).toBe(1_050_000);
		expect(model.maxTokens).toBe(128_000);
		expect(model.thinkingLevelMap).toMatchObject({
			off: null,
			minimal: null,
			low: "low",
			medium: "medium",
			high: "high",
			xhigh: "xhigh",
			max: "max",
		});
		expect(getSupportedThinkingLevels(model)).toEqual(API_LADDER);
	});

	it.each(["openai/gpt-6.1-sol", "openai/gpt-6.1-sol-pro"])("follows OpenRouter's mandatory ladder on %s", (id) => {
		const model = requireModel("openrouter", id);
		expect(model.api).toBe("openai-completions");
		expect(model.contextWindow).toBe(1_050_000);
		expect(getSupportedThinkingLevels(model)).toEqual(API_LADDER);
	});

	it("does not advertise top tiers on Vercel's Messages budget path", () => {
		const model = requireModel("vercel-ai-gateway", "openai/gpt-6.1-sol");
		expect(model.api).toBe("anthropic-messages");
		const levels = getSupportedThinkingLevels(model);
		expect(levels).not.toContain("xhigh");
		expect(levels).not.toContain("max");
		expect(levels).not.toContain("ultra");
	});

	it("keeps the GPT-6 Sol none toggle on the same routes", () => {
		expect(requireModel("openai", "gpt-6-sol").thinkingLevelMap).toMatchObject({ off: "none", minimal: null });
	});
});

describe("GPT-6.1 Sol thinking rule", () => {
	function syntheticModel(api: Api, provider: string, id: string): Model<Api> {
		return {
			id,
			name: id,
			api,
			provider,
			baseUrl: "",
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 1_050_000,
			maxTokens: 128_000,
		};
	}

	it.each([
		["openai-responses", "openai", "gpt-6.1-sol"],
		["azure-openai-responses", "azure-openai-responses", "gpt-6.1-sol"],
		["openai-responses", "opencode", "gpt-6.1-sol-pro"],
	] as const)("replaces a %s/%s route's ladder with the no-none contract", (api, provider, id) => {
		const model = syntheticModel(api, provider, id);
		model.thinkingLevelMap = { off: "none", minimal: "minimal" };
		applyCurrentThinkingMetadata(model);
		expect(model.thinkingLevelMap).toEqual({
			off: null,
			minimal: null,
			low: "low",
			medium: "medium",
			high: "high",
			xhigh: "xhigh",
			max: "max",
		});
	});

	it("leaves the Codex route and similarly named ids alone", () => {
		const codex = syntheticModel("openai-codex-responses", "openai-codex", "gpt-6.1-sol");
		const sibling = syntheticModel("openai-responses", "openai", "gpt-6.1-sol-mini");
		for (const model of [codex, sibling]) {
			model.thinkingLevelMap = { max: "xhigh" };
			applyCurrentThinkingMetadata(model);
			expect(model.thinkingLevelMap).toEqual({ max: "xhigh" });
		}
	});
});
