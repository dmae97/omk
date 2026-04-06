import { afterEach, describe, expect, it, vi } from "bun:test";
import { Messages } from "@anthropic-ai/sdk/resources/messages/messages";
import { streamAnthropic } from "../src/providers/anthropic";
import type { AssistantMessageEvent, Context, Model } from "../src/types";

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

function createMockRequest(events: MockAnthropicEvent[]): MockAnthropicRequest {
	const response = new Response(null, {
		status: 200,
		headers: { "request-id": "req_mock" },
	});

	const stream: MockAnthropicStream = {
		async *[Symbol.asyncIterator]() {
			for (const event of events) {
				yield event;
			}
		},
	};

	return {
		async withResponse() {
			return {
				data: stream,
				response,
				request_id: response.headers.get("request-id"),
			};
		},
	};
}

function createTextSuccessEvents(text: string): MockAnthropicEvent[] {
	return [
		{
			type: "message_start",
			message: {
				id: "msg_text_success",
				usage: {
					input_tokens: 12,
					output_tokens: 0,
					cache_read_input_tokens: 0,
					cache_creation_input_tokens: 0,
				},
			},
		},
		{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
		{ type: "message_start", message: { id: "msg_duplicate", usage: { input_tokens: 99, output_tokens: 99 } } },
		{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
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
		{ type: "message_stop" },
	];
}

function createMalformedPreMessageStartEvents(): MockAnthropicEvent[] {
	return [{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }];
}

function createMalformedToolUseEvents(): MockAnthropicEvent[] {
	return [
		{
			type: "message_start",
			message: {
				id: "msg_tool_broken",
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
			content_block: { type: "tool_use", id: "tool_broken", name: "lookup_weather", input: {} },
		},
		{
			type: "content_block_delta",
			index: 0,
			delta: { type: "input_json_delta", partial_json: '{"city":"Par' },
		},
		{ type: "content_block_stop", index: 0 },
	];
}

function countEvents(events: AssistantMessageEvent[], type: AssistantMessageEvent["type"]): number {
	return events.filter(event => event.type === type).length;
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("anthropic stream envelope handling", () => {
	it("ignores duplicate message_start envelopes without resetting streamed text", async () => {
		vi.spyOn(Messages.prototype, "create").mockImplementation(
			() => createMockRequest(createTextSuccessEvents("hello")) as never,
		);

		const stream = streamAnthropic(model, context, { apiKey: "sk-ant-test" });
		const events: AssistantMessageEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}
		const result = await stream.result();

		expect(countEvents(events, "text_start")).toBe(1);
		expect(countEvents(events, "text_delta")).toBe(1);
		expect(countEvents(events, "text_end")).toBe(1);
		expect(countEvents(events, "done")).toBe(1);
		expect(result.stopReason).toBe("stop");
		expect(result.responseId).toBe("msg_text_success");
		expect(result.content).toEqual([{ type: "text", text: "hello" }]);
	});

	it("retries malformed envelopes before content starts without duplicating streamed text events", async () => {
		let attempt = 0;
		vi.spyOn(Messages.prototype, "create").mockImplementation(() => {
			attempt += 1;
			return createMockRequest(
				attempt === 1 ? createMalformedPreMessageStartEvents() : createTextSuccessEvents("recovered"),
			) as never;
		});

		const stream = streamAnthropic(model, context, { apiKey: "sk-ant-test" });
		const events: AssistantMessageEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}
		const result = await stream.result();

		expect(attempt).toBe(2);
		expect(countEvents(events, "text_start")).toBe(1);
		expect(countEvents(events, "text_delta")).toBe(1);
		expect(countEvents(events, "text_end")).toBe(1);
		expect(countEvents(events, "done")).toBe(1);
		expect(result.stopReason).toBe("stop");
		expect(result.content).toEqual([{ type: "text", text: "recovered" }]);
	});

	it("does not retry malformed envelopes after partial tool-call content starts streaming", async () => {
		let attempt = 0;
		vi.spyOn(Messages.prototype, "create").mockImplementation(() => {
			attempt += 1;
			return createMockRequest(createMalformedToolUseEvents()) as never;
		});

		const stream = streamAnthropic(model, context, { apiKey: "sk-ant-test" });
		const events: AssistantMessageEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}
		const result = await stream.result();

		expect(attempt).toBe(1);
		expect(countEvents(events, "toolcall_start")).toBe(1);
		expect(countEvents(events, "toolcall_delta")).toBe(1);
		expect(countEvents(events, "toolcall_end")).toBe(1);
		expect(countEvents(events, "error")).toBe(1);
		expect(countEvents(events, "done")).toBe(0);
		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toContain("stream ended before terminal stop signal");

		const toolCall = result.content[0];
		expect(toolCall?.type).toBe("toolCall");
		if (!toolCall || toolCall.type !== "toolCall") {
			throw new Error("Expected toolCall content in terminal error payload");
		}
		expect("partialJson" in toolCall).toBe(false);
	});
});
