/**
 * Structured next-task suggestions: the host renders input → verification → evidence → result,
 * a local suggestion exists whether or not a model answers, stale state never reaches the editor,
 * and Tab hands the displayed prompt to the editor input path without sending anything.
 */
import type { StreamFn } from "omk-agent-core";
import { type AssistantMessage, type Context, getModel, type Model } from "omk-ai";
import { TUI } from "omk-tui";
import { afterEach, describe, expect, it } from "vitest";
import { VirtualTerminal } from "../../tui/test/virtual-terminal.ts";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { collectSuggestionFacts } from "../src/core/next-suggestion-facts.ts";
import {
	buildSuggestion,
	classifySituation,
	isWellFormedSuggestionPrompt,
	renderSuggestionPrompt,
	SUGGESTION_SECTION_ORDER,
	sanitizeModelTask,
	suggestionViolation,
} from "../src/core/next-suggestion-prompt.ts";
import { CustomEditor } from "../src/modes/interactive/components/custom-editor.ts";
import {
	installNextSuggestions,
	type NextSuggestionController,
	type NextSuggestionOptions,
	type SuggestionEditorPort,
	type SuggestionSessionPort,
} from "../src/modes/interactive/next-suggestion-controller.ts";
import { getEditorTheme, initTheme } from "../src/modes/interactive/theme/theme.ts";

const ON = { OMK_NEXT_SUGGESTIONS: "1", LANG: "en_US.UTF-8" };
const anthropic = getModel("anthropic", "claude-sonnet-4-5")! as Model<"anthropic-messages">;
const EN_HEADINGS = ["## Input", "## Verification", "## Evidence", "## Result"];
const KO_HEADINGS = ["## 입력", "## 검증", "## 증거", "## 결과"];

function assistant(text: string, stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: anthropic.id,
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: Date.now(),
		...(stopReason === "error" ? { errorMessage: "503 upstream unavailable" } : {}),
	};
}

const user = (text: string) => ({ role: "user", content: [{ type: "text", text }], timestamp: 1 });
const toolCall = (id: string, name: string, path: string) => ({
	...assistant(""),
	content: [{ type: "toolCall", id, name, arguments: { path } }],
});
const toolResult = (toolCallId: string, toolName: string, isError: boolean, text = "ok") => ({
	role: "toolResult",
	toolCallId,
	toolName,
	isError,
	content: [{ type: "text", text }],
	timestamp: 2,
});

function headingOrder(prompt: string, headings: readonly string[]): number[] {
	const lines = prompt.split("\n");
	return headings.map((heading) => lines.indexOf(heading));
}

const controllers: NextSuggestionController[] = [];
afterEach(() => {
	for (const controller of controllers.splice(0)) controller.dispose();
});

type SuggestionReply = () => Promise<AssistantMessage> | AssistantMessage;

/** Minimal session port: `turn()` runs one main request and settles it in front of the controller. */
function port(suggestionReply: SuggestionReply, options: Partial<NextSuggestionOptions> = {}) {
	const listeners: Array<(event: { type: string; outcome?: string }) => unknown> = [];
	const calls = { main: 0, suggestion: 0 };
	const streamFn = ((_model: unknown, context: Context) => {
		const forSuggestion = JSON.stringify(context.messages.at(-1)).includes("[next-task suggestion]");
		if (forSuggestion) calls.suggestion++;
		else calls.main++;
		return { result: async () => (forSuggestion ? suggestionReply() : assistant("Done.")) };
	}) as unknown as StreamFn;
	const state = { messages: [] as unknown[], isStreaming: false };
	const session = {
		agent: { streamFn, state },
		model: { provider: anthropic.provider, id: anthropic.id } as { provider: string; id: string } | undefined,
		subscribe: (listener: (event: { type: string; outcome?: string }) => unknown) => {
			listeners.push(listener);
			return () => {};
		},
	};
	const editorState = { text: "", placeholder: "base" };
	const editor: SuggestionEditorPort = {
		getText: () => editorState.text,
		setText: (text) => {
			editorState.text = text;
		},
		setPlaceholder: (text) => {
			editorState.placeholder = text;
		},
		isShowingAutocomplete: () => false,
	};
	const install = (): NextSuggestionController => {
		const controller = installNextSuggestions(session as unknown as SuggestionSessionPort, editor, "base", {
			env: ON,
			isTab: (data) => data === "\t",
			quotaUsage: async () => "no_quota",
			...options,
		});
		if (!controller) throw new Error("expected a controller");
		controllers.push(controller);
		return controller;
	};
	const emit = (event: { type: string; outcome?: string }) => {
		for (const listener of listeners) listener(event);
	};
	const turn = async (controller: NextSuggestionController, prompt: string, extra: unknown[] = []) => {
		emit({ type: "agent_start" });
		const message = user(prompt);
		const context: Context = { systemPrompt: "s", messages: [message as Context["messages"][number]], tools: [] };
		const stream = await session.agent.streamFn(anthropic, context, { cacheRetention: "short" });
		const final = await stream.result();
		state.messages = [message, ...extra, final];
		emit({ type: "turn_end" });
		await controller.onSettled("completed");
	};
	return { session, state, editor, editorState, calls, install, turn, emit };
}

