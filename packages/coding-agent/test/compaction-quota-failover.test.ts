import type { AgentMessage, StreamFn } from "omk-agent-core";
import type { AssistantMessage, Model } from "omk-ai";
import { describe, expect, it } from "vitest";
import { type CompactionPreparation, type CompactionSettings, compact } from "../src/core/compaction/compaction.ts";
import { createFileOps } from "../src/core/compaction/utils.ts";

const QUOTA_ERROR = "Codex error: The usage limit has been reached";
const TRANSIENT_ERROR = "provider returned error 503 service unavailable";

const SETTINGS: CompactionSettings = {
	enabled: true,
	reserveTokens: 1000,
	keepRecentTokens: 100,
};

function makeModel(provider: string, id: string): Model<any> {
	return { provider, id, maxTokens: 4000 } as unknown as Model<any>;
}

function assistantError(errorMessage: string): AssistantMessage {
	return {
		role: "assistant",
		stopReason: "error",
		errorMessage,
		content: [],
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	} as unknown as AssistantMessage;
}

function assistantText(text: string): AssistantMessage {
	return {
		role: "assistant",
		stopReason: "stop",
		content: [{ type: "text", text }],
		usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
	} as unknown as AssistantMessage;
}

/**
 * Fake StreamFn keyed by `${provider}/${id}` so a test can decide which model
 * fails and which succeeds.
 */
function makeStreamFn(
	outcomes: Record<string, AssistantMessage>,
	calls: string[] = [],
	apiKeys: Record<string, string | undefined> = {},
): StreamFn {
	const fn = (async (model: Model<any>, _context: unknown, options?: { apiKey?: string }) => {
		const key = `${model.provider}/${model.id}`;
		calls.push(key);
		apiKeys[key] = options?.apiKey;
		const outcome = outcomes[key] ?? assistantText(`summary from ${key}`);
		return {
			result: async () => outcome,
		};
	}) as unknown as StreamFn;
	return fn;
}

const USER_MESSAGE: AgentMessage = {
	role: "user",
	content: "hello",
	timestamp: Date.now(),
} as unknown as AgentMessage;

function makePreparation(): CompactionPreparation {
	return {
		firstKeptEntryId: "kept-1",
		messagesToSummarize: [USER_MESSAGE],
		turnPrefixMessages: [],
		isSplitTurn: false,
		tokensBefore: 10,
		fileOps: createFileOps(),
		settings: SETTINGS,
	};
}

