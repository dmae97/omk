/** Spec 103b: per-cap hit counts for next-suggestion requests (caps flag on only). */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { StreamFn } from "omk-agent-core";
import { type AssistantMessage, type Context, getModel, type Model, type SimpleStreamOptions } from "omk-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SuggestionBudget } from "../src/core/next-suggestion-budget.ts";
import { type AnySuggestionSettlement, anySuggestionMetricInput } from "../src/core/next-suggestion-settlement.ts";
import { summarizeTurnMetrics } from "../src/core/turn-metrics.ts";
import { buildTurnMetricRecord, parseTurnMetricRecord } from "../src/core/turn-metrics-record.ts";
import {
	installNextSuggestions,
	type SuggestionEditorPort,
	type SuggestionSessionPort,
} from "../src/modes/interactive/next-suggestion-controller.ts";
import { runGoldenScenario } from "./fixtures/spec103b/golden-scenario.ts";

const anthropic = getModel("anthropic", "claude-sonnet-4-5")! as Model<"anthropic-messages">;
const PROMPT = "fix the parser SECRET-PROMPT";
const SUGGESTION = "Run the SECRET-SUGGESTION tests.";
const ERROR_TEXT = "SECRET-ERROR boom";
const CAPS_ENV = { OMK_NEXT_SUGGESTIONS: "1", OMK_NEXT_SUGGESTIONS_CAPS: "1" };
const BUDGET: SuggestionBudget = { maxReasoning: "inherit", deadlineMs: 5_000, maxCostUsd: 1 };
const context: Context = {
	systemPrompt: "system",
	messages: [{ role: "user", content: [{ type: "text", text: PROMPT }], timestamp: 1 }],
	tools: [],
};

