import type { Context, Message } from "omk-ai";
import { describe, expect, it } from "vitest";
import {
	createFallbackTokenCounter,
	createTokenCounterRegistry,
	estimateTextTokens,
	type TokenCounterAdapter,
} from "../src/core/context-budget-token-counter.ts";
import { canonicalizeMessagesForContextAdmission } from "../src/core/messages.ts";
import { estimateContextInputTokens } from "../src/core/prompt-budget.ts";
import { boundedAdmissionJson } from "../src/core/request-admission-json.ts";
import { DEFAULT_REQUEST_ADMISSION_POLICY } from "../src/core/request-admission-policy.ts";
import { projectRequestForAdmission } from "../src/core/request-admission-projection.ts";

const transcript: Message[] = [
	{ role: "user", content: "plain string 한글 😀", timestamp: 1 },
	{
		role: "user",
		content: [
			{ type: "text", text: 'quote " backslash \\ newline \n' },
			{ type: "image", data: "aGVsbG8=", mimeType: "image/png" },
		],
		timestamp: 2,
	},
	{
		role: "assistant",
		content: [
			{ type: "thinking", thinking: "plan" },
			{ type: "text", text: "export function f() { return 1; }" },
			{ type: "toolCall", id: "t1", name: "bash", arguments: { command: "ls", n: 1, deep: { ok: true } } },
		],
		api: "openai-completions",
		provider: "mock",
		model: "m",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "toolUse",
		timestamp: 3,
	},
	{
		role: "toolResult",
		toolCallId: "t1",
		toolName: "bash",
		isError: false,
		content: [{ type: "text", text: "x".repeat(5000) }],
		timestamp: 4,
	},
];

describe("context admission without a joined transcript", () => {
	it("canonical admission parts join to the JSON.stringify of the canonical messages", () => {
		const { textParts, imageCount } = canonicalizeMessagesForContextAdmission(transcript);
		const joined = textParts.join("");
		expect(JSON.parse(joined)).toHaveLength(transcript.length);
		expect(joined).toBe(JSON.stringify(JSON.parse(joined)));
		expect(imageCount).toBe(1);
		expect(canonicalizeMessagesForContextAdmission([]).textParts.join("")).toBe("[]");
	});

	it("counts session input exactly as the joined canonical text would", () => {
		const fallback = createFallbackTokenCounter();
		const joinOnly: TokenCounterAdapter = {
			id: "join-only",
			priority: 0,
			isAvailable: () => true,
			supports: () => true,
			countText: (input, modelId) => fallback.countText(input, modelId),
		};
		const input = { systemPrompt: "sys", messages: transcript, tools: [], modelId: "m" };
		const viaParts = estimateContextInputTokens({ ...input, tokenCounter: fallback });
		const viaJoin = estimateContextInputTokens({ ...input, tokenCounter: joinOnly });
		const viaRegistry = estimateContextInputTokens({ ...input, tokenCounter: createTokenCounterRegistry() });
		expect(viaParts).toEqual(viaJoin);
		expect(viaRegistry).toEqual(viaJoin);
		const text = canonicalizeMessagesForContextAdmission(transcript).textParts.join("");
		expect(viaParts.messageTokens).toBeGreaterThanOrEqual(estimateTextTokens(text, "m").tokens);
	});

	it("request projection parts join to the bounded admission JSON of the projected messages", () => {
		const context: Context = { systemPrompt: "sys", messages: transcript };
		const projection = projectRequestForAdmission(context, DEFAULT_REQUEST_ADMISSION_POLICY);
		const joined = projection.messageParts.join("");
		expect(joined).toBe(boundedAdmissionJson(JSON.parse(joined), { remaining: Number.MAX_SAFE_INTEGER, nodes: 0 }));
		expect(projection.imageCount).toBe(1);
		expect(createFallbackTokenCounter().countTextParts?.(projection.messageParts, "m")).toEqual(
			estimateTextTokens(joined, "m"),
		);
	});
});
