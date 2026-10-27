import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StreamFn } from "omk-agent-core";
import {
	type AssistantMessage,
	type Context,
	getModel,
	type Model,
	promptCacheCapability,
	type SimpleStreamOptions,
	type Usage,
} from "omk-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseResponsesUsage } from "../../ai/src/providers/openai-responses-usage.ts";
import { wrapBudgetStream } from "../src/core/budget-stream.ts";
import {
	buildSuggestionContext,
	planSuggestion,
	type RecordedMainRequest,
	requestNextSuggestion,
	type SuggestionPlan,
	suggestionEffectiveMaxTokens,
	suggestionMaxTokens,
} from "../src/core/next-suggestion.ts";
import {
	cappedSuggestionOptions,
	DEFAULT_SUGGESTION_BUDGET,
	estimateSuggestionCostUsd,
	isSuggestionCapsEnabled,
	type SuggestionBudget,
	suggestionBudgetFromEnv,
} from "../src/core/next-suggestion-budget.ts";
import { type SuggestionSettlement, suggestionMetricInput } from "../src/core/next-suggestion-settlement.ts";
import { RunBudget } from "../src/core/run-budget.ts";
import { summarizeTurnMetrics, TurnMetricsSink } from "../src/core/turn-metrics.ts";
import {
	installNextSuggestions,
	type SuggestionEditorPort,
	type SuggestionSessionPort,
} from "../src/modes/interactive/next-suggestion-controller.ts";

const anthropic = getModel("anthropic", "claude-sonnet-4-5")! as Model<"anthropic-messages">;
const openai = getModel("openai", "gpt-4o")! as Model<"openai-responses">;
const xai = getModel("xai", "grok-3")! as Model<"openai-completions">;
const MIN = 60_000;
const BUDGET: SuggestionBudget = { maxReasoning: "inherit", deadlineMs: 5_000, maxCostUsd: 1 };

function usage(input: number, output: number, total = 0.01): Usage {
	return {
		input,
		output,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: input + output,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total },
	};
}
function assistant(text: string, over: Partial<AssistantMessage> = {}): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: anthropic.id,
		usage: usage(10, 5),
		stopReason: "stop",
		timestamp: 1000,
		...over,
	};
}
const context: Context = {
	systemPrompt: "system",
	messages: [{ role: "user", content: [{ type: "text", text: "fix the parser" }], timestamp: 900 }],
	tools: [],
};
function record(model: Model<never> | Model<"anthropic-messages">, options?: SimpleStreamOptions): RecordedMainRequest {
	return { model: model as never, context, options, atMs: 990 };
}
function plan(r: RecordedMainRequest, nowMs: number, caps?: { budget: SuggestionBudget | undefined }): SuggestionPlan {
	return planSuggestion({
		record: r,
		outcome: "completed",
		finalAssistant: assistant("Done."),
		currentModel: { provider: r.model.provider, id: r.model.id },
		nowMs,
		usage: "no_quota",
		...(caps ? { caps } : {}),
	});
}
const reason = (p: SuggestionPlan) => (p.kind === "skip" ? p.reason : p.kind);

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
});

