import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CODEX_TURN_METADATA_FIELD, describeCodexBridgeConnectionError } from "../src/providers/codex-turn-metadata.ts";
import { streamOpenAIResponses, streamSimpleOpenAIResponses } from "../src/providers/openai-responses.ts";
import type { AssistantMessage, Context, Model, Usage } from "../src/types.ts";

class PayloadCaptured extends Error {
	constructor() {
		super("payload captured");
		this.name = "PayloadCaptured";
	}
}

type CapturedPayload = {
	client_metadata?: Record<string, string>;
	input: Array<Record<string, unknown>>;
};

const usage: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function bridgeModel(sendCodexTurnMetadata: boolean | undefined): Model<"openai-responses"> {
	return {
		id: "chatgpt-web/high",
		name: "ChatGPT Web — High",
		api: "openai-responses",
		provider: "codex-chatgpt-web",
		baseUrl: "http://127.0.0.1:17841/v1",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 90_000,
		maxTokens: 32_768,
		...(sendCodexTurnMetadata === undefined ? {} : { compat: { sendCodexTurnMetadata } }),
	};
}

function assistantToolCall(): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "toolCall", id: "call_1|fc_1", name: "read", arguments: { path: "a.ts" } }],
		api: "openai-responses",
		provider: "codex-chatgpt-web",
		model: "chatgpt-web/high",
		usage,
		stopReason: "toolUse",
		timestamp: 2,
	};
}

const firstTurn: Context = {
	systemPrompt: "You are OMK.",
	messages: [{ role: "user", content: "Read a.ts and summarize it", timestamp: 1 }],
};

const firstTurnToolRound: Context = {
	systemPrompt: "You are OMK.",
	messages: [
		...firstTurn.messages,
		assistantToolCall(),
		{
			role: "toolResult",
			toolCallId: "call_1|fc_1",
			toolName: "read",
			content: [{ type: "text", text: "export const a = 1;" }],
			isError: false,
			timestamp: 3,
		},
	],
};

const secondTurn: Context = {
	systemPrompt: "You are OMK.",
	messages: [
		...firstTurnToolRound.messages,
		{
			role: "assistant",
			content: [{ type: "text", text: "It exports a." }],
			api: "openai-responses",
			provider: "codex-chatgpt-web",
			model: "chatgpt-web/high",
			usage,
			stopReason: "stop",
			timestamp: 4,
		},
		{ role: "user", content: "Now rename it to b", timestamp: 5 },
	],
};

async function capturePayload(
	model: Model<"openai-responses">,
	context: Context,
	sessionId: string | undefined,
	cwd?: string,
): Promise<CapturedPayload> {
	let captured: CapturedPayload | undefined;
	const stream = streamSimpleOpenAIResponses(model, context, {
		apiKey: "chatgpt-web",
		sessionId,
		...(cwd === undefined ? {} : { cwd }),
		onPayload: (payload) => {
			captured = payload as CapturedPayload;
			throw new PayloadCaptured();
		},
	});
	for await (const _event of stream) {
		// consume until the provider reports the captured payload
	}
	if (!captured) throw new Error("payload was not captured");
	return captured;
}

function turnMetadata(payload: CapturedPayload): {
	thread_id?: string;
	turn_id: string;
	sandbox?: string;
	workspaces?: Record<string, Record<string, never>>;
} {
	const raw = payload.client_metadata?.[CODEX_TURN_METADATA_FIELD];
	if (typeof raw !== "string") throw new Error(`missing client_metadata.${CODEX_TURN_METADATA_FIELD}`);
	return JSON.parse(raw) as {
		thread_id?: string;
		turn_id: string;
		sandbox?: string;
		workspaces?: Record<string, Record<string, never>>;
	};
}

function lastUserItem(payload: CapturedPayload): Record<string, unknown> {
	const item = [...payload.input].reverse().find((entry) => entry.role === "user");
	if (!item) throw new Error("payload has no user item");
	return item;
}

