import { describe, expect, it } from "bun:test";
import { getBundledModel } from "@oh-my-pi/pi-ai/models";
import { streamOpenAICodexResponses } from "@oh-my-pi/pi-ai/providers/openai-codex-responses";
import { streamOpenAIResponses } from "@oh-my-pi/pi-ai/providers/openai-responses";
import type { Context, Model } from "@oh-my-pi/pi-ai/types";

function createAbortedSignal(): AbortSignal {
	const controller = new AbortController();
	controller.abort();
	return controller.signal;
}

function createCodexToken(accountId: string): string {
	const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
	const payload = Buffer.from(
		JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: accountId } }),
	).toString("base64url");
	return `${header}.${payload}.signature`;
}

const preservedHistoryItems = [
	{ type: "message", role: "user", content: [{ type: "input_text", text: "Preserved user" }] },
	{ type: "compaction", encrypted_content: "enc_123" },
];

const snapshotHistoryItems = [
	{ type: "message", role: "user", content: [{ type: "input_text", text: "Canonical user" }] },
	{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Canonical assistant" }] },
];

const preservedHistoryContext: Context = {
	messages: [
		{
			role: "user",
			content: "summary that should be ignored",
			providerPayload: { type: "openaiResponsesHistory", items: preservedHistoryItems },
			timestamp: Date.now(),
		},
	],
};

const assistantSnapshotContext: Context = {
	messages: [
		{ role: "user", content: "generic history that should be replaced", timestamp: Date.now() },
		{
			role: "assistant",
			content: [{ type: "text", text: "generic assistant that should be replaced" }],
			api: "openai-responses",
			provider: "openai",
			model: "gpt-5-mini",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			providerPayload: { type: "openaiResponsesHistory", items: snapshotHistoryItems },
			timestamp: Date.now(),
		},
		{ role: "user", content: "follow-up user", timestamp: Date.now() },
	],
};

function captureResponsesPayload(model: Model<"openai-responses">, context: Context): Promise<unknown> {
	const { promise, resolve } = Promise.withResolvers<unknown>();
	streamOpenAIResponses(model, context, {
		apiKey: "test-key",
		signal: createAbortedSignal(),
		onPayload: payload => resolve(payload),
	});
	return promise;
}

function captureCodexPayload(model: Model<"openai-codex-responses">, context: Context): Promise<unknown> {
	const { promise, resolve } = Promise.withResolvers<unknown>();
	streamOpenAICodexResponses(model, context, {
		apiKey: createCodexToken("acc_test"),
		signal: createAbortedSignal(),
		onPayload: payload => resolve(payload),
	});
	return promise;
}

const incrementalItems1 = [
	{
		type: "message",
		role: "assistant",
		content: [{ type: "output_text", text: "First response" }],
		status: "completed",
		id: "msg_1",
	},
];

const incrementalItems2 = [
	{
		type: "message",
		role: "assistant",
		content: [{ type: "output_text", text: "Second response" }],
		status: "completed",
		id: "msg_2",
	},
];

function makeAssistantMessage(items: Record<string, unknown>[], incremental?: boolean) {
	return {
		role: "assistant" as const,
		content: [{ type: "text" as const, text: "ignored" }],
		api: "openai-responses" as const,
		provider: "openai" as const,
		model: "gpt-5-mini",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop" as const,
		providerPayload: {
			type: "openaiResponsesHistory" as const,
			...(incremental ? { dt: true } : {}),
			items,
		},
		timestamp: Date.now(),
	};
}

const incrementalContext: Context = {
	messages: [
		{ role: "user", content: "first question", timestamp: Date.now() },
		makeAssistantMessage(incrementalItems1, true),
		{ role: "user", content: "second question", timestamp: Date.now() },
		makeAssistantMessage(incrementalItems2, true),
		{ role: "user", content: "third question", timestamp: Date.now() },
	],
};

describe("OpenAI responses history payload", () => {
	it("inlines preserved replacement history for openai-responses", async () => {
		const model = getBundledModel("openai", "gpt-5-mini") as Model<"openai-responses">;
		const payload = (await captureResponsesPayload(model, preservedHistoryContext)) as { input?: unknown[] };
		expect(payload.input).toEqual(preservedHistoryItems);
	});

	it("prefers assistant native history snapshots for openai-responses", async () => {
		const model = getBundledModel("openai", "gpt-5-mini") as Model<"openai-responses">;
		const payload = (await captureResponsesPayload(model, assistantSnapshotContext)) as { input?: unknown[] };
		expect(payload.input).toEqual([
			...snapshotHistoryItems,
			{ role: "user", content: [{ type: "input_text", text: "follow-up user" }] },
		]);
	});

	it("prefers assistant native history snapshots for openai-codex-responses", async () => {
		const model = getBundledModel("openai-codex", "gpt-5.2-codex") as Model<"openai-codex-responses">;
		const payload = (await captureCodexPayload(model, assistantSnapshotContext)) as { input?: unknown[] };
		expect(payload.input).toEqual([
			...snapshotHistoryItems,
			{ role: "user", content: [{ type: "input_text", text: "follow-up user" }] },
		]);
	});

	it("builds up history incrementally from multiple assistant messages", async () => {
		const model = getBundledModel("openai", "gpt-5-mini") as Model<"openai-responses">;
		const payload = (await captureResponsesPayload(model, incrementalContext)) as { input?: unknown[] };
		expect(payload.input).toEqual([
			{ role: "user", content: [{ type: "input_text", text: "first question" }] },
			...incrementalItems1,
			{ role: "user", content: [{ type: "input_text", text: "second question" }] },
			...incrementalItems2,
			{ role: "user", content: [{ type: "input_text", text: "third question" }] },
		]);
	});

	it("backward compat: old full-snapshot payloads still replace history", async () => {
		const fullSnapshotItems = [
			{ type: "message", role: "user", content: [{ type: "input_text", text: "Canonical user" }] },
			{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Canonical assistant" }] },
		];
		const context: Context = {
			messages: [
				{ role: "user", content: "old user message that gets replaced", timestamp: Date.now() },
				{
					...makeAssistantMessage(fullSnapshotItems, false),
					// no incremental flag — old format
				},
				{ role: "user", content: "follow-up", timestamp: Date.now() },
			],
		};
		const model = getBundledModel("openai", "gpt-5-mini") as Model<"openai-responses">;
		const payload = (await captureResponsesPayload(model, context)) as { input?: unknown[] };
		// Old full-snapshot should replace all prior history
		expect(payload.input).toEqual([
			...fullSnapshotItems,
			{ role: "user", content: [{ type: "input_text", text: "follow-up" }] },
		]);
	});
});
