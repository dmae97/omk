import { Type } from "typebox";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getModel } from "../src/models.ts";
import { streamOpenAICompletions } from "../src/providers/openai-completions.ts";
import type { Model } from "../src/types.ts";

interface CacheControl {
	type: "ephemeral";
	ttl?: string;
}

interface TextPart {
	type: "text";
	text: string;
	cache_control?: CacheControl;
}

interface ToolWithCacheControl {
	type: string;
	cache_control?: CacheControl;
}

interface CapturedParams {
	messages: Array<{
		role: string;
		content: string | TextPart[] | null;
	}>;
	tools?: ToolWithCacheControl[];
}

const mockState = vi.hoisted(() => ({
	lastParams: undefined as CapturedParams | undefined,
}));

vi.mock("openai", () => {
	class FakeOpenAI {
		chat = {
			completions: {
				create: (params: CapturedParams) => {
					mockState.lastParams = params;
					const stream = {
						async *[Symbol.asyncIterator]() {
							yield {
								id: "chatcmpl-test",
								choices: [{ delta: {}, finish_reason: "stop" }],
								usage: {
									prompt_tokens: 1,
									completion_tokens: 1,
									prompt_tokens_details: { cached_tokens: 0 },
									completion_tokens_details: { reasoning_tokens: 0 },
								},
							};
						},
					};
					const promise = Promise.resolve(stream) as Promise<typeof stream> & {
						withResponse: () => Promise<{
							data: typeof stream;
							response: { status: number; headers: Headers };
						}>;
					};
					promise.withResponse = async () => ({
						data: stream,
						response: { status: 200, headers: new Headers() },
					});
					return promise;
				},
			},
		};
	}

	return { default: FakeOpenAI };
});

async function capturePayload(
	model: Model<"openai-completions">,
	options?: { cacheRetention?: "none" | "short" | "long" },
): Promise<CapturedParams> {
	const timestamp = Date.now();

	await streamOpenAICompletions(
		model,
		{
			systemPrompt: "System prompt",
			messages: [{ role: "user", content: "Hello", timestamp }],
			tools: [
				{
					name: "read",
					description: "Read a file",
					parameters: Type.Object({
						path: Type.String(),
					}),
				},
			],
		},
		{ apiKey: "test-key", ...options },
	).result();

	if (!mockState.lastParams) {
		throw new Error("Expected payload to be captured");
	}

	return mockState.lastParams;
}

function getInstructionMessage(params: CapturedParams) {
	return params.messages.find((message) => message.role === "system" || message.role === "developer");
}

function expectAnthropicCacheMarkers(params: CapturedParams, expected: CacheControl = { type: "ephemeral" }): void {
	const instructionMessage = getInstructionMessage(params);
	expect(instructionMessage).toBeDefined();
	const instructionContent = instructionMessage?.content;
	// Narrow instead of casting: a cast would hide a string/undefined content
	// behind a TextPart[] index and throw before the assertion could report it.
	expect(Array.isArray(instructionContent)).toBe(true);
	if (!Array.isArray(instructionContent)) return;
	expect(instructionContent[0]?.cache_control).toEqual(expected);

	expect(params.tools).toHaveLength(1);
	expect(params.tools?.[0]?.cache_control).toEqual(expected);

	const lastMessage = params.messages[params.messages.length - 1];
	expect(lastMessage.role).toBe("user");
	const lastContent = lastMessage.content;
	expect(Array.isArray(lastContent)).toBe(true);
	if (!Array.isArray(lastContent)) return;
	expect(lastContent[0]?.cache_control).toEqual(expected);
}

describe("openai-completions cacheControlFormat", () => {
	// Default retention resolves from OMK_CACHE_RETENTION, so an ambient value
	// would otherwise decide whether these payloads carry a ttl and the suite
	// would pass or fail based on the shell it was launched from.
	const originalCacheRetention = process.env.OMK_CACHE_RETENTION;

	beforeEach(() => {
		mockState.lastParams = undefined;
		delete process.env.OMK_CACHE_RETENTION;
	});

	afterEach(() => {
		if (originalCacheRetention === undefined) {
			delete process.env.OMK_CACHE_RETENTION;
		} else {
			process.env.OMK_CACHE_RETENTION = originalCacheRetention;
		}
	});

	it("applies Anthropic-style cache markers when model compat enables them", async () => {
		const model: Model<"openai-completions"> = {
			id: "custom-qwen",
			name: "Custom Qwen",
			api: "openai-completions",
			provider: "openrouter",
			baseUrl: "https://example.com/v1",
			reasoning: true,
			input: ["text"],
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
			},
			contextWindow: 128000,
			maxTokens: 32000,
			compat: {
				cacheControlFormat: "anthropic",
			},
		};

		const params = await capturePayload(model);
		expectAnthropicCacheMarkers(params);
	});

	it("preserves Anthropic-style cache markers for OpenRouter Anthropic models", async () => {
		const model = getModel("openrouter", "anthropic/claude-sonnet-4");
		const params = await capturePayload(model);
		expectAnthropicCacheMarkers(params);
	});

	it("adds a 1h ttl when cacheRetention is long", async () => {
		const model = getModel("openrouter", "anthropic/claude-sonnet-4");
		const params = await capturePayload(model, { cacheRetention: "long" });
		expectAnthropicCacheMarkers(params, { type: "ephemeral", ttl: "1h" });
	});

	it("resolves the default retention from OMK_CACHE_RETENTION", async () => {
		process.env.OMK_CACHE_RETENTION = "long";
		const model = getModel("openrouter", "anthropic/claude-sonnet-4");
		const params = await capturePayload(model);
		expectAnthropicCacheMarkers(params, { type: "ephemeral", ttl: "1h" });
	});

	it("omits Anthropic-style cache markers when cacheRetention is none", async () => {
		const model: Model<"openai-completions"> = {
			id: "custom-qwen",
			name: "Custom Qwen",
			api: "openai-completions",
			provider: "openrouter",
			baseUrl: "https://example.com/v1",
			reasoning: true,
			input: ["text"],
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
			},
			contextWindow: 128000,
			maxTokens: 32000,
			compat: {
				cacheControlFormat: "anthropic",
			},
		};
		const params = await capturePayload(model, { cacheRetention: "none" });
		const instructionMessage = getInstructionMessage(params);

		expect(Array.isArray(instructionMessage?.content)).toBe(false);
		expect(params.tools?.[0]?.cache_control).toBeUndefined();
		expect(typeof params.messages[params.messages.length - 1]?.content).toBe("string");
	});
});
