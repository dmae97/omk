import type { AgentMessage, AgentTool } from "omk-agent-core";
import { getModels, getProviders } from "omk-ai";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import {
	compactionHysteresisConfigFor,
	DEFAULT_COMPACTION_SETTINGS,
} from "../src/core/compaction/compaction-headroom.ts";
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
import { sessionInputTokenLimit } from "../src/core/session-input-admission.ts";

describe("session input token limit", () => {
	it("reproduces the admission ceiling reported for opencode-go/deepseek-v4.1-flash", () => {
		// 1,000,000 window - 384,000 output reserve - 100,000 safety margin.
		expect(sessionInputTokenLimit({ maxTokens: 384_000 }, 1_000_000)).toBe(516_000);
	});

	it("has no limit without a model or a usable window", () => {
		expect(sessionInputTokenLimit(undefined, 1_000_000)).toBeUndefined();
		expect(sessionInputTokenLimit({ maxTokens: 1_000 }, 0)).toBeUndefined();
	});

	it("keeps the compaction trigger below the admission ceiling for every catalogued model", () => {
		// Before the fix 1,862 of 1,876 models let the hard gate reject input that
		// threshold compaction had not reached yet, so the session stayed blocked.
		const blocked: string[] = [];
		for (const provider of getProviders()) {
			for (const model of getModels(provider)) {
				const ceiling = sessionInputTokenLimit(model, model.contextWindow);
				const config = compactionHysteresisConfigFor(model.contextWindow, DEFAULT_COMPACTION_SETTINGS, ceiling);
				if (ceiling !== undefined && config && config.triggerRatio * model.contextWindow > ceiling) {
					blocked.push(`${provider}/${model.id}`);
				}
			}
		}
		expect(blocked).toEqual([]);
	});

	it("fires emergency compaction no later than the admission ceiling for every catalogued model", () => {
		// A disarmed hysteresis only compacts at the emergency ratio; above the ceiling admission rejects first.
		const late: string[] = [];
		for (const provider of getProviders()) {
			for (const model of getModels(provider)) {
				const ceiling = sessionInputTokenLimit(model, model.contextWindow);
				const config = compactionHysteresisConfigFor(model.contextWindow, DEFAULT_COMPACTION_SETTINGS, ceiling);
				if (ceiling !== undefined && config && config.emergencyRatio > ceiling / model.contextWindow) {
					late.push(`${provider}/${model.id}`);
				}
			}
		}
		expect(late).toEqual([]);
	});

	it("keeps the devin/swe-2 262k override emergency threshold under its reported 219,416 ceiling", () => {
		// 262,000 window - 16,384 output reserve - 26,200 safety margin.
		const ceiling = sessionInputTokenLimit({ maxTokens: 16_384 }, 262_000);
		expect(ceiling).toBe(219_416);
		const settings = {
			...DEFAULT_COMPACTION_SETTINGS,
			reserveTokens: 8192,
			keepRecentTokens: 10_000,
			maxUsageRatio: 0.7,
		};
		const config = compactionHysteresisConfigFor(262_000, settings, ceiling);
		expect(config).toBeDefined();
		expect(config!.emergencyRatio).toBeLessThanOrEqual(219_416 / 262_000);
		expect(config!.triggerRatio).toBeLessThanOrEqual(config!.emergencyRatio);
	});
});

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
	it("counts reasoning only for the turn in progress, not for turns a later user message closed", () => {
		const answered = {
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "r".repeat(40_000) },
				{ type: "text", text: "done" },
			],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "test-model",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: 2,
		} as AgentMessage;
		const plain = { ...answered, content: [{ type: "text", text: "done" }] } as AgentMessage;
		const tokens = (messages: AgentMessage[]) =>
			estimateContextInputTokens({
				systemPrompt: "",
				messages,
				tools: [],
				modelId: "test-model",
				tokenCounter: fixedTokenCounter,
			}).messageTokens;

		expect(tokens([userMessage("q"), answered, userMessage("next")])).toBe(
			tokens([userMessage("q"), plain, userMessage("next")]),
		);
		expect(tokens([userMessage("q"), answered])).toBeGreaterThan(tokens([userMessage("q"), plain]) + 30_000);
	});

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
