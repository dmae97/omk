import { afterEach, describe, expect, it, vi } from "bun:test";
import {
	getOpenAICodexTransportDetails,
	prewarmOpenAICodexResponses,
	streamOpenAICodexResponses,
} from "@oh-my-pi/pi-ai/providers/openai-codex-responses";
import type { Context, Model, ProviderSessionState } from "@oh-my-pi/pi-ai/types";
import { getAgentDir, setAgentDir, TempDir } from "@oh-my-pi/pi-utils";

const originalFetch = global.fetch;
const originalAgentDir = getAgentDir();
const originalWebSocket = global.WebSocket;
const originalCodexWebSocketRetryBudget = Bun.env.PI_CODEX_WEBSOCKET_RETRY_BUDGET;
const originalCodexWebSocketRetryDelayMs = Bun.env.PI_CODEX_WEBSOCKET_RETRY_DELAY_MS;
const originalCodexWebSocketIdleTimeoutMs = Bun.env.PI_CODEX_WEBSOCKET_IDLE_TIMEOUT_MS;
const originalCodexWebSocketV2 = Bun.env.PI_CODEX_WEBSOCKET_V2;

function restoreEnv(name: string, value: string | undefined): void {
	if (value === undefined) {
		delete Bun.env[name];
		return;
	}
	Bun.env[name] = value;
}

afterEach(() => {
	global.fetch = originalFetch;
	global.WebSocket = originalWebSocket;
	setAgentDir(originalAgentDir);
	restoreEnv("PI_CODEX_WEBSOCKET_RETRY_BUDGET", originalCodexWebSocketRetryBudget);
	restoreEnv("PI_CODEX_WEBSOCKET_RETRY_DELAY_MS", originalCodexWebSocketRetryDelayMs);
	restoreEnv("PI_CODEX_WEBSOCKET_IDLE_TIMEOUT_MS", originalCodexWebSocketIdleTimeoutMs);
	restoreEnv("PI_CODEX_WEBSOCKET_V2", originalCodexWebSocketV2);
	vi.restoreAllMocks();
});

