import { afterEach, describe, expect, it } from "bun:test";
import { getBundledModel } from "../src/models";
import { convertMessages, streamOpenAICompletions } from "../src/providers/openai-completions";
import type { AssistantMessage, Context, Model, OpenAICompat } from "../src/types";

const originalFetch = global.fetch;

afterEach(() => {
	global.fetch = originalFetch;
});

function createAbortedSignal(): AbortSignal {
	const controller = new AbortController();
	controller.abort();
	return controller.signal;
}

function toObject(value: unknown): object | null {
	return typeof value === "object" && value !== null ? value : null;
}

function getNestedObject(value: unknown, key: string): object | null {
	const obj = toObject(value);
	if (!obj) return null;
	return toObject(Reflect.get(obj, key));
}

function getNestedBoolean(value: unknown, key: string): boolean | undefined {
	const obj = toObject(value);
	if (!obj) return undefined;
	const property = Reflect.get(obj, key);
	return typeof property === "boolean" ? property : undefined;
}

function createSseResponse(events: unknown[]): Response {
	const payload = `${events.map(event => `data: ${typeof event === "string" ? event : JSON.stringify(event)}`).join("\n\n")}\n\n`;
	return new Response(payload, {
		status: 200,
		headers: { "content-type": "text/event-stream" },
	});
}

function createMockFetch(events: unknown[]): typeof fetch {
	async function mockFetch(_input: string | URL | Request, _init?: RequestInit): Promise<Response> {
		return createSseResponse(events);
	}

	return Object.assign(mockFetch, { preconnect: originalFetch.preconnect });
}

function baseContext(): Context {
	return {
		messages: [
			{
				role: "user",
				content: "hello",
				timestamp: Date.now(),
			},
		],
	};
}

describe("openai-completions compatibility", () => {
	it("serializes assistant text content as a plain string", () => {
		const model: Model<"openai-completions"> = {
			...getBundledModel("openai", "gpt-4o-mini"),
			api: "openai-completions",
		};
		const compat = {
			supportsStore: true,
			supportsDeveloperRole: true,
			supportsReasoningEffort: true,
			reasoningEffortMap: {},
			supportsUsageInStreaming: true,
			supportsToolChoice: true,
			maxTokensField: "max_completion_tokens",
			requiresToolResultName: false,
			requiresAssistantAfterToolResult: false,
			requiresThinkingAsText: false,
			requiresMistralToolIds: false,
			thinkingFormat: "openai",
			reasoningContentField: "reasoning_content",
			requiresReasoningContentForToolCalls: false,
			requiresAssistantContentForToolCalls: false,
			openRouterRouting: {},
			vercelGatewayRouting: {},
			supportsStrictMode: true,
		} satisfies Required<OpenAICompat>;
		const assistantMessage: AssistantMessage = {
			role: "assistant",
			content: [
				{ type: "text", text: "hello" },
				{ type: "text", text: " world" },
			],
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		};
		const messages = convertMessages(model, { messages: [assistantMessage] }, compat);
		const assistant = messages.find(message => message.role === "assistant");
		expect(assistant).toBeDefined();
		if (!assistant || assistant.role !== "assistant") {
			throw new Error("assistant message missing");
		}
		expect(typeof assistant.content).toBe("string");
		expect(assistant.content).toBe("hello world");
	});

	it("reads usage from choice usage fallback", async () => {
		const model: Model<"openai-completions"> = {
			...getBundledModel("openai", "gpt-4o-mini"),
			api: "openai-completions",
		};
		global.fetch = createMockFetch([
			{
				id: "chatcmpl-test",
				object: "chat.completion.chunk",
				created: 0,
				model: model.id,
				choices: [
					{
						index: 0,
						delta: { content: "Hello" },
						usage: {
							prompt_tokens: 12,
							completion_tokens: 3,
							prompt_tokens_details: { cached_tokens: 2 },
						},
					},
				],
			},
			{
				id: "chatcmpl-test",
				object: "chat.completion.chunk",
				created: 0,
				model: model.id,
				choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
			},
			"[DONE]",
		]);

		const result = await streamOpenAICompletions(model, baseContext(), { apiKey: "test-key" }).result();
		expect(result.stopReason).toBe("stop");
		expect(result.usage.input).toBe(10);
		expect(result.usage.output).toBe(3);
		expect(result.usage.cacheRead).toBe(2);
		expect(result.usage.totalTokens).toBe(15);
	});

	it("maps qwen chat template reasoning into chat_template_kwargs", async () => {
		const model: Model<"openai-completions"> = {
			...getBundledModel("openai", "gpt-4o-mini"),
			api: "openai-completions",
			reasoning: true,
			compat: {
				thinkingFormat: "qwen-chat-template",
			},
		};
		const { promise, resolve } = Promise.withResolvers<unknown>();
		streamOpenAICompletions(model, baseContext(), {
			apiKey: "test-key",
			reasoning: "high",
			signal: createAbortedSignal(),
			onPayload: payload => resolve(payload),
		});
		const payload = await promise;
		const chatTemplateArgs = getNestedObject(payload, "chat_template_kwargs");
		expect(getNestedBoolean(chatTemplateArgs, "enable_thinking")).toBe(true);
	});

	it("treats finish_reason end as stop", async () => {
		const model: Model<"openai-completions"> = {
			...getBundledModel("openai", "gpt-4o-mini"),
			api: "openai-completions",
		};
		global.fetch = createMockFetch([
			{
				id: "chatcmpl-end",
				object: "chat.completion.chunk",
				created: 0,
				model: model.id,
				choices: [{ index: 0, delta: { content: "done" } }],
			},
			{
				id: "chatcmpl-end",
				object: "chat.completion.chunk",
				created: 0,
				model: model.id,
				choices: [{ index: 0, delta: {}, finish_reason: "end" }],
			},
			"[DONE]",
		]);

		const result = await streamOpenAICompletions(model, baseContext(), { apiKey: "test-key" }).result();
		expect(result.stopReason).toBe("stop");
		expect(result.content[0]).toMatchObject({ type: "text", text: "done" });
	});

	it("injects compat.extraBody into OpenAI payload", async () => {
		const model: Model<"openai-completions"> = {
			...getBundledModel("openai", "gpt-4o-mini"),
			api: "openai-completions",
			compat: {
				extraBody: {
					gateway: "m1-01",
					controller: "mlx",
				},
			},
		};

		const { promise, resolve } = Promise.withResolvers<unknown>();
		global.fetch = createMockFetch(["[DONE]"]);
		streamOpenAICompletions(model, baseContext(), {
			apiKey: "test-key",
			signal: createAbortedSignal(),
			onPayload: payload => resolve(payload),
		});

		const payload = await promise;
		expect(payload).toEqual(
			expect.objectContaining({
				gateway: "m1-01",
				controller: "mlx",
			}),
		);
	});
});
