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
});
