import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "omk-agent-core";
import { type AssistantMessage, type AssistantMessageEvent, type Context, EventStream, getModel } from "omk-ai";
import { TUI } from "omk-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VirtualTerminal } from "../../tui/test/virtual-terminal.ts";
import { AgentSession } from "../src/core/agent-session.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { type QuotaUsage, SUGGESTION_INSTRUCTION } from "../src/core/next-suggestion.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { CustomEditor } from "../src/modes/interactive/components/custom-editor.ts";
import {
	followActiveEditor,
	installNextSuggestions,
	type NextSuggestionController,
	type SuggestionEditorPort,
	type SuggestionSessionPort,
} from "../src/modes/interactive/next-suggestion-controller.ts";
import { getEditorTheme, initTheme } from "../src/modes/interactive/theme/theme.ts";
import { createTestResourceLoader } from "./utilities.ts";

const SUGGESTION = "Run the parser tests next.";
const ON = { OMK_NEXT_SUGGESTIONS: "1" };

class MockStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor() {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") return event.message;
				if (event.type === "error") return event.error;
				throw new Error("unexpected");
			},
		);
	}
}

function reply(text: string, stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-sonnet-4-5",
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
		...(stopReason === "error" ? { errorMessage: "boom" } : {}),
	};
}

function isSuggestionRequest(context: Context): boolean {
	return JSON.stringify(context.messages.at(-1) ?? null).includes(SUGGESTION_INSTRUCTION);
}

const serialize = (context: Context) =>
	JSON.stringify({ systemPrompt: context.systemPrompt, tools: context.tools, messages: context.messages });

const sessions: AgentSession[] = [];
const controllers: NextSuggestionController[] = [];
const dirs: string[] = [];
afterEach(() => {
	for (const c of controllers.splice(0)) c.dispose();
	for (const s of sessions.splice(0)) s.dispose();
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
	vi.restoreAllMocks();
});

function harness(
	cwd: string,
	options: { suggestionGate?: Promise<void>; mainStopReason?: AssistantMessage["stopReason"] } = {},
) {
	const main: string[] = [];
	const suggestion: Context[] = [];
	let calls = 0;
	const model = getModel("anthropic", "claude-sonnet-4-5")!;
	const agent = new Agent({
		getApiKey: () => "test-key",
		initialState: { model, systemPrompt: "Test", tools: [] },
		streamFn: (_model, context) => {
			calls++;
			const stream = new MockStream();
			const forSuggestion = isSuggestionRequest(context);
			if (forSuggestion) suggestion.push(context);
			else main.push(serialize(context));
			const send = () => {
				const msg = forSuggestion ? reply(SUGGESTION) : reply("Done.", options.mainStopReason ?? "stop");
				stream.push({ type: "start", partial: msg });
				if (msg.stopReason === "error") stream.push({ type: "error", reason: "error", error: msg });
				else stream.push({ type: "done", reason: "stop", message: msg });
			};
			if (forSuggestion && options.suggestionGate) void options.suggestionGate.then(send);
			else queueMicrotask(send);
			return stream;
		},
	});
	const settingsManager = SettingsManager.create(cwd, cwd);
	settingsManager.applyOverrides({ retry: { enabled: false } });
	const authStorage = AuthStorage.create(join(cwd, "auth.json"));
	authStorage.setRuntimeApiKey("anthropic", "test-key");
	const session = new AgentSession({
		agent,
		sessionManager: SessionManager.inMemory(),
		settingsManager,
		cwd,
		modelRegistry: ModelRegistry.create(authStorage, cwd),
		resourceLoader: createTestResourceLoader(),
	});
	sessions.push(session);
	return { session, main, suggestion, calls: () => calls };
}

function fakeEditor(autocomplete = false) {
	const state = { text: "", placeholder: "base" };
	const editor: SuggestionEditorPort & { state: typeof state } = {
		state,
		getText: () => state.text,
		setText: (text) => {
			state.text = text;
		},
		setPlaceholder: (text) => {
			state.placeholder = text;
		},
		isShowingAutocomplete: () => autocomplete,
	};
	return editor;
}

