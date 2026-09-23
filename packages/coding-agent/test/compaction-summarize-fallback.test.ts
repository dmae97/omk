/**
 * summarizeWithFallback ladder — the overflow-rescue gate.
 *
 * Mechanism this pins: overflow recovery is the session's last chance before a
 * provider 400 strands it. Without `alwaysRescue` the ladder only descends on
 * quota-class errors; the 2026-09-20 incident showed a failover candidate's
 * entitlement 403 (permission_error, not quota) aborting compaction under the
 * primary model's label and leaving the session dead. `alwaysRescue` — set by
 * the overflow path — routes every summarization failure through the
 * session-model rescue and then the deterministic trim.
 */

import type { AgentMessage } from "omk-agent-core";
import type { Model } from "omk-ai";
import { describe, expect, it } from "vitest";
import type { CompactionPreparation, CompactionResult, CompactionSettings } from "../src/core/compaction/compaction.ts";
import { type DeterministicCompactionDetails, summarizeWithFallback } from "../src/core/compaction/fallback.ts";
import { createFileOps } from "../src/core/compaction/utils.ts";

const SETTINGS: CompactionSettings = {
	enabled: true,
	reserveTokens: 1000,
	keepRecentTokens: 100,
};

const QUOTA_ERROR = "Codex error: The usage limit has been reached";
const PERMISSION_ERROR =
	'Failover candidate kimi-coding/k3 failed: 403 {"error":{"type":"permission_error","message":"subscription does not have access"}}';
const TRANSIENT_ERROR = "provider returned error 503 service unavailable";

function makeModel(provider: string, id: string): Model<any> {
	return { provider, id, maxTokens: 4000 } as unknown as Model<any>;
}

function user(content: string): AgentMessage {
	return { role: "user", content, timestamp: 0 } as unknown as AgentMessage;
}

function makePreparation(): CompactionPreparation {
	return {
		firstKeptEntryId: "kept-1",
		messagesToSummarize: [user("hello")],
		turnPrefixMessages: [],
		isSplitTurn: false,
		tokensBefore: 4242,
		fileOps: createFileOps(),
		settings: SETTINGS,
	};
}

function result(text: string): CompactionResult {
	return {
		summary: text,
		firstKeptEntryId: "kept-1",
		tokensBefore: 4242,
		details: { readFiles: [], modifiedFiles: [] },
	};
}

function failingSummarize(error: string): (model: Model<any>) => Promise<CompactionResult> {
	return async () => {
		throw new Error(error);
	};
}

function isDeterministic(r: CompactionResult): boolean {
	return (r.details as DeterministicCompactionDetails | undefined)?.deterministicEmergency === true;
}

describe("summarizeWithFallback", () => {
	it("rescues a non-quota primary failure on overflow (alwaysRescue)", async () => {
		const r = await summarizeWithFallback({
			preparation: makePreparation(),
			primaryModel: makeModel("openai-codex", "gpt-5.6-sol"),
			sessionModel: makeModel("devin", "swe-2"),
			isAborted: () => false,
			alwaysRescue: true,
			summarize: async (model) =>
				model.provider === "devin" ? result("session summary") : failingSummarize(PERMISSION_ERROR)(model),
		});
		expect(r.summary).toBe("session summary");
	});

	it("reaches the deterministic trim when both models fail (alwaysRescue)", async () => {
		const r = await summarizeWithFallback({
			preparation: makePreparation(),
			primaryModel: makeModel("openai-codex", "gpt-5.6-sol"),
			sessionModel: makeModel("devin", "swe-2"),
			isAborted: () => false,
			alwaysRescue: true,
			summarize: failingSummarize(PERMISSION_ERROR),
		});
		expect(isDeterministic(r)).toBe(true);
		expect((r.details as DeterministicCompactionDetails).deterministicReason).toContain("permission_error");
	});

	it("still propagates non-quota failures without alwaysRescue", async () => {
		await expect(
			summarizeWithFallback({
				preparation: makePreparation(),
				primaryModel: makeModel("openai-codex", "gpt-5.6-sol"),
				sessionModel: makeModel("devin", "swe-2"),
				isAborted: () => false,
				summarize: failingSummarize(TRANSIENT_ERROR),
			}),
		).rejects.toThrow(/503/);
	});

	it("trims when Devin resource_exhausted is reported as quota", async () => {
		const r = await summarizeWithFallback({
			preparation: makePreparation(),
			primaryModel: makeModel("devin", "swe-2"),
			sessionModel: makeModel("devin", "swe-2"),
			isAborted: () => false,
			summarize: failingSummarize("Devin quota exceeded"),
		});
		expect(isDeterministic(r)).toBe(true);
	});

	it("keeps quota-rescue working without alwaysRescue", async () => {
		const r = await summarizeWithFallback({
			preparation: makePreparation(),
			primaryModel: makeModel("openai-codex", "gpt-5.6-sol"),
			sessionModel: makeModel("devin", "swe-2"),
			isAborted: () => false,
			summarize: async (model) =>
				model.provider === "devin" ? result("session summary") : failingSummarize(QUOTA_ERROR)(model),
		});
		expect(r.summary).toBe("session summary");
	});

	it("propagates aborts even with alwaysRescue", async () => {
		await expect(
			summarizeWithFallback({
				preparation: makePreparation(),
				primaryModel: makeModel("openai-codex", "gpt-5.6-sol"),
				sessionModel: makeModel("devin", "swe-2"),
				isAborted: () => true,
				alwaysRescue: true,
				summarize: failingSummarize("aborted"),
			}),
		).rejects.toThrow(/aborted/);
	});
});
