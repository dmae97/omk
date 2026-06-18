import type { AgentMessage } from "@earendil-works/omk-agent-core";
import type { AssistantMessage, Model } from "@earendil-works/omk-ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	type CompactionPreparation,
	compact,
	generateBranchSummary,
	generateSummary,
	packSummaryInputForTokenBudget,
} from "../src/core/compaction/index.ts";
import type { SessionMessageEntry } from "../src/core/session-manager.ts";

const { completeSimpleMock } = vi.hoisted(() => ({
	completeSimpleMock: vi.fn(),
}));

vi.mock("@earendil-works/omk-ai", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@earendil-works/omk-ai")>();
	return {
		...actual,
		completeSimple: completeSimpleMock,
	};
});

function createModel(reasoning: boolean, maxTokens = 8192): Model<"anthropic-messages"> {
	return {
		id: reasoning ? "reasoning-model" : "non-reasoning-model",
		name: reasoning ? "Reasoning Model" : "Non-reasoning Model",
		api: "anthropic-messages",
		provider: "anthropic",
		baseUrl: "https://api.anthropic.com",
		reasoning,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens,
	};
}

const mockSummaryResponse: AssistantMessage = {
	role: "assistant",
	content: [{ type: "text", text: "## Goal\nTest summary" }],
	api: "anthropic-messages",
	provider: "anthropic",
	model: "claude-sonnet-4-5",
	usage: {
		input: 10,
		output: 10,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 20,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	},
	stopReason: "stop",
	timestamp: Date.now(),
};

const messages: AgentMessage[] = [{ role: "user", content: "Summarize this.", timestamp: Date.now() }];

interface SummaryPromptContext {
	messages: Array<{
		content: Array<{ type: "text"; text: string }>;
	}>;
}

function getLastSummaryPrompt(): string {
	const call = completeSimpleMock.mock.calls[completeSimpleMock.mock.calls.length - 1];
	if (!call) {
		throw new Error("completeSimple was not called");
	}
	const context = call[1] as SummaryPromptContext;
	return context.messages[0].content[0].text;
}

function createBranchUserEntry(): SessionMessageEntry {
	return {
		type: "message",
		id: "branch-user",
		parentId: null,
		timestamp: new Date().toISOString(),
		message: { role: "user", content: "Keep going.", timestamp: Date.now() },
	};
}

describe("generateSummary reasoning options", () => {
	beforeEach(() => {
		completeSimpleMock.mockReset();
		completeSimpleMock.mockResolvedValue(mockSummaryResponse);
	});

	it("asks compaction summaries to include resume handoff fields", async () => {
		await generateSummary(messages, createModel(false), 2000, "test-key");

		const prompt = getLastSummaryPrompt();
		expect(prompt).toContain("## Resume Handoff");
		expect(prompt).toContain("**First action**");
		expect(prompt).toContain("**Re-check before editing**");
		expect(prompt).toContain("**Evidence status**");
	});

	it("asks branch summaries to include resume handoff fields", async () => {
		await generateBranchSummary([createBranchUserEntry()], {
			model: createModel(false),
			apiKey: "test-key",
			signal: new AbortController().signal,
		});

		const prompt = getLastSummaryPrompt();
		expect(prompt).toContain("## Resume Handoff");
		expect(prompt).toContain("**First action**");
		expect(prompt).toContain("**Re-check before editing**");
		expect(prompt).toContain("**Evidence status**");
	});

	it("uses the provided thinking level for reasoning-capable models", async () => {
		await generateSummary(
			messages,
			createModel(true),
			2000,
			"test-key",
			undefined,
			undefined,
			undefined,
			undefined,
			"medium",
		);

		expect(completeSimpleMock).toHaveBeenCalledTimes(1);
		expect(completeSimpleMock.mock.calls[0][2]).toMatchObject({
			reasoning: "medium",
			apiKey: "test-key",
		});
	});

	it("does not set reasoning when thinking is off", async () => {
		await generateSummary(
			messages,
			createModel(true),
			2000,
			"test-key",
			undefined,
			undefined,
			undefined,
			undefined,
			"off",
		);

		expect(completeSimpleMock).toHaveBeenCalledTimes(1);
		expect(completeSimpleMock.mock.calls[0][2]).toMatchObject({
			apiKey: "test-key",
		});
		expect(completeSimpleMock.mock.calls[0][2]).not.toHaveProperty("reasoning");
	});

	it("does not set reasoning for non-reasoning models", async () => {
		await generateSummary(
			messages,
			createModel(false),
			2000,
			"test-key",
			undefined,
			undefined,
			undefined,
			undefined,
			"medium",
		);

		expect(completeSimpleMock).toHaveBeenCalledTimes(1);
		expect(completeSimpleMock.mock.calls[0][2]).toMatchObject({
			apiKey: "test-key",
		});
		expect(completeSimpleMock.mock.calls[0][2]).not.toHaveProperty("reasoning");
	});

	it("clamps compaction summary maxTokens to the model output cap", async () => {
		const preparation: CompactionPreparation = {
			firstKeptEntryId: "entry-keep",
			messagesToSummarize: messages,
			turnPrefixMessages: messages,
			isSplitTurn: true,
			tokensBefore: 600000,
			fileOps: { read: new Set(), written: new Set(), edited: new Set() },
			settings: { enabled: true, reserveTokens: 500000, keepRecentTokens: 20000 },
		};

		await compact(preparation, createModel(false, 128000), "test-key");

		expect(completeSimpleMock.mock.calls.map((call) => call[2]?.maxTokens)).toEqual([128000, 128000]);
	});

	it("packs oversized compaction input before sending it to the summarizer", async () => {
		const noisyBody = "low value chatter ".repeat(4000);
		const importantPath = "packages/coding-agent/src/core/compaction/compaction.ts";
		await generateSummary(
			[
				{
					role: "user",
					content: `Start of task\n${noisyBody}\nError in ${importantPath}\n${noisyBody}\nRecent decision: keep budget-aware packing`,
					timestamp: Date.now(),
				},
			],
			createModel(false),
			2000,
			"test-key",
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			350,
		);

		const prompt = getLastSummaryPrompt();
		expect(prompt).toContain("<omk-summary-input-compressed");
		expect(prompt).toContain(importantPath);
		expect(prompt).toContain("Recent decision: keep budget-aware packing");
		expect(prompt).not.toContain(noisyBody.slice(0, 5000));
	});

	it("keeps summary input unchanged when it fits the token budget", () => {
		const input = "short conversation with packages/coding-agent/src/core/compaction/compaction.ts";

		const result = packSummaryInputForTokenBudget(input, 1000);

		expect(result.wasCompressed).toBe(false);
		expect(result.text).toBe(input);
		expect(result.omittedTokens).toBe(0);
	});
});