describe("structured suggestion prompt: host contract", () => {
	it("renders the four sections in order with non-empty items, in both locales", () => {
		for (const [text, headings] of [
			["add a retry to the uploader", EN_HEADINGS],
			["업로더에 재시도를 추가해줘", KO_HEADINGS],
		] as const) {
			const facts = collectSuggestionFacts({ messages: [user(text), assistant("Done.")], outcome: "completed" });
			const suggestion = buildSuggestion(facts, sanitizeModelTask("Run the uploader tests next.", facts));
			const prompt = renderSuggestionPrompt(suggestion);
			expect(suggestionViolation(suggestion)).toBeUndefined();
			expect(isWellFormedSuggestionPrompt(prompt)).toBe(true);
			const order = headingOrder(prompt, headings);
			expect(order.every((index) => index > 0)).toBe(true);
			expect([...order].sort((a, b) => a - b)).toEqual(order);
			expect(prompt.split("\n")[0]).toBe("Run the uploader tests next.");
			for (const key of SUGGESTION_SECTION_ORDER) expect(suggestion.sections[key].length).toBeGreaterThanOrEqual(3);
		}
	});

	it("rejects a title-only card, an empty section, reordered sections and broken text", () => {
		const facts = collectSuggestionFacts({ messages: [], outcome: "idle", env: ON });
		const good = buildSuggestion(facts);
		expect(suggestionViolation({ ...good, title: "  " })).toBe("title");
		expect(suggestionViolation({ ...good, sections: { ...good.sections, evidence: [] } })).toBe("evidence");
		expect(suggestionViolation({ ...good, sections: { ...good.sections, result: [" "] } })).toBe("result");
		const prompt = renderSuggestionPrompt(good);
		expect(isWellFormedSuggestionPrompt(good.title)).toBe(false);
		expect(isWellFormedSuggestionPrompt(prompt.replace("## Evidence", "## Result"))).toBe(false);
		expect(isWellFormedSuggestionPrompt(prompt.replace(/## Verification[\s\S]*?(?=## Evidence)/, ""))).toBe(false);
		expect(isWellFormedSuggestionPrompt(`${prompt}\ntrailing garbage`)).toBe(false);
	});

	it("treats the model reply as external input", () => {
		const facts = collectSuggestionFacts({
			messages: [user("fix the parser"), assistant("ok")],
			outcome: "completed",
		});
		for (const bad of [
			undefined,
			"",
			"   ",
			'{"next":"x"}',
			"```json",
			"<tool>",
			"!!!",
			"ok",
			"[next-task suggestion] x",
		]) {
			expect(sanitizeModelTask(bad, facts), String(bad)).toBeUndefined();
		}
		// Repeating the request that just completed is not a next task.
		expect(sanitizeModelTask("Fix the parser", facts)).toBeUndefined();
		expect(sanitizeModelTask("  Run the\nparser tests.  ", facts)).toBe("Run the parser tests.");
	});

	it("classifies only what the transcript shows and never reports work as done", () => {
		const changed = collectSuggestionFacts({
			messages: [
				user("rename the helper"),
				toolCall("c1", "edit", "src/a.ts"),
				toolResult("c1", "edit", false),
				toolCall("c2", "write", "src/b.ts"),
				toolResult("c2", "write", true, "EACCES: permission denied"),
				toolCall("c3", "write", "src/b.ts"),
				toolResult("c3", "write", false),
				assistant("Renamed."),
			],
			outcome: "completed",
		});
		// The failed write was retried successfully: no unresolved failure, both paths changed.
		expect(changed.failedTools).toEqual([]);
		expect(changed.changedPaths).toEqual(["src/a.ts", "src/b.ts"]);
		expect(classifySituation(changed)).toBe("verify");
		const verify = renderSuggestionPrompt(buildSuggestion(changed));
		expect(verify.split("\n")[0]).toBe("Verify the change: src/a.ts and 1 more");
		expect(verify).toContain("no check had run when this suggestion was built");
		// The result section states what is expected, never that it happened.
		expect(buildSuggestion(changed).sections.result.map((item) => item.split(":")[0])).toEqual([
			"Expected deliverable",
			"Completion condition",
			"Final report",
		]);
		expect(verify).not.toMatch(/\b(was|were|has been|have been) (verified|fixed|completed|tested)\b/i);

		const failing = collectSuggestionFacts({
			messages: [
				user("run the build"),
				toolResult("b1", "bash", true, "\nerror TS2304: Cannot find name 'x'\nmore"),
				assistant("It failed."),
			],
			outcome: "completed",
		});
		expect(classifySituation(failing)).toBe("diagnose");
		expect(failing.failure).toBe("error TS2304: Cannot find name 'x'");
		expect(renderSuggestionPrompt(buildSuggestion(failing))).toContain("failed tools bash");

		const answered = collectSuggestionFacts({
			messages: [user("what does x do"), assistant("It does y.")],
			outcome: "completed",
		});
		expect(classifySituation(answered)).toBe("continue");
		expect(classifySituation(collectSuggestionFacts({ messages: [], outcome: "idle" }))).toBe("clarify");
		expect(classifySituation({ ...answered, outcome: "failed" })).toBe("reconnect");
		const blocked = buildSuggestion({ ...answered, modelMissing: true }, "Run the tests next.");
		expect(blocked).toMatchObject({ situation: "blocked", executable: false, source: "local" });
		expect(blocked.blockedReason).toContain("No model is selected or its provider is not authenticated");
		expect(blocked.title).toBe("Blocked: no usable model");
	});
});

describe("structured suggestions in the controller", () => {
	it("shows an honest local suggestion before any turn, with zero provider calls", () => {
		const p = port(() => assistant("unused"));
		const controller = p.install();
		expect(controller.title).toBe("Confirm the task goal and target scope");
		expect(p.editorState.placeholder).toBe(controller.suggestion);
		expect(isWellFormedSuggestionPrompt(p.editorState.placeholder)).toBe(true);
		expect(p.editorState.placeholder).toContain("Unconfirmed: goal, target paths, completion criteria");
		expect(p.calls).toEqual({ main: 0, suggestion: 0 });
	});

	it("replaces the local suggestion with a validated model sentence, keeping the host layout", async () => {
		const p = port(() => assistant("Run the uploader tests next."));
		const controller = p.install();
		await p.turn(controller, "add a retry to the uploader", [
			toolCall("c1", "edit", "src/upload.ts"),
			toolResult("c1", "edit", false),
		]);
		expect(controller.title).toBe("Run the uploader tests next.");
		const prompt = controller.suggestion ?? "";
		expect(headingOrder(prompt, EN_HEADINGS).every((index) => index > 0)).toBe(true);
		expect(prompt).toContain("- Scope: src/upload.ts");
		expect(prompt).toContain("- Inferred: the problem is the model's proposed next request");
		expect(p.calls.suggestion).toBe(1);
	});

	it.each([
		["empty reply", () => assistant(""), "empty"],
		["whitespace reply", () => assistant("  \n  "), "empty"],
		["malformed structure", () => assistant('{"suggestion": 1}'), "invalid_output"],
		["provider error result", () => assistant("", "error"), "error"],
		[
			"provider throws",
			() => {
				throw new Error("ECONNREFUSED");
			},
			"error",
		],
	] as const)(
		"keeps a complete local suggestion on %s, with one request and no retry",
		async (_name, reply, reason) => {
			const p = port(reply);
			const controller = p.install();
			await p.turn(controller, "add a retry to the uploader", [
				toolCall("c1", "edit", "src/upload.ts"),
				toolResult("c1", "edit", false),
			]);
			expect(controller.title).toBe("Verify the change: src/upload.ts");
			expect(isWellFormedSuggestionPrompt(controller.suggestion ?? "")).toBe(true);
			expect(p.editorState.placeholder).toBe(controller.suggestion);
			expect(controller.suggestion).toContain(`(no model input: ${reason})`);
			expect(p.calls.suggestion).toBe(1);
		},
	);

	it("falls back at the existing deadline instead of waiting on a hung provider", async () => {
		const p = port(() => new Promise<AssistantMessage>(() => {}), {
			env: { ...ON, OMK_NEXT_SUGGESTIONS_CAPS: "1" },
			budget: { maxReasoning: "inherit", deadlineMs: 5, maxCostUsd: 1 },
		});
		const controller = p.install();
		const streamFn = p.session.agent.streamFn;
		// The provider only settles when its signal aborts, as a real stream does.
		p.session.agent.streamFn = ((...[model, context, streamOptions]: Parameters<StreamFn>) => {
			const inner = streamFn(model, context, streamOptions) as unknown as {
				result: () => Promise<AssistantMessage>;
			};
			if (!JSON.stringify(context.messages.at(-1)).includes("[next-task suggestion]")) return inner;
			return {
				result: () =>
					new Promise<AssistantMessage>((resolve) =>
						streamOptions?.signal?.addEventListener("abort", () => resolve(assistant("", "aborted"))),
					),
			};
		}) as unknown as StreamFn;
		controller.dispose();
		const fresh = p.install();
		await p.turn(fresh, "add a retry to the uploader");
		expect(fresh.title).toBe("Review what the last answer left unconfirmed");
		expect(fresh.suggestion).toContain("(no model input: timeout)");
	});

	it("offline or quota-unknown: no request is sent and the local suggestion says why", async () => {
		const p = port(() => assistant("unused"), {
			quotaUsage: async () => {
				throw new Error("offline");
			},
		});
		const controller = p.install();
		await p.turn(controller, "add a retry to the uploader");
		expect(p.calls.suggestion).toBe(0);
		expect(controller.suggestion).toContain("(no model input: usage_unavailable)");
		expect(isWellFormedSuggestionPrompt(controller.suggestion ?? "")).toBe(true);
	});

	it("a failed turn proposes the provider check; an aborted turn stays empty", async () => {
		const p = port(() => assistant("unused"));
		const controller = p.install();
		p.emit({ type: "agent_start" });
		p.state.messages = [user("add a retry"), assistant("", "error")];
		await controller.onSettled("failed");
		expect(controller.title).toBe("Check the provider failure and run local checks");
		expect(controller.suggestion).toContain('error "503 upstream unavailable"');
		expect(p.calls.suggestion).toBe(0);

		p.emit({ type: "agent_start" });
		p.state.messages = [user("add a retry"), assistant("", "aborted")];
		await controller.onSettled("aborted");
		expect(controller.suggestion).toBeUndefined();
		expect(p.editorState.placeholder).toBe("base");
	});

	it("a dismissed suggestion is not revived by a late model reply", async () => {
		let release: (message: AssistantMessage) => void = () => {};
		const p = port(
			() =>
				new Promise<AssistantMessage>((resolve) => {
					release = resolve;
				}),
		);
		const controller = p.install();
		const settled = p.turn(controller, "add a retry to the uploader");
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(controller.title).toBe("Review what the last answer left unconfirmed");
		expect(p.editor.onBeforeInput?.("\x1b")).toBe(false);
		expect(controller.suggestion).toBeUndefined();
		release(assistant("Run the uploader tests next."));
		await settled;
		expect(controller.suggestion).toBeUndefined();
		expect(p.editorState.placeholder).toBe("base");
	});

	it("Tab drops a suggestion whose session state changed since it was shown", async () => {
		const p = port(() => assistant("Run the uploader tests next."));
		const controller = p.install();
		await p.turn(controller, "add a retry to the uploader");
		expect(controller.title).toBe("Run the uploader tests next.");
		// Compaction or tree navigation replaces the transcript without starting a turn.
		p.state.messages = [user("a different branch"), assistant("Other.")];
		expect(p.editor.onBeforeInput?.("\t")).toBe(false);
		expect(p.editorState.text).toBe("");
		expect(controller.suggestion).toBeUndefined();

		await p.turn(controller, "add a retry to the uploader");
		p.session.model = { provider: "openai", id: "other" };
		expect(p.editor.onBeforeInput?.("\t")).toBe(false);
		expect(p.editorState.text).toBe("");
	});

	it("no model: the suggestion names the block and accepting it sends nothing", async () => {
		const p = port(() => assistant("unused"));
		p.session.model = undefined;
		const controller = p.install();
		expect(controller.title).toBe("Blocked: no usable model");
		expect(controller.suggestion).toContain("select a model with /model or authenticate with /login");
		const prompt = controller.suggestion;
		expect(p.editor.onBeforeInput?.("\t")).toBe(true);
		expect(p.editorState.text).toBe(prompt);
		expect(p.calls).toEqual({ main: 0, suggestion: 0 });
	});

	it("a default model without credentials is blocked, and logging in makes that suggestion stale", () => {
		let authenticated = false;
		const p = port(() => assistant("unused"), { modelUsable: () => authenticated });
		const controller = p.install();
		expect(controller.title).toBe("Blocked: no usable model");
		authenticated = true;
		expect(p.editor.onBeforeInput?.("\t")).toBe(false);
		expect(p.editorState.text).toBe("");
		expect(controller.suggestion).toBeUndefined();
	});

	it("real editor: the rendered prompt is what Tab inserts and what submit delivers; nothing is sent by Tab", async () => {
		initTheme("dark");
		const ui = new TUI(new VirtualTerminal(100, 60));
		const editor = new CustomEditor(ui, getEditorTheme(), new KeybindingsManager());
		editor.setPlaceholder("base");
		const p = port(() => assistant("Run the uploader tests next."));
		const controller = installNextSuggestions(p.session as unknown as SuggestionSessionPort, editor, "base", {
			env: ON,
			quotaUsage: async () => "no_quota",
		});
		if (!controller) throw new Error("expected a controller");
		controllers.push(controller);
		await p.turn(controller, "add a retry to the uploader");
		const prompt = controller.suggestion ?? "";
		const rendered = editor
			.render(100)
			.join("\n")
			.replace(/\u001b\[[0-9;]*m|\u001b_[^\u0007]*\u0007/g, "");
		const renderedLines = rendered.split("\n").map((line) => line.trim());
		for (const heading of EN_HEADINGS) expect(renderedLines).toContain(heading);
		expect(renderedLines.indexOf("## Input")).toBeLessThan(renderedLines.indexOf("## Verification"));
		expect(renderedLines.indexOf("## Evidence")).toBeLessThan(renderedLines.indexOf("## Result"));
		// Every prompt line is on screen (wrapped rows joined back), so display and delivery match.
		const flat = renderedLines.join(" ").replace(/\s+/g, " ");
		for (const line of prompt.split("\n")) expect(flat).toContain(line.replace(/\s+/g, " "));

		const submitted: string[] = [];
		editor.onSubmit = (text) => submitted.push(text);
		editor.handleInput("\t");
		expect(editor.getText()).toBe(prompt);
		expect(submitted).toEqual([]);
		expect(p.calls.main).toBe(1);
		editor.handleInput("\r");
		expect(submitted).toEqual([prompt]);
	});
});
