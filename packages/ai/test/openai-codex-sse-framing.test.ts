import { afterEach, describe, expect, it, vi } from "vitest";
import { streamOpenAICodexResponses } from "../src/providers/openai-codex-responses.ts";
import type { Model } from "../src/types.ts";

const model: Model<"openai-codex-responses"> = {
	id: "gpt-5.1-codex",
	name: "test",
	api: "openai-codex-responses",
	provider: "openai-codex",
	baseUrl: "https://chatgpt.com/backend-api",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 400000,
	maxTokens: 128000,
};
const payload = Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "test" } })).toString(
	"base64",
);

const events = [
	{ type: "response.output_item.added", item: { type: "message", id: "msg", role: "assistant", content: [] } },
	{ type: "response.content_part.added", part: { type: "output_text", text: "" } },
	{ type: "response.output_text.delta", delta: "안녕하세요" },
	{ type: "response.completed", response: { status: "completed", usage: { input_tokens: 1, output_tokens: 1 } } },
];

afterEach(() => vi.unstubAllGlobals());

describe("Codex SSE framing", () => {
	// The SSE spec allows LF, CRLF and a bare CR as line terminators.
	for (const newline of ["\n", "\r\n", "\r"]) {
		for (const byteChunks of [false, true]) {
			it(`delivers ${JSON.stringify(newline)} events before EOF (${byteChunks ? "byte" : "whole"} chunks)`, async () => {
				let cancelled = false;
				const data = new TextEncoder().encode(
					events.map((event) => `data: ${JSON.stringify(event)}${newline}${newline}`).join(""),
				);
				const body = new ReadableStream<Uint8Array>({
					start(controller) {
						if (byteChunks) {
							for (const byte of data) controller.enqueue(Uint8Array.of(byte));
						} else controller.enqueue(data);
						// Keep the body open: completion must not depend on a network disconnect.
					},
					cancel() {
						cancelled = true;
					},
				});
				vi.stubGlobal(
					"fetch",
					vi.fn(async () => new Response(body)),
				);
				const abort = new AbortController();
				const stream = streamOpenAICodexResponses(
					model,
					{ messages: [] },
					{
						apiKey: `aaa.${payload}.bbb`,
						transport: "sse",
						signal: abort.signal,
					},
				);
				let text = "";
				let done = false;
				const consume = (async () => {
					for await (const event of stream) {
						if (event.type === "text_delta") text += event.delta;
						if (event.type === "done") done = true;
					}
				})();
				try {
					await vi.waitFor(() => expect(done).toBe(true), { timeout: 500, interval: 10 });
					expect(text).toBe("안녕하세요");
					expect(cancelled).toBe(true);
				} finally {
					abort.abort();
					await consume;
				}
			});
		}
	}
});