function install(session: AgentSession, editor: SuggestionEditorPort) {
	const controller = installNextSuggestions(session as unknown as SuggestionSessionPort, editor, "base", {
		env: ON,
		isTab: (data) => data === "\t",
		quotaUsage: async () => "no_quota" as const,
	});
	if (!controller) throw new Error("expected a controller");
	controllers.push(controller);
	return controller;
}

function tempCwd(): string {
	const dir = mkdtempSync(join(tmpdir(), "omk-091-"));
	dirs.push(dir);
	mkdirSync(join(dir, ".omk"), { recursive: true });
	return dir;
}

describe("spec 091 stage 1: next suggestions in a session", () => {
	it("flag off installs nothing: zero extra calls and unchanged stream function", async () => {
		const h = harness(tempCwd());
		const before = h.session.agent.streamFn;
		const controller = installNextSuggestions(h.session as unknown as SuggestionSessionPort, fakeEditor(), "base", {
			env: {},
		});
		expect(controller).toBeUndefined();
		expect(h.session.agent.streamFn).toBe(before);
		await h.session.prompt("first");
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(h.calls()).toBe(1);
		expect(h.suggestion).toHaveLength(0);
	});

	it("flag on with an unaccepted suggestion: next main request bytes equal flag off; nothing enters history", async () => {
		vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
		const cwd = tempCwd();

		const off = harness(cwd);
		await off.session.prompt("first");
		await off.session.prompt("second");

		const on = harness(cwd);
		const editor = fakeEditor();
		const controller = install(on.session, editor);
		await on.session.prompt("first");
		await vi.waitFor(() => expect(controller.suggestion).toBe(SUGGESTION));
		expect(editor.state.placeholder).toBe(SUGGESTION);
		await on.session.prompt("second");

		// One suggestion per completed turn; none of them reaches a main request.
		expect(on.suggestion.length).toBeGreaterThanOrEqual(1);
		expect(on.main).toEqual(off.main);
		expect(on.main).toHaveLength(2);
		// The suggestion request reuses the first main request as its exact prefix.
		const first = JSON.parse(on.main[0]!) as { messages: unknown[] };
		const req = on.suggestion[0]!;
		expect(JSON.stringify(req.messages.slice(0, first.messages.length))).toBe(JSON.stringify(first.messages));
		expect(req.messages).toHaveLength(first.messages.length + 2);
		// Never in session history, agent context (compaction input), or the next main request.
		const persisted = JSON.stringify(on.session.sessionManager.getEntries());
		const agentState = JSON.stringify(on.session.agent.state.messages);
		for (const text of [SUGGESTION, SUGGESTION_INSTRUCTION]) {
			expect(persisted).not.toContain(text);
			expect(agentState).not.toContain(text);
			expect(on.main[1]).not.toContain(text);
		}
	});

	it("skips at ≥90% quota usage with zero extra calls", async () => {
		const h = harness(tempCwd());
		const plans: string[] = [];
		const controller = installNextSuggestions(h.session as unknown as SuggestionSessionPort, fakeEditor(), "base", {
			env: ON,
			quotaUsage: async () => 90,
			onPlan: (plan) => plans.push(plan.kind === "skip" ? plan.reason : plan.kind),
		});
		controllers.push(controller!);
		await h.session.prompt("first");
		await vi.waitFor(() => expect(plans).toEqual(["near_usage_limit"]));
		expect(h.calls()).toBe(1);
	});

	function planRecorder(
		h: ReturnType<typeof harness>,
		quotaUsage: (() => Promise<QuotaUsage>) | undefined,
		extra = {},
	) {
		const plans: string[] = [];
		const controller = installNextSuggestions(h.session as unknown as SuggestionSessionPort, fakeEditor(), "base", {
			env: ON,
			quotaUsage,
			onPlan: (plan) => plans.push(plan.kind === "skip" ? plan.reason : plan.kind),
			...extra,
		});
		controllers.push(controller!);
		return plans;
	}

	it("fails closed when the quota check throws: suggestion skipped, zero extra calls", async () => {
		const h = harness(tempCwd());
		const plans = planRecorder(h, async () => {
			throw new Error("usage endpoint down");
		});
		await h.session.prompt("first");
		await vi.waitFor(() => expect(plans).toEqual(["usage_unavailable"]));
		expect(h.calls()).toBe(1);
	});

	it("fails closed when the quota check times out, without delaying the main turn", async () => {
		const h = harness(tempCwd());
		const plans = planRecorder(h, () => new Promise<never>(() => {}), { usageTimeoutMs: 30 });
		const started = performance.now();
		await h.session.prompt("first");
		expect(performance.now() - started).toBeLessThan(1000);
		await vi.waitFor(() => expect(plans).toEqual(["usage_unavailable"]));
		expect(h.calls()).toBe(1);
	});

	it("no quota source proceeds, while a failed or timed-out check skips", async () => {
		const noSource = harness(tempCwd());
		const noSourcePlans = planRecorder(noSource, async () => "no_quota" as const);
		await noSource.session.prompt("first");
		await vi.waitFor(() => expect(noSourcePlans).toEqual(["request"]));

		const failed = harness(tempCwd());
		const failedPlans = planRecorder(failed, async () => {
			throw new Error("down");
		});
		await failed.session.prompt("first");
		await vi.waitFor(() => expect(failedPlans).toEqual(["usage_unavailable"]));
		expect(failed.calls()).toBe(1);

		const slow = harness(tempCwd());
		const slowPlans = planRecorder(slow, () => new Promise<never>(() => {}), { usageTimeoutMs: 30 });
		await slow.session.prompt("first");
		await vi.waitFor(() => expect(slowPlans).toEqual(["usage_unavailable"]));
		expect(slow.calls()).toBe(1);
	});

	it("fails closed when no quota reader is wired", async () => {
		const h = harness(tempCwd());
		const plans = planRecorder(h, undefined);
		await h.session.prompt("first");
		await vi.waitFor(() => expect(plans).toEqual(["usage_unavailable"]));
		expect(h.calls()).toBe(1);
	});

	it("reads quota at most once per turn with the flag on, and never with the flag off", async () => {
		const on = harness(tempCwd());
		let reads = 0;
		const plans: string[] = [];
		controllers.push(
			installNextSuggestions(on.session as unknown as SuggestionSessionPort, fakeEditor(), "base", {
				env: ON,
				quotaUsage: async () => {
					reads++;
					return 10;
				},
				onPlan: (plan) => plans.push(plan.kind),
			})!,
		);
		await on.session.prompt("first");
		await vi.waitFor(() => expect(plans).toHaveLength(1));
		await on.session.prompt("second");
		await vi.waitFor(() => expect(plans).toHaveLength(2));
		expect(reads).toBe(2);

		const off = harness(tempCwd());
		let offReads = 0;
		const none = installNextSuggestions(off.session as unknown as SuggestionSessionPort, fakeEditor(), "base", {
			env: {},
			quotaUsage: async () => {
				offReads++;
				return 10;
			},
		});
		expect(none).toBeUndefined();
		await off.session.prompt("first");
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(offReads).toBe(0);
		expect(off.calls()).toBe(1);
	});

	it("does not read quota when cheap turn eligibility already rejects the suggestion", async () => {
		const h = harness(tempCwd(), { mainStopReason: "error" });
		let quotaReads = 0;
		const plans = planRecorder(h, async () => {
			quotaReads++;
			return "no_quota";
		});
		await h.session.prompt("first");
		await vi.waitFor(() => expect(plans).toEqual(["not_completed"]));
		expect(quotaReads).toBe(0);
		expect(h.calls()).toBe(1);
	});

	it("skips after a provider error with zero extra calls", async () => {
		const h = harness(tempCwd(), { mainStopReason: "error" });
		const plans: string[] = [];
		const controller = installNextSuggestions(h.session as unknown as SuggestionSessionPort, fakeEditor(), "base", {
			env: ON,
			quotaUsage: async () => "no_quota" as const,
			onPlan: (plan) => plans.push(plan.kind === "skip" ? plan.reason : plan.kind),
		});
		controllers.push(controller!);
		await h.session.prompt("first");
		await vi.waitFor(() => expect(plans).toHaveLength(1));
		expect(plans[0]).not.toBe("request");
		expect(h.suggestion).toHaveLength(0);
	});

	it("skips when the model changed since the main request", async () => {
		const h = harness(tempCwd());
		const plans: string[] = [];
		const port = {
			agent: h.session.agent,
			get model() {
				return { provider: "openai", id: "other" };
			},
			subscribe: (listener: never) => h.session.subscribe(listener),
		} as unknown as SuggestionSessionPort;
		const controller = installNextSuggestions(port, fakeEditor(), "base", {
			env: ON,
			quotaUsage: async () => "no_quota" as const,
			onPlan: (plan) => plans.push(plan.kind === "skip" ? plan.reason : plan.kind),
		});
		controllers.push(controller!);
		await h.session.prompt("first");
		await vi.waitFor(() => expect(plans).toEqual(["model_changed"]));
		expect(h.suggestion).toHaveLength(0);
	});

	it("discards a late suggestion when the user started typing", async () => {
		let release = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const h = harness(tempCwd(), { suggestionGate: gate });
		const editor = fakeEditor();
		const controller = install(h.session, editor);
		await h.session.prompt("first");
		await vi.waitFor(() => expect(h.suggestion).toHaveLength(1));
		expect(editor.onBeforeInput?.("a")).toBe(false);
		editor.state.text = "a";
		release();
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(controller.suggestion).toBeUndefined();
		expect(editor.state.placeholder).toBe("base");
	});

	it("discards a late suggestion when the next turn was sent", async () => {
		let release = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const h = harness(tempCwd(), { suggestionGate: gate });
		const editor = fakeEditor();
		const shownAt: number[] = [];
		const setPlaceholder = editor.setPlaceholder;
		editor.setPlaceholder = (text) => {
			if (text === SUGGESTION) shownAt.push(h.suggestion.length);
			setPlaceholder(text);
		};
		install(h.session, editor);
		await h.session.prompt("first");
		await vi.waitFor(() => expect(h.suggestion).toHaveLength(1));
		const started = new Promise<void>((resolve) => {
			const off = h.session.subscribe((event) => {
				if (event.type === "agent_start") {
					off();
					resolve();
				}
			});
		});
		const second = h.session.prompt("second");
		await started;
		release();
		await second;
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(h.main).toHaveLength(2);
		// The first (late) result was never shown; only the second turn's own suggestion may be.
		expect(shownAt.every((count) => count === 2)).toBe(true);
		expect(JSON.stringify(h.session.agent.state.messages)).not.toContain(SUGGESTION);
	});

	it("Tab inserts the suggestion into the empty editor without sending; other keys dismiss", async () => {
		const h = harness(tempCwd());
		const editor = fakeEditor();
		const controller = install(h.session, editor);
		await h.session.prompt("first");
		await vi.waitFor(() => expect(controller.suggestion).toBe(SUGGESTION));
		expect(editor.onBeforeInput?.("\t")).toBe(true);
		expect(editor.state.text).toBe(SUGGESTION);
		expect(editor.state.placeholder).toBe("base");
		expect(h.main).toHaveLength(1);

		// Submitting empties the editor before the turn runs, as the TUI does. Clearing it after
		// prompt() resolved raced the suggestion, which is discarded while the editor has text.
		editor.state.text = "";
		await h.session.prompt("second");
		await vi.waitFor(() => expect(controller.suggestion).toBe(SUGGESTION));
		expect(editor.onBeforeInput?.("x")).toBe(false);
		expect(controller.suggestion).toBeUndefined();
		expect(editor.state.placeholder).toBe("base");
		expect(editor.onBeforeInput?.("\t")).toBe(false);
	});

	it("Tab is left to autocomplete while the autocomplete list is showing", async () => {
		const h = harness(tempCwd());
		const editor = fakeEditor(true);
		const controller = install(h.session, editor);
		await h.session.prompt("first");
		await vi.waitFor(() => expect(controller.suggestion).toBe(SUGGESTION));
		expect(editor.onBeforeInput?.("\t")).toBe(false);
		expect(editor.state.text).toBe("");
	});

	it("dispose aborts pending work, blocks late UI updates, and permits clean reinstall", async () => {
		let release: (() => void) | undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const h = harness(tempCwd(), { suggestionGate: gate });
		const original = h.session.agent.streamFn;
		const editor = fakeEditor();
		const controller = install(h.session, editor);
		await h.session.prompt("first");
		await vi.waitFor(() => expect(h.suggestion).toHaveLength(1));

		controller.dispose();
		release?.();
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(controller.suggestion).toBeUndefined();
		expect(editor.state.placeholder).toBe("base");
		expect(editor.onBeforeInput).toBeUndefined();
		expect(h.session.agent.streamFn).toBe(original);

		const replacement = install(h.session, editor);
		expect(replacement).not.toBe(controller);
		replacement.dispose();
	});

	it("real CustomEditor: gray suggestion renders, Tab inserts, typing dismisses, Tab without suggestion is untouched", async () => {
		initTheme("dark");
		const ui = new TUI(new VirtualTerminal(80, 30));
		const editor = new CustomEditor(ui, getEditorTheme(), new KeybindingsManager());
		editor.setPlaceholder("base");
		const h = harness(tempCwd());
		const controller = install(h.session, editor);
		await h.session.prompt("first");
		await vi.waitFor(() => expect(controller.suggestion).toBe(SUGGESTION));
		expect(editor.render(80).join("\n")).toContain(SUGGESTION);
		editor.handleInput("\t");
		expect(editor.getText()).toBe(SUGGESTION);
		expect(h.main).toHaveLength(1);

		editor.setText("");
		await h.session.prompt("second");
		await vi.waitFor(() => expect(controller.suggestion).toBe(SUGGESTION));
		editor.handleInput("h");
		expect(editor.getText()).toBe("h");
		expect(controller.suggestion).toBeUndefined();
		expect(editor.render(80).join("\n")).not.toContain(SUGGESTION);

		controller.dispose();
		expect(editor.onBeforeInput).toBeUndefined();
		editor.setText("");
		editor.handleInput("\t");
		expect(editor.getText()).toBe("");
	});

	it("follows an extension's custom editor installed after setup: the suggestion renders and Tab inserts there", async () => {
		initTheme("dark");
		const ui = new TUI(new VirtualTerminal(80, 30));
		const keybindings = new KeybindingsManager();
		const defaultEditor = new CustomEditor(ui, getEditorTheme(), keybindings);
		defaultEditor.setPlaceholder("base");
		let active = defaultEditor;
		const h = harness(tempCwd());
		const controller = install(
			h.session,
			followActiveEditor(() => active, "base"),
		);
		// pi-powerline-footer swaps in its own editor at session start, after the controller exists.
		const custom = new CustomEditor(ui, getEditorTheme(), keybindings);
		active = custom;
		await h.session.prompt("first");
		await vi.waitFor(() => expect(controller.suggestion).toBe(SUGGESTION));
		expect(custom.render(80).join("\n")).toContain(SUGGESTION);
		expect(defaultEditor.render(80).join("\n")).not.toContain(SUGGESTION);
		custom.handleInput("\t");
		expect(custom.getText()).toBe(SUGGESTION);
		expect(defaultEditor.getText()).toBe("");
		expect(h.main).toHaveLength(1);

		// The extension removes its editor while a suggestion is visible: the shown one is cleared too.
		custom.setText("");
		await h.session.prompt("second");
		await vi.waitFor(() => expect(controller.suggestion).toBe(SUGGESTION));
		active = defaultEditor;
		controller.cancel();
		expect(custom.render(80).join("\n")).not.toContain(SUGGESTION);
		expect(defaultEditor.render(80).join("\n")).not.toContain(SUGGESTION);

		controller.dispose();
		expect(custom.onBeforeInput).toBeUndefined();
		expect(defaultEditor.onBeforeInput).toBeUndefined();
	});
});
