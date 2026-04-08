import { afterEach, describe, expect, it, vi } from "bun:test";
import { getBundledModel } from "../src/models";
import { streamAzureOpenAIResponses } from "../src/providers/azure-openai-responses";
import { streamOpenAICompletions } from "../src/providers/openai-completions";
import { streamOpenAIResponses } from "../src/providers/openai-responses";
import type { Context, Model, TextContent } from "../src/types";
import * as idleIterator from "../src/utils/idle-iterator";

const originalFetch = global.fetch;

const openAIResponsesModel = getBundledModel("openai", "gpt-5-mini") as Model<"openai-responses">;
const openAICompletionsModel = {
	...getBundledModel("openai", "gpt-4o-mini"),
	api: "openai-completions",
} satisfies Model<"openai-completions">;
const azureOpenAIResponsesModel: Model<"azure-openai-responses"> = {
	id: "gpt-5-mini",
	name: "GPT-5 Mini",
	api: "azure-openai-responses",
	provider: "azure",
	baseUrl: "https://example.openai.azure.com/openai/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 400000,
	maxTokens: 128000,
};

function baseContext(): Context {
	return {
		messages: [{ role: "user", content: "Say hello", timestamp: Date.now() }],
	};
}

function getRequestSignal(input: string | URL | Request, init: RequestInit | undefined): AbortSignal | undefined {
	if (init?.signal) {
		return init.signal;
	}
	if (input instanceof Request) {
		return input.signal;
	}
	return undefined;
}

function createHangingSseResponse(signal: AbortSignal | undefined): Response {
	let abortListener: (() => void) | undefined;
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			abortListener = () => {
				if (abortListener) {
					signal?.removeEventListener("abort", abortListener);
				}
				const reason = signal?.reason;
				if (reason instanceof Error) {
					controller.error(reason);
					return;
				}
				controller.error(new Error("request aborted"));
			};
			if (signal?.aborted) {
				queueMicrotask(() => abortListener?.());
				return;
			}
			signal?.addEventListener("abort", abortListener, { once: true });
		},
		cancel() {
			if (abortListener) {
				signal?.removeEventListener("abort", abortListener);
			}
		},
	});
	return new Response(stream, {
		status: 200,
		headers: { "content-type": "text/event-stream" },
	});
}

function createHangingFetch(): typeof fetch {
	async function mockFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
		return createHangingSseResponse(getRequestSignal(input, init));
	}

	return Object.assign(mockFetch, { preconnect: originalFetch.preconnect });
}

function createSseResponse(events: unknown[]): Response {
	const payload = `${events.map(event => `data: ${typeof event === "string" ? event : JSON.stringify(event)}`).join("\n\n")}\n\n`;
	return new Response(payload, {
		status: 200,
		headers: { "content-type": "text/event-stream" },
	});
}

async function waitForDelayOrAbort(delayMs: number, signal: AbortSignal | undefined): Promise<void> {
	if (signal?.aborted) {
		const reason = signal.reason;
		throw reason instanceof Error ? reason : new Error(String(reason ?? "request aborted"));
	}

	const { promise, resolve, reject } = Promise.withResolvers<void>();
	const timer = setTimeout(() => resolve(), delayMs);
	const onAbort = () => {
		const reason = signal?.reason;
		reject(reason instanceof Error ? reason : new Error(String(reason ?? "request aborted")));
	};
	signal?.addEventListener("abort", onAbort, { once: true });

	try {
		await promise;
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener("abort", onAbort);
	}
}

function createDelayedFetch(delayMs: number, responseFactory: () => Response): typeof fetch {
	async function mockFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
		await waitForDelayOrAbort(delayMs, getRequestSignal(input, init));
		return responseFactory();
	}

	return Object.assign(mockFetch, { preconnect: originalFetch.preconnect });
}

function createOpenAIResponsesSuccessResponse(): Response {
	return createSseResponse([
		{ type: "response.created", response: { id: "resp_delayed" } },
		{
			type: "response.output_item.added",
			item: { type: "message", id: "msg_delayed", role: "assistant", status: "in_progress", content: [] },
		},
		{ type: "response.content_part.added", part: { type: "output_text", text: "" } },
		{ type: "response.output_text.delta", delta: "Hello delayed" },
		{
			type: "response.output_item.done",
			item: {
				type: "message",
				id: "msg_delayed",
				role: "assistant",
				status: "completed",
				content: [{ type: "output_text", text: "Hello delayed" }],
			},
		},
		{
			type: "response.completed",
			response: {
				id: "resp_delayed",
				status: "completed",
				usage: {
					input_tokens: 5,
					output_tokens: 2,
					total_tokens: 7,
					input_tokens_details: { cached_tokens: 0 },
				},
			},
		},
	]);
}

function createOpenAICompletionsSuccessResponse(modelId: string): Response {
	return createSseResponse([
		{
			id: "chatcmpl-delayed",
			object: "chat.completion.chunk",
			created: 0,
			model: modelId,
			choices: [{ index: 0, delta: { content: "Hello delayed" } }],
		},
		{
			id: "chatcmpl-delayed",
			object: "chat.completion.chunk",
			created: 0,
			model: modelId,
			choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
			usage: {
				prompt_tokens: 5,
				completion_tokens: 2,
				total_tokens: 7,
				prompt_tokens_details: { cached_tokens: 0 },
			},
		},
		"[DONE]",
	]);
}

