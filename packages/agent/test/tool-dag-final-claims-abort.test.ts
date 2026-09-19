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
import type { AgentContext, AgentLoopConfig, AgentMessage, AgentTool, ToolResourceClaims } from "../src/types.ts";

/**
 * Audit F02 (2026-09-19): the dag-v2 scheduler bounds the *initial* claim
 * computation with the run's abort signal, but re-resolved the *final*
 * (post-hook) claims with a bare `await`. An extension whose
 * `resourceClaims()` never settles on that second call therefore pinned the
 * whole batch: cancelling the run could not release the wait, and the loop
 * stayed alive until the callback returned on its own.
 *
 * The contract under test: a cancelled run settles without the callback's
 * cooperation; the tool never executes; its result carries the aborted
 * disposition with `executionStarted: false`; a peer already in flight keeps
 * the existing in-flight abort contract (aborted, `executionStarted: true`);
 * the authorization hook still runs exactly once; and a late settlement of
 * the abandoned callback — fulfilled or rejected — admits nothing.
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

const schema = Type.Object({ path: Type.String() });

interface Deferred<T> {
	readonly promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
	let resolve: (value: T) => void = () => {};
	let reject: (error: unknown) => void = () => {};
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

/** Settles with "timeout" if the run does not end on its own within `ms`. */
function settledWithin<T>(work: Promise<T>, ms: number): Promise<"settled" | "timeout"> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<"timeout">((resolve) => {
		timer = setTimeout(() => resolve("timeout"), ms);
	});
	return Promise.race([
		work.then(
			() => "settled" as const,
			() => "settled" as const,
		),
		timeout,
	]).finally(() => clearTimeout(timer));
}

interface Harness {
	readonly run: Promise<AgentMessage[]>;
	readonly finalClaimsStarted: Promise<void>;
	readonly finalClaims: Deferred<ToolResourceClaims>;
	readonly releaseSlow: () => void;
	readonly executed: string[];
	readonly hookCalls: Map<string, number>;
	readonly controller: AbortController;
}

/**
 * Two independent calls on a dag-v2 run: `slow` (source 0) starts executing
 * and blocks on a gate; `probe` (source 1) answers its scheduling-time claims
 * normally but never settles the admission-time re-resolution until the test
 * releases it.
 */
function startHarness(): Harness {
	const executed: string[] = [];
	const hookCalls = new Map<string, number>();
	const controller = new AbortController();
	const finalClaims = deferred<ToolResourceClaims>();
	const started = deferred<void>();
	const slowGate = deferred<void>();
	let probeClaimCalls = 0;

	const slow: AgentTool<typeof schema, { path: string }> = {
		name: "slow",
		label: "Slow",
		description: "Blocks until released",
		parameters: schema,
		resourceClaims: (args) => [{ kind: "path", key: (args as { path: string }).path, access: "write" }],
		async execute(toolCallId, params) {
			executed.push(toolCallId);
			await slowGate.promise;
			return { content: [{ type: "text", text: "slow-done" }], details: params };
		},
	};
	const probe: AgentTool<typeof schema, { path: string }> = {
		name: "probe",
		label: "Probe",
		description: "Hangs its final claim resolution",
		parameters: schema,
		resourceClaims: (args) => {
			probeClaimCalls += 1;
			if (probeClaimCalls === 1) return [{ kind: "path", key: (args as { path: string }).path, access: "read" }];
			started.resolve();
			return finalClaims.promise;
		},
		async execute(toolCallId, params) {
			executed.push(toolCallId);
			return { content: [{ type: "text", text: "probe-done" }], details: params };
		},
	};

	const context: AgentContext = { systemPrompt: "", messages: [], tools: [slow, probe] };
	const config: AgentLoopConfig = {
		model: createModel(),
		convertToLlm: identityConverter,
		toolScheduler: "dag-v2",
		beforeToolCall: async ({ toolCall }) => {
			hookCalls.set(toolCall.id, (hookCalls.get(toolCall.id) ?? 0) + 1);
			return undefined;
		},
	};

	let providerCalls = 0;
	const stream = agentLoop([createUserMessage("go")], context, config, controller.signal, () => {
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
									{ type: "toolCall", id: "slow-0", name: "slow", arguments: { path: "a" } },
									{ type: "toolCall", id: "probe-1", name: "probe", arguments: { path: "b" } },
								],
								"toolUse",
							),
						}
					: { type: "done", reason: "stop", message: createAssistantMessage([{ type: "text", text: "done" }]) },
			);
		});
		return response;
	});
	const run = (async () => {
		for await (const _event of stream) {
			// consume
		}
		return stream.result();
	})();
	return {
		run,
		finalClaimsStarted: started.promise,
		finalClaims,
		releaseSlow: () => slowGate.resolve(),
		executed,
		hookCalls,
		controller,
	};
}

function toolResults(messages: AgentMessage[]): ToolResultMessage[] {
	return messages.filter((message): message is ToolResultMessage => message.role === "toolResult");
}

describe("dag-v2 final claim resolution is bound to the run's abort signal (F02)", () => {
	it("a cancelled run settles without the hung callback and never executes the call", async () => {
		const harness = startHarness();
		await harness.finalClaimsStarted;
		expect(harness.executed).toEqual(["slow-0"]);

		harness.controller.abort();
		// Neither the hung callback nor the blocked peer is released: the abort
		// alone must let the run settle.
		expect(await settledWithin(harness.run, 1_000)).toBe("settled");

		const messages = await harness.run;
		expect(harness.executed).toEqual(["slow-0"]);
		const results = toolResults(messages);
		expect(results.map((result) => result.toolCallId)).toEqual(["slow-0", "probe-1"]);
		// The in-flight peer follows the existing abort contract: it started, so
		// its aborted terminal records that ownership rather than a clean skip.
		expect(results[0]?.details).toMatchObject({ omk: { disposition: "aborted", executionStarted: true } });
		// The abandoned admission is a synthetic abort that never started.
		expect(results[1]?.isError).toBe(true);
		expect(results[1]?.details).toMatchObject({ omk: { disposition: "aborted", executionStarted: false } });
		expect(harness.hookCalls.get("probe-1")).toBe(1);

		harness.releaseSlow();
		harness.finalClaims.resolve([{ kind: "path", key: "b", access: "read" }]);
	});

	it.each([
		[
			"fulfils",
			(claims: Deferred<ToolResourceClaims>) => claims.resolve([{ kind: "path", key: "b", access: "read" }]),
		],
		["rejects", (claims: Deferred<ToolResourceClaims>) => claims.reject(new Error("late failure"))],
	])("a late callback that %s after cancellation admits nothing", async (_label, settleLate) => {
		const harness = startHarness();
		await harness.finalClaimsStarted;
		harness.controller.abort();
		harness.releaseSlow();
		const messages = await harness.run;
		const before = messages.length;

		settleLate(harness.finalClaims);
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(harness.executed).toEqual(["slow-0"]);
		expect(messages.length).toBe(before);
		expect(toolResults(messages).map((result) => result.toolCallId)).toEqual(["slow-0", "probe-1"]);
	});
});