describe("compact quota-exhaustion failover", () => {
	it("falls back to the next candidate when the primary model's quota is exhausted", async () => {
		const primary = makeModel("openrouter", "stealth/ox-alpha");
		const candidate = makeModel("kimi-coding", "k3");
		const calls: string[] = [];
		const streamFn = makeStreamFn(
			{
				"openrouter/stealth/ox-alpha": assistantError(QUOTA_ERROR),
				"kimi-coding/k3": assistantText("rescued summary"),
			},
			calls,
		);

		const result = await compact(
			makePreparation(),
			primary,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			streamFn,
			undefined,
			undefined,
			[candidate],
			{ resolveCandidateAuth: async () => ({ apiKey: "candidate-key" }) },
		);

		expect(result.summary).toContain("rescued summary");
		expect(calls).toEqual(["openrouter/stealth/ox-alpha", "kimi-coding/k3"]);
	});

	it("skips candidates that duplicate the primary model", async () => {
		const primary = makeModel("openrouter", "stealth/ox-alpha");
		const duplicate = makeModel("openrouter", "stealth/ox-alpha");
		const realCandidate = makeModel("deepseek", "deepseek-v4-flash");
		const calls: string[] = [];
		const streamFn = makeStreamFn({ "openrouter/stealth/ox-alpha": assistantError(QUOTA_ERROR) }, calls);

		const result = await compact(
			makePreparation(),
			primary,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			streamFn,
			undefined,
			undefined,
			[duplicate, realCandidate],
			{ resolveCandidateAuth: async () => ({ apiKey: "candidate-key" }) },
		);

		expect(result.summary).toContain("deepseek/deepseek-v4-flash");
		expect(calls).toEqual(["openrouter/stealth/ox-alpha", "deepseek/deepseek-v4-flash"]);
	});

	it("surfaces non-quota failures immediately without burning candidates", async () => {
		const primary = makeModel("openrouter", "stealth/ox-alpha");
		const candidate = makeModel("kimi-coding", "k3");
		const calls: string[] = [];
		const streamFn = makeStreamFn({ "openrouter/stealth/ox-alpha": assistantError(TRANSIENT_ERROR) }, calls);

		await expect(
			compact(
				makePreparation(),
				primary,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				streamFn,
				undefined,
				undefined,
				[candidate],
				{ resolveCandidateAuth: async () => ({ apiKey: "candidate-key" }) },
			),
		).rejects.toThrow(/Summarization failed/);
		expect(calls).toEqual(["openrouter/stealth/ox-alpha"]);
	});

	it("throws the original quota error when every candidate is also quota-blocked", async () => {
		const primary = makeModel("openrouter", "stealth/ox-alpha");
		const candidates = [makeModel("kimi-coding", "k3"), makeModel("deepseek", "deepseek-v4-flash")];
		const calls: string[] = [];
		const streamFn = makeStreamFn(
			{
				"openrouter/stealth/ox-alpha": assistantError(QUOTA_ERROR),
				"kimi-coding/k3": assistantError("kimi usage limit reached"),
				"deepseek/deepseek-v4-flash": assistantError("insufficient_quota"),
			},
			calls,
		);

		await expect(
			compact(
				makePreparation(),
				primary,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				streamFn,
				undefined,
				undefined,
				candidates,
				{ resolveCandidateAuth: async () => ({ apiKey: "candidate-key" }) },
			),
		).rejects.toThrow(/The usage limit has been reached/);
		expect(calls).toEqual(["openrouter/stealth/ox-alpha", "kimi-coding/k3", "deepseek/deepseek-v4-flash"]);
	});

	it("keeps plain single-model compaction working without failover models", async () => {
		const primary = makeModel("anthropic", "claude-sonnet");
		const calls: string[] = [];
		const streamFn = makeStreamFn({}, calls);

		const result = await compact(
			makePreparation(),
			primary,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			streamFn,
		);

		expect(result.summary).toContain("anthropic/claude-sonnet");
		expect(calls).toEqual(["anthropic/claude-sonnet"]);
	});

	it("never replays the primary key against a cross-provider candidate", async () => {
		// Regression for the 2026-09-20 incident: the Codex OAuth bearer was sent
		// to api.kimi.com, which answered an entitlement 403 that surfaced under
		// the primary model's label. Candidates must get their own credentials.
		const primary = makeModel("openai-codex", "gpt-5.6-sol");
		const candidate = makeModel("kimi-coding", "k3");
		const calls: string[] = [];
		const apiKeys: Record<string, string | undefined> = {};
		const streamFn = makeStreamFn(
			{
				"openai-codex/gpt-5.6-sol": assistantError(QUOTA_ERROR),
				"kimi-coding/k3": assistantText("rescued summary"),
			},
			calls,
			apiKeys,
		);

		const result = await compact(
			makePreparation(),
			primary,
			"codex-oauth-token",
			undefined,
			undefined,
			undefined,
			undefined,
			streamFn,
			undefined,
			undefined,
			[candidate],
			{ resolveCandidateAuth: async () => ({ apiKey: "kimi-key" }) },
		);

		expect(result.summary).toContain("rescued summary");
		expect(apiKeys["openai-codex/gpt-5.6-sol"]).toBe("codex-oauth-token");
		expect(apiKeys["kimi-coding/k3"]).toBe("kimi-key");
	});

	it("skips a cross-provider candidate with no resolvable auth instead of leaking the primary key", async () => {
		const primary = makeModel("openai-codex", "gpt-5.6-sol");
		const noAuth = makeModel("kimi-coding", "k3");
		const rescued = makeModel("deepseek", "deepseek-v4-flash");
		const calls: string[] = [];
		const apiKeys: Record<string, string | undefined> = {};
		const streamFn = makeStreamFn(
			{
				"openai-codex/gpt-5.6-sol": assistantError(QUOTA_ERROR),
				"deepseek/deepseek-v4-flash": assistantText("rescued summary"),
			},
			calls,
			apiKeys,
		);

		const result = await compact(
			makePreparation(),
			primary,
			"codex-oauth-token",
			undefined,
			undefined,
			undefined,
			undefined,
			streamFn,
			undefined,
			undefined,
			[noAuth, rescued],
			{
				resolveCandidateAuth: async (candidate) =>
					candidate.provider === "deepseek" ? { apiKey: "deepseek-key" } : {},
			},
		);

		expect(result.summary).toContain("rescued summary");
		// kimi-coding was never called — its key was not resolvable.
		expect(calls).toEqual(["openai-codex/gpt-5.6-sol", "deepseek/deepseek-v4-flash"]);
		expect(apiKeys["kimi-coding/k3"]).toBeUndefined();
	});

	it("absorbs a candidate's terminal 403 and continues to the next candidate", async () => {
		// The observed incident shape: codex quota-dead -> k3 entitlement 403 ->
		// deepseek serves. A terminally-dead candidate must not abort the chain.
		const primary = makeModel("openai-codex", "gpt-5.6-sol");
		const dead = makeModel("kimi-coding", "k3");
		const rescued = makeModel("deepseek", "deepseek-v4-flash");
		const calls: string[] = [];
		const streamFn = makeStreamFn(
			{
				"openai-codex/gpt-5.6-sol": assistantError(QUOTA_ERROR),
				"kimi-coding/k3": assistantError(
					'403 {"error":{"type":"permission_error","message":"subscription does not have access"}}',
				),
				"deepseek/deepseek-v4-flash": assistantText("rescued summary"),
			},
			calls,
		);

		const result = await compact(
			makePreparation(),
			primary,
			"codex-oauth-token",
			undefined,
			undefined,
			undefined,
			undefined,
			streamFn,
			undefined,
			undefined,
			[dead, rescued],
			{ resolveCandidateAuth: async (candidate) => ({ apiKey: `${candidate.provider}-key` }) },
		);

		expect(result.summary).toContain("rescued summary");
		expect(calls).toEqual(["openai-codex/gpt-5.6-sol", "kimi-coding/k3", "deepseek/deepseek-v4-flash"]);
	});

	it("does not dispatch a candidate when cancellation arrives during auth resolution", async () => {
		const primary = makeModel("openai-codex", "gpt-5.6-sol");
		const candidate = makeModel("kimi-coding", "k3");
		const controller = new AbortController();
		const calls: string[] = [];
		const streamFn = makeStreamFn({ "openai-codex/gpt-5.6-sol": assistantError(QUOTA_ERROR) }, calls);
		await expect(
			compact(
				makePreparation(),
				primary,
				"primary-fixture",
				undefined,
				undefined,
				controller.signal,
				undefined,
				streamFn,
				undefined,
				undefined,
				[candidate],
				{
					resolveCandidateAuth: async () => {
						controller.abort();
						return { apiKey: "candidate-fixture" };
					},
				},
			),
		).rejects.toThrow(/The usage limit has been reached/);
		expect(calls).toEqual(["openai-codex/gpt-5.6-sol"]);
	});

	it("attributes a candidate's transient failure to the candidate, not the primary", async () => {
		const primary = makeModel("openai-codex", "gpt-5.6-sol");
		const candidate = makeModel("kimi-coding", "k3");
		const streamFn = makeStreamFn({
			"openai-codex/gpt-5.6-sol": assistantError(QUOTA_ERROR),
			"kimi-coding/k3": assistantError("provider returned error 503 service unavailable"),
		});

		await expect(
			compact(
				makePreparation(),
				primary,
				"codex-oauth-token",
				undefined,
				undefined,
				undefined,
				undefined,
				streamFn,
				undefined,
				undefined,
				[candidate],
				{ resolveCandidateAuth: async () => ({ apiKey: "kimi-key" }) },
			),
		).rejects.toThrow(/Failover candidate kimi-coding\/k3 failed:.*503/);
	});
});
