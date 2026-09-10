import { type AssistantMessage, createAssistantMessageEventStream, type Message, type Model } from "omk-ai";
import { describe, expect, it } from "vitest";
import { agentLoop } from "../src/agent-loop.ts";
import {
	assertModelContract,
	type ModelContract,
	ModelContractViolation,
	type RouteRequest,
} from "../src/run-model-contract.ts";
import type { AgentEvent, AgentLoopConfig } from "../src/types.ts";

const model: Model<"openai-responses"> = {
	id: "output-limit-fixture",
	name: "output-limit-fixture",
	api: "openai-responses",
	provider: "openai",
	baseUrl: "https://example.invalid",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 8192,
	maxTokens: 2048,
};
const contract: ModelContract = {
	allowedModels: [model],
	allowedProviders: [model.provider],
	allowedAuthOrigins: [model.provider],
	thinking: false,
	maxOutputTokens: 2048,
};
const request: RouteRequest = { model, provider: model.provider, thinking: false, maxOutputTokens: 2048 };
const invalidLimits = [
	Number.NaN,
	Number.POSITIVE_INFINITY,
	Number.NEGATIVE_INFINITY,
	-1,
	0,
	0.5,
	Number.MAX_SAFE_INTEGER + 1,
];

function response() {
	const stream = createAssistantMessageEventStream();
	const message: AssistantMessage = {
		role: "assistant",
		api: model.api,
		provider: model.provider,
		model: model.id,
		content: [{ type: "text", text: "ok" }],
		stopReason: "stop",
		timestamp: 0,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	};
	queueMicrotask(() => stream.push({ type: "done", reason: "stop", message }));
	return stream;
}

describe("model contract output limit values", () => {
	it.each(invalidLimits)(
		"rejects invalid contract limit %s even without an explicit request limit",
		(maxOutputTokens) => {
			const configured = { ...contract, maxOutputTokens };
			expect(() => assertModelContract(configured, { model, provider: model.provider, thinking: false })).toThrow(
				/contract maxOutputTokens must be a positive safe integer/,
			);
		},
	);

	it.each(invalidLimits)("rejects invalid explicit request limit %s", (maxOutputTokens) => {
		expect(() => assertModelContract(contract, { ...request, maxOutputTokens })).toThrow(
			/request maxOutputTokens must be a positive safe integer/,
		);
	});

	it.each([1, 2048])("accepts valid explicit request limit %s", (maxOutputTokens) => {
		expect(() => assertModelContract(contract, { ...request, maxOutputTokens })).not.toThrow();
	});

	it("still rejects a valid integer above the cap", () => {
		expect(() => assertModelContract(contract, { ...request, maxOutputTokens: 2049 })).toThrow(
			ModelContractViolation,
		);
	});

	it("preserves the existing unspecified-limit policy without claiming an effective wire cap", () => {
		expect(() => assertModelContract(contract, { model, provider: model.provider, thinking: false })).not.toThrow();
	});
});

describe("agent loop output limit send boundary", () => {
	it.each(invalidLimits)("does not silently discard invalid explicit maxTokens %s", async (maxTokens) => {
		const config: AgentLoopConfig = {
			model,
			modelContract: contract,
			maxTokens,
			convertToLlm: (messages) =>
				messages.filter(
					(message): message is Message =>
						message.role === "user" || message.role === "assistant" || message.role === "toolResult",
				),
		};
		let sends = 0;
		const events: AgentEvent[] = [];
		const stream = agentLoop(
			[{ role: "user", content: "hi", timestamp: 0 }],
			{ systemPrompt: "", messages: [], tools: [] },
			config,
			undefined,
			() => {
				sends++;
				return response();
			},
		);
		for await (const event of stream) events.push(event);
		await stream.result();
		expect(sends).toBe(0);
		expect(events.some((event) => event.type === "provider_request")).toBe(false);
		expect(events).toContainEqual(
			expect.objectContaining({ type: "provider_denied", deniedReason: "contract-violation" }),
		);
	});

	it("continues to send a valid explicit limit", async () => {
		let sends = 0;
		const config: AgentLoopConfig = { model, modelContract: contract, maxTokens: 2048, convertToLlm: () => [] };
		await agentLoop(
			[{ role: "user", content: "hi", timestamp: 0 }],
			{ systemPrompt: "", messages: [], tools: [] },
			config,
			undefined,
			() => {
				sends++;
				return response();
			},
		).result();
		expect(sends).toBe(1);
	});
});
