import { describe, expect, it } from "bun:test";
import { getBundledModel } from "@oh-my-pi/pi-ai/models";
import { streamOpenAICodexResponses } from "@oh-my-pi/pi-ai/providers/openai-codex-responses";
import { streamOpenAIResponses } from "@oh-my-pi/pi-ai/providers/openai-responses";
import type { Context, Model } from "@oh-my-pi/pi-ai/types";
import { createOpenAIResponsesHistoryPayload } from "../src/utils";

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
			providerPayload: createOpenAIResponsesHistoryPayload("openai", preservedHistoryItems, false),
			timestamp: Date.now(),
		},
	],
};

const assistantSnapshotContext: Context = {
	messages: [
		{ role: "user", content: "generic history that should be replaced", timestamp: Date.now() },
		makeAssistantMessage(snapshotHistoryItems),
		{ role: "user", content: "follow-up user", timestamp: Date.now() },
	],
};

const codexAssistantSnapshotContext: Context = {
	messages: [
		{ role: "user", content: "generic history that should be replaced", timestamp: Date.now() },
		makeAssistantMessage(snapshotHistoryItems, false, "openai-codex", "gpt-5.2-codex"),
		{ role: "user", content: "follow-up user", timestamp: Date.now() },
	],
};

const codexToCopilotContext: Context = {
	messages: [
		{ role: "user", content: "generic user before switch", timestamp: Date.now() },
		{
			...makeAssistantMessage([], false, "openai-codex", "gpt-5.2-codex"),
			content: [{ type: "text", text: "generic assistant that should be rebuilt" }],
			providerPayload: createOpenAIResponsesHistoryPayload("openai-codex", [
				{ type: "reasoning", encrypted_content: "enc_123" },
				...snapshotHistoryItems,
			]),
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

function makeAssistantMessage(
	items: Record<string, unknown>[],
	incremental = false,
	provider: "openai" | "openai-codex" = "openai",
	model = provider === "openai" ? "gpt-5-mini" : "gpt-5.2-codex",
) {
	return {
		role: "assistant" as const,
		content: [{ type: "text" as const, text: "ignored" }],
		api: provider === "openai" ? ("openai-responses" as const) : ("openai-codex-responses" as const),
		provider,
		model,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop" as const,
		providerPayload: createOpenAIResponsesHistoryPayload(provider, items, incremental),
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

function containsAssistantOutputText(input: unknown[] | undefined, text: string): boolean {
	return (input ?? []).some(item => {
		if (!item || typeof item !== "object") return false;
		const candidate = item as { type?: unknown; role?: unknown; content?: unknown };
		if (candidate.type !== "message" || candidate.role !== "assistant" || !Array.isArray(candidate.content))
			return false;
		return candidate.content.some(part => {
			if (!part || typeof part !== "object") return false;
			const content = part as { type?: unknown; text?: unknown };
			return content.type === "output_text" && content.text === text;
		});
	});
}

function containsEncryptedReasoning(input: unknown[] | undefined): boolean {
	return (input ?? []).some(item => {
		if (!item || typeof item !== "object") return false;
		const candidate = item as { encrypted_content?: unknown };
		return typeof candidate.encrypted_content === "string";
	});
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
		const payload = (await captureCodexPayload(model, codexAssistantSnapshotContext)) as { input?: unknown[] };
		expect(payload.input).toEqual([
			...snapshotHistoryItems,
			{ role: "user", content: [{ type: "input_text", text: "follow-up user" }] },
		]);
	});

	it("ignores incompatible native history snapshots across providers", async () => {
		const model = getBundledModel("github-copilot", "gpt-5.4") as Model<"openai-responses">;
		const payload = (await captureResponsesPayload(model, codexToCopilotContext)) as { input?: unknown[] };
		expect(containsEncryptedReasoning(payload.input)).toBe(false);
		expect(containsAssistantOutputText(payload.input, "generic assistant that should be rebuilt")).toBe(true);
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

	it("preserves assistant message phase when rebuilding fallback replay history", async () => {
		const context: Context = {
			messages: [
				{ role: "user", content: "first user", timestamp: Date.now() },
				{
					role: "assistant",
					content: [
						{
							type: "text",
							text: "Commentary answer",
							textSignature: JSON.stringify({ v: 1, id: "msg_commentary", phase: "commentary" }),
						},
					],
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
					timestamp: Date.now(),
				},
				{ role: "user", content: "follow-up", timestamp: Date.now() },
			],
		};
		const model = getBundledModel("openai", "gpt-5-mini") as Model<"openai-responses">;
		const payload = (await captureResponsesPayload(model, context)) as { input?: unknown[] };
		expect(payload.input).toEqual([
			{ role: "user", content: [{ type: "input_text", text: "first user" }] },
			{
				type: "message",
				role: "assistant",
				content: [{ type: "output_text", text: "Commentary answer", annotations: [] }],
				status: "completed",
				id: "msg_commentary",
				phase: "commentary",
			},
			{ role: "user", content: [{ type: "input_text", text: "follow-up" }] },
		]);
	});

	it("keeps legacy plain-string text signatures when rebuilding fallback replay history", async () => {
		const context: Context = {
			messages: [
				{ role: "user", content: "first user", timestamp: Date.now() },
				{
					role: "assistant",
					content: [{ type: "text", text: "Legacy answer", textSignature: "msg_legacy" }],
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
					timestamp: Date.now(),
				},
				{ role: "user", content: "follow-up", timestamp: Date.now() },
			],
		};
		const model = getBundledModel("openai", "gpt-5-mini") as Model<"openai-responses">;
		const payload = (await captureResponsesPayload(model, context)) as { input?: unknown[] };
		expect(payload.input).toEqual([
			{ role: "user", content: [{ type: "input_text", text: "first user" }] },
			{
				type: "message",
				role: "assistant",
				content: [{ type: "output_text", text: "Legacy answer", annotations: [] }],
				status: "completed",
				id: "msg_legacy",
			},
			{ role: "user", content: [{ type: "input_text", text: "follow-up" }] },
		]);
	});

	it("backward compat: old full-snapshot payloads still replace history for legacy same-provider assistant turns", async () => {
		const fullSnapshotItems = [
			{ type: "message", role: "user", content: [{ type: "input_text", text: "Canonical user" }] },
			{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Canonical assistant" }] },
		];
		const context: Context = {
			messages: [
				{ role: "user", content: "old user message that gets replaced", timestamp: Date.now() },
				{
					...makeAssistantMessage(fullSnapshotItems, false),
					providerPayload: { type: "openaiResponsesHistory", items: fullSnapshotItems },
				},
				{ role: "user", content: "follow-up", timestamp: Date.now() },
			],
		};
		const model = getBundledModel("openai", "gpt-5-mini") as Model<"openai-responses">;
		const payload = (await captureResponsesPayload(model, context)) as { input?: unknown[] };
		expect(payload.input).toEqual([
			...fullSnapshotItems,
			{ role: "user", content: [{ type: "input_text", text: "follow-up" }] },
		]);
	});
});
