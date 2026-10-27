/**
 * Accept-trace golden scenario: suggestions on, one turn, the suggestion is
 * shown, accepted with Tab, lightly edited and sent as the next prompt, then a
 * second suggestion is shown and dismissed by typing. Uses only APIs that exist
 * on main `7cd26ee5fa` (extra controller options are passed through untyped), so
 * the same scenario produced the committed flag-off golden bytes there.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StreamFn } from "omk-agent-core";
import { type AssistantMessage, type Context, getModel, type Model } from "omk-ai";
import { suggestionMetricsSettler } from "../../../src/core/next-suggestion-settlement.ts";
import { TurnMetricsSink } from "../../../src/core/turn-metrics.ts";
import {
	installNextSuggestions,
	type SuggestionEditorPort,
	type SuggestionSessionPort,
} from "../../../src/modes/interactive/next-suggestion-controller.ts";

export const SUGGESTION = "Run the SECRET-SUGGESTION parser tests.";
export const SENT = "Run the SECRET-SUGGESTION parser tests now.";
const anthropic = getModel("anthropic", "claude-sonnet-4-5")! as Model<"anthropic-messages">;

function assistant(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: anthropic.id,
		usage: {
			input: 10,
			output: 3,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 13,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.001 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

export interface ScenarioResult {
	readonly turns: string;
	readonly files: readonly string[];
	readonly editor: readonly string[];
	readonly mainRequests: readonly string[];
	readonly outcomes: string | undefined;
}

/**
 * `extraOptions(dir)` adds controller options (the accept trace); omit for the golden.
 * Caller fakes `Date`.
 */
export async function runAcceptScenario(
	env: NodeJS.ProcessEnv,
	extraOptions?: (metricsDir: string) => Record<string, unknown>,
): Promise<ScenarioResult> {
	const dir = mkdtempSync(join(tmpdir(), "omk-accept-golden-"));
	try {
		const metricsEnv = { ...env, OMK_TURN_METRICS_DIR: dir };
		const mainRequests: string[] = [];
		const listeners: Array<(e: { type: string; outcome?: string; message?: unknown }) => unknown> = [];
		const streamFn = ((_m: unknown, c: Context) => {
			const last = JSON.stringify(c.messages.at(-1));
			const forSuggestion = last.includes("[next-task suggestion]");
			if (!forSuggestion) mainRequests.push(JSON.stringify(c));
			return { result: async () => assistant(forSuggestion ? SUGGESTION : "Done.") };
		}) as unknown as StreamFn;
		const session = {
			agent: { streamFn, state: { messages: [] as unknown[] } },
			model: { provider: anthropic.provider, id: anthropic.id },
			subscribe: (l: (e: { type: string; outcome?: string; message?: unknown }) => unknown) => {
				listeners.push(l);
				return () => {};
			},
		};
		const emit = (e: { type: string; outcome?: string; message?: unknown }) => {
			for (const l of listeners) l(e);
		};
		let text = "";
		let placeholder = "base";
		const editorLog: string[] = [];
		const editor: SuggestionEditorPort = {
			getText: () => text,
			setText: (t) => {
				text = t;
			},
			setPlaceholder: (p) => {
				placeholder = p;
			},
			isShowingAutocomplete: () => false,
		};
		const controller = installNextSuggestions(session as unknown as SuggestionSessionPort, editor, "base", {
			env,
			isTab: (d: string) => d === "\t",
			quotaUsage: async () => "no_quota",
			settle: suggestionMetricsSettler(() => "golden", "/nonexistent", metricsEnv),
			...(extraOptions?.(dir) ?? {}),
		})!;
		const sink = new TurnMetricsSink({ dir });
		const key = (d: string) => {
			const consumed = editor.onBeforeInput?.(d) ?? false;
			if (!consumed && d.length === 1 && d >= " ") text += d;
			editorLog.push(`${consumed}|${text.length}|${placeholder === "base" ? "base" : "suggestion"}`);
		};
		const turn = async (prompt: string, index: number) => {
			emit({ type: "agent_start" });
			const user = { role: "user", content: [{ type: "text", text: prompt }], timestamp: 1 };
			emit({ type: "message_start", message: user });
			const context: Context = { systemPrompt: "s", messages: [user as Context["messages"][number]], tools: [] };
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
				stopReason: "stop",
			});
			await controller.onSettled("completed");
		};
		await turn("first", 0);
		key("\t"); // accept
		for (const c of " now") key(c);
		text = text.replace("tests. now", "tests now.");
		const sent = text;
		text = "";
		await turn(sent, 1);
		key("x"); // typed over the second suggestion
		controller.dispose();
		const outcomesPath = join(dir, "suggestion-outcomes.jsonl");
		const files = readdirSync(dir).sort();
		return {
			turns: readFileSync(sink.path, "utf8"),
			files,
			editor: editorLog,
			mainRequests,
			outcomes: files.includes("suggestion-outcomes.jsonl") ? readFileSync(outcomesPath, "utf8") : undefined,
		};
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}
