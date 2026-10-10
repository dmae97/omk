import { type Context, type FauxResponseFactory, fauxAssistantMessage } from "omk-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { createHarness, getMessageText, type Harness } from "./suite/harness.ts";

// Text the user typed while compaction ran sits in the TUI's compaction queue. The real handleEvent and
// flushCompactionQueue must hand it to the session once compaction ends, for auto and manual compaction,
// instead of failing and putting it back in the editor queue.

const TYPED = "typed during compaction";
type Queued = { text: string; mode: "steer" | "followUp" };

const harnesses: Harness[] = [];
afterEach(() => {
	while (harnesses.length > 0) harnesses.pop()?.cleanup();
});

function seedClosedTranscript(harness: Harness): void {
	const now = Date.now();
	for (let index = 0; index < 2; index += 1) {
		harness.sessionManager.appendMessage({ role: "user", content: `user-${index}`, timestamp: now + index * 2 });
		harness.sessionManager.appendMessage({
			...fauxAssistantMessage(`assistant-${index}`),
			timestamp: now + index * 2 + 1,
		});
	}
	harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
}

/** The InteractiveMode fields the compaction_end branch and the queue flush use, around a real session. */
function tuiFor(harness: Harness) {
	const handleEvent = Reflect.get(InteractiveMode.prototype, "handleEvent") as (
		this: unknown,
		event: unknown,
	) => Promise<void>;
	const flush = Reflect.get(InteractiveMode.prototype, "flushCompactionQueue") as (
		this: unknown,
		options?: { readonly willRetry?: boolean },
	) => Promise<void>;
	const tui = {
		isInitialized: true,
		footer: { invalidate: vi.fn() },
		autoCompactionEscapeHandler: undefined,
		autoCompactionLoader: undefined,
		defaultEditor: {},
		statusContainer: { clear: vi.fn() },
		chatContainer: { clear: vi.fn(), addChild: vi.fn() },
		rebuildChatFromMessages: vi.fn(),
		addMessageToChat: vi.fn(),
		showError: vi.fn(),
		showStatus: vi.fn(),
		settingsManager: { getShowTerminalProgress: () => false },
		ui: { requestRender: vi.fn(), terminal: { setProgress: vi.fn() } },
		compactionQueuedMessages: [] as Queued[],
		updatePendingMessagesDisplay: vi.fn(),
		isExtensionCommand: () => false,
		session: harness.session,
		flushCompactionQueue(options?: { readonly willRetry?: boolean }) {
			return flush.call(tui, options);
		},
	};
	harness.session.subscribe((event) => {
		if (event.type === "compaction_end") void handleEvent.call(tui, event);
	});
	return tui;
}

/** Faux model: the first summary call runs `onSummary`; the first ordinary turn runs `onFirstTurn`. */
function script(harness: Harness, onSummary: () => void, onFirstTurn: () => void = () => {}) {
	const calls: string[] = [];
	const respond: FauxResponseFactory = (context: Context) => {
		if (context.systemPrompt?.startsWith("You are a context summarization assistant")) {
			if (!calls.includes("summary")) onSummary();
			calls.push("summary");
			return fauxAssistantMessage("summary-of-earlier-work");
		}
		const typed = context.messages.some((m) => getMessageText(m).includes(TYPED));
		if (!calls.includes("turn") && !typed) onFirstTurn();
		calls.push(typed ? "typed turn" : "turn");
		return fauxAssistantMessage(typed ? "answered the typed message" : "turn done");
	};
	harness.setResponses(Array.from({ length: 8 }, () => respond));
	return calls;
}

async function seededTui() {
	const harness = await createHarness({ settings: { compaction: { keepRecentTokens: 1 } } });
	harnesses.push(harness);
	seedClosedTranscript(harness);
	return { harness, tui: tuiFor(harness) };
}

