import { afterEach, describe, expect, it, vi } from "vitest";
import { getModel } from "../src/models.ts";
import {
	getOpenAICodexWebSocketDebugStats,
	streamOpenAICodexResponses,
} from "../src/providers/openai-codex-responses.ts";
import { cleanupSessionResources } from "../src/session-resources.ts";
import type { Context } from "../src/types.ts";

const model = getModel("openai-codex", "gpt-5.6-sol");
const context: Context = { messages: [{ role: "user", content: "test", timestamp: 0 }] };

function mockToken(): string {
	const payload = Buffer.from(
		JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acc_test" } }),
		"utf8",
	).toString("base64");
	return `aaa.${payload}.bbb`;
}

function sseResponse(event: Record<string, unknown>): Response {
	return new Response(`data: ${JSON.stringify(event)}\n\n`, {
		status: 200,
		headers: { "content-type": "text/event-stream" },
	});
}

afterEach(() => {
	cleanupSessionResources();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("OpenAI Codex terminal and retry boundaries", () => {
	it.each(["failed", "cancelled", "queued", "in_progress", "unknown", undefined])(
		"maps completed status %s to an error terminal",
		async (status) => {
			vi.stubGlobal(
				"fetch",
				vi.fn(async () =>
					sseResponse({
						type: "response.completed",
						response: {
							status,
							usage: {
								input_tokens: 5,
								output_tokens: 3,
								total_tokens: 8,
								input_tokens_details: { cached_tokens: 0 },
							},
						},
					}),
				),
			);
			const stream = streamOpenAICodexResponses(model, context, { apiKey: mockToken(), transport: "sse" });
			const terminals: string[] = [];
			for await (const event of stream) {
				if (event.type === "done" || event.type === "error") terminals.push(event.type);
			}
			const result = await stream.result();

			expect(terminals).toEqual(["error"]);
			expect(result.stopReason).toBe("error");
			expect(result.usage).toMatchObject({ input: 5, output: 3, totalTokens: 8 });
		},
	);

	it("cleans MoA child WebSocket state with the parent session", async () => {
		vi.stubGlobal("WebSocket", undefined);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				sseResponse({
					type: "response.completed",
					response: { status: "completed", usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } },
				}),
			),
		);
		await streamOpenAICodexResponses(model, context, {
			apiKey: mockToken(),
			sessionId: "parent:moa:sol",
			transport: "auto",
		}).result();

		expect(getOpenAICodexWebSocketDebugStats("parent:moa:sol")).toBeDefined();
		cleanupSessionResources("parent");
		expect(getOpenAICodexWebSocketDebugStats("parent:moa:sol")).toBeUndefined();
	});

	it.each(["failed", "cancelled"])("maps WebSocket status %s to an error terminal", async (status) => {
		class MockWebSocket {
			static readonly OPEN = 1;
			readonly readyState = MockWebSocket.OPEN;
			private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

			constructor() {
				queueMicrotask(() => this.dispatch("open", {}));
			}

			addEventListener(type: string, listener: (event: unknown) => void): void {
				const listeners = this.listeners.get(type) ?? new Set();
				listeners.add(listener);
				this.listeners.set(type, listeners);
			}

			removeEventListener(type: string, listener: (event: unknown) => void): void {
				this.listeners.get(type)?.delete(listener);
			}

			send(): void {
				queueMicrotask(() =>
					this.dispatch("message", {
						data: JSON.stringify({
							type: "response.completed",
							response: {
								status,
								usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 },
							},
						}),
					}),
				);
			}

			close(): void {}

			private dispatch(type: string, event: unknown): void {
				for (const listener of this.listeners.get(type) ?? []) listener(event);
			}
		}
		vi.stubGlobal("WebSocket", MockWebSocket);

		const stream = streamOpenAICodexResponses(model, context, {
			apiKey: mockToken(),
			sessionId: `ws-${status}`,
			transport: "websocket",
		});
		const terminals: string[] = [];
		for await (const event of stream) {
			if (event.type === "done" || event.type === "error") terminals.push(event.type);
		}
		const result = await stream.result();

		expect(terminals).toEqual(["error"]);
		expect(result.stopReason).toBe("error");
		expect(result.usage).toMatchObject({ input: 5, output: 3, totalTokens: 8 });
	});

	it("fails closed when SSE ends without a terminal event", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("", { status: 200, headers: { "content-type": "text/event-stream" } })),
		);

		const result = await streamOpenAICodexResponses(model, context, {
			apiKey: mockToken(),
			transport: "sse",
		}).result();

		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toBe("Codex stream ended without a terminal event");
	});

	it("does not retry observer failures", async () => {
		const fetchMock = vi.fn(async () => new Response(new ReadableStream(), { status: 500 }));
		vi.stubGlobal("fetch", fetchMock);

		const result = await streamOpenAICodexResponses(model, context, {
			apiKey: mockToken(),
			maxRetries: 2,
			onResponse: async () => {
				throw new Error("observer failed");
			},
			transport: "sse",
		}).result();

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(result.errorMessage).toBe("observer failed");
	});

	it("does not retry a non-retryable HTTP error", async () => {
		const fetchMock = vi.fn(
			async () =>
				new Response(JSON.stringify({ error: { message: "bad request" } }), {
					status: 400,
					headers: { "content-type": "application/json" },
				}),
		);
		vi.stubGlobal("fetch", fetchMock);

		const result = await streamOpenAICodexResponses(model, context, {
			apiKey: mockToken(),
			maxRetries: 2,
			transport: "sse",
		}).result();

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(result.stopReason).toBe("error");
	});
});
