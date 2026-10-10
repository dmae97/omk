import type { AgentTool } from "omk-agent-core";
import { type Context, type FauxResponseFactory, fauxAssistantMessage, fauxToolCall } from "omk-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSession } from "../src/core/agent-session.ts";
import { PromptExecutionBusyError } from "../src/core/session-prompt-lifecycle.ts";
import { createHarness, getMessageText, type Harness, type HarnessOptions } from "./suite/harness.ts";

// A turn-starting message that lands while the session is busy without an agent loop to drain the queue
// (manual /compact, branch summary, the gap before a retry, late tool settlement, prompt preflight, the
// resource probe) must reach the agent once, after that work, on the current context: never dropped and
// never run as a hidden competing turn on stale context.

const WAKE = "background task finished";
const SUMMARY = "summary-of-earlier-work";
type Send = (session: AgentSession) => Promise<void>;
const notify: Send = (session) =>
	session.sendCustomMessage(
		{ customType: "task-done", content: WAKE, display: true, details: {} },
		{ triggerTurn: true, deliverAs: "followUp" },
	);
const followUp: Send = (session) => session.sendUserMessage(WAKE, { deliverAs: "followUp" });

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

const isSummaryCall = (context: Context) =>
	context.systemPrompt?.startsWith("You are a context summarization assistant");
const sawText = (context: Context, text: string) => context.messages.some((m) => getMessageText(m).includes(text));

/** Scripted faux model: records each call; `first` answers the first non-summary call (tool call, error, ...). */
function script(harness: Harness, first?: () => ReturnType<FauxResponseFactory>) {
	const calls: string[] = [];
	let wakeSawSummary = false;
	let firstUsed = first === undefined;
	const respond: FauxResponseFactory = (context, options, state, model) => {
		if (isSummaryCall(context)) {
			calls.push("summary");
			return fauxAssistantMessage(SUMMARY);
		}
		if (!firstUsed) {
			firstUsed = true;
			calls.push("first");
			return (first as () => ReturnType<FauxResponseFactory>)();
		}
		const wake = sawText(context, WAKE);
		if (wake) wakeSawSummary = sawText(context, SUMMARY);
		calls.push(wake ? "wake turn" : "turn");
		void options;
		void state;
		void model;
		return fauxAssistantMessage(wake ? "handled the background result" : "turn done");
	};
	harness.setResponses(Array.from({ length: 8 }, () => respond));
	return { calls, wakeSawSummary: () => wakeSawSummary };
}

async function harnessWith(options: HarnessOptions = {}): Promise<Harness> {
	const harness = await createHarness({
		...options,
		settings: { compaction: { keepRecentTokens: 1 }, retry: { enabled: false }, ...options.settings },
	});
	harnesses.push(harness);
	return harness;
}

function capture(send: Send, session: AgentSession): Promise<unknown> {
	return send(session).then(
		() => "delivered",
		(error: unknown) => error,
	);
}

async function expectWokeOnce(harness: Harness, calls: string[]): Promise<void> {
	await vi.waitFor(() => expect(calls.filter((c) => c === "wake turn")).toHaveLength(1), { timeout: 3000 });
	await vi.waitFor(() => expect(harness.session.runJournalRecords.at(-1)?.event).toBe("run_finished"), {
		timeout: 3000,
	});
	expect(harness.session.isStreaming).toBe(false);
	expect(harness.session.isCompacting).toBe(false);
}