describe("openai-codex streaming", () => {
	it("streams SSE responses into AssistantMessageEventStream", async () => {
		const tempDir = TempDir.createSync("@pi-codex-stream-");
		setAgentDir(tempDir.path());

		const payload = Buffer.from(
			JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acc_test" } }),
			"utf8",
		).toBase64();
		const token = `aaa.${payload}.bbb`;

		const sse = `${[
			`data: ${JSON.stringify({
				type: "response.output_item.added",
				item: { type: "message", id: "msg_1", role: "assistant", status: "in_progress", content: [] },
			})}`,
			`data: ${JSON.stringify({ type: "response.content_part.added", part: { type: "output_text", text: "" } })}`,
			`data: ${JSON.stringify({ type: "response.output_text.delta", delta: "Hello" })}`,
			`data: ${JSON.stringify({
				type: "response.output_item.done",
				item: {
					type: "message",
					id: "msg_1",
					role: "assistant",
					status: "completed",
					content: [{ type: "output_text", text: "Hello" }],
				},
			})}`,
			`data: ${JSON.stringify({
				type: "response.completed",
				response: {
					status: "completed",
					usage: {
						input_tokens: 5,
						output_tokens: 3,
						total_tokens: 8,
						input_tokens_details: { cached_tokens: 0 },
					},
				},
			})}`,
		].join("\n\n")}\n\n`;

		const encoder = new TextEncoder();
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoder.encode(sse));
				controller.close();
			},
		});

		const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
			const url = typeof input === "string" ? input : input.toString();
			if (url === "https://api.github.com/repos/openai/codex/releases/latest") {
				return new Response(JSON.stringify({ tag_name: "rust-v0.0.0" }), { status: 200 });
			}
			if (url.startsWith("https://raw.githubusercontent.com/openai/codex/")) {
				return new Response("PROMPT", { status: 200, headers: { etag: '"etag"' } });
			}
			if (url === "https://chatgpt.com/backend-api/codex/responses") {
				const headers = init?.headers instanceof Headers ? init.headers : undefined;
				expect(headers?.get("Authorization")).toBe(`Bearer ${token}`);
				expect(headers?.get("chatgpt-account-id")).toBe("acc_test");
				expect(headers?.get("OpenAI-Beta")).toBe("responses=experimental");
				expect(headers?.get("originator")).toBe("pi");
				expect(headers?.get("accept")).toBe("text/event-stream");
				expect(headers?.has("x-api-key")).toBe(false);
				return new Response(stream, {
					status: 200,
					headers: { "content-type": "text/event-stream" },
				});
			}
			return new Response("not found", { status: 404 });
		});

		global.fetch = fetchMock as unknown as typeof fetch;

		const model: Model<"openai-codex-responses"> = {
			id: "gpt-5.1-codex",
			name: "GPT-5.1 Codex",
			api: "openai-codex-responses",
			provider: "openai-codex",
			baseUrl: "https://chatgpt.com/backend-api",
			reasoning: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 400000,
			maxTokens: 128000,
		};

		const context: Context = {
			systemPrompt: "You are a helpful assistant.",
			messages: [{ role: "user", content: "Say hello", timestamp: Date.now() }],
		};

		const streamResult = streamOpenAICodexResponses(model, context, { apiKey: token });
		let sawTextDelta = false;
		let sawDone = false;

		for await (const event of streamResult) {
			if (event.type === "text_delta") {
				sawTextDelta = true;
			}
			if (event.type === "done") {
				sawDone = true;
				expect(event.message.content.find(c => c.type === "text")?.text).toBe("Hello");
			}
		}

		expect(sawTextDelta).toBe(true);
		expect(sawDone).toBe(true);
	});

	it("fails truncated SSE streams that never emit a terminal response event", async () => {
		const tempDir = TempDir.createSync("@pi-codex-stream-");
		setAgentDir(tempDir.path());

		const payload = Buffer.from(
			JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acc_test" } }),
			"utf8",
		).toBase64();
		const token = `aaa.${payload}.bbb`;

		const sse = `${[
			`data: ${JSON.stringify({
				type: "response.output_item.added",
				item: { type: "message", id: "msg_1", role: "assistant", status: "in_progress", content: [] },
			})}`,
			`data: ${JSON.stringify({ type: "response.content_part.added", part: { type: "output_text", text: "" } })}`,
			`data: ${JSON.stringify({ type: "response.output_text.delta", delta: "Hello" })}`,
			`data: ${JSON.stringify({
				type: "response.output_item.done",
				item: {
					type: "message",
					id: "msg_1",
					role: "assistant",
					status: "completed",
					content: [{ type: "output_text", text: "Hello" }],
				},
			})}`,
		].join("\n\n")}\n\n`;

		const fetchMock = vi.fn(async (input: string | URL) => {
			const url = typeof input === "string" ? input : input.toString();
			if (url === "https://chatgpt.com/backend-api/codex/responses") {
				return new Response(sse, {
					status: 200,
					headers: { "content-type": "text/event-stream" },
				});
			}
			return new Response("not found", { status: 404 });
		});
		global.fetch = fetchMock as unknown as typeof fetch;

		const model: Model<"openai-codex-responses"> = {
			id: "gpt-5.1-codex",
			name: "GPT-5.1 Codex",
			api: "openai-codex-responses",
			provider: "openai-codex",
			baseUrl: "https://chatgpt.com/backend-api",
			reasoning: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 400000,
			maxTokens: 128000,
		};

		const context: Context = {
			systemPrompt: "You are a helpful assistant.",
			messages: [{ role: "user", content: "Say hello", timestamp: Date.now() }],
		};

		const result = await streamOpenAICodexResponses(model, context, { apiKey: token }).result();
		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toContain("terminal completion event");
	});

	it("surfaces 429 errors after retry budget checks without body reuse failures", async () => {
		const tempDir = TempDir.createSync("@pi-codex-stream-");
		setAgentDir(tempDir.path());

		const payload = Buffer.from(
			JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acc_test" } }),
			"utf8",
		).toBase64();
		const token = `aaa.${payload}.bbb`;

		const fetchMock = vi.fn(async (input: string | URL) => {
			const url = typeof input === "string" ? input : input.toString();
			if (url === "https://chatgpt.com/backend-api/codex/responses") {
				return new Response(
					JSON.stringify({
						error: {
							code: "rate_limit_exceeded",
							message: "too many requests",
						},
					}),
					{
						status: 429,
						headers: {
							"content-type": "application/json",
							"retry-after": "600",
						},
					},
				);
			}
			return new Response("not found", { status: 404 });
		});
		global.fetch = fetchMock as unknown as typeof fetch;

		const model: Model<"openai-codex-responses"> = {
			id: "gpt-5.1-codex",
			name: "GPT-5.1 Codex",
			api: "openai-codex-responses",
			provider: "openai-codex",
			baseUrl: "https://chatgpt.com/backend-api",
			reasoning: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 400000,
			maxTokens: 128000,
		};

		const context: Context = {
			systemPrompt: "You are a helpful assistant.",
			messages: [{ role: "user", content: "Say hello", timestamp: Date.now() }],
		};

		const result = await streamOpenAICodexResponses(model, context, { apiKey: token }).result();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(result.stopReason).toBe("error");
		expect((result.errorMessage ?? "").toLowerCase()).toContain("rate limit");
		expect(result.errorMessage).not.toContain("Body already used");
	});

	it("sets conversation_id/session_id headers and prompt_cache_key when sessionId is provided", async () => {
		const tempDir = TempDir.createSync("@pi-codex-stream-");
		setAgentDir(tempDir.path());

		const payload = Buffer.from(
			JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acc_test" } }),
			"utf8",
		).toBase64();
		const token = `aaa.${payload}.bbb`;

		const sse = `${[
			`data: ${JSON.stringify({
				type: "response.output_item.added",
				item: { type: "message", id: "msg_1", role: "assistant", status: "in_progress", content: [] },
			})}`,
			`data: ${JSON.stringify({ type: "response.content_part.added", part: { type: "output_text", text: "" } })}`,
			`data: ${JSON.stringify({ type: "response.output_text.delta", delta: "Hello" })}`,
			`data: ${JSON.stringify({
				type: "response.output_item.done",
				item: {
					type: "message",
					id: "msg_1",
					role: "assistant",
					status: "completed",
					content: [{ type: "output_text", text: "Hello" }],
				},
			})}`,
			`data: ${JSON.stringify({
				type: "response.completed",
				response: {
					status: "completed",
					usage: {
						input_tokens: 5,
						output_tokens: 3,
						total_tokens: 8,
						input_tokens_details: { cached_tokens: 0 },
					},
				},
			})}`,
		].join("\n\n")}\n\n`;

		const encoder = new TextEncoder();
		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue(encoder.encode(sse));
				controller.close();
			},
		});

		const sessionId = "test-session-123";
		const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
			const url = typeof input === "string" ? input : input.toString();
			if (url === "https://api.github.com/repos/openai/codex/releases/latest") {
				return new Response(JSON.stringify({ tag_name: "rust-v0.0.0" }), { status: 200 });
			}
			if (url.startsWith("https://raw.githubusercontent.com/openai/codex/")) {
				return new Response("PROMPT", { status: 200, headers: { etag: '"etag"' } });
			}
			if (url === "https://chatgpt.com/backend-api/codex/responses") {
				const headers = init?.headers instanceof Headers ? init.headers : undefined;
				// Verify sessionId is set in headers
				expect(headers?.get("conversation_id")).toBe(sessionId);
				expect(headers?.get("session_id")).toBe(sessionId);

				// Verify sessionId is set in request body as prompt_cache_key
				const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
				expect(body?.prompt_cache_key).toBe(sessionId);

				return new Response(stream, {
					status: 200,
					headers: { "content-type": "text/event-stream" },
				});
			}
			return new Response("not found", { status: 404 });
		});

		global.fetch = fetchMock as unknown as typeof fetch;

		const model: Model<"openai-codex-responses"> = {
			id: "gpt-5.1-codex",
			name: "GPT-5.1 Codex",
			api: "openai-codex-responses",
			provider: "openai-codex",
			baseUrl: "https://chatgpt.com/backend-api",
			reasoning: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 400000,
			maxTokens: 128000,
		};

		const context: Context = {
			systemPrompt: "You are a helpful assistant.",
			messages: [{ role: "user", content: "Say hello", timestamp: Date.now() }],
		};

		const streamResult = streamOpenAICodexResponses(model, context, { apiKey: token, sessionId });
		await streamResult.result();
	});

	it("clamps gpt-5.3-codex minimal reasoning effort to low", async () => {
		const tempDir = TempDir.createSync("@pi-codex-stream-");
		setAgentDir(tempDir.path());

		const payload = Buffer.from(
			JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acc_test" } }),
			"utf8",
		).toBase64();
		const token = `aaa.${payload}.bbb`;

		const sse = `${[
			`data: ${JSON.stringify({
				type: "response.output_item.added",
				item: { type: "message", id: "msg_1", role: "assistant", status: "in_progress", content: [] },
			})}`,
			`data: ${JSON.stringify({ type: "response.content_part.added", part: { type: "output_text", text: "" } })}`,
			`data: ${JSON.stringify({ type: "response.output_text.delta", delta: "Hello" })}`,
			`data: ${JSON.stringify({
				type: "response.output_item.done",
				item: {
					type: "message",
					id: "msg_1",
					role: "assistant",
					status: "completed",
					content: [{ type: "output_text", text: "Hello" }],
				},
			})}`,
			`data: ${JSON.stringify({
				type: "response.completed",
				response: {
					status: "completed",
					usage: {
						input_tokens: 5,
						output_tokens: 3,
						total_tokens: 8,
						input_tokens_details: { cached_tokens: 0 },
					},
				},
			})}`,
		].join("\n\n")}\n\n`;

		const encoder = new TextEncoder();
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoder.encode(sse));
				controller.close();
			},
		});

		const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
			const url = typeof input === "string" ? input : input.toString();
			if (url === "https://api.github.com/repos/openai/codex/releases/latest") {
				return new Response(JSON.stringify({ tag_name: "rust-v0.0.0" }), { status: 200 });
			}
			if (url.startsWith("https://raw.githubusercontent.com/openai/codex/")) {
				return new Response("PROMPT", { status: 200, headers: { etag: '"etag"' } });
			}
			if (url === "https://chatgpt.com/backend-api/codex/responses") {
				const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
				expect(body?.reasoning).toEqual({ effort: "low", summary: "auto" });

				return new Response(stream, {
					status: 200,
					headers: { "content-type": "text/event-stream" },
				});
			}
			return new Response("not found", { status: 404 });
		});

		global.fetch = fetchMock as unknown as typeof fetch;

		const model: Model<"openai-codex-responses"> = {
			id: "gpt-5.3-codex",
			name: "GPT-5.3 Codex",
			api: "openai-codex-responses",
			provider: "openai-codex",
			baseUrl: "https://chatgpt.com/backend-api",
			reasoning: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 400000,
			maxTokens: 128000,
		};

		const context: Context = {
			systemPrompt: "You are a helpful assistant.",
			messages: [{ role: "user", content: "Say hello", timestamp: Date.now() }],
		};

		const streamResult = streamOpenAICodexResponses(model, context, {
			apiKey: token,
			reasoningEffort: "minimal",
		});
		await streamResult.result();
	});

	it("does not set conversation_id/session_id headers when sessionId is not provided", async () => {
		const tempDir = TempDir.createSync("@pi-codex-stream-");
		setAgentDir(tempDir.path());

		const payload = Buffer.from(
			JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acc_test" } }),
			"utf8",
		).toBase64();
		const token = `aaa.${payload}.bbb`;

		const sse = `${[
			`data: ${JSON.stringify({
				type: "response.output_item.added",
				item: { type: "message", id: "msg_1", role: "assistant", status: "in_progress", content: [] },
			})}`,
			`data: ${JSON.stringify({ type: "response.content_part.added", part: { type: "output_text", text: "" } })}`,
			`data: ${JSON.stringify({ type: "response.output_text.delta", delta: "Hello" })}`,
			`data: ${JSON.stringify({
				type: "response.output_item.done",
				item: {
					type: "message",
					id: "msg_1",
					role: "assistant",
					status: "completed",
					content: [{ type: "output_text", text: "Hello" }],
				},
			})}`,
			`data: ${JSON.stringify({
				type: "response.completed",
				response: {
					status: "completed",
					usage: {
						input_tokens: 5,
						output_tokens: 3,
						total_tokens: 8,
						input_tokens_details: { cached_tokens: 0 },
					},
				},
			})}`,
		].join("\n\n")}\n\n`;

		const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
			const url = typeof input === "string" ? input : input.toString();
			if (url === "https://api.github.com/repos/openai/codex/releases/latest") {
				return new Response(JSON.stringify({ tag_name: "rust-v0.0.0" }), { status: 200 });
			}
			if (url.startsWith("https://raw.githubusercontent.com/openai/codex/")) {
				return new Response("PROMPT", { status: 200, headers: { etag: '"etag"' } });
			}
			if (url === "https://chatgpt.com/backend-api/codex/responses") {
				const headers = init?.headers instanceof Headers ? init.headers : undefined;
				// Verify headers are not set when sessionId is not provided
				expect(headers?.has("conversation_id")).toBe(false);
				expect(headers?.has("session_id")).toBe(false);

				return new Response(sse, {
					status: 200,
					headers: { "content-type": "text/event-stream" },
				});
			}
			return new Response("not found", { status: 404 });
		});

		global.fetch = fetchMock as unknown as typeof fetch;

		const model: Model<"openai-codex-responses"> = {
			id: "gpt-5.1-codex",
			name: "GPT-5.1 Codex",
			api: "openai-codex-responses",
			provider: "openai-codex",
			baseUrl: "https://chatgpt.com/backend-api",
			reasoning: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 400000,
			maxTokens: 128000,
		};

		const context: Context = {
			systemPrompt: "You are a helpful assistant.",
			messages: [{ role: "user", content: "Say hello", timestamp: Date.now() }],
		};

		// No sessionId provided
		const streamResult = streamOpenAICodexResponses(model, context, { apiKey: token });
		await streamResult.result();
	});

	it("falls back to SSE when websocket connect fails", async () => {
		const tempDir = TempDir.createSync("@pi-codex-stream-");
		setAgentDir(tempDir.path());
		const payload = Buffer.from(
			JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acc_test" } }),
			"utf8",
		).toBase64();
		const token = `aaa.${payload}.bbb`;
		Bun.env.PI_CODEX_WEBSOCKET_RETRY_BUDGET = "0";
		Bun.env.PI_CODEX_WEBSOCKET_RETRY_DELAY_MS = "1";
		const sse = `${[
			`data: ${JSON.stringify({ type: "response.content_part.added", part: { type: "output_text", text: "" } })}`,
			`data: ${JSON.stringify({ type: "response.output_text.delta", delta: "Hello" })}`,
			`data: ${JSON.stringify({ type: "response.output_item.done", item: { type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Hello" }] } })}`,
			`data: ${JSON.stringify({ type: "response.completed", response: { status: "completed", usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8, input_tokens_details: { cached_tokens: 0 } } } })}`,
		].join("\n\n")}\n\n`;

		const fetchMock = vi.fn(async (input: string | URL) => {
			const url = typeof input === "string" ? input : input.toString();
			if (url === "https://chatgpt.com/backend-api/codex/responses") {
				return new Response(sse, {
					status: 200,
					headers: { "content-type": "text/event-stream" },
				});
			}
			return new Response("not found", { status: 404 });
		});
		global.fetch = fetchMock as unknown as typeof fetch;
		type WsListener = (event: Event) => void;
		class FailingWebSocket {
			static readonly CONNECTING = 0;
			static readonly OPEN = 1;
			static readonly CLOSING = 2;
			static readonly CLOSED = 3;
			readyState = FailingWebSocket.CONNECTING;
			#listeners = new Map<string, Set<WsListener>>();
			url: string;
			options?: { headers?: Record<string, string> };

			constructor(url: string, options?: { headers?: Record<string, string> }) {
				this.url = url;
				this.options = options;
				setTimeout(() => {
					expect(this.options?.headers?.["OpenAI-Beta"] ?? this.options?.headers?.["openai-beta"]).toBe(
						"responses_websockets=2026-02-04",
					);
					this.#emit("error", new Event("error"));
					this.#emit("close", new Event("close"));
					this.readyState = FailingWebSocket.CLOSED;
				}, 0);
			}
			addEventListener(type: string, listener: unknown): void {
				if (typeof listener !== "function") return;
				const listeners = this.#listeners.get(type) ?? new Set<WsListener>();
				listeners.add(listener as WsListener);
				this.#listeners.set(type, listeners);
			}
			removeEventListener(type: string, listener: unknown): void {
				if (typeof listener !== "function") return;
				const listeners = this.#listeners.get(type);
				listeners?.delete(listener as WsListener);
			}

			send(): void {}
			close(): void {
				this.readyState = FailingWebSocket.CLOSED;
			}
			#emit(type: string, event: Event): void {
				const listeners = this.#listeners.get(type);
				if (!listeners) return;
				for (const listener of listeners) {
					listener(event);
				}
			}
		}

		global.WebSocket = FailingWebSocket as unknown as typeof WebSocket;
		const model: Model<"openai-codex-responses"> = {
			id: "gpt-5.3-codex-spark",
			name: "GPT-5.3 Codex Spark",
			api: "openai-codex-responses",
			provider: "openai-codex",
			baseUrl: "https://chatgpt.com/backend-api",
			reasoning: true,
			preferWebsockets: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 128000,
		};
		const context: Context = {
			systemPrompt: "You are a helpful assistant.",
			messages: [{ role: "user", content: "Say hello", timestamp: Date.now() }],
		};
		const providerSessionState = new Map<string, ProviderSessionState>();
		const streamResult = streamOpenAICodexResponses(model, context, {
			apiKey: token,
			sessionId: "ws-session",
			providerSessionState,
		});
		const result = await streamResult.result();
		expect(result.role).toBe("assistant");
		expect(fetchMock).toHaveBeenCalled();
		const fallbackDetails = getOpenAICodexTransportDetails(model, { sessionId: "ws-session", providerSessionState });
		expect(fallbackDetails.lastTransport).toBe("sse");
		expect(fallbackDetails.websocketDisabled).toBe(true);
		expect(fallbackDetails.fallbackCount).toBe(1);
	});

	it("retries websocket failures before activating sticky fallback", async () => {
		const tempDir = TempDir.createSync("@pi-codex-stream-");
		setAgentDir(tempDir.path());
		Bun.env.PI_CODEX_WEBSOCKET_RETRY_BUDGET = "1";
		Bun.env.PI_CODEX_WEBSOCKET_RETRY_DELAY_MS = "1";

		const payload = Buffer.from(
			JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acc_test" } }),
			"utf8",
		).toBase64();
		const token = `aaa.${payload}.bbb`;

		const fetchMock = vi.fn(async () => {
			throw new Error("SSE fallback should not be called when websocket retry succeeds");
		});
		global.fetch = fetchMock as unknown as typeof fetch;

		type WsListener = (event: Event) => void;
		let constructorCount = 0;
		class FlakyWebSocket {
			static readonly CONNECTING = 0;
			static readonly OPEN = 1;
			static readonly CLOSING = 2;
			static readonly CLOSED = 3;
			readyState = FlakyWebSocket.CONNECTING;
			#listeners = new Map<string, Set<WsListener>>();
			#attempt: number;

			constructor(_url: string, _options?: { headers?: Record<string, string> }) {
				constructorCount += 1;
				this.#attempt = constructorCount;
				setTimeout(() => {
					if (this.#attempt === 1) {
						this.#emit("error", new Event("error"));
						this.#emit("close", new Event("close"));
						this.readyState = FlakyWebSocket.CLOSED;
						return;
					}
					this.readyState = FlakyWebSocket.OPEN;
					this.#emit("open", new Event("open"));
				}, 0);
			}

			addEventListener(type: string, listener: unknown): void {
				if (typeof listener !== "function") return;
				const listeners = this.#listeners.get(type) ?? new Set<WsListener>();
				listeners.add(listener as WsListener);
				this.#listeners.set(type, listeners);
			}

			removeEventListener(type: string, listener: unknown): void {
				if (typeof listener !== "function") return;
				const listeners = this.#listeners.get(type);
				listeners?.delete(listener as WsListener);
			}

			send(): void {
				this.#emit("message", {
					data: JSON.stringify({
						type: "response.output_item.added",
						item: { type: "message", id: "msg_retry", role: "assistant", status: "in_progress", content: [] },
					}),
				} as unknown as Event);
				this.#emit("message", {
					data: JSON.stringify({ type: "response.content_part.added", part: { type: "output_text", text: "" } }),
				} as unknown as Event);
				this.#emit("message", {
					data: JSON.stringify({ type: "response.output_text.delta", delta: "Hello retry" }),
				} as unknown as Event);
				this.#emit("message", {
					data: JSON.stringify({
						type: "response.output_item.done",
						item: {
							type: "message",
							id: "msg_retry",
							role: "assistant",
							status: "completed",
							content: [{ type: "output_text", text: "Hello retry" }],
						},
					}),
				} as unknown as Event);
				this.#emit("message", {
					data: JSON.stringify({
						type: "response.done",
						response: {
							id: "resp_retry",
							status: "completed",
							usage: {
								input_tokens: 5,
								output_tokens: 3,
								total_tokens: 8,
								input_tokens_details: { cached_tokens: 0 },
							},
						},
					}),
				} as unknown as Event);
			}

			close(): void {
				this.readyState = FlakyWebSocket.CLOSED;
			}

			#emit(type: string, event: Event): void {
				const listeners = this.#listeners.get(type);
				if (!listeners) return;
				for (const listener of listeners) {
					listener(event);
				}
			}
		}

		global.WebSocket = FlakyWebSocket as unknown as typeof WebSocket;

		const model: Model<"openai-codex-responses"> = {
			id: "gpt-5.3-codex-spark",
			name: "GPT-5.3 Codex Spark",
			api: "openai-codex-responses",
			provider: "openai-codex",
			baseUrl: "https://chatgpt.com/backend-api",
			reasoning: true,
			preferWebsockets: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 128000,
		};
		const context: Context = {
			systemPrompt: "You are a helpful assistant.",
			messages: [{ role: "user", content: "Say hello", timestamp: Date.now() }],
		};
		const providerSessionState = new Map<string, ProviderSessionState>();
		const result = await streamOpenAICodexResponses(model, context, {
			apiKey: token,
			sessionId: "ws-retry-session",
			providerSessionState,
		}).result();
		expect(result.role).toBe("assistant");
		expect(constructorCount).toBe(2);
		expect(fetchMock).not.toHaveBeenCalled();
		const transportDetails = getOpenAICodexTransportDetails(model, {
			sessionId: "ws-retry-session",
			providerSessionState,
		});
		expect(transportDetails.lastTransport).toBe("websocket");
		expect(transportDetails.websocketDisabled).toBe(false);
		expect(transportDetails.fallbackCount).toBe(0);
	});

	it("captures websocket handshake metadata and replays it on later SSE requests", async () => {
		const tempDir = TempDir.createSync("@pi-codex-stream-");
		setAgentDir(tempDir.path());

		const payload = Buffer.from(
			JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acc_test" } }),
			"utf8",
		).toBase64();
		const token = `aaa.${payload}.bbb`;

		const sse = `${[
			`data: ${JSON.stringify({ type: "response.output_item.added", item: { type: "message", id: "msg_sse", role: "assistant", status: "in_progress", content: [] } })}`,
			`data: ${JSON.stringify({ type: "response.content_part.added", part: { type: "output_text", text: "" } })}`,
			`data: ${JSON.stringify({ type: "response.output_text.delta", delta: "Hello SSE" })}`,
			`data: ${JSON.stringify({ type: "response.output_item.done", item: { type: "message", id: "msg_sse", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Hello SSE" }] } })}`,
			`data: ${JSON.stringify({ type: "response.completed", response: { status: "completed", usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8, input_tokens_details: { cached_tokens: 0 } } } })}`,
		].join("\n\n")}\n\n`;
		const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit) => {
			const headers = init?.headers instanceof Headers ? init.headers : new Headers(init?.headers);
			expect(headers.get("x-codex-turn-state")).toBe("ws-turn-state-1");
			expect(headers.get("x-models-etag")).toBe("models-etag-1");
			return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
		});
		global.fetch = fetchMock as unknown as typeof fetch;

		type WsListener = (event: Event) => void;
		class HandshakeWebSocket {
			static readonly CONNECTING = 0;
			static readonly OPEN = 1;
			static readonly CLOSING = 2;
			static readonly CLOSED = 3;
			readyState = HandshakeWebSocket.CONNECTING;
			handshakeHeaders = {
				"x-codex-turn-state": "ws-turn-state-1",
				"x-models-etag": "models-etag-1",
				"x-reasoning-included": "true",
			};
			#listeners = new Map<string, Set<WsListener>>();

			constructor(_url: string, _options?: { headers?: Record<string, string> }) {
				setTimeout(() => {
					this.readyState = HandshakeWebSocket.OPEN;
					this.#emit("open", new Event("open"));
				}, 0);
			}

			addEventListener(type: string, listener: unknown): void {
				if (typeof listener !== "function") return;
				const listeners = this.#listeners.get(type) ?? new Set<WsListener>();
				listeners.add(listener as WsListener);
				this.#listeners.set(type, listeners);
			}

			removeEventListener(type: string, listener: unknown): void {
				if (typeof listener !== "function") return;
				const listeners = this.#listeners.get(type);
				listeners?.delete(listener as WsListener);
			}

			send(): void {
				this.#emit("message", {
					data: JSON.stringify({
						type: "response.output_item.added",
						item: { type: "message", id: "msg_ws", role: "assistant", status: "in_progress", content: [] },
					}),
				} as unknown as Event);
				this.#emit("message", {
					data: JSON.stringify({ type: "response.content_part.added", part: { type: "output_text", text: "" } }),
				} as unknown as Event);
				this.#emit("message", {
					data: JSON.stringify({ type: "response.output_text.delta", delta: "Hello WS" }),
				} as unknown as Event);
				this.#emit("message", {
					data: JSON.stringify({
						type: "response.output_item.done",
						item: {
							type: "message",
							id: "msg_ws",
							role: "assistant",
							status: "completed",
							content: [{ type: "output_text", text: "Hello WS" }],
						},
					}),
				} as unknown as Event);
				this.#emit("message", {
					data: JSON.stringify({
						type: "response.done",
						response: {
							id: "resp_ws",
							status: "completed",
							usage: {
								input_tokens: 5,
								output_tokens: 3,
								total_tokens: 8,
								input_tokens_details: { cached_tokens: 0 },
							},
						},
					}),
				} as unknown as Event);
			}

			close(): void {
				this.readyState = HandshakeWebSocket.CLOSED;
			}

			#emit(type: string, event: Event): void {
				const listeners = this.#listeners.get(type);
				if (!listeners) return;
				for (const listener of listeners) {
					listener(event);
				}
			}
		}

		global.WebSocket = HandshakeWebSocket as unknown as typeof WebSocket;

		const websocketModel: Model<"openai-codex-responses"> = {
			id: "gpt-5.3-codex-spark",
			name: "GPT-5.3 Codex Spark",
			api: "openai-codex-responses",
			provider: "openai-codex",
			baseUrl: "https://chatgpt.com/backend-api",
			reasoning: true,
			preferWebsockets: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 128000,
		};
		const sseModel: Model<"openai-codex-responses"> = {
			...websocketModel,
			preferWebsockets: false,
		};
		const context: Context = {
			systemPrompt: "You are a helpful assistant.",
			messages: [{ role: "user", content: "Say hello", timestamp: Date.now() }],
		};
		const providerSessionState = new Map<string, ProviderSessionState>();
		await streamOpenAICodexResponses(websocketModel, context, {
			apiKey: token,
			sessionId: "ws-handshake-session",
			providerSessionState,
		}).result();
		await streamOpenAICodexResponses(sseModel, context, {
			apiKey: token,
			sessionId: "ws-handshake-session",
			providerSessionState,
		}).result();
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("uses websocket v2 beta header when v2 mode is enabled", async () => {
		const tempDir = TempDir.createSync("@pi-codex-stream-");
		setAgentDir(tempDir.path());
		Bun.env.PI_CODEX_WEBSOCKET_V2 = "1";

		const payload = Buffer.from(
			JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acc_test" } }),
			"utf8",
		).toBase64();
		const token = `aaa.${payload}.bbb`;

		const fetchMock = vi.fn(async () => {
			throw new Error("SSE fallback should not be called");
		});
		global.fetch = fetchMock as unknown as typeof fetch;

		type WsListener = (event: Event) => void;
		class WebSocketV2HeaderProbe {
			static readonly CONNECTING = 0;
			static readonly OPEN = 1;
			static readonly CLOSING = 2;
			static readonly CLOSED = 3;
			readyState = WebSocketV2HeaderProbe.CONNECTING;
			#listeners = new Map<string, Set<WsListener>>();

			constructor(_url: string, options?: { headers?: Record<string, string> }) {
				expect(options?.headers?.["OpenAI-Beta"] ?? options?.headers?.["openai-beta"]).toBe(
					"responses_websockets=2026-02-06",
				);
				setTimeout(() => {
					this.readyState = WebSocketV2HeaderProbe.OPEN;
					this.#emit("open", new Event("open"));
				}, 0);
			}

			addEventListener(type: string, listener: unknown): void {
				if (typeof listener !== "function") return;
				const listeners = this.#listeners.get(type) ?? new Set<WsListener>();
				listeners.add(listener as WsListener);
				this.#listeners.set(type, listeners);
			}

			removeEventListener(type: string, listener: unknown): void {
				if (typeof listener !== "function") return;
				const listeners = this.#listeners.get(type);
				listeners?.delete(listener as WsListener);
			}

			send(): void {
				this.#emit("message", {
					data: JSON.stringify({
						type: "response.output_item.added",
						item: { type: "message", id: "msg_v2", role: "assistant", status: "in_progress", content: [] },
					}),
				} as unknown as Event);
				this.#emit("message", {
					data: JSON.stringify({ type: "response.content_part.added", part: { type: "output_text", text: "" } }),
				} as unknown as Event);
				this.#emit("message", {
					data: JSON.stringify({ type: "response.output_text.delta", delta: "Hello v2" }),
				} as unknown as Event);
				this.#emit("message", {
					data: JSON.stringify({
						type: "response.output_item.done",
						item: {
							type: "message",
							id: "msg_v2",
							role: "assistant",
							status: "completed",
							content: [{ type: "output_text", text: "Hello v2" }],
						},
					}),
				} as unknown as Event);
				this.#emit("message", {
					data: JSON.stringify({
						type: "response.done",
						response: {
							id: "resp_v2",
							status: "completed",
							usage: {
								input_tokens: 5,
								output_tokens: 3,
								total_tokens: 8,
								input_tokens_details: { cached_tokens: 0 },
							},
						},
					}),
				} as unknown as Event);
			}

			close(): void {
				this.readyState = WebSocketV2HeaderProbe.CLOSED;
			}

			#emit(type: string, event: Event): void {
				const listeners = this.#listeners.get(type);
				if (!listeners) return;
				for (const listener of listeners) {
					listener(event);
				}
			}
		}

		global.WebSocket = WebSocketV2HeaderProbe as unknown as typeof WebSocket;

		const model: Model<"openai-codex-responses"> = {
			id: "gpt-5.3-codex-spark",
			name: "GPT-5.3 Codex Spark",
			api: "openai-codex-responses",
			provider: "openai-codex",
			baseUrl: "https://chatgpt.com/backend-api",
			reasoning: true,
			preferWebsockets: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 128000,
		};
		const context: Context = {
			systemPrompt: "You are a helpful assistant.",
			messages: [{ role: "user", content: "Say hello", timestamp: Date.now() }],
		};
		const providerSessionState = new Map<string, ProviderSessionState>();
		await streamOpenAICodexResponses(model, context, {
			apiKey: token,
			sessionId: "ws-v2-session",
			providerSessionState,
		}).result();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("fails websocket streams with an idle-timeout transport error", async () => {
		const tempDir = TempDir.createSync("@pi-codex-stream-");
		setAgentDir(tempDir.path());
		Bun.env.PI_CODEX_WEBSOCKET_IDLE_TIMEOUT_MS = "10";

		const payload = Buffer.from(
			JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acc_test" } }),
			"utf8",
		).toBase64();
		const token = `aaa.${payload}.bbb`;

		const fetchMock = vi.fn(async () => {
			throw new Error("SSE fallback should not be called for websocket idle timeout");
		});
		global.fetch = fetchMock as unknown as typeof fetch;

		type WsListener = (event: Event) => void;
		class IdleWebSocket {
			static readonly CONNECTING = 0;
			static readonly OPEN = 1;
			static readonly CLOSING = 2;
			static readonly CLOSED = 3;
			readyState = IdleWebSocket.CONNECTING;
			#listeners = new Map<string, Set<WsListener>>();

			constructor(_url: string, _options?: { headers?: Record<string, string> }) {
				setTimeout(() => {
					this.readyState = IdleWebSocket.OPEN;
					this.#emit("open", new Event("open"));
				}, 0);
			}

			addEventListener(type: string, listener: unknown): void {
				if (typeof listener !== "function") return;
				const listeners = this.#listeners.get(type) ?? new Set<WsListener>();
				listeners.add(listener as WsListener);
				this.#listeners.set(type, listeners);
			}

			removeEventListener(type: string, listener: unknown): void {
				if (typeof listener !== "function") return;
				const listeners = this.#listeners.get(type);
				listeners?.delete(listener as WsListener);
			}

			send(): void {}

			close(): void {
				this.readyState = IdleWebSocket.CLOSED;
			}

			#emit(type: string, event: Event): void {
				const listeners = this.#listeners.get(type);
				if (!listeners) return;
				for (const listener of listeners) {
					listener(event);
				}
			}
		}

		global.WebSocket = IdleWebSocket as unknown as typeof WebSocket;

		const model: Model<"openai-codex-responses"> = {
			id: "gpt-5.3-codex-spark",
			name: "GPT-5.3 Codex Spark",
			api: "openai-codex-responses",
			provider: "openai-codex",
			baseUrl: "https://chatgpt.com/backend-api",
			reasoning: true,
			preferWebsockets: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 128000,
		};
		const context: Context = {
			systemPrompt: "You are a helpful assistant.",
			messages: [{ role: "user", content: "Say hello", timestamp: Date.now() }],
		};
		const providerSessionState = new Map<string, ProviderSessionState>();
		const result = await streamOpenAICodexResponses(model, context, {
			apiKey: token,
			sessionId: "ws-idle-timeout-session",
			providerSessionState,
		}).result();
		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toContain("idle timeout waiting for websocket");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("retries websocket stream closes before surfacing transport errors", async () => {
		const tempDir = TempDir.createSync("@pi-codex-stream-");
		setAgentDir(tempDir.path());
		Bun.env.PI_CODEX_WEBSOCKET_RETRY_BUDGET = "1";
		Bun.env.PI_CODEX_WEBSOCKET_RETRY_DELAY_MS = "1";

		const payload = Buffer.from(
			JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acc_test" } }),
			"utf8",
		).toBase64();
		const token = `aaa.${payload}.bbb`;
		const fetchMock = vi.fn(async () => {
			throw new Error("SSE fallback should not be called when websocket retry succeeds");
		});
		global.fetch = fetchMock as unknown as typeof fetch;

		type WsListener = (event: Event) => void;
		let constructorCount = 0;
		const requestTypes: string[] = [];

		class FlakyCloseWebSocket {
			static readonly CONNECTING = 0;
			static readonly OPEN = 1;
			static readonly CLOSING = 2;
			static readonly CLOSED = 3;
			readyState = FlakyCloseWebSocket.CONNECTING;
			#listeners = new Map<string, Set<WsListener>>();

			constructor(_url: string, _options?: { headers?: Record<string, string> }) {
				constructorCount += 1;
				setTimeout(() => {
					this.readyState = FlakyCloseWebSocket.OPEN;
					this.#emit("open", new Event("open"));
				}, 0);
			}

			addEventListener(type: string, listener: unknown): void {
				if (typeof listener !== "function") return;
				const listeners = this.#listeners.get(type) ?? new Set<WsListener>();
				listeners.add(listener as WsListener);
				this.#listeners.set(type, listeners);
			}

			removeEventListener(type: string, listener: unknown): void {
				if (typeof listener !== "function") return;
				const listeners = this.#listeners.get(type);
				listeners?.delete(listener as WsListener);
			}

			send(data: string): void {
				const request = JSON.parse(data) as { type?: string };
				requestTypes.push(typeof request.type === "string" ? request.type : "");
				if (requestTypes.length === 1) {
					this.readyState = FlakyCloseWebSocket.CLOSED;
					this.#emit("close", { code: 1012 } as unknown as Event);
					return;
				}
				this.#emit("message", {
					data: JSON.stringify({
						type: "response.output_item.added",
						item: {
							type: "message",
							id: "msg_retry_close",
							role: "assistant",
							status: "in_progress",
							content: [],
						},
					}),
				} as unknown as Event);
				this.#emit("message", {
					data: JSON.stringify({ type: "response.content_part.added", part: { type: "output_text", text: "" } }),
				} as unknown as Event);
				this.#emit("message", {
					data: JSON.stringify({ type: "response.output_text.delta", delta: "Hello retry close" }),
				} as unknown as Event);
				this.#emit("message", {
					data: JSON.stringify({
						type: "response.output_item.done",
						item: {
							type: "message",
							id: "msg_retry_close",
							role: "assistant",
							status: "completed",
							content: [{ type: "output_text", text: "Hello retry close" }],
						},
					}),
				} as unknown as Event);
				this.#emit("message", {
					data: JSON.stringify({
						type: "response.done",
						response: {
							id: "resp_retry_close",
							status: "completed",
							usage: {
								input_tokens: 5,
								output_tokens: 3,
								total_tokens: 8,
								input_tokens_details: { cached_tokens: 0 },
							},
						},
					}),
				} as unknown as Event);
			}

			close(): void {
				this.readyState = FlakyCloseWebSocket.CLOSED;
			}

			#emit(type: string, event: Event): void {
				const listeners = this.#listeners.get(type);
				if (!listeners) return;
				for (const listener of listeners) {
					listener(event);
				}
			}
		}

		global.WebSocket = FlakyCloseWebSocket as unknown as typeof WebSocket;

		const model: Model<"openai-codex-responses"> = {
			id: "gpt-5.3-codex-spark",
			name: "GPT-5.3 Codex Spark",
			api: "openai-codex-responses",
			provider: "openai-codex",
			baseUrl: "https://chatgpt.com/backend-api",
			reasoning: true,
			preferWebsockets: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 128000,
		};
		const context: Context = {
			systemPrompt: "You are a helpful assistant.",
			messages: [{ role: "user", content: "Say hello", timestamp: Date.now() }],
		};
		const providerSessionState = new Map<string, ProviderSessionState>();
		const result = await streamOpenAICodexResponses(model, context, {
			apiKey: token,
			sessionId: "ws-retry-close-session",
			providerSessionState,
		}).result();

		expect(result.role).toBe("assistant");
		expect(constructorCount).toBe(2);
		expect(requestTypes).toEqual(["response.create", "response.create"]);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("falls back to SSE when websocket becomes unavailable before stream start", async () => {
		const tempDir = TempDir.createSync("@pi-codex-stream-");
		setAgentDir(tempDir.path());
		Bun.env.PI_CODEX_WEBSOCKET_RETRY_BUDGET = "0";
		Bun.env.PI_CODEX_WEBSOCKET_RETRY_DELAY_MS = "1";

		const payload = Buffer.from(
			JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acc_test" } }),
			"utf8",
		).toBase64();
		const token = `aaa.${payload}.bbb`;
		const sse = `${[
			`data: ${JSON.stringify({ type: "response.content_part.added", part: { type: "output_text", text: "" } })}`,
			`data: ${JSON.stringify({ type: "response.output_text.delta", delta: "Hello fallback" })}`,
			`data: ${JSON.stringify({ type: "response.output_item.done", item: { type: "message", id: "msg_ws_unavailable", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Hello fallback" }] } })}`,
			`data: ${JSON.stringify({ type: "response.completed", response: { status: "completed", usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8, input_tokens_details: { cached_tokens: 0 } } } })}`,
		].join("\n\n")}\n\n`;

		const fetchMock = vi.fn(async (input: string | URL) => {
			const url = typeof input === "string" ? input : input.toString();
			if (url === "https://chatgpt.com/backend-api/codex/responses") {
				return new Response(sse, {
					status: 200,
					headers: { "content-type": "text/event-stream" },
				});
			}
			return new Response("not found", { status: 404 });
		});
		global.fetch = fetchMock as unknown as typeof fetch;

		type WsListener = (event: Event) => void;
		class UnavailableBeforeStreamWebSocket {
			static readonly CONNECTING = 0;
			static readonly OPEN = 1;
			static readonly CLOSING = 2;
			static readonly CLOSED = 3;
			readyState = UnavailableBeforeStreamWebSocket.CONNECTING;
			#listeners = new Map<string, Set<WsListener>>();

			constructor(_url: string, _options?: { headers?: Record<string, string> }) {
				setTimeout(() => {
					this.readyState = UnavailableBeforeStreamWebSocket.OPEN;
					this.#emit("open", new Event("open"));
					this.readyState = UnavailableBeforeStreamWebSocket.CLOSED;
					this.#emit("close", { code: 1006 } as unknown as Event);
				}, 0);
			}

			addEventListener(type: string, listener: unknown): void {
				if (typeof listener !== "function") return;
				const listeners = this.#listeners.get(type) ?? new Set<WsListener>();
				listeners.add(listener as WsListener);
				this.#listeners.set(type, listeners);
			}

			removeEventListener(type: string, listener: unknown): void {
				if (typeof listener !== "function") return;
				const listeners = this.#listeners.get(type);
				listeners?.delete(listener as WsListener);
			}

			send(): void {}

			close(): void {
				this.readyState = UnavailableBeforeStreamWebSocket.CLOSED;
			}

			#emit(type: string, event: Event): void {
				const listeners = this.#listeners.get(type);
				if (!listeners) return;
				for (const listener of listeners) {
					listener(event);
				}
			}
		}

		global.WebSocket = UnavailableBeforeStreamWebSocket as unknown as typeof WebSocket;

		const model: Model<"openai-codex-responses"> = {
			id: "gpt-5.3-codex-spark",
			name: "GPT-5.3 Codex Spark",
			api: "openai-codex-responses",
			provider: "openai-codex",
			baseUrl: "https://chatgpt.com/backend-api",
			reasoning: true,
			preferWebsockets: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 128000,
		};
		const context: Context = {
			systemPrompt: "You are a helpful assistant.",
			messages: [{ role: "user", content: "Say hello", timestamp: Date.now() }],
		};
		const providerSessionState = new Map<string, ProviderSessionState>();
		const result = await streamOpenAICodexResponses(model, context, {
			apiKey: token,
			sessionId: "ws-unavailable-session",
			providerSessionState,
		}).result();

		expect(result.role).toBe("assistant");
		expect(result.stopReason).not.toBe("error");
		expect(result.errorMessage).toBeUndefined();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const transportDetails = getOpenAICodexTransportDetails(model, {
			sessionId: "ws-unavailable-session",
			providerSessionState,
		});
		expect(transportDetails.lastTransport).toBe("sse");
		expect(transportDetails.websocketDisabled).toBe(true);
		expect(transportDetails.fallbackCount).toBe(1);
	});

	it("resets websocket append state after an aborted request closes the connection", async () => {
		const tempDir = TempDir.createSync("@pi-codex-stream-");
		setAgentDir(tempDir.path());

		const payload = Buffer.from(
			JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acc_test" } }),
			"utf8",
		).toBase64();
		const token = `aaa.${payload}.bbb`;
		const fetchMock = vi.fn(async () => {
			throw new Error("SSE fallback should not be called");
		});
		global.fetch = fetchMock as unknown as typeof fetch;

		type WsListener = (event: Event) => void;
		const sentTypesByConnection: string[][] = [];
		let constructorCount = 0;
		let abortSecondRequest: (() => void) | undefined;

		class AbortResetWebSocket {
			static readonly CONNECTING = 0;
			static readonly OPEN = 1;
			static readonly CLOSING = 2;
			static readonly CLOSED = 3;
			readyState = AbortResetWebSocket.CONNECTING;
			#listeners = new Map<string, Set<WsListener>>();
			#connectionIndex: number;

			constructor(_url: string, _options?: { headers?: Record<string, string> }) {
				this.#connectionIndex = constructorCount;
				constructorCount += 1;
				sentTypesByConnection[this.#connectionIndex] = [];
				setTimeout(() => {
					this.readyState = AbortResetWebSocket.OPEN;
					this.#emit("open", new Event("open"));
				}, 0);
			}

			addEventListener(type: string, listener: unknown): void {
				if (typeof listener !== "function") return;
				const listeners = this.#listeners.get(type) ?? new Set<WsListener>();
				listeners.add(listener as WsListener);
				this.#listeners.set(type, listeners);
			}

			removeEventListener(type: string, listener: unknown): void {
				if (typeof listener !== "function") return;
				const listeners = this.#listeners.get(type);
				listeners?.delete(listener as WsListener);
			}

			send(data: string): void {
				const request = JSON.parse(data) as { type?: string };
				const requestType = typeof request.type === "string" ? request.type : "";
				sentTypesByConnection[this.#connectionIndex]?.push(requestType);
				const requestIndex = sentTypesByConnection[this.#connectionIndex]?.length ?? 0;

				if (this.#connectionIndex === 0 && requestIndex === 1) {
					this.#emitCompleted("msg_1", "resp_1", "Hello one");
					return;
				}
				if (this.#connectionIndex === 0 && requestIndex === 2) {
					this.#emit("message", {
						data: JSON.stringify({
							type: "response.output_item.added",
							item: { type: "message", id: "msg_2", role: "assistant", status: "in_progress", content: [] },
						}),
					} as unknown as Event);
					this.#emit("message", {
						data: JSON.stringify({
							type: "response.content_part.added",
							part: { type: "output_text", text: "" },
						}),
					} as unknown as Event);
					this.#emit("message", {
						data: JSON.stringify({ type: "response.output_text.delta", delta: "Still streaming" }),
					} as unknown as Event);
					setTimeout(() => {
						abortSecondRequest?.();
					}, 0);
					return;
				}
				if (this.#connectionIndex === 1 && requestIndex === 1) {
					expect(requestType).toBe("response.create");
					this.#emitCompleted("msg_3", "resp_3", "Hello three");
					return;
				}
				throw new Error(`Unexpected websocket send sequence: ${this.#connectionIndex}:${requestIndex}`);
			}

			close(): void {
				this.readyState = AbortResetWebSocket.CLOSED;
			}

			#emitCompleted(messageId: string, responseId: string, text: string): void {
				this.#emit("message", {
					data: JSON.stringify({
						type: "response.output_item.added",
						item: { type: "message", id: messageId, role: "assistant", status: "in_progress", content: [] },
					}),
				} as unknown as Event);
				this.#emit("message", {
					data: JSON.stringify({ type: "response.content_part.added", part: { type: "output_text", text: "" } }),
				} as unknown as Event);
				this.#emit("message", {
					data: JSON.stringify({ type: "response.output_text.delta", delta: text }),
				} as unknown as Event);
				this.#emit("message", {
					data: JSON.stringify({
						type: "response.output_item.done",
						item: {
							type: "message",
							id: messageId,
							role: "assistant",
							status: "completed",
							content: [{ type: "output_text", text }],
						},
					}),
				} as unknown as Event);
				this.#emit("message", {
					data: JSON.stringify({
						type: "response.done",
						response: {
							id: responseId,
							status: "completed",
							usage: {
								input_tokens: 5,
								output_tokens: 3,
								total_tokens: 8,
								input_tokens_details: { cached_tokens: 0 },
							},
						},
					}),
				} as unknown as Event);
			}

			#emit(type: string, event: Event): void {
				const listeners = this.#listeners.get(type);
				if (!listeners) return;
				for (const listener of listeners) {
					listener(event);
				}
			}
		}

		global.WebSocket = AbortResetWebSocket as unknown as typeof WebSocket;
		const model: Model<"openai-codex-responses"> = {
			id: "gpt-5.3-codex-spark",
			name: "GPT-5.3 Codex Spark",
			api: "openai-codex-responses",
			provider: "openai-codex",
			baseUrl: "https://chatgpt.com/backend-api",
			reasoning: true,
			preferWebsockets: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 128000,
		};
		const firstContext: Context = {
			systemPrompt: "You are a helpful assistant.",
			messages: [{ role: "user", content: "Say hello", timestamp: Date.now() }],
		};
		const secondContext: Context = {
			systemPrompt: "You are a helpful assistant.",
			messages: [
				{ role: "user", content: "Say hello", timestamp: Date.now() },
				{ role: "user", content: "Keep going", timestamp: Date.now() + 1 },
			],
		};
		const thirdContext: Context = {
			systemPrompt: "You are a helpful assistant.",
			messages: [
				{ role: "user", content: "Say hello", timestamp: Date.now() },
				{ role: "user", content: "Keep going", timestamp: Date.now() + 1 },
				{ role: "user", content: "Finish", timestamp: Date.now() + 2 },
			],
		};
		const providerSessionState = new Map<string, ProviderSessionState>();

		const firstResult = await streamOpenAICodexResponses(model, firstContext, {
			apiKey: token,
			sessionId: "ws-abort-reset-session",
			providerSessionState,
		}).result();
		expect(firstResult.role).toBe("assistant");

		const secondAbortController = new AbortController();
		abortSecondRequest = () => {
			secondAbortController.abort();
		};
		const secondResult = await streamOpenAICodexResponses(model, secondContext, {
			apiKey: token,
			sessionId: "ws-abort-reset-session",
			signal: secondAbortController.signal,
			providerSessionState,
		}).result();
		expect(secondResult.stopReason).toBe("aborted");

		const thirdResult = await streamOpenAICodexResponses(model, thirdContext, {
			apiKey: token,
			sessionId: "ws-abort-reset-session",
			providerSessionState,
		}).result();
		expect(thirdResult.role).toBe("assistant");
		expect(constructorCount).toBe(2);
		expect(sentTypesByConnection[0]).toEqual(["response.create", "response.append"]);
		expect(sentTypesByConnection[1]).toEqual(["response.create"]);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("resets websocket append state after websocket error events", async () => {
		const tempDir = TempDir.createSync("@pi-codex-stream-");
		setAgentDir(tempDir.path());

		const payload = Buffer.from(
			JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acc_test" } }),
			"utf8",
		).toBase64();
		const token = `aaa.${payload}.bbb`;
		const fetchMock = vi.fn(async () => {
			throw new Error("SSE fallback should not be called");
		});
		global.fetch = fetchMock as unknown as typeof fetch;

		type WsListener = (event: Event) => void;
		const sentTypes: string[] = [];
		let constructorCount = 0;

		class ErrorResetWebSocket {
			static readonly CONNECTING = 0;
			static readonly OPEN = 1;
			static readonly CLOSING = 2;
			static readonly CLOSED = 3;
			readyState = ErrorResetWebSocket.CONNECTING;
			#listeners = new Map<string, Set<WsListener>>();

			constructor(_url: string, _options?: { headers?: Record<string, string> }) {
				constructorCount += 1;
				setTimeout(() => {
					this.readyState = ErrorResetWebSocket.OPEN;
					this.#emit("open", new Event("open"));
				}, 0);
			}

			addEventListener(type: string, listener: unknown): void {
				if (typeof listener !== "function") return;
				const listeners = this.#listeners.get(type) ?? new Set<WsListener>();
				listeners.add(listener as WsListener);
				this.#listeners.set(type, listeners);
			}

			removeEventListener(type: string, listener: unknown): void {
				if (typeof listener !== "function") return;
				const listeners = this.#listeners.get(type);
				listeners?.delete(listener as WsListener);
			}

			send(data: string): void {
				const request = JSON.parse(data) as { type?: string };
				const requestType = typeof request.type === "string" ? request.type : "";
				sentTypes.push(requestType);
				const requestIndex = sentTypes.length;

				if (requestIndex === 1) {
					this.#emitCompleted("msg_1", "resp_1", "Hello one");
					return;
				}
				if (requestIndex === 2) {
					this.#emit("message", {
						data: JSON.stringify({
							type: "error",
							code: "invalid_request_error",
							message: "simulated request error",
						}),
					} as unknown as Event);
					return;
				}
				if (requestIndex === 3) {
					expect(requestType).toBe("response.create");
					this.#emitCompleted("msg_3", "resp_3", "Hello three");
					return;
				}
				throw new Error(`Unexpected websocket request index: ${requestIndex}`);
			}

			close(): void {
				this.readyState = ErrorResetWebSocket.CLOSED;
			}

			#emitCompleted(messageId: string, responseId: string, text: string): void {
				this.#emit("message", {
					data: JSON.stringify({
						type: "response.output_item.added",
						item: { type: "message", id: messageId, role: "assistant", status: "in_progress", content: [] },
					}),
				} as unknown as Event);
				this.#emit("message", {
					data: JSON.stringify({ type: "response.content_part.added", part: { type: "output_text", text: "" } }),
				} as unknown as Event);
				this.#emit("message", {
					data: JSON.stringify({ type: "response.output_text.delta", delta: text }),
				} as unknown as Event);
				this.#emit("message", {
					data: JSON.stringify({
						type: "response.output_item.done",
						item: {
							type: "message",
							id: messageId,
							role: "assistant",
							status: "completed",
							content: [{ type: "output_text", text }],
						},
					}),
				} as unknown as Event);
				this.#emit("message", {
					data: JSON.stringify({
						type: "response.done",
						response: {
							id: responseId,
							status: "completed",
							usage: {
								input_tokens: 5,
								output_tokens: 3,
								total_tokens: 8,
								input_tokens_details: { cached_tokens: 0 },
							},
						},
					}),
				} as unknown as Event);
			}

			#emit(type: string, event: Event): void {
				const listeners = this.#listeners.get(type);
				if (!listeners) return;
				for (const listener of listeners) {
					listener(event);
				}
			}
		}

		global.WebSocket = ErrorResetWebSocket as unknown as typeof WebSocket;
		const model: Model<"openai-codex-responses"> = {
			id: "gpt-5.3-codex-spark",
			name: "GPT-5.3 Codex Spark",
			api: "openai-codex-responses",
			provider: "openai-codex",
			baseUrl: "https://chatgpt.com/backend-api",
			reasoning: true,
			preferWebsockets: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 128000,
		};
		const firstContext: Context = {
			systemPrompt: "You are a helpful assistant.",
			messages: [{ role: "user", content: "Say hello", timestamp: Date.now() }],
		};
		const secondContext: Context = {
			systemPrompt: "You are a helpful assistant.",
			messages: [
				{ role: "user", content: "Say hello", timestamp: Date.now() },
				{ role: "user", content: "Keep going", timestamp: Date.now() + 1 },
			],
		};
		const thirdContext: Context = {
			systemPrompt: "You are a helpful assistant.",
			messages: [
				{ role: "user", content: "Say hello", timestamp: Date.now() },
				{ role: "user", content: "Keep going", timestamp: Date.now() + 1 },
				{ role: "user", content: "Finish", timestamp: Date.now() + 2 },
			],
		};
		const providerSessionState = new Map<string, ProviderSessionState>();

		const firstResult = await streamOpenAICodexResponses(model, firstContext, {
			apiKey: token,
			sessionId: "ws-error-reset-session",
			providerSessionState,
		}).result();
		expect(firstResult.role).toBe("assistant");

		const secondResult = await streamOpenAICodexResponses(model, secondContext, {
			apiKey: token,
			sessionId: "ws-error-reset-session",
			providerSessionState,
		}).result();
		expect(secondResult.stopReason).toBe("error");
		expect(secondResult.errorMessage).toContain("simulated request error");

		const thirdResult = await streamOpenAICodexResponses(model, thirdContext, {
			apiKey: token,
			sessionId: "ws-error-reset-session",
			providerSessionState,
		}).result();
		expect(thirdResult.role).toBe("assistant");
		expect(constructorCount).toBe(1);
		expect(sentTypes).toEqual(["response.create", "response.append", "response.create"]);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("resets append state and stale turn headers when websocket requests diverge", async () => {
		const tempDir = TempDir.createSync("@pi-codex-stream-");
		setAgentDir(tempDir.path());

		const payload = Buffer.from(
			JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acc_test" } }),
			"utf8",
		).toBase64();
		const token = `aaa.${payload}.bbb`;

		const sseTurnStates: Array<string | null> = [];
		const sseModelsEtags: Array<string | null> = [];
		const sse = `${[
			`data: ${JSON.stringify({ type: "response.output_item.added", item: { type: "message", id: "msg_sse", role: "assistant", status: "in_progress", content: [] } })}`,
			`data: ${JSON.stringify({ type: "response.content_part.added", part: { type: "output_text", text: "" } })}`,
			`data: ${JSON.stringify({ type: "response.output_text.delta", delta: "Hello SSE" })}`,
			`data: ${JSON.stringify({ type: "response.output_item.done", item: { type: "message", id: "msg_sse", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Hello SSE" }] } })}`,
			`data: ${JSON.stringify({ type: "response.completed", response: { status: "completed", usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8, input_tokens_details: { cached_tokens: 0 } } } })}`,
		].join("\n\n")}\n\n`;
		const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit) => {
			const headers = init?.headers instanceof Headers ? init.headers : new Headers(init?.headers);
			sseTurnStates.push(headers.get("x-codex-turn-state"));
			sseModelsEtags.push(headers.get("x-models-etag"));
			return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
		});
		global.fetch = fetchMock as unknown as typeof fetch;

		type WsListener = (event: Event) => void;
		const requestTypes: string[] = [];
		class DivergedAppendWebSocket {
			static readonly CONNECTING = 0;
			static readonly OPEN = 1;
			static readonly CLOSING = 2;
			static readonly CLOSED = 3;
			readyState = DivergedAppendWebSocket.CONNECTING;
			handshakeHeaders = {
				"x-codex-turn-state": "ws-turn-state-1",
				"x-models-etag": "ws-models-etag-1",
			};
			#listeners = new Map<string, Set<WsListener>>();
			#sendCount = 0;

			constructor(_url: string, _options?: { headers?: Record<string, string> }) {
				setTimeout(() => {
					this.readyState = DivergedAppendWebSocket.OPEN;
					this.#emit("open", new Event("open"));
				}, 0);
			}

			addEventListener(type: string, listener: unknown): void {
				if (typeof listener !== "function") return;
				const listeners = this.#listeners.get(type) ?? new Set<WsListener>();
				listeners.add(listener as WsListener);
				this.#listeners.set(type, listeners);
			}

			removeEventListener(type: string, listener: unknown): void {
				if (typeof listener !== "function") return;
				const listeners = this.#listeners.get(type);
				listeners?.delete(listener as WsListener);
			}

			send(data: string): void {
				this.#sendCount += 1;
				const request = JSON.parse(data) as { type?: string };
				requestTypes.push(typeof request.type === "string" ? request.type : "");
				const idSuffix = String(this.#sendCount);
				this.#emitCompleted(`msg_${idSuffix}`, `resp_${idSuffix}`, `Hello WS ${idSuffix}`);
			}

			close(): void {
				this.readyState = DivergedAppendWebSocket.CLOSED;
			}

			#emitCompleted(messageId: string, responseId: string, text: string): void {
				this.#emit("message", {
					data: JSON.stringify({
						type: "response.output_item.added",
						item: { type: "message", id: messageId, role: "assistant", status: "in_progress", content: [] },
					}),
				} as unknown as Event);
				this.#emit("message", {
					data: JSON.stringify({ type: "response.content_part.added", part: { type: "output_text", text: "" } }),
				} as unknown as Event);
				this.#emit("message", {
					data: JSON.stringify({ type: "response.output_text.delta", delta: text }),
				} as unknown as Event);
				this.#emit("message", {
					data: JSON.stringify({
						type: "response.output_item.done",
						item: {
							type: "message",
							id: messageId,
							role: "assistant",
							status: "completed",
							content: [{ type: "output_text", text }],
						},
					}),
				} as unknown as Event);
				this.#emit("message", {
					data: JSON.stringify({
						type: "response.done",
						response: {
							id: responseId,
							status: "completed",
							usage: {
								input_tokens: 5,
								output_tokens: 3,
								total_tokens: 8,
								input_tokens_details: { cached_tokens: 0 },
							},
						},
					}),
				} as unknown as Event);
			}

			#emit(type: string, event: Event): void {
				const listeners = this.#listeners.get(type);
				if (!listeners) return;
				for (const listener of listeners) {
					listener(event);
				}
			}
		}

		global.WebSocket = DivergedAppendWebSocket as unknown as typeof WebSocket;

		const websocketModel: Model<"openai-codex-responses"> = {
			id: "gpt-5.3-codex-spark",
			name: "GPT-5.3 Codex Spark",
			api: "openai-codex-responses",
			provider: "openai-codex",
			baseUrl: "https://chatgpt.com/backend-api",
			reasoning: true,
			preferWebsockets: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 128000,
		};
		const sseModel: Model<"openai-codex-responses"> = {
			...websocketModel,
			preferWebsockets: false,
		};
		const firstContext: Context = {
			systemPrompt: "Prompt A",
			messages: [{ role: "user", content: "Say hello", timestamp: Date.now() }],
		};
		const secondContext: Context = {
			systemPrompt: "Prompt B",
			messages: [{ role: "user", content: "Say hello", timestamp: Date.now() }],
		};
		const providerSessionState = new Map<string, ProviderSessionState>();

		await streamOpenAICodexResponses(websocketModel, firstContext, {
			apiKey: token,
			sessionId: "ws-diverged-session",
			providerSessionState,
		}).result();
		await streamOpenAICodexResponses(websocketModel, secondContext, {
			apiKey: token,
			sessionId: "ws-diverged-session",
			providerSessionState,
		}).result();
		await streamOpenAICodexResponses(sseModel, secondContext, {
			apiKey: token,
			sessionId: "ws-diverged-session",
			providerSessionState,
		}).result();

		expect(requestTypes).toEqual(["response.create", "response.create"]);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(sseTurnStates[0]).toBeNull();
		expect(sseModelsEtags[0]).toBeNull();
	});

	it("reuses a prewarmed websocket connection across turns", async () => {
		const tempDir = TempDir.createSync("@pi-codex-stream-");
		setAgentDir(tempDir.path());

		const payload = Buffer.from(
			JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acc_test" } }),
			"utf8",
		).toBase64();
		const token = `aaa.${payload}.bbb`;

		const fetchMock = vi.fn(async () => {
			throw new Error("SSE fallback should not be called");
		});
		global.fetch = fetchMock as unknown as typeof fetch;

		type WsListener = (event: Event) => void;
		let constructorCount = 0;
		let sendCount = 0;
		class ReusableWebSocket {
			static readonly CONNECTING = 0;
			static readonly OPEN = 1;
			static readonly CLOSING = 2;
			static readonly CLOSED = 3;

			readyState = ReusableWebSocket.CONNECTING;
			#listeners = new Map<string, Set<WsListener>>();

			constructor(
				public readonly url: string,
				public readonly options?: { headers?: Record<string, string> },
			) {
				constructorCount += 1;
				setTimeout(() => {
					this.readyState = ReusableWebSocket.OPEN;
					this.#emit("open", new Event("open"));
				}, 0);
			}

			addEventListener(type: string, listener: unknown): void {
				if (typeof listener !== "function") return;
				const listeners = this.#listeners.get(type) ?? new Set<WsListener>();
				listeners.add(listener as WsListener);
				this.#listeners.set(type, listeners);
			}

			removeEventListener(type: string, listener: unknown): void {
				if (typeof listener !== "function") return;
				const listeners = this.#listeners.get(type);
				listeners?.delete(listener as WsListener);
			}

			send(data: string): void {
				sendCount += 1;
				const request = JSON.parse(data) as Record<string, unknown>;
				expect(typeof request.type).toBe("string");
				this.#emit("message", {
					data: JSON.stringify({
						type: "response.output_item.added",
						item: {
							type: "message",
							id: `msg_${sendCount}`,
							role: "assistant",
							status: "in_progress",
							content: [],
						},
					}),
				} as unknown as Event);
				this.#emit("message", {
					data: JSON.stringify({ type: "response.content_part.added", part: { type: "output_text", text: "" } }),
				} as unknown as Event);
				this.#emit("message", {
					data: JSON.stringify({ type: "response.output_text.delta", delta: `Hello ${sendCount}` }),
				} as unknown as Event);
				this.#emit("message", {
					data: JSON.stringify({
						type: "response.output_item.done",
						item: {
							type: "message",
							id: `msg_${sendCount}`,
							role: "assistant",
							status: "completed",
							content: [{ type: "output_text", text: `Hello ${sendCount}` }],
						},
					}),
				} as unknown as Event);
				this.#emit("message", {
					data: JSON.stringify({
						type: "response.done",
						response: {
							id: `resp_${sendCount}`,
							status: "completed",
							usage: {
								input_tokens: 5,
								output_tokens: 3,
								total_tokens: 8,
								input_tokens_details: { cached_tokens: 0 },
							},
						},
					}),
				} as unknown as Event);
			}

			close(): void {
				this.readyState = ReusableWebSocket.CLOSED;
			}

			#emit(type: string, event: Event): void {
				const listeners = this.#listeners.get(type);
				if (!listeners) return;
				for (const listener of listeners) {
					listener(event);
				}
			}
		}

		global.WebSocket = ReusableWebSocket as unknown as typeof WebSocket;

		const model: Model<"openai-codex-responses"> = {
			id: "gpt-5.3-codex-spark",
			name: "GPT-5.3 Codex Spark",
			api: "openai-codex-responses",
			provider: "openai-codex",
			baseUrl: "https://chatgpt.com/backend-api",
			reasoning: true,
			preferWebsockets: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 128000,
		};

		const providerSessionState = new Map<string, ProviderSessionState>();
		await prewarmOpenAICodexResponses(model, { apiKey: token, sessionId: "ws-reuse-session", providerSessionState });

		const firstContext: Context = {
			systemPrompt: "You are a helpful assistant.",
			messages: [{ role: "user", content: "First", timestamp: Date.now() }],
		};
		const secondContext: Context = {
			systemPrompt: "You are a helpful assistant.",
			messages: [
				{ role: "user", content: "First", timestamp: Date.now() },
				{ role: "user", content: "Second", timestamp: Date.now() },
			],
		};

		await streamOpenAICodexResponses(model, firstContext, {
			apiKey: token,
			sessionId: "ws-reuse-session",
			providerSessionState,
		}).result();
		await streamOpenAICodexResponses(model, secondContext, {
			apiKey: token,
			sessionId: "ws-reuse-session",
			providerSessionState,
		}).result();

		expect(constructorCount).toBe(1);
		expect(sendCount).toBe(2);
		expect(fetchMock).not.toHaveBeenCalled();
		const transportDetails = getOpenAICodexTransportDetails(model, {
			sessionId: "ws-reuse-session",
			providerSessionState,
		});
		expect(transportDetails.lastTransport).toBe("websocket");
		expect(transportDetails.websocketConnected).toBe(true);
		expect(transportDetails.prewarmed).toBe(true);
		expect(transportDetails.canAppend).toBe(true);
	});

	it("replays x-codex-turn-state on subsequent SSE requests", async () => {
		const tempDir = TempDir.createSync("@pi-codex-stream-");
		setAgentDir(tempDir.path());

		const payload = Buffer.from(
			JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acc_test" } }),
			"utf8",
		).toBase64();
		const token = `aaa.${payload}.bbb`;

		const requestTurnStates: Array<string | null> = [];
		let callCount = 0;
		const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit) => {
			const headers = init?.headers instanceof Headers ? init.headers : new Headers(init?.headers);
			requestTurnStates.push(headers.get("x-codex-turn-state"));
			const sse = `${[
				`data: ${JSON.stringify({ type: "response.output_item.added", item: { type: "message", id: `msg_${callCount}`, role: "assistant", status: "in_progress", content: [] } })}`,
				`data: ${JSON.stringify({ type: "response.content_part.added", part: { type: "output_text", text: "" } })}`,
				`data: ${JSON.stringify({ type: "response.output_text.delta", delta: "Hello" })}`,
				`data: ${JSON.stringify({ type: "response.output_item.done", item: { type: "message", id: `msg_${callCount}`, role: "assistant", status: "completed", content: [{ type: "output_text", text: "Hello" }] } })}`,
				`data: ${JSON.stringify({ type: "response.completed", response: { status: "completed", usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8, input_tokens_details: { cached_tokens: 0 } } } })}`,
			].join("\n\n")}\n\n`;
			const responseHeaders = new Headers({ "content-type": "text/event-stream" });
			if (callCount === 0) {
				responseHeaders.set("x-codex-turn-state", "turn-state-1");
			}
			callCount += 1;
			return new Response(sse, { status: 200, headers: responseHeaders });
		});
		global.fetch = fetchMock as unknown as typeof fetch;

		const model: Model<"openai-codex-responses"> = {
			id: "gpt-5.1-codex",
			name: "GPT-5.1 Codex",
			api: "openai-codex-responses",
			provider: "openai-codex",
			baseUrl: "https://chatgpt.com/backend-api",
			reasoning: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 400000,
			maxTokens: 128000,
		};

		const context: Context = {
			systemPrompt: "You are a helpful assistant.",
			messages: [{ role: "user", content: "Say hello", timestamp: Date.now() }],
		};

		const providerSessionState = new Map<string, ProviderSessionState>();
		await streamOpenAICodexResponses(model, context, {
			apiKey: token,
			sessionId: "turn-state-session",
			providerSessionState,
		}).result();
		await streamOpenAICodexResponses(model, context, {
			apiKey: token,
			sessionId: "turn-state-session",
			providerSessionState,
		}).result();

		expect(requestTurnStates[0]).toBeNull();
		expect(requestTurnStates[1]).toBe("turn-state-1");
	});
});