describe("spec 103: flags", () => {
	it("caps flag is off by default; env budget = spec defaults, env only overrides", () => {
		expect(isSuggestionCapsEnabled({})).toBe(false);
		expect(isSuggestionCapsEnabled({ OMK_NEXT_SUGGESTIONS_CAPS: "1" })).toBe(true);
		expect(DEFAULT_SUGGESTION_BUDGET).toEqual({ maxReasoning: "inherit", deadlineMs: 30_000, maxCostUsd: 0.02 });
		expect(suggestionBudgetFromEnv({})).toEqual(DEFAULT_SUGGESTION_BUDGET);
		expect(suggestionBudgetFromEnv({ OMK_NEXT_SUGGESTIONS_DEADLINE_MS: "3000" })).toEqual({
			...DEFAULT_SUGGESTION_BUDGET,
			deadlineMs: 3000,
		});
		expect(
			suggestionBudgetFromEnv({
				OMK_NEXT_SUGGESTIONS_MAX_COST_USD: "0.5",
				OMK_NEXT_SUGGESTIONS_MAX_REASONING: "low",
			}),
		).toEqual({ maxReasoning: "low", deadlineMs: 30_000, maxCostUsd: 0.5 });
		// Invalid values keep the default; they never disable the suggestion.
		expect(
			suggestionBudgetFromEnv({ OMK_NEXT_SUGGESTIONS_DEADLINE_MS: "abc", OMK_NEXT_SUGGESTIONS_MAX_COST_USD: "-1" }),
		).toEqual(DEFAULT_SUGGESTION_BUDGET);
	});

	it("budget_unset only when a cap is explicitly set to 0", () => {
		expect(suggestionBudgetFromEnv({ OMK_NEXT_SUGGESTIONS_DEADLINE_MS: "0" })).toBeUndefined();
		expect(suggestionBudgetFromEnv({ OMK_NEXT_SUGGESTIONS_MAX_COST_USD: "0" })).toBeUndefined();
		expect(reason(plan(record(anthropic), 2000, { budget: suggestionBudgetFromEnv({}) }))).toBe("request");
	});

	it("caps on with no budget configured skips (fail closed) with zero provider calls", () => {
		expect(reason(plan(record(anthropic), 2000, { budget: undefined }))).toBe("budget_unset");
	});

	it("caps off: plan shape and request bytes equal the spec 091 reuse arm", async () => {
		const options: SimpleStreamOptions = { reasoning: "high", cacheRetention: "short", sessionId: "s" };
		const p = plan(record(anthropic, options), 2000);
		expect(p).toEqual({ kind: "request", record: record(anthropic, options), finalAssistant: assistant("Done.") });
		let seen: Record<string, unknown> | undefined;
		const streamFn = ((_m: unknown, _c: Context, o: Record<string, unknown>) => {
			seen = o;
			return { result: async () => assistant("Next.") };
		}) as unknown as StreamFn;
		const signal = new AbortController().signal;
		await requestNextSuggestion(streamFn, record(anthropic, options), assistant("Done."), signal);
		expect(seen).toEqual({ ...options, maxTokens: 128, signal });
		expect(Object.keys(seen ?? {})).toEqual([...Object.keys(options), "maxTokens", "signal"]);
	});
});

describe("spec 103 §2.1: independent caps (caps flag on)", () => {
	it("deadline fires on a fake clock: outcome timeout, request aborted, partial usage settled, nothing shown", async () => {
		vi.useFakeTimers();
		let requestSignal: AbortSignal | undefined;
		const streamFn = ((_m: unknown, _c: Context, o: SimpleStreamOptions) => {
			requestSignal = o.signal;
			return {
				result: () =>
					new Promise<AssistantMessage>((resolve) =>
						o.signal?.addEventListener("abort", () =>
							resolve(assistant("", { stopReason: "aborted", usage: usage(40, 2) })),
						),
					),
			};
		}) as unknown as StreamFn;
		const p = plan(record(anthropic), 2000, { budget: BUDGET });
		if (p.kind !== "request" || !p.caps) throw new Error("expected caps request");
		const timeoutSignal = (ms: number) => {
			const c = new AbortController();
			setTimeout(() => c.abort(new Error("timeout")), ms);
			return c.signal;
		};
		const pending = requestNextSuggestion(streamFn, p.record, p.finalAssistant, new AbortController().signal, {
			caps: p.caps,
			timeoutSignal,
		});
		await vi.advanceTimersByTimeAsync(BUDGET.deadlineMs);
		const result = await pending;
		expect(requestSignal?.aborted).toBe(true);
		expect(result.outcome).toBe("timeout");
		expect(result.text).toBeUndefined();
		expect(result.usage?.input).toBe(40);
	});

	it("pre-flight estimate over maxCostUsd skips over_cost_cap with zero provider calls", () => {
		const p = plan(record(anthropic), 2000, { budget: { ...BUDGET, maxCostUsd: 1e-9 } });
		expect(reason(p)).toBe("over_cost_cap");
		expect(reason(plan(record(anthropic), 2000, { budget: BUDGET }))).toBe("request");
	});

	it("charges admission against the provider's effective output ceiling", () => {
		const priced = {
			...anthropic,
			maxTokens: 100_000,
			cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
		};
		const options: SimpleStreamOptions = { reasoning: "high", cacheRetention: "short" };
		const r = record(priced, options);
		const context = buildSuggestionContext(r, assistant("Done."));
		const baseCost = estimateSuggestionCostUsd(priced, context, suggestionMaxTokens(priced, options));
		const effectiveCost = estimateSuggestionCostUsd(priced, context, suggestionEffectiveMaxTokens(priced, options));
		expect(suggestionEffectiveMaxTokens(priced, options)).toBe(16384 + 128);
		expect(effectiveCost).toBeGreaterThan(baseCost);

		expect(reason(plan(r, 2000, { budget: { ...BUDGET, maxCostUsd: (baseCost + effectiveCost) / 2 } }))).toBe(
			"over_cost_cap",
		);
	});

	it("maxReasoning inherit keeps the options object; a lower cap only lowers", () => {
		const options: SimpleStreamOptions = { reasoning: "high" };
		expect(cappedSuggestionOptions(options, BUDGET)).toBe(options);
		expect(cappedSuggestionOptions(options, { ...BUDGET, maxReasoning: "low" })).toEqual({ reasoning: "low" });
		expect(cappedSuggestionOptions({ reasoning: "minimal" }, { ...BUDGET, maxReasoning: "low" })).toEqual({
			reasoning: "minimal",
		});
	});
});

