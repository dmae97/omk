import {
	type Api,
	type AssistantMessage,
	createAssistantMessageEventStream,
	fauxAssistantMessage,
	fauxToolCall,
	type Model,
} from "omk-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CompactionEnvelope } from "../../src/core/compaction/transaction.ts";
import { PromptInputCapacityError } from "../../src/core/prompt-budget.ts";
import type { ExtensionFactory } from "../../src/index.ts";
import { createHarness, type Harness } from "./harness.ts";

type SessionWithCompactionInternals = {
	_checkCompaction: (assistantMessage: AssistantMessage, skipAbortedCheck?: boolean) => Promise<boolean>;
	_checkProjectedCompaction: (...args: unknown[]) => Promise<boolean>;
	_runAutoCompaction: (reason: "overflow" | "threshold", willRetry: boolean) => Promise<boolean>;
};

function extensionSummary(summary: string): ExtensionFactory {
	return (pi) => {
		pi.on("session_before_compact", async (event) => ({
			compaction: {
				summary,
				firstKeptEntryId: event.preparation.firstKeptEntryId,
				tokensBefore: event.preparation.tokensBefore,
				details: {},
			},
		}));
	};
}

function createUsage(totalTokens: number) {
	return {
		input: totalTokens,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function createAssistant(
	harness: Harness,
	options: {
		stopReason?: AssistantMessage["stopReason"];
		errorMessage?: string;
		totalTokens?: number;
		timestamp?: number;
	},
): AssistantMessage {
	const model = harness.getModel();
	return {
		...fauxAssistantMessage("", {
			stopReason: options.stopReason,
			errorMessage: options.errorMessage,
			timestamp: options.timestamp,
		}),
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: createUsage(options.totalTokens ?? 0),
	};
}

function useSummaryStreamFn(harness: Harness, summary: string, onModel?: (model: Model<Api>) => void): () => number {
	let callCount = 0;
	harness.session.agent.streamFn = (model) => {
		callCount++;
		onModel?.(model);
		const stream = createAssistantMessageEventStream();
		queueMicrotask(() => {
			const message: AssistantMessage = {
				...fauxAssistantMessage(summary),
				api: model.api,
				provider: model.provider,
				model: model.id,
				usage: createUsage(10),
			};
			stream.push({ type: "done", reason: "stop", message });
		});
		return stream;
	};
	return () => callCount;
}

function seedCompactableSession(harness: Harness): void {
	const now = Date.now();
	harness.sessionManager.appendMessage({
		role: "user",
		content: [{ type: "text", text: "message to compact" }],
		timestamp: now - 1000,
	});
	harness.sessionManager.appendMessage(
		createAssistant(harness, {
			stopReason: "stop",
			totalTokens: 100,
			timestamp: now - 500,
		}),
	);
	harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
}

/** ~150k tokens of retained history: above the 130k ceiling of a 200k window with a 50k output reserve. */
function seedAdmissionOverflowHistory(harness: Harness): void {
	const now = Date.now();
	harness.sessionManager.appendMessage({
		role: "user",
		content: [{ type: "text", text: "x".repeat(600_000) }],
		timestamp: now - 4000,
	});
	harness.sessionManager.appendMessage(
		createAssistant(harness, { stopReason: "stop", totalTokens: 150_000, timestamp: now - 3000 }),
	);
	harness.sessionManager.appendMessage({
		role: "user",
		content: [{ type: "text", text: "small follow-up" }],
		timestamp: now - 2000,
	});
	harness.sessionManager.appendMessage(
		createAssistant(harness, { stopReason: "stop", totalTokens: 150_010, timestamp: now - 1000 }),
	);
	harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
}

describe("AgentSession compaction characterization", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("manually compacts using an extension-provided summary", async () => {
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.on("session_before_compact", async (event) => ({
						compaction: {
							summary: "summary from extension",
							firstKeptEntryId: event.preparation.firstKeptEntryId,
							tokensBefore: event.preparation.tokensBefore,
							details: { source: "extension" },
						},
					}));
				},
			],
		});
		harnesses.push(harness);

		await harness.session.prompt("one");
		await harness.session.prompt("two");

		const result = await harness.session.compact();
		const compactionEntries = harness.sessionManager.getEntries().filter((entry) => entry.type === "compaction");

		expect(result.summary).toBe("summary from extension");
		expect(compactionEntries).toHaveLength(1);
		expect(harness.session.messages[0]?.role).toBe("compactionSummary");
	});

	it("throws when compacting without a model", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		harness.session.agent.state.model = undefined as unknown as Model<any>;

		await expect(harness.session.compact()).rejects.toThrow("No model selected");
	});

	it("throws when compacting without configured auth", async () => {
		const harness = await createHarness({ withConfiguredAuth: false });
		harnesses.push(harness);

		await expect(harness.session.compact()).rejects.toThrow(`No API key found for ${harness.getModel().provider}.`);
	});

	it("manually compacts with a custom streamFn when registry auth is absent", async () => {
		const harness = await createHarness({ withConfiguredAuth: false });
		harnesses.push(harness);
		seedCompactableSession(harness);
		const getStreamCallCount = useSummaryStreamFn(harness, "summary from custom stream");

		const result = await harness.session.compact();

		expect(result.summary).toBe("summary from custom stream");
		expect(getStreamCallCount()).toBe(1);
	});

	it("uses the configured model for manual and automatic compaction", async () => {
		for (const automatic of [false, true]) {
			const harness = await createHarness({
				models: [{ id: "faux-1" }, { id: "glm-compactor" }],
				settings: { compaction: { model: "faux/glm-compactor" } },
			});
			harnesses.push(harness);
			seedCompactableSession(harness);
			const usedModels: string[] = [];
			useSummaryStreamFn(harness, "summary from configured model", (model) => {
				usedModels.push(`${model.provider}/${model.id}`);
			});

			if (automatic) {
				const sessionInternals = harness.session as unknown as SessionWithCompactionInternals;
				await sessionInternals._runAutoCompaction("threshold", false);
			} else {
				await harness.session.compact();
			}

			expect(usedModels).toEqual(["faux/glm-compactor"]);
		}
	});

	it("fails instead of committing an empty summary when thinking exhausts the output cap", async () => {
		// A real claude-opus-5-5 summary at effort "max" stopped for length after 6553
		// output tokens of thinking and no text; committing it silently loses the context.
		const harness = await createHarness({
			withConfiguredAuth: false,
			// Summarize everything before the last reply, as in a large real session.
			settings: { compaction: { enabled: true, reserveTokens: 8192, keepRecentTokens: 1 } },
		});
		harnesses.push(harness);
		// A file read makes compaction append a file list, so an empty model summary still
		// yields non-empty text that would commit silently.
		const now = Date.now();
		harness.sessionManager.appendMessage({ role: "user", content: "read the config", timestamp: now - 3000 });
		harness.sessionManager.appendMessage({
			...createAssistant(harness, { stopReason: "toolUse", totalTokens: 100, timestamp: now - 2500 }),
			content: [fauxToolCall("read", { path: "config.json" }, { id: "call-read" })],
		});
		harness.sessionManager.appendMessage({
			role: "toolResult",
			toolCallId: "call-read",
			toolName: "read",
			content: [{ type: "text", text: "{}" }],
			isError: false,
			timestamp: now - 2400,
		});
		harness.sessionManager.appendMessage(
			createAssistant(harness, { stopReason: "stop", totalTokens: 120, timestamp: now - 2000 }),
		);
		harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
		harness.session.agent.streamFn = (model) => {
			const stream = createAssistantMessageEventStream();
			queueMicrotask(() => {
				const message: AssistantMessage = {
					...fauxAssistantMessage(""),
					content: [{ type: "thinking", thinking: "planning the summary" }],
					api: model.api,
					provider: model.provider,
					model: model.id,
					usage: createUsage(6553),
					stopReason: "length",
				};
				stream.push({ type: "done", reason: "length", message });
			});
			return stream;
		};

		await expect(harness.session.compact()).rejects.toThrow(/output limit before writing a summary/);
		expect(harness.sessionManager.getEntries().some((entry) => entry.type === "compaction")).toBe(false);
	});

	// pi-landstrip persists background-task snapshots through appendEntry while the
	// summary streams; that used to discard every compaction with revision_mismatch.
	function appendTaskSnapshotDuringSummary(harness: Harness): () => string | undefined {
		let lastId: string | undefined;
		useSummaryStreamFn(harness, "summary despite extension state writes", () => {
			lastId = harness.sessionManager.appendCustomEntry("landstrip.task", { id: "task-1", state: "running" });
		});
		return () => lastId;
	}

	it("manually compacts while an extension appends state during summarization", async () => {
		const harness = await createHarness({ withConfiguredAuth: false });
		harnesses.push(harness);
		seedCompactableSession(harness);
		const lastStateEntryId = appendTaskSnapshotDuringSummary(harness);

		const result = await harness.session.compact();

		expect(result.summary).toBe("summary despite extension state writes");
		const compaction = harness.sessionManager.getEntries().find((entry) => entry.type === "compaction");
		expect(compaction?.parentId).toBe(lastStateEntryId());
		expect(harness.sessionManager.buildSessionContext().messages[0]?.role).toBe("compactionSummary");
	});

	it("auto-compacts while an extension appends state during summarization", async () => {
		const harness = await createHarness({ withConfiguredAuth: false });
		harnesses.push(harness);
		seedCompactableSession(harness);
		const lastStateEntryId = appendTaskSnapshotDuringSummary(harness);
		const compactionErrors: string[] = [];
		harness.session.subscribe((event) => {
			if (event.type === "compaction_end" && event.errorMessage) compactionErrors.push(event.errorMessage);
		});
		const sessionInternals = harness.session as unknown as SessionWithCompactionInternals;

		await sessionInternals._runAutoCompaction("threshold", false);

		expect(compactionErrors).toEqual([]);
		const compaction = harness.sessionManager.getEntries().find((entry) => entry.type === "compaction");
		expect(compaction?.parentId).toBe(lastStateEntryId());
	});

	it("auto-compacts with a custom streamFn when registry auth is absent", async () => {
		const harness = await createHarness({ withConfiguredAuth: false });
		harnesses.push(harness);
		seedCompactableSession(harness);
		const getStreamCallCount = useSummaryStreamFn(harness, "auto summary from custom stream");
		const sessionInternals = harness.session as unknown as SessionWithCompactionInternals;

		await sessionInternals._runAutoCompaction("threshold", false);

		const compactionEntries = harness.sessionManager.getEntries().filter((entry) => entry.type === "compaction");
		expect(compactionEntries).toHaveLength(1);
		expect(getStreamCallCount()).toBe(1);
	});

	it("cancels in-progress manual compaction when abortCompaction is called", async () => {
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.on("session_before_compact", async (event) => {
						return await new Promise<{ cancel: true }>((resolve) => {
							event.signal.addEventListener("abort", () => resolve({ cancel: true }), { once: true });
						});
					});
				},
			],
		});
		harnesses.push(harness);

		await harness.session.prompt("one");
		await harness.session.prompt("two");

		const compactPromise = harness.session.compact();
		await new Promise((resolve) => setTimeout(resolve, 0));
		harness.session.abortCompaction();

		await expect(compactPromise).rejects.toThrow("Compaction cancelled");
		expect(harness.session.lastTermination).toMatchObject({
			causeCode: "compaction.aborted",
			nextAction: expect.stringMatching(/retry \/compact/i),
		});
	});

	it("resumes after threshold compaction when only agent-level queued messages exist", async () => {
		vi.useFakeTimers();
		const harness = await createHarness({
			settings: { compaction: { keepRecentTokens: 1 } },
			extensionFactories: [
				(pi) => {
					pi.on("session_before_compact", async (event) => ({
						compaction: {
							summary: "auto compacted",
							firstKeptEntryId: event.preparation.firstKeptEntryId,
							tokensBefore: event.preparation.tokensBefore,
							details: {},
						},
					}));
				},
			],
		});
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("one"), fauxAssistantMessage("two")]);
		await harness.session.prompt("first");
		await harness.session.prompt("second");

		harness.session.agent.followUp({
			role: "custom",
			customType: "test",
			content: [{ type: "text", text: "queued custom" }],
			display: false,
			timestamp: Date.now(),
		});

		const sessionInternals = harness.session as unknown as SessionWithCompactionInternals;

		await expect(sessionInternals._runAutoCompaction("threshold", false)).resolves.toBe(true);
	});

	it("does not retry overflow recovery more than twice", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const sessionInternals = harness.session as unknown as SessionWithCompactionInternals;
		const overflowMessage = createAssistant(harness, {
			stopReason: "error",
			errorMessage: "prompt is too long",
			timestamp: Date.now(),
		});
		const runAutoCompactionSpy = vi.spyOn(sessionInternals, "_runAutoCompaction").mockResolvedValue(false);
		const compactionErrors: string[] = [];
		harness.session.subscribe((event) => {
			if (event.type === "compaction_end" && event.errorMessage) {
				compactionErrors.push(event.errorMessage);
			}
		});

		await sessionInternals._checkCompaction(overflowMessage);
		await sessionInternals._checkCompaction({ ...overflowMessage, timestamp: Date.now() + 1 });
		await sessionInternals._checkCompaction({ ...overflowMessage, timestamp: Date.now() + 2 });

		expect(runAutoCompactionSpy).toHaveBeenCalledTimes(2);
		expect(compactionErrors).toContain(
			"Context overflow recovery failed after two staged compact-and-retry attempts. Reduce the latest input or switch to a model with a larger effective context window.",
		);
	});

	it("ignores stale pre-compaction assistant usage on pre-prompt checks", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const sessionInternals = harness.session as unknown as SessionWithCompactionInternals;
		const staleTimestamp = Date.now() - 10_000;
		const staleAssistant = createAssistant(harness, {
			stopReason: "stop",
			totalTokens: 610_000,
			timestamp: staleTimestamp,
		});

		harness.sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: "before compaction" }],
			timestamp: staleTimestamp - 1000,
		});
		harness.sessionManager.appendMessage(staleAssistant);
		const firstKeptEntryId = harness.sessionManager.getEntries()[0]!.id;
		harness.sessionManager.appendCompaction(
			"summary",
			firstKeptEntryId,
			staleAssistant.usage.totalTokens,
			undefined,
			false,
		);
		harness.sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: "after compaction" }],
			timestamp: Date.now(),
		});

		const runAutoCompactionSpy = vi.spyOn(sessionInternals, "_runAutoCompaction").mockResolvedValue(false);

		await sessionInternals._checkCompaction(staleAssistant, false);

		expect(runAutoCompactionSpy).not.toHaveBeenCalled();
	});

	it("triggers threshold compaction for error messages using the last successful usage", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const sessionInternals = harness.session as unknown as SessionWithCompactionInternals;
		const successfulAssistant = createAssistant(harness, {
			stopReason: "stop",
			totalTokens: 190_000,
			timestamp: Date.now(),
		});
		const errorAssistant = createAssistant(harness, {
			stopReason: "error",
			errorMessage: "529 overloaded",
			timestamp: Date.now() + 1000,
		});
		harness.session.agent.state.messages = [
			{ role: "user", content: [{ type: "text", text: "hello" }], timestamp: Date.now() - 1000 },
			successfulAssistant,
			{ role: "user", content: [{ type: "text", text: "retry" }], timestamp: Date.now() + 500 },
			errorAssistant,
		];

		const runAutoCompactionSpy = vi.spyOn(sessionInternals, "_runAutoCompaction").mockResolvedValue(false);

		await sessionInternals._checkCompaction(errorAssistant);

		expect(runAutoCompactionSpy).toHaveBeenCalledWith("threshold", false);
	});

	it("does not trigger threshold compaction for error messages when no prior usage exists", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const sessionInternals = harness.session as unknown as SessionWithCompactionInternals;
		const errorAssistant = createAssistant(harness, {
			stopReason: "error",
			errorMessage: "529 overloaded",
			timestamp: Date.now(),
		});
		harness.session.agent.state.messages = [
			{ role: "user", content: [{ type: "text", text: "hello" }], timestamp: Date.now() - 1000 },
			errorAssistant,
		];

		const runAutoCompactionSpy = vi.spyOn(sessionInternals, "_runAutoCompaction").mockResolvedValue(false);

		await sessionInternals._checkCompaction(errorAssistant);

		expect(runAutoCompactionSpy).not.toHaveBeenCalled();
	});

	it("does not trigger threshold compaction when only kept pre-compaction usage exists", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const sessionInternals = harness.session as unknown as SessionWithCompactionInternals;
		const preCompactionTimestamp = Date.now() - 10_000;
		const keptAssistant = createAssistant(harness, {
			stopReason: "stop",
			totalTokens: 190_000,
			timestamp: preCompactionTimestamp,
		});

		harness.sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: "before compaction" }],
			timestamp: preCompactionTimestamp - 1000,
		});
		harness.sessionManager.appendMessage(keptAssistant);
		const firstKeptEntryId = harness.sessionManager.getEntries()[0]!.id;
		harness.sessionManager.appendCompaction(
			"summary",
			firstKeptEntryId,
			keptAssistant.usage.totalTokens,
			undefined,
			false,
		);

		const errorAssistant = createAssistant(harness, {
			stopReason: "error",
			errorMessage: "529 overloaded",
			timestamp: Date.now(),
		});
		harness.session.agent.state.messages = [
			{ role: "user", content: [{ type: "text", text: "kept user" }], timestamp: preCompactionTimestamp - 1000 },
			keptAssistant,
			{ role: "user", content: [{ type: "text", text: "new prompt" }], timestamp: Date.now() - 500 },
			errorAssistant,
		];

		const runAutoCompactionSpy = vi.spyOn(sessionInternals, "_runAutoCompaction").mockResolvedValue(false);

		await sessionInternals._checkCompaction(errorAssistant);

		expect(runAutoCompactionSpy).not.toHaveBeenCalled();
	});

	it("triggers threshold compaction at 90% of the admission ceiling when the reserve boundary is later", async () => {
		// 200k window, 20k output reserve, 10% safety -> admission ceiling 160k -> trigger 144k.
		const harness = await createHarness({
			settings: { compaction: { enabled: true, reserveTokens: 1000 } },
			models: [{ id: "faux-1", contextWindow: 200_000, maxTokens: 20_000 }],
		});
		harnesses.push(harness);
		const sessionInternals = harness.session as unknown as SessionWithCompactionInternals;
		const runAutoCompactionSpy = vi.spyOn(sessionInternals, "_runAutoCompaction").mockResolvedValue(false);

		await sessionInternals._checkCompaction(
			createAssistant(harness, { stopReason: "stop", totalTokens: 143_999, timestamp: Date.now() }),
		);
		expect(runAutoCompactionSpy).not.toHaveBeenCalled();

		await sessionInternals._checkCompaction(
			createAssistant(harness, { stopReason: "stop", totalTokens: 144_000, timestamp: Date.now() + 1 }),
		);
		expect(runAutoCompactionSpy).toHaveBeenCalledWith("threshold", false);
	});

	it("fires threshold compaction before the admission ceiling on large-output models", async () => {
		// opencode-go/deepseek-v4.1-flash shape: the admission ceiling is 516k, far below 90% of the window.
		const harness = await createHarness({
			settings: { compaction: { enabled: true } },
			models: [{ id: "big-output", contextWindow: 1_000_000, maxTokens: 384_000 }],
		});
		harnesses.push(harness);
		const sessionInternals = harness.session as unknown as SessionWithCompactionInternals;
		const runAutoCompactionSpy = vi.spyOn(sessionInternals, "_runAutoCompaction").mockResolvedValue(false);

		await sessionInternals._checkCompaction(
			createAssistant(harness, { stopReason: "stop", totalTokens: 400_000, timestamp: Date.now() }),
		);
		expect(runAutoCompactionSpy).not.toHaveBeenCalled();

		await sessionInternals._checkCompaction(
			createAssistant(harness, { stopReason: "stop", totalTokens: 470_000, timestamp: Date.now() + 1 }),
		);
		expect(runAutoCompactionSpy).toHaveBeenCalledWith("threshold", false);
	});

	it("compacts before provider request and admits the compacted context", async () => {
		const harness = await createHarness({
			settings: { compaction: { enabled: true, reserveTokens: 1000, keepRecentTokens: 1 } },
			models: [{ id: "faux-1", contextWindow: 200_000 }],
			extensionFactories: [extensionSummary("projected compacted")],
		});
		harnesses.push(harness);
		const nearLimitAssistant = createAssistant(harness, {
			stopReason: "stop",
			totalTokens: 179_990,
			timestamp: Date.now(),
		});
		harness.sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: "seed" }],
			timestamp: Date.now() - 1000,
		});
		harness.sessionManager.appendMessage(nearLimitAssistant);
		harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
		harness.setResponses([fauxAssistantMessage("after projected compaction")]);

		expect(harness.sessionManager.getEntries().filter((entry) => entry.type === "compaction")).toHaveLength(0);

		// Pre-compaction usage must not keep blocking the prompt once the history is compacted.
		await expect(harness.session.prompt("x".repeat(80))).resolves.toBeUndefined();

		const compactionEntries = harness.sessionManager.getEntries().filter((entry) => entry.type === "compaction");
		expect(compactionEntries).toHaveLength(1);
		expect(compactionEntries[0]).toMatchObject({ summary: "projected compacted" });
		expect(harness.faux.state.callCount).toBe(1);
	});

	it("recovers from an admission overflow by compacting and sending the prompt", async () => {
		// 200k window, 50k output reserve -> admission ceiling 130k. The history holds ~150k tokens.
		const harness = await createHarness({
			settings: { compaction: { enabled: true, keepRecentTokens: 1 } },
			models: [{ id: "admission-window", contextWindow: 200_000, maxTokens: 50_000 }],
			extensionFactories: [extensionSummary("admission compacted")],
		});
		harnesses.push(harness);
		const sessionInternals = harness.session as unknown as SessionWithCompactionInternals;
		// Isolate the admission path: neither pre-prompt compaction check may be what saves the turn.
		vi.spyOn(sessionInternals, "_checkCompaction").mockResolvedValue(false);
		vi.spyOn(sessionInternals, "_checkProjectedCompaction").mockResolvedValue(false);
		seedAdmissionOverflowHistory(harness);
		harness.setResponses([fauxAssistantMessage("answered after admission compaction")]);

		await expect(harness.session.prompt("continue")).resolves.toBeUndefined();

		const compactionEntries = harness.sessionManager.getEntries().filter((entry) => entry.type === "compaction");
		expect(compactionEntries).toHaveLength(1);
		expect(compactionEntries[0]).toMatchObject({ summary: "admission compacted" });
		expect(harness.faux.state.callCount).toBe(1);
	});

	it("still rejects when the pending input alone exceeds hard input capacity", async () => {
		const harness = await createHarness({
			settings: { compaction: { enabled: true, keepRecentTokens: 1 } },
			models: [{ id: "admission-window", contextWindow: 200_000, maxTokens: 50_000 }],
			extensionFactories: [extensionSummary("cannot help")],
		});
		harnesses.push(harness);
		const sessionInternals = harness.session as unknown as SessionWithCompactionInternals;
		vi.spyOn(sessionInternals, "_checkProjectedCompaction").mockResolvedValue(false);
		seedCompactableSession(harness);
		harness.setResponses([]);

		const prompted = harness.session.prompt("y".repeat(800_000));
		await expect(prompted).rejects.toBeInstanceOf(PromptInputCapacityError);
		// The rejection names the overhead compaction cannot shrink, so the cause is actionable.
		await expect(prompted).rejects.toThrow(
			/cannot shrink the system prompt \(\d+ tokens\), tool schemas \(\d+\) or latest input \(\d+\)/,
		);

		// Compaction cannot shrink the pending turn, so history is left intact and nothing is sent.
		expect(harness.sessionManager.getEntries().filter((entry) => entry.type === "compaction")).toHaveLength(0);
		expect(harness.faux.state.callCount).toBe(0);
	});

	it("admits the reported opencode-go/deepseek-v4.1-flash overflow through prompt() by compacting first", async () => {
		// Reported: estimated=627823 > limit=516000 while threshold compaction still waited for 900k.
		const harness = await createHarness({
			settings: { compaction: { enabled: true, keepRecentTokens: 1 } },
			models: [{ id: "deepseek-v4.1-flash", contextWindow: 1_000_000, maxTokens: 384_000 }],
			extensionFactories: [extensionSummary("deepseek compacted")],
		});
		harnesses.push(harness);
		// A long earlier turn, then a small latest turn that compaction keeps verbatim.
		const now = Date.now();
		harness.sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: "x".repeat(2_400_000) }],
			timestamp: now - 4000,
		});
		harness.sessionManager.appendMessage(
			createAssistant(harness, { stopReason: "stop", totalTokens: 600_000, timestamp: now - 3000 }),
		);
		harness.sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: "small follow-up" }],
			timestamp: now - 2000,
		});
		harness.sessionManager.appendMessage(
			createAssistant(harness, { stopReason: "stop", totalTokens: 627_823, timestamp: now - 1000 }),
		);
		harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
		harness.setResponses([fauxAssistantMessage("answered after compaction")]);

		await expect(harness.session.prompt("continue")).resolves.toBeUndefined();

		const compactionEntries = harness.sessionManager.getEntries().filter((entry) => entry.type === "compaction");
		expect(compactionEntries).toHaveLength(1);
		expect(compactionEntries[0]).toMatchObject({ summary: "deepseek compacted" });
		expect(harness.faux.state.callCount).toBe(1);
	});

	it("reports the committed compaction when admission still fails after compacting", async () => {
		const harness = await createHarness({
			settings: { compaction: { enabled: true, keepRecentTokens: 1 } },
			models: [{ id: "admission-window", contextWindow: 200_000, maxTokens: 50_000 }],
			extensionFactories: [extensionSummary("earlier turn summarized")],
		});
		harnesses.push(harness);
		const sessionInternals = harness.session as unknown as SessionWithCompactionInternals;
		vi.spyOn(sessionInternals, "_checkCompaction").mockResolvedValue(false);
		vi.spyOn(sessionInternals, "_checkProjectedCompaction").mockResolvedValue(false);
		// The ~150k-token latest turn is kept verbatim: compaction commits but cannot get under 130k.
		const now = Date.now();
		harness.sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: "earlier question" }],
			timestamp: now - 4000,
		});
		harness.sessionManager.appendMessage(
			createAssistant(harness, { stopReason: "stop", totalTokens: 1_000, timestamp: now - 3000 }),
		);
		harness.sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: "x".repeat(600_000) }],
			timestamp: now - 2000,
		});
		harness.sessionManager.appendMessage(
			createAssistant(harness, { stopReason: "stop", totalTokens: 150_010, timestamp: now - 1000 }),
		);
		harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
		harness.setResponses([]);

		const prompted = harness.session.prompt("continue");

		await expect(prompted).rejects.toBeInstanceOf(PromptInputCapacityError);
		await expect(prompted).rejects.toThrow(/after automatic compaction/);
		expect(harness.sessionManager.getEntries().filter((entry) => entry.type === "compaction")).toHaveLength(1);
		expect(harness.session.lastTermination).toMatchObject({
			causeCode: "provider.context_overflow",
			sideEffects: "confirmed",
		});
		expect(harness.faux.state.callCount).toBe(0);
	});

	it("re-compacts the retained tail when the latest entry is already a compaction and admission still overflows", async () => {
		// Reported devin/swe-2 wedge: a committed compaction kept history that still overflows the
		// ceiling, and admission recovery refused to compact again, so every prompt was rejected.
		const harness = await createHarness({
			settings: { compaction: { enabled: true, keepRecentTokens: 100_000 } },
			models: [{ id: "admission-window", contextWindow: 200_000, maxTokens: 50_000 }],
			extensionFactories: [extensionSummary("retained tail recompacted")],
		});
		harnesses.push(harness);
		const sessionInternals = harness.session as unknown as SessionWithCompactionInternals;
		vi.spyOn(sessionInternals, "_checkCompaction").mockResolvedValue(false);
		vi.spyOn(sessionInternals, "_checkProjectedCompaction").mockResolvedValue(false);
		const now = Date.now();
		const keptTurnId = harness.sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: "x".repeat(600_000) }],
			timestamp: now - 5000,
		});
		harness.sessionManager.appendMessage(
			createAssistant(harness, { stopReason: "stop", totalTokens: 150_000, timestamp: now - 4000 }),
		);
		const recentTurnId = harness.sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: "y".repeat(40_000) }],
			timestamp: now - 3000,
		});
		harness.sessionManager.appendMessage(
			createAssistant(harness, { stopReason: "stop", totalTokens: 160_000, timestamp: now - 2000 }),
		);
		harness.sessionManager.appendCompaction("earlier summary", keptTurnId, 160_000);
		harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
		harness.setResponses([fauxAssistantMessage("answered after re-compaction")]);

		await expect(harness.session.prompt("continue")).resolves.toBeUndefined();

		const compactionEntries = harness.sessionManager.getEntries().filter((entry) => entry.type === "compaction");
		expect(compactionEntries).toHaveLength(2);
		expect(compactionEntries[1]).toMatchObject({
			summary: "retained tail recompacted",
			firstKeptEntryId: recentTurnId,
		});
		expect(harness.faux.state.callCount).toBe(1);
	});

	it("admits a new turn whose finished turn's reasoning inflated the reported usage past the ceiling", async () => {
		// Usage reported during the finished turn counts reasoning the provider drops at the next
		// user message, so admission must not reject (or compact) on it.
		const harness = await createHarness({
			settings: { compaction: { enabled: true, keepRecentTokens: 1 } },
			models: [{ id: "admission-window", contextWindow: 200_000, maxTokens: 50_000 }],
			extensionFactories: [extensionSummary("must not run")],
		});
		harnesses.push(harness);
		const sessionInternals = harness.session as unknown as SessionWithCompactionInternals;
		vi.spyOn(sessionInternals, "_checkCompaction").mockResolvedValue(false);
		vi.spyOn(sessionInternals, "_checkProjectedCompaction").mockResolvedValue(false);
		const now = Date.now();
		const withReasoning = (usage: { input: number; output: number }, timestamp: number): AssistantMessage => {
			const message = createAssistant(harness, { stopReason: "stop", timestamp });
			message.content = [{ type: "thinking", thinking: "r".repeat(200_000) }, ...message.content];
			message.usage = { ...createUsage(usage.input + usage.output), ...usage };
			return message;
		};
		harness.sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: "question" }],
			timestamp: now - 3000,
		});
		harness.sessionManager.appendMessage(withReasoning({ input: 20_000, output: 60_000 }, now - 2000));
		harness.sessionManager.appendMessage(withReasoning({ input: 80_000, output: 60_000 }, now - 1000));
		harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
		harness.setResponses([fauxAssistantMessage("answered without compaction")]);

		await expect(harness.session.prompt("continue")).resolves.toBeUndefined();

		expect(harness.sessionManager.getEntries().filter((entry) => entry.type === "compaction")).toHaveLength(0);
		expect(harness.faux.state.callCount).toBe(1);
	});

	it("re-cuts the retained tail when /compact is repeated right after a compaction", async () => {
		// Reported: /compact after an automatic compaction answered "Already compacted" although the
		// kept tail could still shrink, so an over-limit session had no manual way forward.
		const harness = await createHarness({
			settings: { compaction: { enabled: true, keepRecentTokens: 100_000 } },
			extensionFactories: [extensionSummary("manual tail recompacted")],
		});
		harnesses.push(harness);
		const now = Date.now();
		const keptTurnId = harness.sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: "x".repeat(600_000) }],
			timestamp: now - 5000,
		});
		harness.sessionManager.appendMessage(
			createAssistant(harness, { stopReason: "stop", totalTokens: 150_000, timestamp: now - 4000 }),
		);
		const recentTurnId = harness.sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: "y".repeat(40_000) }],
			timestamp: now - 3000,
		});
		harness.sessionManager.appendMessage(
			createAssistant(harness, { stopReason: "stop", totalTokens: 160_000, timestamp: now - 2000 }),
		);
		harness.sessionManager.appendCompaction("earlier summary", keptTurnId, 160_000);
		harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;

		await expect(harness.session.compact()).resolves.toMatchObject({
			summary: "manual tail recompacted",
			firstKeptEntryId: recentTurnId,
		});
		expect(harness.sessionManager.getEntries().filter((entry) => entry.type === "compaction")).toHaveLength(2);
	});

	it("does not compact on admission failure when auto-compaction is disabled", async () => {
		const harness = await createHarness({
			settings: { compaction: { enabled: false, keepRecentTokens: 1 } },
			models: [{ id: "admission-window", contextWindow: 200_000, maxTokens: 50_000 }],
			extensionFactories: [extensionSummary("must not run")],
		});
		harnesses.push(harness);
		seedAdmissionOverflowHistory(harness);
		harness.setResponses([]);

		await expect(harness.session.prompt("continue")).rejects.toBeInstanceOf(PromptInputCapacityError);

		expect(harness.sessionManager.getEntries().filter((entry) => entry.type === "compaction")).toHaveLength(0);
		expect(harness.session.lastTermination).toMatchObject({
			causeCode: "provider.context_overflow",
			sideEffects: "none",
		});
		expect(harness.faux.state.callCount).toBe(0);
	});

	it("does not trigger threshold compaction below the threshold or when disabled", async () => {
		const belowThresholdHarness = await createHarness({
			settings: { compaction: { enabled: true, reserveTokens: 1000 } },
			models: [{ id: "faux-1", contextWindow: 200_000 }],
		});
		harnesses.push(belowThresholdHarness);
		const disabledHarness = await createHarness({ settings: { compaction: { enabled: false } } });
		harnesses.push(disabledHarness);

		const belowThresholdInternals = belowThresholdHarness.session as unknown as SessionWithCompactionInternals;
		const disabledInternals = disabledHarness.session as unknown as SessionWithCompactionInternals;
		const belowThresholdSpy = vi.spyOn(belowThresholdInternals, "_runAutoCompaction").mockResolvedValue(false);
		const disabledSpy = vi.spyOn(disabledInternals, "_runAutoCompaction").mockResolvedValue(false);

		await belowThresholdInternals._checkCompaction(
			createAssistant(belowThresholdHarness, { stopReason: "stop", totalTokens: 1_000, timestamp: Date.now() }),
		);
		await disabledInternals._checkCompaction(
			createAssistant(disabledHarness, { stopReason: "stop", totalTokens: 1_000_000, timestamp: Date.now() }),
		);

		expect(belowThresholdSpy).not.toHaveBeenCalled();
		expect(disabledSpy).not.toHaveBeenCalled();
	});

	it("sanitizes control characters in the latest user message when building compaction provenance", async () => {
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.on("session_before_compact", async (event) => ({
						compaction: {
							summary: "summary with sanitized provenance",
							firstKeptEntryId: event.preparation.firstKeptEntryId,
							tokensBefore: event.preparation.tokensBefore,
							details: {},
						},
					}));
				},
			],
		});
		harnesses.push(harness);

		const now = Date.now();
		harness.sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: "before\x00\x07with\x1b[31mANSI\x1b[0m and NUL" }],
			timestamp: now - 1000,
		});
		harness.sessionManager.appendMessage(
			createAssistant(harness, {
				stopReason: "stop",
				totalTokens: 100,
				timestamp: now - 500,
			}),
		);
		harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;

		const result = await harness.session.compact();

		expect(result.summary).toBe("summary with sanitized provenance");
		const compactionEntries = harness.sessionManager.getEntries().filter((entry) => entry.type === "compaction");
		expect(compactionEntries).toHaveLength(1);
		const envelope = (compactionEntries[0]?.details as { compactionEnvelope?: CompactionEnvelope } | undefined)
			?.compactionEnvelope;
		if (!envelope) throw new Error("expected compaction envelope");
		expect(envelope.preserved.latestIntent).not.toContain("\x00");
		expect(envelope.preserved.latestIntent).not.toContain("\x07");
		expect(envelope.preserved.latestIntent).not.toContain("\x1b");
		expect(envelope.preserved.latestIntent).toContain("before");
		expect(envelope.preserved.latestIntent).toContain("with");
		expect(envelope.preserved.latestIntent).toContain("ANSI");
		expect(envelope.preserved.nextAction).not.toContain("\x00");
		expect(envelope.preserved.nextAction).not.toContain("\x07");
		expect(envelope.preserved.nextAction).not.toContain("\x1b");
		expect(envelope.preserved.nextAction).toContain("before");
	});
});
