import type { ResponseStreamEvent } from "openai/resources/responses/responses.js";
import { describe, expect, it } from "vitest";
import { parseChunkUsage } from "../src/providers/openai-completions-usage.ts";
import { processResponsesStream } from "../src/providers/openai-responses-shared.ts";
import { hasNoCacheWriteCharge, parseResponsesUsage } from "../src/providers/openai-responses-usage.ts";
import type { AssistantMessage, Model } from "../src/types.ts";
import {
	cacheReadShare,
	cumulativeCacheReadShare,
	isUsageInputSemanticsVerified,
	uncachedInputFromInclusiveTotal,
} from "../src/usage-share.ts";
import { AssistantMessageEventStream } from "../src/utils/event-stream.ts";

const responsesModel: Model<"openai-responses"> = {
	id: "gpt-5.6",
	name: "GPT-5.6",
	api: "openai-responses",
	provider: "openai",
	baseUrl: "https://api.openai.com/v1",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 400000,
	maxTokens: 128000,
};

function emptyOutput(): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: responsesModel.api,
		provider: responsesModel.provider,
		model: responsesModel.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 0,
	};
}

async function completedUsage(details: Record<string, number>): Promise<AssistantMessage["usage"]> {
	async function* events(): AsyncIterable<ResponseStreamEvent> {
		yield {
			type: "response.completed",
			response: {
				id: "resp_test",
				status: "completed",
				usage: { input_tokens: 1000, output_tokens: 5, total_tokens: 1005, input_tokens_details: details },
			},
		} as unknown as ResponseStreamEvent;
	}
	const output = emptyOutput();
	await processResponsesStream(events(), output, new AssistantMessageEventStream(), responsesModel);
	return output.usage;
}

describe("cache read share", () => {
	it("is 80% for input 100, read 800, write 100", () => {
		expect(cacheReadShare({ input: 100, cacheRead: 800, cacheWrite: 100 })).toBe(0.8);
	});

	it("keeps the previous value when cache write is 0 (98.9% stays 98.9%)", () => {
		const usage = { input: 11, cacheRead: 989, cacheWrite: 0 };
		expect(cacheReadShare(usage)).toBe(989 / (11 + 989));
		expect(cacheReadShare(usage)).toBeCloseTo(0.989, 12);
	});

	it("computes cumulative share from token sums, not mean of percentages", () => {
		const share = cumulativeCacheReadShare([
			{ input: 0, cacheRead: 10, cacheWrite: 0 },
			{ input: 900, cacheRead: 90, cacheWrite: 0 },
		]);
		expect(share).toBe(100 / 1000);
	});

	it("is undefined with no prompt-side usage", () => {
		expect(cacheReadShare({ input: 0, cacheRead: 0, cacheWrite: 0 })).toBeUndefined();
	});

	it("gives 80% for the same usage in OpenAI shape (input includes cache) and Anthropic shape", async () => {
		const anthropicShape = { input: 100, cacheRead: 800, cacheWrite: 100 };
		const openaiResponses = await completedUsage({ cached_tokens: 800, cache_write_tokens: 100 });
		expect(openaiResponses).toMatchObject(anthropicShape);
		const completions = parseChunkUsage(
			{
				prompt_tokens: 1000,
				completion_tokens: 5,
				prompt_tokens_details: { cached_tokens: 800, cache_write_tokens: 100 },
			},
			{ ...responsesModel, api: "openai-completions" } as unknown as Model<"openai-completions">,
		);
		expect(completions).toMatchObject(anthropicShape);
		for (const usage of [anthropicShape, openaiResponses, completions]) expect(cacheReadShare(usage)).toBe(0.8);
		expect(uncachedInputFromInclusiveTotal(1000, 800, 100)).toBe(100);
	});

	it("marks cacheWrite unknown (not 0) when OpenAI omits cache_write_tokens", async () => {
		const usage = await completedUsage({ cached_tokens: 800 });
		expect(usage).toMatchObject({ input: 200, cacheRead: 800, cacheWriteUnknown: true });
	});

	it("zero-fills a missing cache_write_tokens only for OpenAI models before GPT-5.6", async () => {
		const raw = {
			input_tokens: 1000,
			output_tokens: 5,
			total_tokens: 1005,
			input_tokens_details: { cached_tokens: 800 },
		};
		for (const id of [
			"gpt-5.5",
			"gpt-5.5-pro",
			"gpt-5",
			"gpt-5.1-codex",
			"gpt-4.1",
			"gpt-4o-mini",
			"o3",
			"o4-mini",
		]) {
			const usage = parseResponsesUsage(raw, { provider: "openai", id });
			expect(usage, id).toMatchObject({ input: 200, cacheRead: 800, cacheWrite: 0 });
			expect(usage.cacheWriteUnknown, id).toBeUndefined();
		}
		for (const id of ["gpt-5.6", "gpt-6.1-sol", "gpt-10", "my-custom-model"]) {
			expect(parseResponsesUsage(raw, { provider: "openai", id }).cacheWriteUnknown, id).toBe(true);
		}
		for (const provider of ["azure-openai-responses", "openai-codex", "anthropic"]) {
			expect(parseResponsesUsage(raw, { provider, id: "gpt-5.5" }).cacheWriteUnknown, provider).toBe(true);
		}
		expect(hasNoCacheWriteCharge("anthropic", "claude-sonnet-4-5")).toBe(false);
	});

	it("keeps a reported cache_write_tokens of 0 as a known 0", async () => {
		const usage = await completedUsage({ cached_tokens: 800, cache_write_tokens: 0 });
		expect(usage).toMatchObject({ input: 200, cacheRead: 800, cacheWrite: 0 });
		expect(usage.cacheWriteUnknown).toBeUndefined();
	});

	it("marks providers whose input semantics were not verified", () => {
		expect(isUsageInputSemanticsVerified("anthropic")).toBe(true);
		expect(isUsageInputSemanticsVerified("openai")).toBe(true);
		expect(isUsageInputSemanticsVerified("xai")).toBe(false);
		expect(isUsageInputSemanticsVerified(undefined)).toBe(false);
	});
});
