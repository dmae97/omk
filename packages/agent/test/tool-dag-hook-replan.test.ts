import {
	type AssistantMessage,
	type AssistantMessageEvent,
	EventStream,
	type Message,
	type Model,
	type ToolResultMessage,
	type UserMessage,
} from "omk-ai";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { agentLoop } from "../src/agent-loop.ts";
import type { AgentContext, AgentLoopConfig, AgentMessage, AgentTool } from "../src/types.ts";

/**
 * T-DAG-H01 (audit §9.2): a beforeToolCall hook that changes a call's claim
 * target must not silently reverse the source-order conflict pair. The
 * minimal counterexample is three calls — write(x)=A, read(x), write(y)=B —
 * where the hook retargets the last call onto x. Executing it before the
 * read lets the read observe B; the contract requires A (or an explicit
 * rejection), never a quiet B.
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

describe("DAG hook claim retargeting (T-DAG-H01)", () => {
	it("the retargeted write defers past the earlier-source read it now conflicts with", async () => {
		// Given: write x=A, read x, write y=B — and a hook that moves the last
		// write onto x. The buggy local re-plan observed B; the contract is A.
		const schema = Type.Object({ path: Type.String(), value: Type.Optional(Type.String()) });
		const store = new Map<string, string>();
		const trace: string[] = [];

		const write: AgentTool<typeof schema, { path: string; value?: string }> = {
			name: "write",
			label: "Write",
			description: "Write a path",
			parameters: schema,
			async execute(toolCallId, params) {
				trace.push(`start:${toolCallId}`);
				store.set(params.path, params.value ?? "");
				trace.push(`end:${toolCallId}`);
				return { content: [{ type: "text", text: `wrote:${params.path}` }], details: params };
			},
		};
		const read: AgentTool<typeof schema, { path: string }> = {
			name: "read",
			label: "Read",
			description: "Read a path",
			parameters: schema,
			async execute(toolCallId, params) {
				const value = store.get(params.path);
				trace.push(`read:${toolCallId}=${value}`);
				return { content: [{ type: "text", text: `read:${value}` }], details: { path: params.path, value } };
			},
		};

		const context: AgentContext = { systemPrompt: "", messages: [], tools: [write, read] };
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			toolScheduler: "dag-v2",
			beforeToolCall: async ({ toolCall, args }) => {
				if (toolCall.id === "write-b" && typeof args === "object" && args !== null) {
					(args as { path: string }).path = "x";
				}
				return undefined;
			},
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
										{ type: "toolCall", id: "write-a", name: "write", arguments: { path: "x", value: "A" } },
										{ type: "toolCall", id: "read-x", name: "read", arguments: { path: "x" } },
										{ type: "toolCall", id: "write-b", name: "write", arguments: { path: "y", value: "B" } },
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
		const messages = await stream.result();

		// Then: the read observed A — the retargeted write ran after it.
		expect(trace).toContain("read:read-x=A");
		const results = messages.filter((message): message is ToolResultMessage => message.role === "toolResult");
		const readResult = results.find((result) => result.toolCallId === "read-x");
		expect(readResult?.isError).toBe(false);
		expect(readResult?.details).toMatchObject({ value: "A" });
	});

	it("a hook that retargets a call onto a running later-source call's claim must not overlap it", async () => {
		// T-DAG-H02 (audit §7.1 counterexample): write(x)=A, read(x), write(y)=B.
		// Source 2 starts first (independent), and while it is still in flight
		// source 0 settles; source 1's hook then moves its read onto y. Admitting
		// it now overlaps the running write — the conflict check must treat every
		// running call, not only earlier-source predecessors, as a blocker.
		const schema = Type.Object({ path: Type.String(), value: Type.Optional(Type.String()) });
		const store = new Map<string, string>();
		const trace: string[] = [];
		const hookCalls = new Map<string, number>();
		let releaseY = (): void => {};
		const gateY = new Promise<void>((resolve) => {
			releaseY = resolve;
		});

		const write: AgentTool<typeof schema, { path: string; value?: string }> = {
			name: "write",
			label: "Write",
			description: "Write a path",
			parameters: schema,
			async execute(toolCallId, params) {
				trace.push(`start:${toolCallId}`);
				if (params.path === "y") await gateY;
				store.set(params.path, params.value ?? "");
				trace.push(`end:${toolCallId}`);
				return { content: [{ type: "text", text: `wrote:${params.path}` }], details: params };
			},
		};
		const read: AgentTool<typeof schema, { path: string }> = {
			name: "read",
			label: "Read",
			description: "Read a path",
			parameters: schema,
			async execute(toolCallId, params) {
				const value = store.get(params.path);
				trace.push(`read:${toolCallId}=${value}`);
				return { content: [{ type: "text", text: `read:${value}` }], details: { path: params.path, value } };
			},
		};

		const context: AgentContext = { systemPrompt: "", messages: [], tools: [write, read] };
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
			toolScheduler: "dag-v2",
			beforeToolCall: async ({ toolCall, args }) => {
				hookCalls.set(toolCall.id, (hookCalls.get(toolCall.id) ?? 0) + 1);
				if (toolCall.id === "read-x" && typeof args === "object" && args !== null) {
					(args as { path: string }).path = "y";
				}
				return undefined;
			},
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
										{ type: "toolCall", id: "write-a", name: "write", arguments: { path: "x", value: "A" } },
										{ type: "toolCall", id: "read-x", name: "read", arguments: { path: "x" } },
										{ type: "toolCall", id: "write-y", name: "write", arguments: { path: "y", value: "B" } },
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

		// Release write(y) on a fixed timer once it has started: long enough for
		// the post-settle admission scan to run (microtasks, before timers), short
		// enough to keep the test fast. On a regressed path the read admits while
		// write(y) is in flight and observes an empty store; on the contract path
		// it defers and reads B.
		const releasePromise = (async () => {
			while (!trace.includes("start:write-y")) await new Promise((resolve) => setTimeout(resolve, 1));
			await new Promise((resolve) => setTimeout(resolve, 5));
			releaseY();
		})();

		for await (const _event of stream) {
			// consume
		}
		await stream.result();
		await releasePromise;

		// The deferred call must not re-invoke the authorization hook on retry:
		// its prepared scope is cached and reused.
		expect(hookCalls.get("read-x")).toBe(1);
		// And it must not have run while write(y) was still executing.
		const readEntry = trace.find((entry) => entry.startsWith("read:read-x="));
		expect(readEntry).toBeDefined();
		expect(trace.indexOf("end:write-y")).toBeLessThan(trace.indexOf(readEntry!));
		expect(readEntry).toBe("read:read-x=B");
	});

	it("a failing end-event sink still drains the executions this batch owns", async () => {
		// T-DAG-L03 (audit §8.4): two independent calls admit together. When the
		// fast call's tool_execution_end emit throws, the batch must still join
		// the slow call it already owns before surfacing the failure — otherwise
		// the run abandons live work.
		const schema = Type.Object({ path: Type.String(), value: Type.Optional(Type.String()) });
		const trace: string[] = [];
		let releaseB = (): void => {};
		const gateB = new Promise<void>((resolve) => {
			releaseB = resolve;
		});

		const write: AgentTool<typeof schema, { path: string; value?: string }> = {
			name: "write",
			label: "Write",
			description: "Write a path",
			parameters: schema,
			async execute(toolCallId, params) {
				trace.push(`start:${toolCallId}`);
				if (params.path === "b") await gateB;
				trace.push(`end:${toolCallId}`);
				return { content: [{ type: "text", text: `wrote:${params.path}` }], details: params };
			},
		};

		const context: AgentContext = { systemPrompt: "", messages: [], tools: [write] };
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
										{ type: "toolCall", id: "write-a", name: "write", arguments: { path: "a", value: "A" } },
										{ type: "toolCall", id: "write-b", name: "write", arguments: { path: "b", value: "B" } },
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

		// Fail only write-a's end event. A second sink error from write-b would
		// correctly surface as AggregateError instead of the first error's text.
		const originalPush = stream.push.bind(stream);
		stream.push = (event) => {
			if (event.type === "tool_execution_end" && event.toolCallId === "write-a") {
				throw new Error("sink exploded");
			}
			return originalPush(event);
		};

		// Free write-b independently of the failure timing: write-a's emit throws
		// within a few milliseconds, while the gate opens later so a join is only
		// possible if the batch explicitly drains owned executions.
		const releaseTimer = setTimeout(() => releaseB(), 25);

		for await (const _event of stream) {
			// consume
		}
		const messages = await stream.result();
		clearTimeout(releaseTimer);
		releaseB();

		// The loop failed: endStreamWithFailure surfaced a synthetic error
		// assistant for the sink explosion.
		const failureAssistant = messages.find(
			(message): message is AssistantMessage => message.role === "assistant" && message.stopReason === "error",
		);
		expect(failureAssistant?.errorMessage).toContain("sink exploded");
		// Ownership preserved: by the time the failure surfaced, the batch had
		// already joined write-b. A regressed (no-drain) frontier surfaces the
		// emit error immediately and end:write-b lands after this point.
		expect(trace).toContain("end:write-b");
	});
});
