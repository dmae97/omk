import { setImmediate as nextTurn } from "node:timers/promises";
import { type AssistantMessage, type AssistantMessageEvent, EventStream, type Message, type Model } from "omk-ai";
import { Type } from "typebox";
import { expect, it } from "vitest";
import { agentLoop } from "../src/agent-loop.ts";
import type { AgentTool, ToolResourceClaims } from "../src/types.ts";

function gate() {
	let release = () => {};
	const promise = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { promise, release: () => release() };
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
			? ["a", "b", "c"].map((id) => ({ type: "toolCall", id, name: "work", arguments: {} }))
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

it.each(["drift", "abort"] as const)("refreshes deferred claims without a second authorization: %s", async (mode) => {
	const a = gate(),
		c = gate(),
		bStarted = gate(),
		refreshed = gate(),
		lateClaim = gate();
	const controller = new AbortController();
	const trace: string[] = [];
	const hooks = new Map<string, number>();
	let bResolutions = 0;
	const tool: AgentTool = {
		name: "work",
		label: "work",
		description: "controlled fixture",
		parameters: Type.Object({}),
		resourceClaims: async (_args, context): Promise<ToolResourceClaims> => {
			let key = context.toolCallId === "a" ? "x" : "z";
			if (context.toolCallId === "b") {
				bResolutions++;
				key = bResolutions === 1 ? "initial" : bResolutions === 2 ? "x" : "z";
				if (bResolutions >= 3) {
					refreshed.release();
					if (mode === "abort") await lateClaim.promise;
				}
			}
			return [{ kind: "session", key, access: "write" }];
		},
		execute: async (id, _args, signal) => {
			trace.push(`start:${id}`);
			if (id === "a") await a.promise;
			if (id === "b") bStarted.release();
			if (id === "c") {
				a.release();
				signal?.addEventListener("abort", c.release, { once: true });
				try {
					await c.promise;
				} finally {
					signal?.removeEventListener("abort", c.release);
				}
			}
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
			maxToolConcurrency: 2,
			convertToLlm: (messages) =>
				messages.filter(
					(m): m is Message => m.role === "user" || m.role === "assistant" || m.role === "toolResult",
				),
			beforeToolCall: async ({ toolCall }) => {
				hooks.set(toolCall.id, (hooks.get(toolCall.id) ?? 0) + 1);
				return undefined;
			},
		},
		controller.signal,
		() => reply(responses++ === 0),
	);
	const running = (async () => {
		for await (const _event of stream) {
			/* consume real loop */
		}
		return stream.result();
	})();
	let watchdog: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			refreshed.promise,
			bStarted.promise,
			new Promise<never>((_, reject) => {
				watchdog = setTimeout(() => reject(new Error("Admission fixture stalled")), 2000);
			}),
		]);
		// All fixture admission work is microtask-only; advance one event-loop turn, not a timing race.
		await nextTurn();
		const ranBeforeRelease = trace.includes("start:b");
		if (mode === "abort") controller.abort();
		c.release();
		const messages = await running;
		expect(ranBeforeRelease).toBe(false);
		expect(bResolutions).toBeGreaterThanOrEqual(3);
		expect(hooks.get("b")).toBe(1);
		if (mode === "drift") expect(trace.indexOf("end:c")).toBeLessThan(trace.indexOf("start:b"));
		else {
			expect(trace).not.toContain("start:b");
			expect(messages.filter((m) => m.role === "toolResult")).toHaveLength(3);
			lateClaim.release();
			await nextTurn();
			expect(trace).not.toContain("start:b");
		}
	} finally {
		if (watchdog) clearTimeout(watchdog);
		controller.abort();
		a.release();
		c.release();
		lateClaim.release();
		await running;
	}
});
