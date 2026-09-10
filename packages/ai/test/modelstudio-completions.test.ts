import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { streamSimpleOpenAICompletions } from "../src/providers/openai-completions.ts";
import type { Context, Model, SimpleStreamOptions } from "../src/types.ts";

const model: Model<"openai-completions"> = {
	id: "deepseek-v4-flash-0731",
	name: "DeepSeek Flash fixture",
	api: "openai-completions",
	provider: "modelstudio-fixture",
	baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 1048576,
	maxTokens: 32768,
	thinkingLevelMap: { xhigh: "xhigh", max: "max" },
};
const context: Context = {
	systemPrompt: "Use the supplied tools to complete the task.",
	messages: [{ role: "user", content: "Check the fixture.", timestamp: 0 }],
};
const requests: unknown[] = [];

async function send(selected: Model<"openai-completions"> = model, options: SimpleStreamOptions = {}) {
	const result = await streamSimpleOpenAICompletions(selected, context, {
		apiKey: "fixture-key",
		maxTokens: 512,
		maxRetries: 0,
		...options,
	}).result();
	expect(result.stopReason).toBe("stop");
	expect(requests).toHaveLength(1);
	return requests[0];
}

describe("Model Studio Chat Completions wire format", () => {
	beforeEach(() => {
		requests.length = 0;
		vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
			const request = new Request(input, init);
			requests.push(await request.json());
			const chunk = {
				id: "chatcmpl-fixture",
				choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }],
			};
			return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
				headers: { "content-type": "text/event-stream" },
			});
		});
	});
	afterEach(() => vi.unstubAllGlobals());

	it.each([
		model.baseUrl,
		"https://example.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
		"https://dashscope.aliyuncs.com/compatible-mode/v1",
		"https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
		"https://dashscope-us.aliyuncs.com/compatible-mode/v1",
		"https://coding.dashscope.aliyuncs.com/v1",
		"https://coding-intl.dashscope.aliyuncs.com/v1",
	])("sends explicit non-thinking and max_tokens for %s", async (baseUrl) => {
		const body = await send({ ...model, baseUrl });
		expect(body).toEqual(expect.objectContaining({ model: model.id, max_tokens: 512, enable_thinking: false }));
		expect(body).not.toHaveProperty("max_completion_tokens");
		expect(body).not.toHaveProperty("thinking");
		expect(body).not.toHaveProperty("store");
		expect(body).toHaveProperty("messages.0.role", "system");
	});

	it("corrects the legacy native DeepSeek format only at the Model Studio endpoint", async () => {
		const body = await send({
			...model,
			compat: { thinkingFormat: "deepseek", supportsReasoningEffort: false },
		});
		expect(body).toHaveProperty("enable_thinking", false);
		expect(body).not.toHaveProperty("thinking");
		expect(body).not.toHaveProperty("reasoning_effort");
	});

	it.each(["high", "xhigh", "max"] as const)("transmits requested %s reasoning effort", async (reasoning) => {
		const body = await send(model, { reasoning });
		expect(body).toEqual(expect.objectContaining({ enable_thinking: true, reasoning_effort: reasoning }));
		expect(body).not.toHaveProperty("thinking");
	});

	it("maps minimal reasoning to the lowest documented Model Studio V4 effort", async () => {
		const body = await send(model, { reasoning: "minimal" });
		expect(body).toHaveProperty("reasoning_effort", "low");
	});

	it("omits OpenAI long-cache fields even when long retention is requested", async () => {
		const body = await send(model, { cacheRetention: "long", sessionId: "fixture-session" });
		expect(body).not.toHaveProperty("prompt_cache_retention");
		expect(body).not.toHaveProperty("prompt_cache_key");
	});

	it("preserves an explicit reasoning-effort opt-out", async () => {
		const body = await send({ ...model, compat: { supportsReasoningEffort: false } }, { reasoning: "max" });
		expect(body).toHaveProperty("enable_thinking", true);
		expect(body).not.toHaveProperty("reasoning_effort");
	});

	it("does not add DeepSeek effort fields for a Qwen model", async () => {
		const body = await send({ ...model, id: "qwen3.6-plus" }, { reasoning: "high" });
		expect(body).toHaveProperty("enable_thinking", true);
		expect(body).not.toHaveProperty("reasoning_effort");
	});

	it("keeps native DeepSeek thinking serialization unchanged", async () => {
		const body = await send({ ...model, provider: "deepseek", baseUrl: "https://api.deepseek.com/v1" });
		expect(body).toHaveProperty("thinking", { type: "disabled" });
		expect(body).not.toHaveProperty("enable_thinking");
	});

	it.each([
		"https://maas.aliyuncs.com.evil.invalid/v1",
		"https://notmaas.aliyuncs.com/v1",
		"https://example.invalid/dashscope.aliyuncs.com/v1",
		"https://example.invalid/v1?endpoint=token-plan.ap-southeast-1.maas.aliyuncs.com",
		"https://dashscope.aliyuncs.com@example.invalid/v1",
		"not a URL",
	])("does not infer Alibaba protocol from a lookalike URL: %s", async (baseUrl) => {
		// An observer cancels before fetch, so even malformed URLs stay offline.
		let body: unknown;
		await streamSimpleOpenAICompletions({ ...model, baseUrl }, context, {
			apiKey: "fixture-key",
			maxTokens: 512,
			onPayload: (payload) => {
				body = payload;
				throw new Error("fixture: stop before network");
			},
		}).result();
		expect(requests).toHaveLength(0);
		expect(body).not.toHaveProperty("enable_thinking");
		expect(body).toHaveProperty("max_completion_tokens", 512);
	});
});
