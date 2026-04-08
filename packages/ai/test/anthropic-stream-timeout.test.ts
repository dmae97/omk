import { afterEach, describe, expect, it, vi } from "bun:test";
import { Messages } from "@anthropic-ai/sdk/resources/messages/messages";
import * as idleIterator from "../src/utils/idle-iterator";
import { streamAnthropic } from "../src/providers/anthropic";
import type { Context, Model } from "../src/types";

const model: Model<"anthropic-messages"> = {
	id: "claude-sonnet-4-5",
	name: "Claude Sonnet 4.5",
	api: "anthropic-messages",
	provider: "anthropic",
	baseUrl: "https://api.anthropic.com",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 200_000,
	maxTokens: 8_192,
};

const context: Context = {
	messages: [{ role: "user", content: "Say hi", timestamp: Date.now() }],
};

type MockAnthropicEvent = Record<string, unknown>;
type MockAnthropicStream = AsyncIterable<MockAnthropicEvent>;

type MockAnthropicRequest = {
	withResponse(): Promise<{
		data: MockAnthropicStream;
		response: Response;
		request_id: string | null;
	}>;
};

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

async function waitForAbortAndThrowAbortError(signal: AbortSignal | undefined): Promise<never> {
	if (signal?.aborted) {
		throw new Error("Request was aborted.");
	}

	const { promise, reject } = Promise.withResolvers<void>();
	const onAbort = () => reject(new Error("Request was aborted."));
	signal?.addEventListener("abort", onAbort, { once: true });

	try {
		await promise;
		throw new Error("Anthropic mock stream unexpectedly resumed");
	} finally {
		signal?.removeEventListener("abort", onAbort);
	}
}

function createSuccessfulAnthropicEvents(text: string): MockAnthropicEvent[] {
	return [
		{
			type: "message_start",
			message: {
				id: "msg_retry_success",
				usage: {
					input_tokens: 12,
					output_tokens: 0,
					cache_read_input_tokens: 0,
					cache_creation_input_tokens: 0,
				},
			},
		},
		{
			type: "content_block_start",
			index: 0,
			content_block: { type: "text", text: "" },
		},
		{
			type: "content_block_delta",
			index: 0,
			delta: { type: "text_delta", text },
		},
		{ type: "content_block_stop", index: 0 },
		{
			type: "message_delta",
			delta: { stop_reason: "end_turn" },
			usage: {
				input_tokens: 12,
				output_tokens: 4,
				cache_read_input_tokens: 0,
				cache_creation_input_tokens: 0,
			},
		},
	];
}

function createAnthropicMockStream({
	signal,
	connectDelayMs = 0,
	events,
}: {
	signal: AbortSignal | undefined;
	connectDelayMs?: number;
	events?: MockAnthropicEvent[];
}): MockAnthropicRequest {
	const response = new Response(null, {
		status: 200,
		headers: { "request-id": "req_mock" },
	});

	const stream: MockAnthropicStream = {
		async *[Symbol.asyncIterator]() {
			if (!events) {
				await waitForAbortAndThrowAbortError(signal);
				return;
			}
			for (const event of events) {
				yield event;
			}
		},
	};

	return {
		async withResponse() {
			if (connectDelayMs > 0) {
				await waitForDelayOrAbort(connectDelayMs, signal);
			}
			return {
				data: stream,
				response,
				request_id: response.headers.get("request-id"),
			};
		},
	};
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("anthropic first-event timeout retries", () => {
	it("retries when the provider never sends the first stream event", async () => {
		vi.spyOn(idleIterator, "getStreamFirstEventTimeoutMs").mockReturnValue(20);
		let attempt = 0;

		vi.spyOn(Messages.prototype, "create").mockImplementation((_body, requestOptions) => {
			attempt += 1;
			const signal = (requestOptions as { signal?: AbortSignal } | undefined)?.signal;
			return createAnthropicMockStream({
				signal,
				events: attempt === 1 ? undefined : createSuccessfulAnthropicEvents("retry recovered"),
			}) as never;
		});

		const result = await streamAnthropic(model, context, { apiKey: "sk-ant-test" }).result();

		expect(attempt).toBe(2);
		expect(result.stopReason).toBe("stop");
		expect(result.content).toEqual([{ type: "text", text: "retry recovered" }]);
		expect(result.responseId).toBe("msg_retry_success");
	});

	it("does not arm the Anthropic first-event watchdog before the stream connects", async () => {
		vi.spyOn(idleIterator, "getStreamFirstEventTimeoutMs").mockReturnValue(20);

		vi.spyOn(Messages.prototype, "create").mockImplementation((_body, requestOptions) => {
			const signal = (requestOptions as { signal?: AbortSignal } | undefined)?.signal;
			return createAnthropicMockStream({
				signal,
				connectDelayMs: 30,
				events: createSuccessfulAnthropicEvents("delayed connect"),
			}) as never;
		});

		const result = await streamAnthropic(model, context, { apiKey: "sk-ant-test" }).result();

		expect(result.stopReason).toBe("stop");
		expect(result.content).toEqual([{ type: "text", text: "delayed connect" }]);
	});

	it("keeps caller aborts as aborted instead of retrying them as first-event timeouts", async () => {
		vi.spyOn(idleIterator, "getStreamFirstEventTimeoutMs").mockReturnValue(50);
		let attempt = 0;

		vi.spyOn(Messages.prototype, "create").mockImplementation((_body, requestOptions) => {
			attempt += 1;
			const signal = (requestOptions as { signal?: AbortSignal } | undefined)?.signal;
			return createAnthropicMockStream({ signal }) as never;
		});

		const controller = new AbortController();
		setTimeout(() => controller.abort(), 5);

		const result = await streamAnthropic(model, context, {
			apiKey: "sk-ant-test",
			signal: controller.signal,
		}).result();

		expect(attempt).toBe(1);
		expect(result.stopReason).toBe("aborted");
		expect(result.errorMessage).not.toBe("Anthropic stream timed out while waiting for the first event");
		expect((result.errorMessage ?? "").toLowerCase()).toContain("abort");
	});
});
