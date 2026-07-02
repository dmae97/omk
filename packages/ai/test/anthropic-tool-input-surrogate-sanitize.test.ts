import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { streamAnthropic } from "../src/providers/anthropic.ts";
import type { Context, Message, Model, Usage } from "../src/types.ts";
import { sanitizeSurrogatesDeep } from "../src/utils/sanitize-unicode.ts";

// Unpaired high surrogate: valid JS string char, but invalid on the wire when JSON-serialized.
// Anthropic rejects it with: "The request body is not valid JSON: no low surrogate in string".
const LONE = String.fromCharCode(0xd83d);
const LONE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function createModel(baseUrl: string): Model<"anthropic-messages"> {
	return {
		id: "claude-opus-4-8",
		name: "Claude Opus 4.8",
		api: "anthropic-messages",
		provider: "test-anthropic",
		baseUrl,
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 32000,
		compat: { forceAdaptiveThinking: true },
	};
}

function zeroUsage(): Usage {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function contextWithSurrogateToolCall(): Context {
	const messages: Message[] = [
		{ role: "user", content: "run it", timestamp: Date.now() },
		{
			role: "assistant",
			content: [
				{
					type: "toolCall",
					id: "toolu_surrogate",
					name: "lookup",
					arguments: {
						value: `bad${LONE}value`,
						nested: { deep: `x${LONE}y` },
						list: [`a${LONE}b`, "clean"],
						count: 3,
					},
				},
			],
			api: "anthropic-messages",
			provider: "test-anthropic",
			model: "claude-opus-4-8",
			usage: zeroUsage(),
			stopReason: "toolUse",
			timestamp: Date.now(),
		},
		{
			role: "toolResult",
			toolCallId: "toolu_surrogate",
			toolName: "lookup",
			content: [{ type: "text", text: "done" }],
			isError: false,
			timestamp: Date.now(),
		},
	];
	return { messages };
}

async function readRequestBody(request: IncomingMessage): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];
	for await (const chunk of request) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

async function captureAnthropicRequest(context: Context): Promise<Record<string, unknown>> {
	let capturedBody: Record<string, unknown> | undefined;

	const server = createServer(async (request, response: ServerResponse) => {
		capturedBody = await readRequestBody(request);
		response.writeHead(200, { "content-type": "text/event-stream" });
		response.end();
	});

	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address() as AddressInfo;

	try {
		const stream = streamAnthropic(createModel(`http://127.0.0.1:${address.port}`), context, {
			apiKey: "test-key",
			cacheRetention: "none",
		});
		for await (const event of stream) {
			if (event.type === "done" || event.type === "error") break;
		}
	} finally {
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
		});
	}

	if (!capturedBody) throw new Error("Anthropic request was not captured");
	return capturedBody;
}

function findToolUseInput(body: Record<string, unknown>): Record<string, unknown> {
	const messages = body.messages;
	if (!Array.isArray(messages)) throw new Error("no messages in body");
	for (const message of messages) {
		const content = (message as { content?: unknown }).content;
		if (!Array.isArray(content)) continue;
		for (const block of content) {
			if (block && typeof block === "object" && (block as { type?: unknown }).type === "tool_use") {
				return (block as { input: Record<string, unknown> }).input;
			}
		}
	}
	throw new Error("no tool_use block in request body");
}

describe("Anthropic tool_use input surrogate sanitization", () => {
	it("strips lone surrogates from model-generated tool-call arguments before they hit the wire", async () => {
		const body = await captureAnthropicRequest(contextWithSurrogateToolCall());
		const input = findToolUseInput(body);

		expect(input.value).toBe("badvalue");
		expect((input.nested as { deep: string }).deep).toBe("xy");
		expect(input.list).toEqual(["ab", "clean"]);
		expect(input.count).toBe(3);

		// The entire serialized body must be free of lone surrogates.
		expect(LONE_RE.test(JSON.stringify(body))).toBe(false);
	});

	it("sanitizeSurrogatesDeep recurses through strings, arrays, and objects while preserving non-strings", () => {
		const cleaned = sanitizeSurrogatesDeep({
			a: `keep${LONE}`,
			b: [`x${LONE}`, 1, true, null],
			c: { d: `nested${LONE}` },
			e: 42,
		});
		expect(cleaned).toEqual({
			a: "keep",
			b: ["x", 1, true, null],
			c: { d: "nested" },
			e: 42,
		});
		// Valid paired emoji must be preserved untouched.
		expect(sanitizeSurrogatesDeep("ok 🙈")).toBe("ok 🙈");
	});
});