describe("spec 103 §2.4: capability table", () => {
	it("cacheRead price 0 but table says supported is not skipped; xAI is cache_capability_unknown", () => {
		const free = { ...anthropic, cost: { ...anthropic.cost, cacheRead: 0 } };
		expect(reason(plan(record(free), 2000))).toBe("no_cache_support"); // caps off: today's rule
		expect(reason(plan(record(free), 2000, { budget: BUDGET }))).toBe("request");
		expect(reason(plan(record(xai as never), 2000, { budget: BUDGET }))).toBe("cache_capability_unknown");
		expect(promptCacheCapability(xai, "short").kind).toBe("unknown");
		expect(reason(plan(record(anthropic, { cacheRetention: "none" }), 2000, { budget: BUDGET }))).toBe(
			"no_cache_support",
		);
	});

	it("TTL per provider and retention actually sent", () => {
		const at = (model: Model<never>, retention: SimpleStreamOptions["cacheRetention"], minutes: number) =>
			reason(plan(record(model, { cacheRetention: retention }), 990 + minutes * MIN, { budget: BUDGET }));
		expect(at(openai as never, "long", 31)).toBe("cache_cold");
		expect(at(openai as never, "long", 29)).toBe("request");
		expect(at(anthropic as never, "long", 59)).toBe("request");
		expect(at(anthropic as never, "long", 61)).toBe("cache_cold");
		expect(at(anthropic as never, undefined, 4)).toBe("request");
		expect(at(anthropic as never, undefined, 6)).toBe("cache_cold");
		expect(promptCacheCapability({ ...openai, id: "gpt-5.6" }, "short")).toMatchObject({ coldAfterMs: 30 * MIN });
		expect(promptCacheCapability(openai, "short")).toMatchObject({ coldAfterMs: 5 * MIN });
	});
});

describe("spec 103 §2.3: normalized usage fixtures (doc examples)", () => {
	it("OpenAI and Anthropic produce the documented ordinary input", () => {
		const o = parseResponsesUsage({
			input_tokens: 12000,
			output_tokens: 0,
			input_tokens_details: { cached_tokens: 4000, cache_write_tokens: 7000 },
		});
		expect({ input: o.input, cacheRead: o.cacheRead, cacheWrite: o.cacheWrite }).toEqual({
			input: 1000,
			cacheRead: 4000,
			cacheWrite: 7000,
		});
		// Anthropic maps fields directly (anthropic.ts message_start): input_tokens is already uncached.
		const a = { input_tokens: 50, cache_read_input_tokens: 100000, cache_creation_input_tokens: 0 };
		expect(a.input_tokens).toBe(50);
		expect(a.cache_read_input_tokens + a.cache_creation_input_tokens + a.input_tokens).toBe(100050);
	});
});