describe("openai-responses sendCodexTurnMetadata", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("serializes the turn metadata onto the wire body the bridge receives", async () => {
		let wireBody: CapturedPayload | undefined;
		vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
			wireBody = JSON.parse(String(init?.body)) as CapturedPayload;
			return new Response("data: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });
		});

		const stream = streamOpenAIResponses(bridgeModel(true), firstTurn, {
			apiKey: "chatgpt-web",
			sessionId: "session-1",
		});
		for await (const event of stream) {
			if (event.type === "done" || event.type === "error") break;
		}

		if (!wireBody) throw new Error("fetch was not called");
		const metadata = turnMetadata(wireBody);
		expect(metadata.thread_id).toBe("session-1");
		expect(lastUserItem(wireBody).internal_chat_message_metadata_passthrough).toEqual({ turn_id: metadata.turn_id });
	});

	it("sends the session as thread_id and stamps the current user item with the same turn_id", async () => {
		const payload = await capturePayload(bridgeModel(true), firstTurn, "session-1");

		const metadata = turnMetadata(payload);
		expect(metadata.thread_id).toBe("session-1");
		expect(metadata.turn_id).toMatch(/^turn_[a-z0-9]+$/);

		const user = lastUserItem(payload);
		expect(user.type).toBe("message");
		expect(user.internal_chat_message_metadata_passthrough).toEqual({ turn_id: metadata.turn_id });
	});

	it("adds a trusted workspace environment before the active user when cwd is provided", async () => {
		// Given: a full-harness bridge request with a trusted runtime cwd.
		const cwd = resolve("fixtures/project & workspace");

		// When: the OpenAI Responses payload is built for codex-chatgpt-web.
		const payload = await capturePayload(bridgeModel(true), firstTurn, "session-1", cwd);
		const metadata = turnMetadata(payload);
		const activeUserIndex = payload.input.reduce(
			(latest, item, index) => (item.role === "user" ? index : latest),
			-1,
		);
		const environment = payload.input[activeUserIndex - 1];

		// Then: metadata and the adjacent environment item bind the same turn and workspace.
		expect(metadata.sandbox).toBe("workspace-write");
		expect(metadata.workspaces).toEqual({ [cwd]: {} });
		expect(environment?.role).toBe("user");
		expect(environment?.internal_chat_message_metadata_passthrough).toEqual({ turn_id: metadata.turn_id });
		expect(JSON.stringify(environment?.content)).toContain("<environment_context>");
		expect(JSON.stringify(environment?.content)).toContain("project &amp; workspace");
	});

	it("does not invent filesystem authority without an absolute cwd", async () => {
		for (const cwd of [undefined, "relative/workspace"]) {
			const payload = await capturePayload(bridgeModel(true), firstTurn, "session-1", cwd);
			const metadata = turnMetadata(payload);

			expect(metadata.sandbox).toBeUndefined();
			expect(metadata.workspaces).toBeUndefined();
			expect(
				payload.input.some((item) => (JSON.stringify(item.content) ?? "").includes("<environment_context>")),
			).toBe(false);
		}
	});

	it("keeps the turn_id stable across tool rounds of the same user turn", async () => {
		const model = bridgeModel(true);
		const cwd = resolve("fixtures/project");
		const first = turnMetadata(await capturePayload(model, firstTurn, "session-1", cwd));
		const toolRound = turnMetadata(await capturePayload(model, firstTurnToolRound, "session-1", cwd));

		expect(toolRound.turn_id).toBe(first.turn_id);
	});

	it("rotates the turn_id when the next user message starts a new turn", async () => {
		const model = bridgeModel(true);
		const first = turnMetadata(await capturePayload(model, firstTurn, "session-1"));
		const next = turnMetadata(await capturePayload(model, secondTurn, "session-1"));

		expect(next.turn_id).not.toBe(first.turn_id);
	});

	it("derives distinct turn ids for the same prompt in different sessions", async () => {
		const model = bridgeModel(true);
		const a = turnMetadata(await capturePayload(model, firstTurn, "session-a"));
		const b = turnMetadata(await capturePayload(model, firstTurn, "session-b"));

		expect(a.turn_id).not.toBe(b.turn_id);
	});

	it("omits thread_id when the caller has no session id", async () => {
		const metadata = turnMetadata(await capturePayload(bridgeModel(true), firstTurn, undefined));

		expect(metadata.thread_id).toBeUndefined();
		expect(metadata.turn_id).toMatch(/^turn_/);
	});

	it("sends no turn metadata when the compat flag is off", async () => {
		for (const model of [bridgeModel(false), bridgeModel(undefined)]) {
			const payload = await capturePayload(model, firstTurn, "session-1");

			expect(payload.client_metadata).toBeUndefined();
			expect(lastUserItem(payload).internal_chat_message_metadata_passthrough).toBeUndefined();
		}
	});
});

function connectionRefused(): Error {
	// Node's fetch reports a refused loopback connect as TypeError("fetch failed") with a coded cause.
	const socketError = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:17841"), { code: "ECONNREFUSED" });
	return new TypeError("fetch failed", { cause: socketError });
}

describe("codex-chatgpt-web bridge connection errors", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("names the launcher when the bridge refuses the connection", () => {
		const hint = describeCodexBridgeConnectionError(connectionRefused(), "http://127.0.0.1:17841/v1");

		expect(hint).toContain("http://127.0.0.1:17841/v1");
		expect(hint).toContain("Codex Web GPT launcher");
	});

	it("recognizes the refusal through an SDK wrapper that only keeps the cause chain", () => {
		const wrapped = new Error("Connection error.", { cause: connectionRefused() });

		expect(describeCodexBridgeConnectionError(wrapped, "http://127.0.0.1:17841/v1")).toBeDefined();
	});

	it("stays silent for every other failure", () => {
		for (const error of [new Error("HTTP 400"), new TypeError("fetch failed"), "ECONNREFUSED", undefined]) {
			expect(describeCodexBridgeConnectionError(error, "http://127.0.0.1:17841/v1")).toBeUndefined();
		}
	});

	it("surfaces the launcher hint as the stream error for a bridge model", async () => {
		// Given: the bridge port refuses connections because the launcher is not running.
		vi.spyOn(globalThis, "fetch").mockRejectedValue(connectionRefused());

		// When: a codex-chatgpt-web turn is attempted.
		let errorMessage: string | undefined;
		for await (const event of streamOpenAIResponses(bridgeModel(true), firstTurn, {
			apiKey: "chatgpt-web",
			maxRetries: 0,
		})) {
			if (event.type === "error") errorMessage = event.error.errorMessage;
		}

		// Then: the user is told to start the launcher instead of seeing a generic connection error.
		expect(errorMessage).toContain("Codex Web GPT launcher");
	});

	it("keeps the generic error for providers without the compat flag", async () => {
		vi.spyOn(globalThis, "fetch").mockRejectedValue(connectionRefused());

		let errorMessage: string | undefined;
		for await (const event of streamOpenAIResponses(bridgeModel(false), firstTurn, {
			apiKey: "chatgpt-web",
			maxRetries: 0,
		})) {
			if (event.type === "error") errorMessage = event.error.errorMessage;
		}

		expect(errorMessage).toBeDefined();
		expect(errorMessage).not.toContain("Codex Web GPT launcher");
	});
});
