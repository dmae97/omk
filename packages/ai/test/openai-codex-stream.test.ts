import { afterEach, describe, expect, it, vi } from "bun:test";
import { getOpenAICodexTransportDetails, prewarmOpenAICodexResponses, streamOpenAICodexResponses } from "@oh-my-pi/pi-ai/providers/openai-codex-responses";
import type { Context, Model } from "@oh-my-pi/pi-ai/types";
import { TempDir } from "@oh-my-pi/pi-utils";
import { getAgentDir, setAgentDir } from "@oh-my-pi/pi-utils/dirs";

const originalFetch = global.fetch;
const originalAgentDir = getAgentDir();
const originalWebSocket = global.WebSocket;

afterEach(() => {
	global.fetch = originalFetch;
	global.WebSocket = originalWebSocket;
	setAgentDir(originalAgentDir);
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
					expect(this.options?.headers?.["OpenAI-Beta"] ?? this.options?.headers?.["openai-beta"]).toBe("responses_websockets=2026-02-04");
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
		const streamResult = streamOpenAICodexResponses(model, context, { apiKey: token, sessionId: "ws-session" });
		const result = await streamResult.result();
		expect(result.role).toBe("assistant");
		expect(fetchMock).toHaveBeenCalled();
		const fallbackDetails = getOpenAICodexTransportDetails(model, { sessionId: "ws-session" });
		expect(fallbackDetails.lastTransport).toBe("sse");
		expect(fallbackDetails.websocketDisabled).toBe(true);
		expect(fallbackDetails.fallbackCount).toBe(1);
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

			constructor(public readonly url: string, public readonly options?: { headers?: Record<string, string> }) {
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
				this.#emit(
					"message",
					({ data: JSON.stringify({ type: "response.output_item.added", item: { type: "message", id: `msg_${sendCount}`, role: "assistant", status: "in_progress", content: [] } }) } as unknown as Event),
				);
				this.#emit(
					"message",
					({ data: JSON.stringify({ type: "response.content_part.added", part: { type: "output_text", text: "" } }) } as unknown as Event),
				);
				this.#emit(
					"message",
					({ data: JSON.stringify({ type: "response.output_text.delta", delta: `Hello ${sendCount}` }) } as unknown as Event),
				);
				this.#emit(
					"message",
					({ data: JSON.stringify({ type: "response.output_item.done", item: { type: "message", id: `msg_${sendCount}`, role: "assistant", status: "completed", content: [{ type: "output_text", text: `Hello ${sendCount}` }] } }) } as unknown as Event),
				);
				this.#emit(
					"message",
					({ data: JSON.stringify({ type: "response.done", response: { id: `resp_${sendCount}`, status: "completed", usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8, input_tokens_details: { cached_tokens: 0 } } } }) } as unknown as Event),
				);
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

		await prewarmOpenAICodexResponses(model, { apiKey: token, sessionId: "ws-reuse-session" });

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

		await streamOpenAICodexResponses(model, firstContext, { apiKey: token, sessionId: "ws-reuse-session" }).result();
		await streamOpenAICodexResponses(model, secondContext, { apiKey: token, sessionId: "ws-reuse-session" }).result();

		expect(constructorCount).toBe(1);
		expect(sendCount).toBe(2);
		expect(fetchMock).not.toHaveBeenCalled();
		const transportDetails = getOpenAICodexTransportDetails(model, { sessionId: "ws-reuse-session" });
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

		await streamOpenAICodexResponses(model, context, { apiKey: token, sessionId: "turn-state-session" }).result();
		await streamOpenAICodexResponses(model, context, { apiKey: token, sessionId: "turn-state-session" }).result();

		expect(requestTurnStates[0]).toBeNull();
		expect(requestTurnStates[1]).toBe("turn-state-1");
	});
});
