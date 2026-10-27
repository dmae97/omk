/**
 * Spec 103b golden scenario: a fixed session run with `OMK_NEXT_SUGGESTIONS=1`
 * and the caps flag off. Uses only APIs that exist on main `a0d6bfc9c0`, so the
 * same scenario produced the committed golden bytes there.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StreamFn } from "omk-agent-core";
import { type AssistantMessage, type Context, getModel, type Model } from "omk-ai";
import { suggestionMetricsSettler } from "../../../src/core/next-suggestion-settlement.ts";
import { summarizeTurnMetrics, TurnMetricsSink } from "../../../src/core/turn-metrics.ts";
import {
	installNextSuggestions,
	type SuggestionEditorPort,
	type SuggestionSessionPort,
} from "../../../src/modes/interactive/next-suggestion-controller.ts";

const anthropic = getModel("anthropic", "claude-sonnet-4-5")! as Model<"anthropic-messages">;

function assistant(text: string, timestamp: number, input: number, total: number): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: anthropic.id,
		usage: {
			input,
			output: 3,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: input + 3,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total },
		},
		stopReason: "stop",
		timestamp,
	};
}

/** Returns the `turns.jsonl` bytes and the JSON summary bytes. Caller fakes `Date`. */
export async function runGoldenScenario(env: NodeJS.ProcessEnv): Promise<{ turns: string; summary: string }> {
	const dir = mkdtempSync(join(tmpdir(), "omk-103b-golden-"));
	try {
		const metricsEnv = { ...env, OMK_TURN_METRICS_DIR: dir };
		// Large context: with caps on this would exceed the $0.02 cost cap (over_cost_cap).
		const big = "x".repeat(200_000);
		const contexts: Context[] = [
			{
				systemPrompt: "s",
				messages: [{ role: "user", content: [{ type: "text", text: "a" }], timestamp: 1 }],
				tools: [],
			},
			{
				systemPrompt: big,
				messages: [{ role: "user", content: [{ type: "text", text: "b" }], timestamp: 2 }],
				tools: [],
			},
		];
		const listeners: Array<(e: { type: string; outcome?: string }) => unknown> = [];
		const streamFn = ((_m: unknown, c: Context) => ({
			result: async () =>
				c.messages.length > 1
					? assistant("Next.", Date.now(), 7, 0.002)
					: assistant("Done.", Date.now(), 100, 0.05),
		})) as unknown as StreamFn;
		const session = {
			agent: { streamFn, state: { messages: [] as unknown[] } },
			model: { provider: anthropic.provider, id: anthropic.id },
			subscribe: (l: (e: { type: string; outcome?: string }) => unknown) => {
				listeners.push(l);
				return () => {};
			},
		};
		const emit = (e: { type: string; outcome?: string }) => {
			for (const l of listeners) l(e);
		};
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
			env,
			quotaUsage: async () => "no_quota",
			settle: suggestionMetricsSettler(() => "golden", "/nonexistent", metricsEnv),
		})!;
		const sink = new TurnMetricsSink({ dir });
		for (const [index, context] of contexts.entries()) {
			emit({ type: "agent_start" });
			const stream = await session.agent.streamFn(anthropic, context, { cacheRetention: "short" });
			const final = await stream.result();
			session.agent.state.messages = [...context.messages, final];
			emit({ type: "turn_end" });
			sink.record({
				sessionId: "golden",
				turnIndex: index,
				provider: anthropic.provider,
				model: anthropic.id,
				startedAtEpochMs: Date.now(),
				endedAtEpochMs: Date.now(),
				usage: { input: 100, output: 3, cacheRead: 0, cacheWrite: 0, costUsd: 0.05 },
				stopReason: "stop",
			});
			await controller.onSettled("completed");
		}
		// A plan skip: failed outcome (no request).
		await controller.onSettled("failed");
		controller.dispose();
		const turns = readFileSync(sink.path, "utf8");
		const summary = JSON.stringify(summarizeTurnMetrics(turns.split("\n")));
		return { turns, summary };
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}
