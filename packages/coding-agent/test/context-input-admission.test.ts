import type { AgentMessage, AgentTool } from "omk-agent-core";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import {
	createFallbackTokenCounter,
	type TokenCounterAdapter,
	type TokenCountResult,
} from "../src/core/context-budget-token-counter.ts";
import {
	assertContextInputWithinCapacity,
	computeHardPromptInputLimit,
	estimateContextInputTokens,
	PromptInputCapacityError,
} from "../src/core/prompt-budget.ts";

function fixedCounter(input: string): TokenCountResult {
	return {
		tokens: input.length,
		method: "exact",
		confidence: "high",
		adapterId: "fixed-test-counter",
		modelId: "test-model",
		notes: [],
	};
}

const fixedTokenCounter: TokenCounterAdapter = {
	id: "fixed-test-counter",
	priority: 1,
	isAvailable: () => true,
	supports: () => true,
	countText: fixedCounter,
};

function userMessage(text: string): AgentMessage {
	return {
		role: "user",
		content: [{ type: "text", text }],
		timestamp: 1,
	};
}

const echoTool = {
	name: "echo",
	label: "Echo",
	description: "Return the supplied text",
	parameters: Type.Object({ text: Type.String() }),
	execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
} as AgentTool;

describe("context input admission", () => {
	it("caps the legacy prompt floor at the physical model limit", () => {
		expect(
			computeHardPromptInputLimit({
				contextWindow: 100,
				configuredMaxPromptTokens: 4_000,
				modelMaxTokens: 100,
			}),
		).toEqual({
			contextWindow: 100,
			responseReserveTokens: 25,
			safetyMarginTokens: 10,
			physicalInputTokens: 65,
			maxInputTokens: 65,
		});
	});

	it("counts converted messages, system text, and tool schemas", () => {
		const withoutTool = estimateContextInputTokens({
			systemPrompt: "system",
			messages: [userMessage("hello")],
			tools: [],
			modelId: "test-model",
			tokenCounter: fixedTokenCounter,
		});
		const withTool = estimateContextInputTokens({
			systemPrompt: "system",
			messages: [userMessage("hello")],
			tools: [echoTool],
			modelId: "test-model",
			tokenCounter: fixedTokenCounter,
		});
		const branchSummary = estimateContextInputTokens({
			systemPrompt: "system",
			messages: [
				{
					role: "branchSummary",
					summary: "remember this",
					fromId: "branch",
					timestamp: 1,
				} as AgentMessage,
			],
			tools: [],
			modelId: "test-model",
			tokenCounter: fixedTokenCounter,
		});

		expect(withTool.totalTokens).toBeGreaterThan(withoutTool.totalTokens);
		expect(branchSummary.messageTokens).toBeGreaterThan(0);
	});

	it("uses provider-reported projected usage as a lower bound", () => {
		const estimate = estimateContextInputTokens({
			systemPrompt: "small",
			messages: [userMessage("small")],
			tools: [],
			modelId: "test-model",
			tokenCounter: fixedTokenCounter,
			projectedUsageTokens: 10_000,
		});

		expect(estimate.providerUsageTokens).toBe(10_000);
		expect(estimate.totalTokens).toBe(10_000);
		expect(estimate.basis).toBe("provider_usage");
	});

	it("does not tokenize image bytes as prompt text", () => {
		const observedInputs: string[] = [];
		const recordingCounter: TokenCounterAdapter = {
			id: "recording-test-counter",
			priority: 1,
			isAvailable: () => true,
			supports: () => true,
			countText(input, _modelId) {
				observedInputs.push(input);
				return fixedCounter(input);
			},
		};
		const estimate = estimateContextInputTokens({
			systemPrompt: "system",
			messages: [
				{
					role: "user",
					content: [{ type: "image", data: "A".repeat(100_000), mimeType: "image/png" }],
					timestamp: 1,
				},
			],
			tools: [],
			modelId: "test-model",
			tokenCounter: recordingCounter,
		});

		expect(estimate.imageCount).toBe(1);
		expect(Math.max(...observedInputs.map((input) => input.length))).toBeLessThan(100_000);
		expect(estimate.messageTokens).toBeGreaterThanOrEqual(1_200);
	});

	it("does not let the chars/4 heuristic undercount CJK text", () => {
		const cjk = "가".repeat(10_000);
		const estimate = estimateContextInputTokens({
			systemPrompt: "",
			messages: [userMessage(cjk)],
			tools: [],
			modelId: "test-model",
			tokenCounter: createFallbackTokenCounter(),
		});

		expect(estimate.messageTokens).toBeGreaterThan(cjk.length / 4);
	});

	it("keeps the hard limit below both configured and physical ceilings", () => {
		let seed = 0x4f4d4b;
		const random = (): number => {
			seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
			return seed;
		};
		for (let trial = 0; trial < 2_000; trial++) {
			const contextWindow = 1 + (random() % 200_000);
			const configuredMaxPromptTokens = 1 + (random() % 100_000);
			const modelMaxTokens = random() % 250_000;
			const limit = computeHardPromptInputLimit({ contextWindow, configuredMaxPromptTokens, modelMaxTokens });
			expect(limit.maxInputTokens, `trial ${trial}`).toBeGreaterThanOrEqual(0);
			expect(limit.maxInputTokens, `trial ${trial}`).toBeLessThanOrEqual(limit.physicalInputTokens);
			expect(limit.maxInputTokens, `trial ${trial}`).toBeLessThanOrEqual(configuredMaxPromptTokens);
			expect(limit.physicalInputTokens, `trial ${trial}`).toBe(
				Math.max(0, contextWindow - limit.responseReserveTokens - limit.safetyMarginTokens),
			);
		}
	});

	it("fails circular provider message arguments with a sanitized error", () => {
		const circular: Record<string, unknown> = {};
		circular.self = circular;
		const message = {
			role: "assistant",
			content: [{ type: "toolCall", id: "call-1", name: "echo", arguments: circular }],
			api: "openai-completions",
			provider: "openai",
			model: "test-model",
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {} },
			stopReason: "toolUse",
			timestamp: 1,
		} as unknown as AgentMessage;

		expect(() =>
			estimateContextInputTokens({
				systemPrompt: "system",
				messages: [message],
				tools: [],
				modelId: "test-model",
				tokenCounter: fixedTokenCounter,
			}),
		).toThrow("Provider messages are not JSON-serializable");
	});

	it("admits the exact boundary and rejects one token over", () => {
		const input = {
			systemPrompt: "12345",
			messages: [] as AgentMessage[],
			tools: [] as AgentTool[],
			modelId: "test-model",
			tokenCounter: fixedTokenCounter,
		};
		const estimate = estimateContextInputTokens(input);

		expect(() => assertContextInputWithinCapacity({ ...input, maxInputTokens: estimate.totalTokens })).not.toThrow();
		expect(() => assertContextInputWithinCapacity({ ...input, maxInputTokens: estimate.totalTokens - 1 })).toThrow(
			PromptInputCapacityError,
		);
	});
});