describe("TUI compaction queue flush", () => {
	it.each(["followUp", "steer"] as const)("delivers %s text typed during post-run auto-compaction", async (mode) => {
		const { harness, tui } = await seededTui();
		let compactNext = false;
		const runtime = harness.session as unknown as { _runtimeCompactionDecision(): unknown };
		vi.spyOn(runtime, "_runtimeCompactionDecision").mockImplementation(() => {
			const compact = compactNext;
			compactNext = false;
			return { compact, emergency: false };
		});
		const calls = script(
			harness,
			() => tui.compactionQueuedMessages.push({ text: TYPED, mode }),
			() => {
				compactNext = true;
			},
		);

		await harness.session.prompt("start");
		await vi.waitFor(() => expect(calls).toContain("typed turn"), { timeout: 3000 });

		expect(tui.showError).not.toHaveBeenCalled();
		expect(tui.compactionQueuedMessages).toEqual([]);
		expect(calls.filter((c) => c === "typed turn")).toHaveLength(1);
	});

	it("delivers text typed during pre-prompt auto-compaction as a follow-up of that prompt", async () => {
		const { harness, tui } = await seededTui();
		let compactNext = true;
		const runtime = harness.session as unknown as { _runtimeCompactionDecision(): unknown };
		vi.spyOn(runtime, "_runtimeCompactionDecision").mockImplementation(() => {
			const compact = compactNext;
			compactNext = false;
			return { compact, emergency: false };
		});
		const calls = script(harness, () => tui.compactionQueuedMessages.push({ text: TYPED, mode: "followUp" }));

		await harness.session.prompt("start");

		expect(tui.showError).not.toHaveBeenCalled();
		expect(tui.compactionQueuedMessages).toEqual([]);
		expect(calls.filter((c) => c !== "summary")).toEqual(["turn", "typed turn"]);
	});

	it("keeps the order of several texts typed during pre-prompt auto-compaction", async () => {
		const { harness, tui } = await seededTui();
		let compactNext = true;
		const runtime = harness.session as unknown as { _runtimeCompactionDecision(): unknown };
		vi.spyOn(runtime, "_runtimeCompactionDecision").mockImplementation(() => {
			const compact = compactNext;
			compactNext = false;
			return { compact, emergency: false };
		});
		const lastUserTexts: string[] = [];
		let queued = false;
		harness.setResponses(
			Array.from({ length: 8 }, () => (context: Context) => {
				if (context.systemPrompt?.startsWith("You are a context summarization assistant")) {
					if (!queued) {
						queued = true;
						tui.compactionQueuedMessages.push(
							{ text: "first typed", mode: "followUp" },
							{ text: "second typed", mode: "followUp" },
						);
					}
					return fauxAssistantMessage("summary-of-earlier-work");
				}
				const users = context.messages.filter((m) => m.role === "user").map((m) => getMessageText(m));
				lastUserTexts.push(users.at(-1) ?? "");
				return fauxAssistantMessage("ok");
			}),
		);

		await harness.session.prompt("start");

		expect(tui.showError).not.toHaveBeenCalled();
		expect(lastUserTexts).toEqual(["start", "first typed", "second typed"]);
	});

	it("delivers text typed during a pre-prompt compaction that will resume, even when that prompt then fails", async () => {
		const { harness, tui } = await seededTui();
		// The last turn did not end cleanly, so the pre-prompt compaction reports willRetry (it will resume).
		harness.sessionManager.appendMessage({
			...fauxAssistantMessage("cut off", { stopReason: "length" }),
			timestamp: Date.now(),
		});
		harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
		let compactNext = true;
		const runtime = harness.session as unknown as { _runtimeCompactionDecision(): unknown };
		vi.spyOn(runtime, "_runtimeCompactionDecision").mockImplementation(() => {
			const compact = compactNext;
			compactNext = false;
			return { compact, emergency: false };
		});
		const admission = (harness.session as unknown as { _turnAdmission: { admit(...args: unknown[]): Promise<void> } })
			._turnAdmission;
		const realAdmit = admission.admit.bind(admission);
		let refused = false;
		vi.spyOn(admission, "admit").mockImplementation(async (...args: unknown[]) => {
			if (!refused) {
				refused = true;
				throw new Error("admission refused");
			}
			return realAdmit(...args);
		});
		const ends: boolean[] = [];
		harness.session.subscribe((event) => {
			if (event.type === "compaction_end") ends.push(event.willRetry);
		});
		const calls = script(harness, () => tui.compactionQueuedMessages.push({ text: TYPED, mode: "followUp" }));

		await harness.session.prompt("start").catch(() => undefined);
		await vi.waitFor(() => expect(calls).toContain("typed turn"), { timeout: 3000 });

		expect(ends).toEqual([true]);
		expect(tui.showError).not.toHaveBeenCalled();
		expect(harness.session.agent.hasQueuedMessages()).toBe(false);
	});

	it("delivers text typed during manual /compact", async () => {
		const { harness, tui } = await seededTui();
		const calls = script(harness, () => tui.compactionQueuedMessages.push({ text: TYPED, mode: "followUp" }));

		await harness.session.compact();
		await vi.waitFor(() => expect(calls).toContain("typed turn"), { timeout: 3000 });

		expect(tui.showError).not.toHaveBeenCalled();
		expect(tui.compactionQueuedMessages).toEqual([]);
		expect(harness.session.messages.some((m) => getMessageText(m).includes("answered the typed message"))).toBe(true);
	});
});
