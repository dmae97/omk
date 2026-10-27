/**
 * Fake-model latency for next-task suggestions: turn end (`prompt_settled`) to
 * suggestion shown, read back from accept-trace records. Free and local.
 *
 *   npx tsx scripts/next-suggestion-latency.ts [runs=200] [modelDelayMs=0] [quotaDelayMs=0]
 *
 * With both delays at 0 this is the harness overhead alone; a real model adds
 * its own time to first token and generation on top.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StreamFn } from "omk-agent-core";
import { type AssistantMessage, getModel, type Model } from "omk-ai";
import { type SuggestionOutcomeRecord, suggestionAcceptTracker } from "../src/core/next-suggestion-accept-trace.ts";
import {
	installNextSuggestions,
	type SuggestionEditorPort,
	type SuggestionSessionPort,
} from "../src/modes/interactive/next-suggestion-controller.ts";

const [runs = 200, modelDelayMs = 0, quotaDelayMs = 0] = process.argv.slice(2).map(Number);
const model = getModel("anthropic", "claude-sonnet-4-5")! as Model<"anthropic-messages">;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const reply = (text: string): AssistantMessage => ({
	role: "assistant",
	content: [{ type: "text", text }],
	api: "anthropic-messages",
	provider: "anthropic",
	model: model.id,
	usage: {
		input: 1,
		output: 1,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 2,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	},
	stopReason: "stop",
	timestamp: Date.now(),
});

const dir = mkdtempSync(join(tmpdir(), "omk-suggest-latency-"));
const env = { OMK_NEXT_SUGGESTIONS: "1", OMK_NEXT_SUGGESTIONS_ACCEPT_TRACE: "1", OMK_TURN_METRICS_DIR: dir };
const streamFn = ((_m: unknown, c: { messages: unknown[] }) => ({
	result: async () => {
		if (c.messages.length > 1 && modelDelayMs > 0) await sleep(modelDelayMs);
		return reply(c.messages.length > 1 ? "Next step." : "Done.");
	},
})) as unknown as StreamFn;
const listeners: Array<(e: { type: string }) => unknown> = [];
const session = {
	agent: { streamFn, state: { messages: [] as unknown[] } },
	model: { provider: model.provider, id: model.id },
	subscribe: (l: (e: { type: string }) => unknown) => {
		listeners.push(l);
		return () => {};
	},
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
	quotaUsage: async () => {
		if (quotaDelayMs > 0) await sleep(quotaDelayMs);
		return "no_quota";
	},
	acceptTrace: suggestionAcceptTracker(() => "latency", dir, env, dir),
})!;
const ctx = { systemPrompt: "s", messages: [{ role: "user" as const, content: "go", timestamp: 1 }], tools: [] };
for (let i = 0; i < runs; i++) {
	for (const l of listeners) l({ type: "agent_start" });
	const final = await (await session.agent.streamFn(model, ctx, { cacheRetention: "short" })).result();
	session.agent.state.messages = [...ctx.messages, final];
	await controller.onSettled("completed");
}
controller.dispose();
const records = readFileSync(join(dir, "suggestion-outcomes.jsonl"), "utf8")
	.split("\n")
	.filter(Boolean)
	.map((l) => JSON.parse(l) as SuggestionOutcomeRecord);
rmSync(dir, { recursive: true, force: true });
const pct = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.ceil((p / 100) * xs.length) - 1)]!;
const shown = records.map((r) => r.shownAtEpochMs - r.settledAtEpochMs).sort((a, b) => a - b);
const quota = records.map((r) => r.quotaCheckedAtEpochMs - r.settledAtEpochMs).sort((a, b) => a - b);
console.log(
	JSON.stringify({
		runs,
		modelDelayMs,
		quotaDelayMs,
		shown: records.length,
		turnEndToShownMs: { p50: pct(shown, 50), p95: pct(shown, 95), max: shown.at(-1) },
		turnEndToQuotaCheckedMs: { p50: pct(quota, 50), p95: pct(quota, 95) },
	}),
);
