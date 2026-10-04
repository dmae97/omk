import { type AssistantMessage, type AssistantMessageEvent, EventStream, type Message, type Model } from "omk-ai";
import { Type } from "typebox";
import { expect, it } from "vitest";
import { runAgentLoop } from "../src/agent-loop.ts";
import type { AgentContext, AgentLoopConfig, AgentTool } from "../src/types.ts";

// This test must run in the complete OMK checkout. It was not run in the reduced offline harness.
it("frontier observes a tool-end sink rejection while a later claim resolver awaits", async () => {
	const schema = Type.Object({});
	let betaClaims = 0;
	let releaseBeta = () => {};
	const betaClaimGate = new Promise<void>((resolve) => {
		releaseBeta = resolve;
	});
	let betaEntered = () => {};
	const betaWaiting = new Promise<void>((resolve) => {
		betaEntered = resolve;
	});
	let alphaEnded = () => {};
	const alphaEnd = new Promise<void>((resolve) => {
		alphaEnded = resolve;
	});
	const makeTool = (name: string): AgentTool<typeof schema> => ({
		name,
		label: name,
		description: name,
		parameters: schema,
		executionMode: "parallel",
		async resourceClaims() {
			if (name === "beta" && ++betaClaims === 2) {
				betaEntered();
				await betaClaimGate;
			}
			return [{ kind: "path", key: `/audit/${name}`, access: "write" }];
		},
		async execute() {
			return { content: [{ type: "text", text: "ok" }], details: {} };
		},
	});
	const model: Model<"openai-responses"> = {
		id: "mock",
		name: "mock",
		api: "openai-responses",
		provider: "openai",
		baseUrl: "https://example.invalid",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 8192,
		maxTokens: 2048,
	};
	const context: AgentContext = { systemPrompt: "", messages: [], tools: [makeTool("alpha"), makeTool("beta")] };
	const config: AgentLoopConfig = {
		model,
		toolScheduler: "dag-v2",
		maxToolConcurrency: 2,
		cwd: "/audit",
		convertToLlm: (messages) =>
			messages.filter(
				(message): message is Message =>
					message.role === "user" || message.role === "assistant" || message.role === "toolResult",
			),
	};
	let providerCalls = 0;
	const run = runAgentLoop(
		[{ role: "user", content: "go", timestamp: Date.now() }],
		context,
		config,
		async (event) => {
			if (event.type === "tool_execution_end" && event.toolCallId === "alpha-call") {
				alphaEnded();
				throw new Error("sink failed");
			}
		},
		undefined,
		() => {
			providerCalls++;
			const stream = new EventStream<AssistantMessageEvent, AssistantMessage>(
				(event) => event.type === "done" || event.type === "error",
				(event) => {
					if (event.type === "done") return event.message;
					if (event.type === "error") return event.error;
					throw new Error("Unexpected event");
				},
			);
			queueMicrotask(() =>
				stream.push({
					type: "done",
					reason: "toolUse",
					message: {
						role: "assistant",
						api: "openai-responses",
						provider: "openai",
						model: "mock",
						timestamp: Date.now(),
						stopReason: "toolUse",
						content: [
							{ type: "toolCall", id: "alpha-call", name: "alpha", arguments: {} },
							{ type: "toolCall", id: "beta-call", name: "beta", arguments: {} },
						],
						usage: {
							input: 0,
							output: 0,
							cacheRead: 0,
							cacheWrite: 0,
							totalTokens: 0,
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
						},
					},
				}),
			);
			return stream;
		},
	);
	await Promise.all([betaWaiting, alphaEnd]);
	// Let Node cross the unhandled-rejection boundary while admission still waits.
	await new Promise<void>((resolve) => setImmediate(resolve));
	releaseBeta();
	await expect(run).rejects.toThrow("sink failed");
	expect(betaClaims).toBeGreaterThanOrEqual(2);
	expect(providerCalls).toBe(1);
});
