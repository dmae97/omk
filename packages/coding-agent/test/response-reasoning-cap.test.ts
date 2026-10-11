import type { StreamFn } from "omk-agent-core";
import {
	type AssistantMessage,
	type AssistantMessageEvent,
	createAssistantMessageEventStream,
	type Model,
	type SimpleStreamOptions,
} from "omk-ai";
import { describe, expect, it } from "vitest";
import { calculateContextTokens } from "../src/core/compaction/compaction.ts";
import { RemainingBudget } from "../src/core/remaining-budget.ts";
import {
	createResponseReasoningCapStreamFn,
	lowerReasoningEffort,
	RESPONSE_CAP_OVERRUN_AFTER_RETRY_DIAGNOSTIC,
	RESPONSE_CAP_RETRY_DIAGNOSTIC,
	type ResponseReasoningCapConfig,
	resolveResponseReasoningCapConfig,
	resolveResponseWallCapMs,
} from "../src/core/response-reasoning-cap.ts";

const model = { id: "grok-4.7", api: "openai-completions", provider: "xai" } as unknown as Model<"openai-completions">;

function usage(output: number) {
	return {
		input: 10,
		output,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 10 + output,
		cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 },
	};
}

function message(text: string, stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage {
	return {
		role: "assistant",
		content: text ? [{ type: "text", text }] : [],
		api: "openai-completions",
		provider: "xai",
		model: "grok-4.7",
		usage: usage(5),
		stopReason,
		timestamp: 0,
	};
}

/** One scripted attempt: thinking chunks, optional delay per chunk, then a text answer. */
interface Script {
	readonly thinking: readonly string[];
	readonly delayMs?: number;
	/** Wait this long before the first event (silent thinking). */
	readonly stallMs?: number;
	readonly answer?: string;
	/** After text_start: wait this long, then stream this much more thinking before done. */
	readonly afterAnswerStallMs?: number;
	readonly afterAnswerThinking?: readonly string[];
}

interface Call {
	readonly options: SimpleStreamOptions | undefined;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function fakeInner(scripts: readonly Script[]): { fn: StreamFn; calls: Call[] } {
	const calls: Call[] = [];
	const fn: StreamFn = (_model, _context, options) => {
		const script = scripts[calls.length] ?? scripts[scripts.length - 1];
		calls.push({ options });
		const stream = createAssistantMessageEventStream();
		const signal = options?.signal;
		void (async () => {
			const partial = message("");
			const aborted = () => {
				const final = { ...message(""), stopReason: "aborted" as const, errorMessage: "aborted" };
				stream.push({ type: "error", reason: "aborted", error: final });
				stream.end(final);
			};
			stream.push({ type: "start", partial });
			if (script.stallMs) await sleep(script.stallMs);
			if (signal?.aborted) return aborted();
			stream.push({ type: "thinking_start", contentIndex: 0, partial });
			for (const delta of script.thinking) {
				if (script.delayMs) await sleep(script.delayMs);
				if (signal?.aborted) return aborted();
				stream.push({ type: "thinking_delta", contentIndex: 0, delta, partial });
			}
			const final = message(script.answer ?? "ok");
			stream.push({ type: "text_start", contentIndex: 1, partial: final });
			if (script.afterAnswerStallMs) await sleep(script.afterAnswerStallMs);
			if (signal?.aborted) return aborted();
			for (const delta of script.afterAnswerThinking ?? []) {
				stream.push({ type: "thinking_delta", contentIndex: 0, delta, partial: final });
			}
			stream.push({ type: "done", reason: "stop", message: final });
			stream.end(final);
		})();
		return stream;
	};
	return { fn, calls };
}

async function run(fn: StreamFn, options: SimpleStreamOptions = { reasoning: "xhigh" }) {
	const response = await fn(model, { messages: [] }, options);
	const events: AssistantMessageEvent[] = [];
	for await (const event of response) events.push(event);
	return { events, result: await response.result() };
}

const config = (overrides: Partial<ResponseReasoningCapConfig> = {}): ResponseReasoningCapConfig => ({
	maxReasoningTokens: 100,
	maxWallMs: 10_000,
	...overrides,
});

const chunk = "x".repeat(200); // 50 estimated tokens

describe("response reasoning cap (spec 033)", () => {
	it("AC1 under cap: one call, events forwarded, no cap diagnostics", async () => {
		const inner = fakeInner([{ thinking: [chunk], answer: "done" }]);
		const { events, result } = await run(createResponseReasoningCapStreamFn(inner.fn, config()));
		expect(inner.calls).toHaveLength(1);
		expect(events.map((e) => e.type)).toEqual(["start", "thinking_start", "thinking_delta", "text_start", "done"]);
		expect(result.content).toEqual([{ type: "text", text: "done" }]);
		expect(result.diagnostics).toBeUndefined();
	});

	it("AC2 reasoning-token cap: aborts, retries once at one lower effort, records it", async () => {
		const inner = fakeInner([{ thinking: [chunk, chunk, chunk, chunk] }, { thinking: [chunk], answer: "retry" }]);
		const { events, result } = await run(createResponseReasoningCapStreamFn(inner.fn, config()));
		expect(inner.calls).toHaveLength(2);
		expect(inner.calls[0].options?.signal?.aborted).toBe(true);
		expect(inner.calls[1].options?.reasoning).toBe("high");
		expect(events.filter((e) => e.type === "start")).toHaveLength(1);
		expect(events.filter((e) => e.type === "done" || e.type === "error")).toHaveLength(1);
		expect(result.stopReason).toBe("stop");
		expect(result.content).toEqual([{ type: "text", text: "retry" }]);
		expect(result.diagnostics).toHaveLength(1);
		expect(result.diagnostics?.[0]).toMatchObject({
			type: RESPONSE_CAP_RETRY_DIAGNOSTIC,
			details: { reason: "reasoning_tokens", fromEffort: "xhigh", toEffort: "high", capTokens: 100 },
		});
		// Tokens are the retry's own; cost covers both billed requests; the aborted usage is in the diagnostic.
		expect(result.usage.output).toBe(5);
		expect(result.usage.cost.total).toBeCloseTo(0.06);
		expect(result.diagnostics?.[0].details?.abortedAttemptUsage).toMatchObject({ output: 5, totalTokens: 15 });
	});

	it("AC3 wall-time cap: silent thinking past the cap is retried once", async () => {
		const inner = fakeInner([
			{ thinking: [], stallMs: 200 },
			{ thinking: [], answer: "fast" },
		]);
		const { result } = await run(createResponseReasoningCapStreamFn(inner.fn, config({ maxWallMs: 40 })));
		expect(inner.calls).toHaveLength(2);
		expect(inner.calls[1].options?.reasoning).toBe("high");
		expect(result.content).toEqual([{ type: "text", text: "fast" }]);
		expect(result.diagnostics?.[0]).toMatchObject({ details: { reason: "wall_time", capMs: 40 } });
	});

	it("AC4 second overrun is recorded but not retried again", async () => {
		const inner = fakeInner([
			{ thinking: [chunk, chunk, chunk] },
			{ thinking: [chunk, chunk, chunk], answer: "slow" },
		]);
		const { result } = await run(createResponseReasoningCapStreamFn(inner.fn, config()));
		expect(inner.calls).toHaveLength(2);
		expect(inner.calls[1].options?.signal?.aborted).toBe(false);
		expect(result.content).toEqual([{ type: "text", text: "slow" }]);
		expect(result.diagnostics?.map((d) => d.type)).toEqual([
			RESPONSE_CAP_RETRY_DIAGNOSTIC,
			RESPONSE_CAP_OVERRUN_AFTER_RETRY_DIAGNOSTIC,
		]);
	});

	it("AC5 feature off: env unset returns no config and the inner StreamFn itself", () => {
		const inner = fakeInner([{ thinking: [] }]);
		expect(resolveResponseReasoningCapConfig({})).toBeUndefined();
		expect(resolveResponseReasoningCapConfig({ OMK_RESPONSE_REASONING_CAP: "0" })).toBeUndefined();
		expect(createResponseReasoningCapStreamFn(inner.fn, resolveResponseReasoningCapConfig({}))).toBe(inner.fn);
		expect(
			resolveResponseReasoningCapConfig({
				OMK_RESPONSE_REASONING_CAP: "1",
				OMK_RESPONSE_REASONING_CAP_TOKENS: "5000",
				OMK_RESPONSE_WALL_CAP_SEC: "90",
			}),
		).toMatchObject({ maxReasoningTokens: 5000, maxWallMs: 90_000 });
		expect(resolveResponseReasoningCapConfig({ OMK_RESPONSE_REASONING_CAP: "1" })).toMatchObject({
			maxReasoningTokens: 20_000,
			maxWallMs: 240_000,
		});
	});

	it("AC6 caller abort is not a cap and is not retried", async () => {
		const inner = fakeInner([{ thinking: [chunk, chunk], delayMs: 30 }]);
		const controller = new AbortController();
		setTimeout(() => controller.abort(), 10);
		const { result } = await run(
			createResponseReasoningCapStreamFn(inner.fn, config({ maxReasoningTokens: 10_000 })),
			{
				reasoning: "xhigh",
				signal: controller.signal,
			},
		);
		expect(inner.calls).toHaveLength(1);
		expect(result.stopReason).toBe("aborted");
		expect(result.diagnostics).toBeUndefined();
	});

	it("AC7 cap passed after the answer started is not cut", async () => {
		const inner = fakeInner([
			{ thinking: [chunk], answer: "kept", afterAnswerStallMs: 120, afterAnswerThinking: [chunk, chunk, chunk] },
		]);
		const { result } = await run(createResponseReasoningCapStreamFn(inner.fn, config({ maxWallMs: 40 })));
		expect(inner.calls).toHaveLength(1);
		expect(inner.calls[0].options?.signal?.aborted).toBe(false);
		expect(result.content).toEqual([{ type: "text", text: "kept" }]);
		expect(result.diagnostics).toBeUndefined();
	});

	it("no lower effort: the cap is measured but not enforced", async () => {
		const inner = fakeInner([{ thinking: [chunk, chunk, chunk], answer: "min" }]);
		const { result } = await run(createResponseReasoningCapStreamFn(inner.fn, config()), { reasoning: "minimal" });
		expect(inner.calls).toHaveLength(1);
		expect(result.content).toEqual([{ type: "text", text: "min" }]);
		expect(lowerReasoningEffort(undefined)).toBeUndefined();
		expect(lowerReasoningEffort("max")).toBe("xhigh");
	});

	it("AC8 wall cap honors the RemainingBudget clock", () => {
		let now = 0;
		const budget = new RemainingBudget({ budgetMs: 900_000, now: () => now, startedAt: 0 });
		expect(resolveResponseWallCapMs(240_000, undefined)).toBe(240_000);
		expect(resolveResponseWallCapMs(240_000, budget)).toBe(135_000); // 15% of 900 s
		now = 750_000; // 150 s left, 90 s reserve → 60 s
		expect(resolveResponseWallCapMs(240_000, budget)).toBe(60_000);
		now = 880_000; // below reserve → floor
		expect(resolveResponseWallCapMs(240_000, budget)).toBe(30_000);
		const long = new RemainingBudget({ budgetMs: 3_600_000, now: () => 0, startedAt: 0 });
		expect(resolveResponseWallCapMs(240_000, long)).toBe(240_000);
	});

	it("review M1: a capped retry does not inflate the context size compaction reads", async () => {
		const inner = fakeInner([{ thinking: [chunk, chunk, chunk, chunk] }, { thinking: [chunk], answer: "retry" }]);
		const { result } = await run(createResponseReasoningCapStreamFn(inner.fn, config()));
		expect(inner.calls).toHaveLength(2);
		// The retry alone reports totalTokens 15; summing both attempts gave 30.
		expect(calculateContextTokens(result.usage)).toBe(15);
		expect(result.usage).toMatchObject({ input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15 });
	});

	it("review M2: a setup throw leaves no abort listener on the caller's signal", async () => {
		const controller = new AbortController();
		const signal = controller.signal;
		let listeners = 0;
		const add = signal.addEventListener.bind(signal);
		const remove = signal.removeEventListener.bind(signal);
		signal.addEventListener = ((...args: Parameters<AbortSignal["addEventListener"]>) => {
			listeners += 1;
			add(...args);
		}) as AbortSignal["addEventListener"];
		signal.removeEventListener = ((...args: Parameters<AbortSignal["removeEventListener"]>) => {
			listeners -= 1;
			remove(...args);
		}) as AbortSignal["removeEventListener"];
		const failing: StreamFn = async () => {
			throw new Error("No API key for xai");
		};
		const wrapped = createResponseReasoningCapStreamFn(failing, config());
		await expect(wrapped(model, { messages: [] }, { reasoning: "xhigh", signal })).rejects.toThrow(/No API key/);
		expect(listeners).toBe(0);
	});
});