describe("turn-starting input while the session is busy without an agent loop", () => {
	it("delivers a triggerTurn message from manual /compact after the commit, on the compacted context", async () => {
		const harness = await harnessWith();
		seedClosedTranscript(harness);
		const { calls, wakeSawSummary } = script(harness);
		let delivery: Promise<unknown> | undefined;
		harness.session.subscribe((event) => {
			if (event.type === "compaction_start") delivery ??= capture(notify, harness.session);
		});

		await harness.session.compact();
		await expectWokeOnce(harness, calls);

		expect(await delivery).toBe("delivered");
		expect(calls.filter((c) => c !== "summary")).toEqual(["wake turn"]);
		expect(wakeSawSummary()).toBe(true);
		const custom = harness.sessionManager.getEntries().filter((e) => e.type === "custom_message");
		expect(custom).toHaveLength(1);
	});

	it("delivers a triggerTurn message from a branch summary on the branch it navigated to", async () => {
		const harness = await harnessWith();
		seedClosedTranscript(harness);
		const firstUser = harness.sessionManager
			.getEntries()
			.find((e) => e.type === "message" && e.message.role === "user" && getMessageText(e.message) === "user-1");
		if (!firstUser) throw new Error("expected seeded user entry");
		const { calls, wakeSawSummary } = script(harness);
		let delivery: Promise<unknown> | undefined;
		const realStream = harness.session.agent.streamFn;
		harness.session.agent.streamFn = (model, context, options) => {
			if (isSummaryCall(context)) delivery ??= capture(notify, harness.session);
			return realStream(model, context, options);
		};

		await harness.session.navigateTree(firstUser.id, { summarize: true });
		await expectWokeOnce(harness, calls);

		expect(await delivery).toBe("delivered");
		expect(wakeSawSummary()).toBe(true);
		const branch = harness.sessionManager.buildSessionContext().messages;
		expect(branch.some((m) => getMessageText(m).includes(WAKE))).toBe(true);
	});

	it.each([
		["sendCustomMessage(triggerTurn)", notify],
		["sendUserMessage(followUp)", followUp],
	] as const)("delivers %s that lands while a retry switches routes", async (_name, send) => {
		const harness = await harnessWith({ settings: { retry: { enabled: true, maxRetries: 2, baseDelayMs: 1 } } });
		const { calls } = script(harness, () =>
			fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" }),
		);
		let delivery: Promise<unknown> | undefined;
		const runtime = harness.session as unknown as {
			_maybeFailoverFromSafetyStop(...args: unknown[]): Promise<unknown>;
		};
		vi.spyOn(runtime, "_maybeFailoverFromSafetyStop").mockImplementation(async () => {
			delivery ??= capture(send, harness.session);
			return undefined;
		});

		await harness.session.prompt("start");

		// Same run: prompt() resolves only after the wake turn.
		expect(calls).toEqual(["first", "turn", "wake turn"]);
		expect(await delivery).toBe("delivered");
		await expectWokeOnce(harness, calls);
	});

	it.each([
		["sendCustomMessage(triggerTurn)", notify],
		["sendUserMessage(followUp)", followUp],
	] as const)("delivers %s that lands while the run waits for its resource probe", async (_name, send) => {
		const harness = await harnessWith();
		const { calls } = script(harness);
		let delivery: Promise<unknown> | undefined;
		const runtime = harness.session as unknown as { _beginResourceGovernedRun(...args: unknown[]): Promise<unknown> };
		vi.spyOn(runtime, "_beginResourceGovernedRun").mockImplementation(async () => {
			delivery ??= capture(send, harness.session);
			return null;
		});

		await harness.session.prompt("start");

		// Same run: prompt() resolves only after the wake turn.
		expect(calls).toEqual(["turn", "wake turn"]);
		expect(await delivery).toBe("delivered");
		await expectWokeOnce(harness, calls);
	});

	it("queues a triggerTurn message from prompt preflight for that prompt's run", async () => {
		let release = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let entered = () => {};
		const preflight = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const harness = await harnessWith({
			extensionFactories: [
				(omk) => {
					omk.on("before_agent_start", async () => {
						entered();
						await gate;
					});
				},
			],
		});
		const { calls } = script(harness);

		const prompt = harness.session.prompt("start").then(
			() => "resolved",
			(error: unknown) => error,
		);
		await preflight;
		const delivery = capture(notify, harness.session);
		release();

		expect(await prompt).toBe("resolved");
		expect(calls).toEqual(["turn", "wake turn"]);
		expect(await delivery).toBe("delivered");
		await expectWokeOnce(harness, calls);
	});

	it("starts a run for a triggerTurn message deferred by a prompt that ended without a run", async () => {
		let release = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let entered = () => {};
		const preflight = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const harness = await harnessWith({
			extensionFactories: [
				(omk) => {
					omk.on("input", async () => {
						entered();
						await gate;
						return { action: "handled" as const };
					});
				},
			],
		});
		const { calls } = script(harness);

		const prompt = harness.session.prompt("start").then(
			() => "resolved",
			(error: unknown) => error,
		);
		await preflight;
		const delivery = capture(notify, harness.session);
		release();

		expect(await prompt).toBe("resolved");
		expect(await delivery).toBe("delivered");
		await expectWokeOnce(harness, calls);
		expect(calls).toEqual(["wake turn"]);
	});

	it("continues for input queued after the run's last queue check", async () => {
		const harness = await harnessWith();
		const { calls } = script(harness);
		let delivery: Promise<unknown> | undefined;
		const runtime = harness.session as unknown as { _handlePostAgentRun(): Promise<boolean> };
		const original = runtime._handlePostAgentRun.bind(runtime);
		vi.spyOn(runtime, "_handlePostAgentRun").mockImplementation(async () => {
			const resume = await original();
			// Lands after the last check returned, before the run loop reads that answer.
			if (!resume && !delivery) {
				queueMicrotask(() => {
					delivery = capture(followUp, harness.session);
				});
			}
			return resume;
		});

		await harness.session.prompt("start");

		expect(calls).toEqual(["turn", "wake turn"]);
		expect(await delivery).toBe("delivered");
		await expectWokeOnce(harness, calls);
	});

	it("delivers a triggerTurn message that lands while a late tool still owns the finished run", async () => {
		let finish = () => {};
		const done = new Promise<void>((resolve) => {
			finish = resolve;
		});
		const tool: AgentTool = {
			name: "late_writer",
			label: "Late writer",
			description: "Wait for test-controlled termination",
			parameters: Type.Object({}),
			execute: async () => {
				await done;
				return { content: [{ type: "text", text: "late" }], details: {} };
			},
		};
		const harness = await harnessWith({
			tools: [tool],
			settings: { agent: { toolTimeouts: { late_writer: 10 } }, resourceGovernor: { mode: "off" } },
		});
		harness.session.agent.toolExecutionPolicy = { lateSettlement: "audit" };
		const { calls } = script(harness, () =>
			fauxAssistantMessage([fauxToolCall("late_writer", {}, { id: "late-1" })], { stopReason: "toolUse" }),
		);

		await harness.session.prompt("start");
		expect(harness.eventsOfType("prompt_settled")).toHaveLength(0);
		const delivery = capture(notify, harness.session);
		finish();

		await expectWokeOnce(harness, calls);
		expect(await delivery).toBe("delivered");
		expect(calls.at(-1)).toBe("wake turn");
	});

	it("drops deferred turn input when the queue is cleared", async () => {
		let finish = () => {};
		const done = new Promise<void>((resolve) => {
			finish = resolve;
		});
		const tool: AgentTool = {
			name: "late_writer",
			label: "Late writer",
			description: "Wait for test-controlled termination",
			parameters: Type.Object({}),
			execute: async () => {
				await done;
				return { content: [{ type: "text", text: "late" }], details: {} };
			},
		};
		const harness = await harnessWith({
			tools: [tool],
			settings: { agent: { toolTimeouts: { late_writer: 10 } }, resourceGovernor: { mode: "off" } },
		});
		harness.session.agent.toolExecutionPolicy = { lateSettlement: "audit" };
		const { calls } = script(harness, () =>
			fauxAssistantMessage([fauxToolCall("late_writer", {}, { id: "late-2" })], { stopReason: "toolUse" }),
		);

		await harness.session.prompt("start");
		const delivery = capture(notify, harness.session);
		harness.session.clearQueue(); // Esc: the user cancels everything queued
		finish();
		await vi.waitFor(() => expect(harness.eventsOfType("prompt_settled")).toHaveLength(1), { timeout: 3000 });
		await new Promise((resolve) => setTimeout(resolve, 100));

		expect(await delivery).toBe("delivered");
		expect(calls).not.toContain("wake turn");
	});

	it("still delivers follow-up input deferred during preflight when that prompt then fails", async () => {
		const seenByPreflight: string[] = [];
		const harness = await harnessWith({
			extensionFactories: [
				(omk) => {
					omk.on("before_agent_start", (event) => {
						seenByPreflight.push(event.prompt);
					});
				},
			],
		});
		const { calls } = script(harness);
		const admission = (harness.session as unknown as { _turnAdmission: { admit(...args: unknown[]): Promise<void> } })
			._turnAdmission;
		const realAdmit = admission.admit.bind(admission);
		let delivery: Promise<unknown> | undefined;
		let refused = false;
		vi.spyOn(admission, "admit").mockImplementation(async (...args: unknown[]) => {
			if (!refused) {
				refused = true;
				delivery = capture(followUp, harness.session); // lands while this prompt is still in preflight
				throw new Error("admission refused");
			}
			return realAdmit(...args);
		});

		const prompt = await harness.session.prompt("start").then(
			() => "resolved",
			(error: unknown) => error,
		);

		expect(prompt).toBeInstanceOf(Error);
		expect(await delivery).toBe("delivered");
		await expectWokeOnce(harness, calls);
		expect(calls).toEqual(["wake turn"]);
		expect(seenByPreflight).toEqual(["start", WAKE]); // the deferred input ran as a full prompt
	});
	it("runs an extension command at once while another prompt is in its pre-prompt compaction", async () => {
		const ran: string[] = [];
		const harness = await harnessWith({
			extensionFactories: [
				(omk) => {
					omk.registerCommand("ping", {
						handler: async () => {
							ran.push("ping");
						},
					});
				},
			],
		});
		seedClosedTranscript(harness);
		let compactNext = true;
		const runtime = harness.session as unknown as { _runtimeCompactionDecision(): unknown };
		vi.spyOn(runtime, "_runtimeCompactionDecision").mockImplementation(() => {
			const compact = compactNext;
			compactNext = false;
			return { compact, emergency: false };
		});
		let command: Promise<unknown> | undefined;
		const realStream = harness.session.agent.streamFn;
		harness.session.agent.streamFn = (model, context, options) => {
			if (isSummaryCall(context)) command ??= capture((session) => session.prompt("/ping"), harness.session);
			return realStream(model, context, options);
		};
		script(harness);

		await harness.session.prompt("start");

		expect(await command).toBe("delivered");
		expect(ran).toEqual(["ping"]);
	});

	it("still refuses slash text that runs no command while another prompt is in its pre-prompt compaction", async () => {
		const seen: string[] = [];
		const ran: string[] = [];
		const harness = await harnessWith({
			extensionFactories: [
				(omk) => {
					omk.registerCommand("ping", {
						handler: async () => {
							ran.push("ping");
						},
					});
					omk.on("input", async (event) => {
						seen.push(event.text);
						return { action: "continue" as const };
					});
				},
			],
		});
		seedClosedTranscript(harness);
		let compactNext = true;
		const runtime = harness.session as unknown as { _runtimeCompactionDecision(): unknown };
		vi.spyOn(runtime, "_runtimeCompactionDecision").mockImplementation(() => {
			const compact = compactNext;
			compactNext = false;
			return { compact, emergency: false };
		});
		const preflightFailures: string[] = [];
		harness.session.subscribe((event) => {
			if (event.type === "session_termination" && event.termination.runId.startsWith("preflight-"))
				preflightFailures.push(event.termination.message);
		});
		let refusals: Promise<unknown[]> | undefined;
		const realStream = harness.session.agent.streamFn;
		harness.session.agent.streamFn = (model, context, options) => {
			if (isSummaryCall(context))
				refusals ??= Promise.all([
					capture((session) => session.prompt("/not-a-command"), harness.session),
					// Without template expansion "/ping" is plain text, not the command.
					capture((session) => session.prompt("/ping", { expandPromptTemplates: false }), harness.session),
				]);
			return realStream(model, context, options);
		};
		script(harness);

		await harness.session.prompt("start");

		// As before the scope bypass: refused up front, without input handlers or a preflight termination.
		const [unknown, literal] = (await refusals) ?? [];
		expect(unknown).toBeInstanceOf(PromptExecutionBusyError);
		expect(literal).toBeInstanceOf(PromptExecutionBusyError);
		expect(ran).toEqual([]);
		expect(seen).toEqual(["start"]);
		expect(preflightFailures).toEqual([]);
	});

	it("reports a deferred follow-up as accepted once, even when it later runs as its own prompt", async () => {
		const harness = await harnessWith();
		const { calls } = script(harness);
		const admission = (harness.session as unknown as { _turnAdmission: { admit(...args: unknown[]): Promise<void> } })
			._turnAdmission;
		const realAdmit = admission.admit.bind(admission);
		const accepted: boolean[] = [];
		let delivery: Promise<unknown> | undefined;
		let refused = false;
		vi.spyOn(admission, "admit").mockImplementation(async (...args: unknown[]) => {
			if (!refused) {
				refused = true;
				delivery = capture(
					(session) =>
						session.prompt(WAKE, { streamingBehavior: "followUp", preflightResult: (ok) => accepted.push(ok) }),
					harness.session,
				);
				throw new Error("admission refused");
			}
			return realAdmit(...args);
		});

		await harness.session.prompt("start").catch(() => undefined);
		expect(await delivery).toBe("delivered");
		await expectWokeOnce(harness, calls);

		expect(accepted).toEqual([true]);
	});
});
