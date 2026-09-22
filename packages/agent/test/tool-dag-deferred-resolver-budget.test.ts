import { type AssistantMessage, type AssistantMessageEvent, EventStream, type Message, type Model } from "omk-ai";
import { Type } from "typebox";
import { expect, it } from "vitest";
import { agentLoop } from "../src/agent-loop.ts";
import type { AgentTool, ToolResourceClaims } from "../src/types.ts";

/**
 * A deferred call must resolve claims freshly before it is admitted, but it must
 * not keep re-invoking an extension `resourceClaims()` callback on every scan
 * while a conflicting peer is still running: the deferral decision is the same
 * conservative answer, and each callback invocation may cost real I/O.
 */

function reply(first: boolean) {
	const stream = new EventStream<AssistantMessageEvent, AssistantMessage>(
		(event) => event.type === "done" || event.type === "error",
		(event) => {
			if (event.type === "done") return event.message;
			if (event.type === "error") return event.error;
			throw new Error("Unexpected event");
		},
	);
	const message: AssistantMessage = {
		role: "assistant",
		content: first
			? ["a", "b", "c", "d"].map((id) => ({ type: "toolCall", id, name: "work", arguments: {} }))
			: [{ type: "text", text: "done" }],
		api: "openai-responses",
		provider: "openai",
		model: "mock",
		stopReason: first ? "toolUse" : "stop",
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
	queueMicrotask(() => stream.push({ type: "done", reason: first ? "toolUse" : "stop", message }));
	return stream;
}

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

it("does not re-invoke a deferred call's claim resolver on every scan while it waits", async () => {
	const resolverCalls = new Map<string, number>();
	let attemptsForB = 0;
	const trace: string[] = [];
	const tool: AgentTool = {
		name: "work",
		label: "work",
		description: "controlled fixture",
		parameters: Type.Object({}),
		resourceClaims: async (_args, context): Promise<ToolResourceClaims> => {
			resolverCalls.set(context.toolCallId, (resolverCalls.get(context.toolCallId) ?? 0) + 1);
			if (context.toolCallId === "a") {
				// The slow peer owns the key the deferred call later claims.
				return [{ kind: "session", key: "x", access: "write" }];
			}
			if (context.toolCallId !== "b") {
				return [{ kind: "session", key: context.toolCallId, access: "write" }];
			}
			// Scheduling claims an independent key, so no dependency edge is drawn;
			// every later resolution claims a's key, so the call must defer while a
			// runs and may only enter after it settles.
			attemptsForB++;
			return [{ kind: "session", key: attemptsForB === 1 ? "y" : "x", access: "write" }];
		},
		execute: async (id) => {
			trace.push(`start:${id}`);
			// Three deterministic event-loop turns keep "a" running across the
			// settles of the fast independent calls without any timing race.
			if (id === "a") for (let turn = 0; turn < 3; turn++) await new Promise((resolve) => setImmediate(resolve));
			trace.push(`end:${id}`);
			return { content: [{ type: "text", text: id }], details: {} };
		},
	};
	let responses = 0;
	const stream = agentLoop(
		[{ role: "user", content: "go", timestamp: 0 }],
		{ systemPrompt: "", messages: [], tools: [tool] },
		{
			model,
			cwd: "/fixture",
			toolScheduler: "dag-v2",
			maxToolConcurrency: 4,
			convertToLlm: (messages) =>
				messages.filter(
					(m): m is Message => m.role === "user" || m.role === "assistant" || m.role === "toolResult",
				),
		},
		undefined,
		() => reply(responses++ === 0),
	);
	for await (const _event of stream) {
		// consume the real loop
	}
	const messages = await stream.result();

	// The deferred call ran strictly after the peer whose key it claims.
	expect(trace.indexOf("end:a")).toBeLessThan(trace.indexOf("start:b"));
	expect(trace.indexOf("start:a")).toBeLessThan(trace.indexOf("start:b"));
	expect(messages.filter((message) => message.role === "toolResult")).toHaveLength(4);
	// One scheduling resolution, one conflict-proving resolution, and one fresh
	// resolution at admission. Re-resolving on every scan of the wait would be one
	// call per settle of the independent peers instead.
	expect(resolverCalls.get("b")).toBeLessThanOrEqual(3);
	expect(resolverCalls.get("b")).toBeGreaterThanOrEqual(3);
}, 10000);
