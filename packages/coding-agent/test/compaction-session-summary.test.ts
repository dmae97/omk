import type { Api, Model } from "omk-ai";
import { expect, it, vi } from "vitest";
import type { CompactionPreparation } from "../src/core/compaction/compaction.ts";
import { type CompactionSummaryInput, summarizeSessionCompaction } from "../src/core/compaction/session-summary.ts";
import { createFileOps } from "../src/core/compaction/utils.ts";

const primary: Model<Api> = {
	id: "primary",
	name: "Primary",
	api: "openai-completions",
	provider: "openai",
	baseUrl: "https://example.invalid",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 16000,
	maxTokens: 4000,
};
const rescue: Model<Api> = { ...primary, id: "rescue", provider: "other" };
const preparation: CompactionPreparation = {
	firstKeptEntryId: "kept",
	messagesToSummarize: [],
	turnPrefixMessages: [],
	isSplitTurn: false,
	tokensBefore: 10000,
	fileOps: createFileOps(),
	settings: { enabled: true, reserveTokens: 1000, keepRecentTokens: 100 },
};
const result = { summary: "summary", firstKeptEntryId: "kept", tokensBefore: 10000 };

it.each(["manual", "threshold", "overflow"] as const)(
	"preserves %s inputs and binds rescue to its own auth",
	async (reason) => {
		const signal = new AbortController().signal;
		const resolveAuth = vi.fn(async () => ({ apiKey: "rescue-fixture", headers: { route: "rescue" } }));
		const summarize = vi.fn(async (input: CompactionSummaryInput) => {
			if (input.model === primary) throw new Error("usage limit has been reached");
			return result;
		});
		expect(
			await summarizeSessionCompaction({
				preparation,
				model: primary,
				apiKey: "primary-fixture",
				headers: { route: "primary" },
				customInstructions: "keep rules",
				signal,
				reason,
				sessionModel: rescue,
				resolveAuth,
				summarize,
			}),
		).toBe(result);
		expect(resolveAuth).toHaveBeenCalledExactlyOnceWith(rescue);
		expect(
			summarize.mock.calls.map(([input]) => ({ model: input.model, apiKey: input.apiKey, headers: input.headers })),
		).toEqual([
			{ model: primary, apiKey: "primary-fixture", headers: { route: "primary" } },
			{ model: rescue, apiKey: "rescue-fixture", headers: { route: "rescue" } },
		]);
		for (const [input] of summarize.mock.calls) {
			expect(input).toMatchObject({ preparation, customInstructions: "keep rules", reason });
			expect(input.signal).toBe(signal);
		}
	},
);

it.each(["manual", "threshold", "overflow"] as const)("keeps the non-quota rescue policy for %s", async (reason) => {
	const failure = new Error("provider returned error 503 service unavailable");
	const resolveAuth = vi.fn(async () => ({ apiKey: "rescue-fixture" }));
	const summarize = vi.fn(async (input: CompactionSummaryInput) => {
		if (input.model === primary) throw failure;
		return result;
	});
	const pending = summarizeSessionCompaction({
		preparation,
		model: primary,
		apiKey: "primary-fixture",
		headers: undefined,
		signal: new AbortController().signal,
		reason,
		sessionModel: rescue,
		resolveAuth,
		summarize,
	});
	if (reason === "overflow") {
		expect(await pending).toBe(result);
		expect(resolveAuth).toHaveBeenCalledExactlyOnceWith(rescue);
	} else {
		await expect(pending).rejects.toBe(failure);
		expect(resolveAuth).not.toHaveBeenCalled();
	}
});

it("does not summarize on the rescue model after auth resolution aborts", async () => {
	const controller = new AbortController();
	const summarize = vi.fn(async (input: CompactionSummaryInput) => {
		if (input.model === primary) throw new Error("usage limit has been reached");
		return result;
	});
	await expect(
		summarizeSessionCompaction({
			preparation,
			model: primary,
			apiKey: "primary-fixture",
			headers: undefined,
			signal: controller.signal,
			reason: "overflow",
			sessionModel: rescue,
			summarize,
			resolveAuth: async () => {
				controller.abort();
				return { apiKey: "rescue-fixture" };
			},
		}),
	).rejects.toMatchObject({ name: "AbortError" });
	expect(summarize).toHaveBeenCalledTimes(1);
});

it("does not rescue an aborted overflow attempt", async () => {
	const controller = new AbortController();
	const failure = new Error("usage limit has been reached");
	const resolveAuth = vi.fn(async () => ({ apiKey: "rescue-fixture" }));
	await expect(
		summarizeSessionCompaction({
			preparation,
			model: primary,
			apiKey: "primary-fixture",
			headers: undefined,
			signal: controller.signal,
			reason: "overflow",
			sessionModel: rescue,
			resolveAuth,
			summarize: async () => {
				controller.abort();
				throw failure;
			},
		}),
	).rejects.toBe(failure);
	expect(resolveAuth).not.toHaveBeenCalled();
});
