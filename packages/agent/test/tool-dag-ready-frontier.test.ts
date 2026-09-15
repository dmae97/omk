import {
	type AssistantMessage,
	type AssistantMessageEvent,
	EventStream,
	type Message,
	type Model,
	type UserMessage,
} from "omk-ai";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { agentLoop } from "../src/agent-loop.ts";
import type { AgentContext, AgentLoopConfig, AgentMessage, AgentTool } from "../src/types.ts";

/**
 * T-DAG-F01 (audit: general tool dependency frontier).
 *
 * `assignDagLevels` builds a barrier schedule: every call in level N+1 waits for
 * ALL of level N. `assignDagDependencies` already computes the real precedence
 * graph — only actually-conflicting pairs — but nothing in the executor consumes
 * it, so an unrelated slow call in a level still delays the whole next level.
 *
 * Minimal counterexample: write(x) is slow, write(y) is fast, read(y) conflicts
 * only with write(y). Levels put write(x) and write(y) together, forcing read(y)
 * to wait for the slow unrelated write(x). A dependency frontier lets read(y)
 * start as soon as write(y) settles.
 */

class MockAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor() {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") return event.message;
				if (event.type === "error") return event.error;
				throw new Error("Unexpected event type");
			},
		);
	}
}

function createModel(): Model<"openai-responses"> {
	return {
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
}

function createAssistantMessage(
	content: AssistantMessage["content"],
	stopReason: AssistantMessage["stopReason"] = "stop",
): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "openai-responses",
		provider: "openai",
		model: "mock",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: Date.now(),
	};
}

function createUserMessage(text: string): UserMessage {
	return { role: "user", content: text, timestamp: Date.now() };
}

function identityConverter(messages: AgentMessage[]): Message[] {
	return messages.filter((m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult") as Message[];
}

describe("tool DAG ready frontier (T-DAG-F01)", () => {
	it("starts a consumer once its own predecessor settles, not the whole level", async () => {
		const schema = Type.Object({ path: Type.String(), value: Type.Optional(Type.String()) });
		const store = new Map<string, string>();
		const trace: string[] = [];
		// Gate the slow write open when the consumer starts, so the test proves
		// ordering rather than racing a fixed sleep. The timer is a deadlock guard:
		// under a barrier schedule the consumer cannot start until the slow write
		// finishes, so without it the run would hang instead of failing cleanly.
		let releaseSlow: () => void = () => {};
		let guard: ReturnType<typeof setTimeout> | undefined;
		const slowGate = new Promise<void>((resolve) => {
			releaseSlow = () => {
				if (guard) clearTimeout(guard);
				resolve();
			};
			guard = setTimeout(resolve, 500);
		});

		const write: AgentTool<typeof schema, { path: string; value?: string }> = {
			name: "write",
			label: "Write",
			description: "Write a path",
			parameters: schema,
			async execute(_toolCallId, params) {
				trace.push(`start:write-${params.path}`);
				if (params.path === "x") await slowGate;
				store.set(params.path, params.value ?? "");
				trace.push(`end:write-${params.path}`);
				return { content: [{ type: "text", text: `wrote:${params.path}` }], details: params };
			},
		};
		const read: AgentTool<typeof schema, { path: string }> = {
			name: "read",
			label: "Read",
			description: "Read a path",
			parameters: schema,
			async execute(_toolCallId, params) {
				trace.push(`start:read-${params.path}`);
				// The consumer running is the signal the frontier admitted it; let
				// the unrelated slow writer finish so the run can complete.
				releaseSlow();
				const value = store.get(params.path);
				trace.push(`end:read-${params.path}`);
				return { content: [{ type: "text", text: `read:${value}` }], details: { path: params.path, value } };
			},
		};

		const context: AgentContext = { systemPrompt: "", messages: [], tools: [write, read] };
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			toolScheduler: "dag-v2",
		};

		let providerCalls = 0;
		const stream = agentLoop([createUserMessage("go")], context, config, undefined, () => {
			providerCalls++;
			const response = new MockAssistantStream();
			queueMicrotask(() => {
				response.push(
					providerCalls === 1
						? {
								type: "done",
								reason: "toolUse",
								message: createAssistantMessage(
									[
										{ type: "toolCall", id: "slow-x", name: "write", arguments: { path: "x", value: "A" } },
										{ type: "toolCall", id: "fast-y", name: "write", arguments: { path: "y", value: "B" } },
										{ type: "toolCall", id: "read-y", name: "read", arguments: { path: "y" } },
									],
									"toolUse",
								),
							}
						: {
								type: "done",
								reason: "stop",
								message: createAssistantMessage([{ type: "text", text: "done" }]),
							},
				);
			});
			return response;
		});
		for await (const _event of stream) {
			// consume
		}
		await stream.result();

		// The consumer conflicts only with write(y); it must not wait for the
		// unrelated write(x) that shares its barrier level.
		expect(trace).toContain("start:read-y");
		expect(trace.indexOf("start:read-y")).toBeLessThan(trace.indexOf("end:write-x"));
		// Serial semantics still hold for the pair that does conflict.
		expect(trace.indexOf("end:write-y")).toBeLessThan(trace.indexOf("start:read-y"));
	});
});