function assistant(text: string, total = 0.01): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: anthropic.id,
		usage: {
			input: 10,
			output: 5,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 15,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

interface Run {
	readonly env: NodeJS.ProcessEnv;
	readonly budget?: SuggestionBudget;
	readonly mainOptions?: SimpleStreamOptions;
	readonly timeoutSignal?: (ms: number) => AbortSignal;
	readonly onSuggestionRequest?: (options: Record<string, unknown>) => void;
	readonly abortDuringRequest?: boolean;
	readonly outcome?: string;
}

async function run(opts: Run): Promise<{ settled: AnySuggestionSettlement[]; providerCalls: number }> {
	const settled: AnySuggestionSettlement[] = [];
	let providerCalls = 0;
	const listeners: Array<(e: { type: string; outcome?: string }) => unknown> = [];
	const streamFn = ((_m: unknown, c: Context, o: Record<string, unknown>) => {
		const isSuggestion = c.messages.length > 1;
		if (isSuggestion) {
			providerCalls++;
			opts.onSuggestionRequest?.(o);
			if (opts.abortDuringRequest) emit({ type: "agent_start" });
		}
		return { result: async () => (isSuggestion ? assistant(SUGGESTION, 0.003) : assistant("Done.", 0.05)) };
	}) as unknown as StreamFn;
	const session = {
		agent: { streamFn, state: { messages: [] as unknown[] } },
		model: { provider: anthropic.provider, id: anthropic.id },
		subscribe: (l: (e: { type: string; outcome?: string }) => unknown) => {
			listeners.push(l);
			return () => {};
		},
	};
	function emit(e: { type: string; outcome?: string }) {
		for (const l of listeners) l(e);
	}
	let text = "";
	const editor: SuggestionEditorPort = {
		getText: () => text,
		setText: (t) => {
			text = t;
		},
		setPlaceholder: () => {},
		isShowingAutocomplete: () => false,
	};
	const controller = installNextSuggestions(session as unknown as SuggestionSessionPort, editor, "base", {
		env: opts.env,
		quotaUsage: async () => "no_quota",
		...(opts.budget ? { budget: opts.budget } : {}),
		...(opts.timeoutSignal ? { timeoutSignal: opts.timeoutSignal } : {}),
		settle: (s) => settled.push(s),
	});
	emit({ type: "agent_start" });
	const stream = await session.agent.streamFn(anthropic, context, opts.mainOptions ?? { cacheRetention: "short" });
	session.agent.state.messages = [...context.messages, await stream.result()];
	emit({ type: "turn_end" });
	await controller!.onSettled(opts.outcome ?? "completed");
	controller!.dispose();
	return { settled, providerCalls };
}

const lines = (settled: readonly AnySuggestionSettlement[]) =>
	settled.map((s) => JSON.stringify(buildTurnMetricRecord(anySuggestionMetricInput("s", s))));
const suggestionSummary = (settled: readonly AnySuggestionSettlement[]) =>
	summarizeTurnMetrics(lines(settled)).byPurpose?.suggestion;

afterEach(() => {
	vi.useRealTimers();
});

describe("spec 103b §2: flag scope", () => {
	it("golden (required): caps flag off ⇒ turns.jsonl and summary byte-identical to main a0d6bfc9c0", async () => {
		const golden = JSON.parse(
			readFileSync(join(import.meta.dirname, "fixtures", "spec103b", "flag-off-golden.json"), "utf8"),
		) as { turns: string; summary: string };
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(1_800_000_000_000);
		const off = await runGoldenScenario({ OMK_NEXT_SUGGESTIONS: "1" });
		expect(off.turns).toBe(golden.turns);
		expect(off.summary).toBe(golden.summary);
		for (const key of [
			"capsApplied",
			"reasoningCapped",
			"suggestionSkip",
			"estimatedCostUsd",
			"maxCostUsd",
			"capHits",
			"capsEligible",
		]) {
			expect(off.turns + off.summary).not.toContain(key);
		}
		// Same scenario with caps on does hit the cost cap, so the golden covers a would-be over_cost_cap skip.
		const on = await runGoldenScenario({ OMK_NEXT_SUGGESTIONS: "1", OMK_NEXT_SUGGESTIONS_CAPS: "1" });
		expect(on.turns).toContain('"suggestionSkip":"over_cost_cap"');
	});

	it("caps off: no skip records and no new fields on request records", async () => {
		const off = await run({ env: { OMK_NEXT_SUGGESTIONS: "1" }, outcome: "failed" });
		expect(off.settled).toHaveLength(0);
		const shown = await run({ env: { OMK_NEXT_SUGGESTIONS: "1" } });
		expect(lines(shown.settled)[0]).not.toMatch(/capsApplied|reasoningCapped/);
	});
});

describe("spec 103b §3: cap hits (caps flag on)", () => {
	it("deadline fires ⇒ timeout record, capsApplied, capHits.deadline = 1, total = 1", async () => {
		const { settled } = await run({ env: CAPS_ENV, budget: BUDGET, timeoutSignal: () => AbortSignal.abort() });
		const record = JSON.parse(lines(settled)[0]!);
		expect(record).toMatchObject({ suggestionOutcome: "timeout", capsApplied: true, reasoningCapped: false });
		expect(suggestionSummary(settled)).toMatchObject({
			capsEligible: 1,
			capHits: { deadline: 1, cost: 0, reasoning: 0, total: 1 },
		});
	});

	it("estimate > maxCostUsd ⇒ zero provider calls, one over_cost_cap skip record with numeric estimate and cap", async () => {
		const budget = { ...BUDGET, maxCostUsd: 0.000_000_1 };
		const { settled, providerCalls } = await run({ env: CAPS_ENV, budget });
		expect(providerCalls).toBe(0);
		expect(settled).toHaveLength(1);
		const record = JSON.parse(lines(settled)[0]!);
		expect(record).toMatchObject({
			purpose: "suggestion",
			capsApplied: true,
			suggestionSkip: "over_cost_cap",
			maxCostUsd: 0.000_000_1,
			durationMs: 0,
		});
		expect(typeof record.estimatedCostUsd).toBe("number");
		expect(record.estimatedCostUsd).toBeGreaterThan(record.maxCostUsd);
		expect(record.usage).toBeUndefined();
		const summary = suggestionSummary(settled)!;
		expect(summary).toMatchObject({ records: 0, missingUsage: 0, capsEligible: 1 });
		expect(summary.capHits).toEqual({ deadline: 0, cost: 1, reasoning: 0, total: 1 });
	});

	it("env cost cap override is the maxCostUsd recorded", async () => {
		const { settled } = await run({ env: { ...CAPS_ENV, OMK_NEXT_SUGGESTIONS_MAX_COST_USD: "0.0000002" } });
		expect(JSON.parse(lines(settled)[0]!)).toMatchObject({
			suggestionSkip: "over_cost_cap",
			maxCostUsd: 0.000_000_2,
		});
	});

	it("non-cost skips get a skip record without cost numbers", async () => {
		const { settled } = await run({ env: CAPS_ENV, budget: BUDGET, outcome: "failed" });
		const record = JSON.parse(lines(settled)[0]!);
		expect(record).toMatchObject({ suggestionSkip: "not_completed", capsApplied: true });
		expect(record.estimatedCostUsd).toBeUndefined();
		expect(record.maxCostUsd).toBeUndefined();
		expect(suggestionSummary(settled)?.capHits).toEqual({ deadline: 0, cost: 0, reasoning: 0, total: 0 });
	});

	it("reasoning capped (main high, cap low) ⇒ reasoningCapped true; inherit ⇒ false", async () => {
		const mainOptions: SimpleStreamOptions = { reasoning: "high", cacheRetention: "short" };
		let seen: Record<string, unknown> | undefined;
		const capped = await run({
			env: CAPS_ENV,
			budget: { ...BUDGET, maxReasoning: "low" },
			mainOptions,
			onSuggestionRequest: (o) => {
				seen = o;
			},
		});
		expect(seen?.reasoning).toBe("low");
		expect(JSON.parse(lines(capped.settled)[0]!)).toMatchObject({ reasoningCapped: true });
		expect(suggestionSummary(capped.settled)?.capHits).toEqual({ deadline: 0, cost: 0, reasoning: 1, total: 1 });
		const inherit = await run({ env: CAPS_ENV, budget: BUDGET, mainOptions });
		expect(JSON.parse(lines(inherit.settled)[0]!)).toMatchObject({ reasoningCapped: false });
	});

	it("reasoning capped + timeout ⇒ deadline 1, reasoning 1, total 1", async () => {
		const { settled } = await run({
			env: CAPS_ENV,
			budget: { ...BUDGET, maxReasoning: "low" },
			mainOptions: { reasoning: "high", cacheRetention: "short" },
			timeoutSignal: () => AbortSignal.abort(),
		});
		expect(suggestionSummary(settled)?.capHits).toEqual({ deadline: 1, cost: 0, reasoning: 1, total: 1 });
	});

	it("user abort (not the deadline) ⇒ aborted, no deadline hit", async () => {
		const { settled } = await run({ env: CAPS_ENV, budget: BUDGET, abortDuringRequest: true });
		expect(JSON.parse(lines(settled)[0]!)).toMatchObject({ suggestionOutcome: "aborted" });
		expect(suggestionSummary(settled)?.capHits).toEqual({ deadline: 0, cost: 0, reasoning: 0, total: 0 });
	});
});

describe("spec 103b §2.1: 0 bytes of raw text", () => {
	it("records hold no prompt, suggestion or error text; skip record keys are an allowed list", async () => {
		const shown = await run({ env: CAPS_ENV, budget: BUDGET });
		const skipped = await run({ env: CAPS_ENV, budget: { ...BUDGET, maxCostUsd: 0.000_000_1 } });
		const all = [...lines(shown.settled), ...lines(skipped.settled)].join("\n");
		for (const secret of [PROMPT, SUGGESTION, ERROR_TEXT, "SECRET"]) expect(all).not.toContain(secret);
		const skip = JSON.parse(lines(skipped.settled)[0]!) as Record<string, unknown>;
		const allowed = new Set([
			"schemaVersion",
			"sessionId",
			"turnIndex",
			"startedAtEpochMs",
			"endedAtEpochMs",
			"durationMs",
			"toolCalls",
			"toolCallCount",
			"toolFailureCount",
			"provider",
			"model",
			"purpose",
			"parentTurnIndex",
			"capsApplied",
			"suggestionSkip",
			"estimatedCostUsd",
			"maxCostUsd",
		]);
		for (const key of Object.keys(skip)) expect(allowed.has(key), key).toBe(true);
		for (const key of ["capsApplied", "reasoningCapped", "estimatedCostUsd", "maxCostUsd"]) {
			const value = { ...skip, ...JSON.parse(lines(shown.settled)[0]!) }[key];
			if (value !== undefined) expect(["boolean", "number"]).toContain(typeof value);
		}
	});
});

describe("spec 103b §3.8: parser", () => {
	const base = {
		schemaVersion: "omk-turn-metrics-2",
		sessionId: "s",
		turnIndex: 0,
		startedAtEpochMs: 1,
		endedAtEpochMs: 1,
		durationMs: 0,
		toolCalls: [],
		toolCallCount: 0,
		toolFailureCount: 0,
		purpose: "suggestion",
		capsApplied: true,
	};
	it("unknown suggestionSkip, non-true capsApplied, or text in number fields ⇒ malformed", () => {
		expect(parseTurnMetricRecord(JSON.stringify({ ...base, suggestionSkip: "over_cost_cap" }))).toBeDefined();
		expect(parseTurnMetricRecord(JSON.stringify({ ...base, suggestionSkip: "free text" }))).toBeUndefined();
		expect(parseTurnMetricRecord(JSON.stringify({ ...base, capsApplied: false }))).toBeUndefined();
		expect(parseTurnMetricRecord(JSON.stringify({ ...base, estimatedCostUsd: "0.5" }))).toBeUndefined();
		expect(parseTurnMetricRecord(JSON.stringify({ ...base, reasoningCapped: "yes" }))).toBeUndefined();
	});
	it("legacy v2 records (main golden) parse unchanged", () => {
		const golden = JSON.parse(
			readFileSync(join(import.meta.dirname, "fixtures", "spec103b", "flag-off-golden.json"), "utf8"),
		) as { turns: string };
		for (const line of golden.turns.trim().split("\n")) {
			expect(JSON.stringify(parseTurnMetricRecord(line))).toBe(line);
		}
	});
});