async function expectFirstEventTimeout(
	run: () => Promise<{ stopReason: string; errorMessage?: string }>,
	expectedMessage: string,
): Promise<void> {
	vi.spyOn(idleIterator, "getStreamFirstEventTimeoutMs").mockReturnValue(20);
	global.fetch = createHangingFetch();

	const result = await run();

	expect(result.stopReason).toBe("error");
	expect(result.errorMessage).toBe(expectedMessage);
}

async function expectCallerAbort(
	run: (signal: AbortSignal) => Promise<{ stopReason: string; errorMessage?: string }>,
	unexpectedMessage: string,
): Promise<void> {
	vi.spyOn(idleIterator, "getStreamFirstEventTimeoutMs").mockReturnValue(50);
	global.fetch = createHangingFetch();
	const controller = new AbortController();
	setTimeout(() => controller.abort(), 5);

	const result = await run(controller.signal);

	expect(result.stopReason).toBe("aborted");
	expect(result.errorMessage).not.toBe(unexpectedMessage);
	expect((result.errorMessage ?? "").toLowerCase()).toContain("abort");
}

function getFirstTextContent(result: { content: unknown[] }): TextContent | undefined {
	return result.content.find((content): content is TextContent => {
		return typeof content === "object" && content !== null && "type" in content && content.type === "text";
	});
}

async function expectDelayedRequestSetupSucceeds(
	run: () => Promise<{ stopReason: string; content: unknown[] }>,
	responseFactory: () => Response,
): Promise<void> {
	vi.spyOn(idleIterator, "getStreamFirstEventTimeoutMs").mockReturnValue(20);
	global.fetch = createDelayedFetch(30, responseFactory);

	const result = await run();

	expect(result.stopReason).toBe("stop");
	expect(getFirstTextContent(result)).toMatchObject({ type: "text", text: "Hello delayed" });
}

afterEach(() => {
	global.fetch = originalFetch;
	vi.restoreAllMocks();
});

describe("OpenAI-family first-event timeouts", () => {
	it("surfaces the OpenAI responses first-event timeout message instead of a generic abort", async () => {
		await expectFirstEventTimeout(
			() => streamOpenAIResponses(openAIResponsesModel, baseContext(), { apiKey: "test-key" }).result(),
			"OpenAI responses stream timed out while waiting for the first event",
		);
	});

	it("surfaces the OpenAI completions first-event timeout message", async () => {
		await expectFirstEventTimeout(
			() => streamOpenAICompletions(openAICompletionsModel, baseContext(), { apiKey: "test-key" }).result(),
			"OpenAI completions stream timed out while waiting for the first event",
		);
	});

	it("surfaces the Azure OpenAI responses first-event timeout message", async () => {
		await expectFirstEventTimeout(
			() =>
				streamAzureOpenAIResponses(azureOpenAIResponsesModel, baseContext(), {
					apiKey: "test-key",
					azureBaseUrl: azureOpenAIResponsesModel.baseUrl,
					azureApiVersion: "v1",
				}).result(),
			"Azure OpenAI responses stream timed out while waiting for the first event",
		);
	});

	it("keeps caller aborts as aborted for OpenAI responses", async () => {
		await expectCallerAbort(
			signal =>
				streamOpenAIResponses(openAIResponsesModel, baseContext(), {
					apiKey: "test-key",
					signal,
				}).result(),
			"OpenAI responses stream timed out while waiting for the first event",
		);
	});

	it("keeps caller aborts as aborted for OpenAI completions", async () => {
		await expectCallerAbort(
			signal =>
				streamOpenAICompletions(openAICompletionsModel, baseContext(), {
					apiKey: "test-key",
					signal,
				}).result(),
			"OpenAI completions stream timed out while waiting for the first event",
		);
	});

	it("keeps caller aborts as aborted for Azure OpenAI responses", async () => {
		await expectCallerAbort(
			signal =>
				streamAzureOpenAIResponses(azureOpenAIResponsesModel, baseContext(), {
					apiKey: "test-key",
					azureBaseUrl: azureOpenAIResponsesModel.baseUrl,
					azureApiVersion: "v1",
					signal,
				}).result(),
			"Azure OpenAI responses stream timed out while waiting for the first event",
		);
	});

	it("does not arm the OpenAI responses first-event watchdog before the stream request exists", async () => {
		await expectDelayedRequestSetupSucceeds(
			() => streamOpenAIResponses(openAIResponsesModel, baseContext(), { apiKey: "test-key" }).result(),
			createOpenAIResponsesSuccessResponse,
		);
	});

	it("does not arm the OpenAI completions first-event watchdog before the stream request exists", async () => {
		await expectDelayedRequestSetupSucceeds(
			() => streamOpenAICompletions(openAICompletionsModel, baseContext(), { apiKey: "test-key" }).result(),
			() => createOpenAICompletionsSuccessResponse(openAICompletionsModel.id),
		);
	});

	it("does not arm the Azure OpenAI responses first-event watchdog before the stream request exists", async () => {
		await expectDelayedRequestSetupSucceeds(
			() =>
				streamAzureOpenAIResponses(azureOpenAIResponsesModel, baseContext(), {
					apiKey: "test-key",
					azureBaseUrl: azureOpenAIResponsesModel.baseUrl,
					azureApiVersion: "v1",
				}).result(),
			createOpenAIResponsesSuccessResponse,
		);
	});
});
