import { afterEach, describe, expect, it, vi } from "bun:test";
import { Messages } from "@anthropic-ai/sdk/resources/messages/messages";
import { streamAnthropic } from "../src/providers/anthropic";
import type { Context, Model } from "../src/types";

const originalFirstEventTimeout = Bun.env.PI_STREAM_FIRST_EVENT_TIMEOUT_MS;

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

function createHangingAnthropicStream(signal: AbortSignal | undefined): AsyncIterable<Record<string, unknown>> {
	return {
		async *[Symbol.asyncIterator]() {
			const { promise, reject } = Promise.withResolvers<void>();
			const onAbort = () => reject(new Error("request aborted"));
			if (signal?.aborted) {
				onAbort();
			} else {
				signal?.addEventListener("abort", onAbort, { once: true });
			}
			try {
				await promise;
			} catch {
				return;
			} finally {
				signal?.removeEventListener("abort", onAbort);
			}
		},
	};
}

function createSuccessfulAnthropicStream(text: string): AsyncIterable<Record<string, unknown>> {
	return {
		async *[Symbol.asyncIterator]() {
			yield {
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
			};
			yield {
				type: "content_block_start",
				index: 0,
				content_block: { type: "text", text: "" },
			};
			yield {
				type: "content_block_delta",
				index: 0,
				delta: { type: "text_delta", text },
			};
			yield { type: "content_block_stop", index: 0 };
			yield {
				type: "message_delta",
				delta: { stop_reason: "end_turn" },
				usage: {
					input_tokens: 12,
					output_tokens: 4,
					cache_read_input_tokens: 0,
					cache_creation_input_tokens: 0,
				},
			};
		},
	};
}

afterEach(() => {
	vi.restoreAllMocks();
	if (originalFirstEventTimeout === undefined) {
		delete Bun.env.PI_STREAM_FIRST_EVENT_TIMEOUT_MS;
	} else {
		Bun.env.PI_STREAM_FIRST_EVENT_TIMEOUT_MS = originalFirstEventTimeout;
	}
});

describe("anthropic first-event timeout retries", () => {
	it("retries when the provider never sends the first stream event", async () => {
		Bun.env.PI_STREAM_FIRST_EVENT_TIMEOUT_MS = "20";
		let attempt = 0;

		vi.spyOn(Messages.prototype, "stream").mockImplementation((_body, requestOptions) => {
			attempt += 1;
			const signal = (requestOptions as { signal?: AbortSignal } | undefined)?.signal;
			return (
				attempt === 1 ? createHangingAnthropicStream(signal) : createSuccessfulAnthropicStream("retry recovered")
			) as never;
		});

		const result = await streamAnthropic(model, context, { apiKey: "sk-ant-test" }).result();

		expect(attempt).toBe(2);
		expect(result.stopReason).toBe("stop");
		expect(result.content).toEqual([{ type: "text", text: "retry recovered" }]);
		expect(result.responseId).toBe("msg_retry_success");
	});
});