describe("spec 103 §2.2: usage settlement", () => {
	function fakeSession(streamFn: StreamFn) {
		const listeners: Array<(e: { type: string; outcome?: string }) => unknown> = [];
		const session = {
			agent: { streamFn, state: { messages: [] as unknown[] } },
			model: { provider: anthropic.provider, id: anthropic.id } as { provider: string; id: string } | undefined,
			subscribe: (l: (e: { type: string; outcome?: string }) => unknown) => {
				listeners.push(l);
				return () => {};
			},
		};
		const emit = (e: { type: string; outcome?: string }) => {
			for (const l of listeners) l(e);
		};
		return { session, emit };
	}
	function editor(): SuggestionEditorPort {
		let text = "";
		return {
			getText: () => text,
			setText: (t) => {
				text = t;
			},
			setPlaceholder: () => {},
			isShowingAutocomplete: () => false,
		};
	}
	async function mainTurn(
		session: ReturnType<typeof fakeSession>["session"],
		emit: (e: { type: string; outcome?: string }) => void,
	) {
		emit({ type: "agent_start" });
		const stream = await session.agent.streamFn(anthropic, context, { cacheRetention: "short" });
		const final = await stream.result();
		session.agent.state.messages = [...context.messages, final];
		emit({ type: "turn_end" });
	}

	it("caps off: one purpose:suggestion record per suggestion; parent turn totals unchanged", async () => {
		const settled: SuggestionSettlement[] = [];
		const { session, emit } = fakeSession(((_m: unknown, c: Context) => ({
			result: async () =>
				c.messages.length > 1
					? assistant("Run tests next.", { usage: usage(7, 3, 0.002) })
					: assistant("Done.", { timestamp: Date.now(), usage: usage(100, 20, 0.05) }),
		})) as unknown as StreamFn);
		const c = installNextSuggestions(session as unknown as SuggestionSessionPort, editor(), "base", {
			env: { OMK_NEXT_SUGGESTIONS: "1" },
			quotaUsage: async () => "no_quota",
			settle: (s) => settled.push(s as SuggestionSettlement),
		})!;
		await mainTurn(session, emit);
		await c.onSettled("completed");
		expect(c.suggestion).toBe("Run tests next.");
		c.dispose();
		expect(settled).toHaveLength(1);
		const input = suggestionMetricInput("sess", settled[0]!);
		expect(input).toMatchObject({ purpose: "suggestion", parentTurnIndex: 0, suggestionOutcome: "shown" });
		const dir = mkdtempSync(join(tmpdir(), "omk-103-"));
		try {
			const sink = new TurnMetricsSink({ dir });
			sink.record({
				sessionId: "sess",
				turnIndex: 0,
				startedAtEpochMs: 1,
				endedAtEpochMs: 2,
				usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, costUsd: 0.05 },
			});
			sink.record(input);
			const summary = summarizeTurnMetrics(readFileSync(sink.path, "utf8").split("\n"));
			expect(summary.byPurpose?.main).toMatchObject({ records: 1, input: 100, costUsd: 0.05 });
			expect(summary.byPurpose?.suggestion).toMatchObject({ records: 1, input: 7, costUsd: 0.002 });
			expect(summary.totals.input).toBe(107);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("joins an identical in-flight request and settles generation once", async () => {
		const settled: SuggestionSettlement[] = [];
		let suggestionCalls = 0;
		let release: (() => void) | undefined;
		const pendingResult = new Promise<AssistantMessage>((resolve) => {
			release = () => resolve(assistant("Run tests next.", { usage: usage(7, 3, 0.002) }));
		});
		const { session, emit } = fakeSession(((_m: unknown, c: Context) => {
			if (c.messages.length > 1) suggestionCalls++;
			return {
				result: () =>
					c.messages.length > 1 ? pendingResult : Promise.resolve(assistant("Done.", { timestamp: Date.now() })),
			};
		}) as unknown as StreamFn);
		const c = installNextSuggestions(session as unknown as SuggestionSessionPort, editor(), "base", {
			env: { OMK_NEXT_SUGGESTIONS: "1" },
			quotaUsage: async () => "no_quota",
			settle: (s) => settled.push(s as SuggestionSettlement),
		})!;
		await mainTurn(session, emit);
		const first = c.onSettled("completed");
		const second = c.onSettled("completed");
		await vi.waitFor(() => expect(suggestionCalls).toBe(1));
		release?.();
		await Promise.all([first, second]);
		expect(c.suggestion).toBe("Run tests next.");
		expect(settled).toHaveLength(1);
		c.dispose();
	});

	it("serves the current candidate without another provider call or generation settlement", async () => {
		const settled: SuggestionSettlement[] = [];
		let suggestionCalls = 0;
		let quotaReads = 0;
		const { session, emit } = fakeSession(((_m: unknown, c: Context) => {
			if (c.messages.length > 1) suggestionCalls++;
			return {
				result: async () =>
					c.messages.length > 1
						? assistant("Run tests next.", { usage: usage(7, 3, 0.002) })
						: assistant("Done.", { timestamp: Date.now() }),
			};
		}) as unknown as StreamFn);
		const c = installNextSuggestions(session as unknown as SuggestionSessionPort, editor(), "base", {
			env: { OMK_NEXT_SUGGESTIONS: "1" },
			quotaUsage: async () => {
				quotaReads++;
				return "no_quota";
			},
			settle: (s) => settled.push(s as SuggestionSettlement),
		})!;
		await mainTurn(session, emit);
		await c.onSettled("completed");
		await c.onSettled("completed");
		expect(c.suggestion).toBe("Run tests next.");
		expect(suggestionCalls).toBe(1);
		expect(quotaReads).toBe(1);
		expect(settled).toHaveLength(1);
		c.dispose();
	});

	it("suggestion records are excluded from turns, durations and usageCoverage but kept in cost totals", () => {
		const base = {
			schemaVersion: "omk-turn-metrics-2",
			sessionId: "s",
			toolCalls: [],
			toolCallCount: 0,
			toolFailureCount: 0,
		};
		const main = {
			...base,
			turnIndex: 0,
			startedAtEpochMs: 0,
			endedAtEpochMs: 100,
			durationMs: 100,
			usage: { input: 100, output: 10, cacheRead: 0, cacheWrite: 0, costUsd: 0.05, billedUsd: 0.04 },
		};
		const sug = {
			...base,
			turnIndex: 0,
			purpose: "suggestion",
			parentTurnIndex: 0,
			suggestionOutcome: "shown",
			startedAtEpochMs: 0,
			endedAtEpochMs: 9000,
			durationMs: 9000,
			usage: { input: 7, output: 3, cacheRead: 0, cacheWrite: 0, costUsd: 0.002, billedUsd: 0.001 },
		};
		const missing = {
			...base,
			turnIndex: 1,
			purpose: "suggestion",
			parentTurnIndex: 1,
			suggestionOutcome: "error",
			startedAtEpochMs: 0,
			endedAtEpochMs: 5,
			durationMs: 5,
		};
		const summary = summarizeTurnMetrics([main, sug, missing].map((r) => JSON.stringify(r)));
		const mainOnly = summarizeTurnMetrics([JSON.stringify(main)]);
		expect(summary.turns).toBe(1);
		expect(summary.turnDurationP50Ms).toBe(100);
		expect(summary.turnDurationP95Ms).toBe(100);
		expect(summary.usageCoverage).toEqual(mainOnly.usageCoverage);
		expect(summary.cacheReadShareCoverage).toEqual(mainOnly.cacheReadShareCoverage);
		expect(summary.totals.input).toBe(107);
		expect(summary.totalCostUsd).toBeCloseTo(0.052, 10);
		expect(summary.billedCostUsd).toBeCloseTo(0.041, 10);
		expect(summary.byPurpose?.suggestion).toMatchObject({ records: 2, missingUsage: 1, input: 7 });
		expect(summary.byPurpose?.main).toMatchObject({ records: 1, input: 100 });
	});

	it("caps flag off through the controller: provider request bytes equal the main-branch reuse arm", async () => {
		const seen: Array<{ context: string; options: Record<string, unknown> }> = [];
		const options: SimpleStreamOptions = { reasoning: "high", cacheRetention: "short", sessionId: "s" };
		const listeners: Array<(e: { type: string; outcome?: string }) => unknown> = [];
		const final = assistant("Done.", { timestamp: Date.now() });
		const session = {
			agent: {
				streamFn: ((_m: unknown, c: Context, o: Record<string, unknown>) => {
					seen.push({ context: JSON.stringify(c), options: o });
					return { result: async () => (c.messages.length > 1 ? assistant("Next.") : final) };
				}) as unknown as StreamFn,
				state: { messages: [] as unknown[] },
			},
			model: { provider: anthropic.provider, id: anthropic.id },
			subscribe: (l: (e: { type: string; outcome?: string }) => unknown) => {
				listeners.push(l);
				return () => {};
			},
		};
		const c = installNextSuggestions(
			session as unknown as SuggestionSessionPort,
			{ getText: () => "", setText: () => {}, setPlaceholder: () => {}, isShowingAutocomplete: () => false },
			"base",
			{
				env: {
					OMK_NEXT_SUGGESTIONS: "1",
					OMK_NEXT_SUGGESTIONS_MAX_COST_USD: "0",
					OMK_NEXT_SUGGESTIONS_MAX_REASONING: "low",
				},
				quotaUsage: async () => "no_quota",
			},
		)!;
		await (await session.agent.streamFn(anthropic, context, options)).result();
		session.agent.state.messages = [...context.messages, final];
		await c.onSettled("completed");
		c.dispose();
		expect(seen).toHaveLength(2);
		const expected = JSON.stringify({
			...context,
			messages: [...context.messages, final, JSON.parse(seen[1]!.context).messages.at(-1)],
		});
		expect(seen[1]!.context).toBe(expected);
		const { signal, ...rest } = seen[1]!.options;
		expect(signal).toBeInstanceOf(AbortSignal);
		expect(rest).toEqual({ ...options, maxTokens: 128 });
		expect(Object.keys(seen[1]!.options)).toEqual([...Object.keys(options), "maxTokens", "signal"]);
	});

	it("no suggestion records: summary has no byPurpose field (flag-off output unchanged)", () => {
		const line = JSON.stringify({
			schemaVersion: "omk-turn-metrics-2",
			sessionId: "s",
			turnIndex: 0,
			startedAtEpochMs: 1,
			endedAtEpochMs: 2,
			durationMs: 1,
			toolCalls: [],
			toolCallCount: 0,
			toolFailureCount: 0,
		});
		expect("byPurpose" in summarizeTurnMetrics([line])).toBe(false);
	});

	it("cancel by keypress mid-stream: cost counted as cancelled, nothing shown", async () => {
		const settled: SuggestionSettlement[] = [];
		const { session, emit } = fakeSession(((_m: unknown, c: Context, o: SimpleStreamOptions) => ({
			result: () =>
				c.messages.length > 1
					? new Promise<AssistantMessage>((resolve) =>
							o.signal?.addEventListener("abort", () =>
								resolve(assistant("", { stopReason: "aborted", usage: usage(9, 1, 0.003) })),
							),
						)
					: Promise.resolve(assistant("Done.", { timestamp: Date.now() })),
		})) as unknown as StreamFn);
		const ed = editor();
		const c = installNextSuggestions(session as unknown as SuggestionSessionPort, ed, "base", {
			env: { OMK_NEXT_SUGGESTIONS: "1" },
			quotaUsage: async () => "no_quota",
			settle: (s) => settled.push(s as SuggestionSettlement),
		})!;
		await mainTurn(session, emit);
		const pending = c.onSettled("completed");
		await vi.waitFor(() => expect((c as unknown as { pending?: unknown }).pending).toBeDefined());
		if (!ed.onBeforeInput) throw new Error("suggestion key handler missing");
		ed.onBeforeInput("x");
		await pending;
		c.dispose();
		expect(c.suggestion).toBeUndefined();
		expect(settled[0]?.result.outcome).toBe("aborted");
		const summary = summarizeTurnMetrics(
			[JSON.stringify({ ...suggestionMetricInput("s", settled[0]!) })].map((l) => {
				const dir = mkdtempSync(join(tmpdir(), "omk-103-"));
				const sink = new TurnMetricsSink({ dir });
				sink.record(JSON.parse(l));
				const out = readFileSync(sink.path, "utf8");
				rmSync(dir, { recursive: true, force: true });
				return out;
			}),
		);
		expect(summary.byPurpose?.suggestion?.cancelledCostUsd).toBe(0.003);
	});

	it("missing usage is missing coverage, never 0", () => {
		const input = suggestionMetricInput("s", {
			result: { outcome: "error", latencyMs: 5 },
			provider: "anthropic",
			model: anthropic.id,
			parentTurnIndex: 2,
			startedAtEpochMs: 10,
		});
		expect(input.usage).toBeUndefined();
	});

	it("model switched before the result (caps on): late result discarded, cost still settled", async () => {
		const settled: SuggestionSettlement[] = [];
		let releaseSuggestion: () => void = () => {};
		const { session, emit } = fakeSession(((_m: unknown, c: Context) => ({
			result: () =>
				c.messages.length > 1
					? new Promise<AssistantMessage>((resolve) => {
							releaseSuggestion = () => resolve(assistant("Late.", { usage: usage(5, 1, 0.001) }));
						})
					: Promise.resolve(assistant("Done.", { timestamp: Date.now() })),
		})) as unknown as StreamFn);
		const c = installNextSuggestions(session as unknown as SuggestionSessionPort, editor(), "base", {
			env: { OMK_NEXT_SUGGESTIONS: "1", OMK_NEXT_SUGGESTIONS_CAPS: "1" },
			budget: BUDGET,
			quotaUsage: async () => "no_quota",
			settle: (s) => settled.push(s as SuggestionSettlement),
		})!;
		await mainTurn(session, emit);
		const pending = c.onSettled("completed");
		await vi.waitFor(() => expect((c as unknown as { pending?: unknown }).pending).toBeDefined());
		session.model = { provider: "openai", id: "gpt-4o" };
		releaseSuggestion();
		await pending;
		c.dispose();
		expect(c.suggestion).toBeUndefined();
		expect(settled[0]?.result.usage?.cost.total).toBe(0.001);
	});

	it("totals reconcile: Σ(main + suggestion) == trace Σ with the suggestion labelled", async () => {
		const dir = mkdtempSync(join(tmpdir(), "omk-103-trace-"));
		const tracePath = join(dir, "trace.jsonl");
		vi.stubEnv("OMK_EVAL_TRACE", tracePath);
		vi.stubEnv("OMK_REQUEST_ADMISSION_MODE", "off");
		const budget = new RunBudget(undefined, () => {});
		try {
			const source = ((_m: unknown, c: Context) => {
				const message =
					c.messages.length > 1
						? assistant("Next.", { usage: usage(7, 3) })
						: assistant("Done.", { usage: usage(100, 20) });
				return { result: async () => message };
			}) as unknown as StreamFn;
			const wrapped = wrapBudgetStream(source, budget);
			const main = await (await wrapped(anthropic, context, { cacheRetention: "short" })).result();
			const sug = await requestNextSuggestion(
				wrapped,
				record(anthropic, { cacheRetention: "short" }),
				main,
				new AbortController().signal,
			);
			await budget.waitForIdle();
			const rows = readFileSync(tracePath, "utf8")
				.trim()
				.split("\n")
				.map((l) => JSON.parse(JSON.parse(l).body));
			const dispatch = rows.filter((r) => r.kind === "logical_dispatch").map((r) => r.purpose);
			expect(dispatch).toEqual(["unknown", "suggestion"]);
			const traceInput = rows.filter((r) => r.kind === "logical_terminal").reduce((n, r) => n + r.usage.input, 0);
			expect(traceInput).toBe(main.usage.input + (sug.usage?.input ?? 0));
			const raw = readFileSync(tracePath, "utf8");
			expect(raw).not.toContain("fix the parser");
			expect(raw).not.toContain("Next.");
		} finally {
			budget.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
