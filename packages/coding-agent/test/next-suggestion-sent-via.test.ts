/**
 * Accept trace `sentVia` through a real AgentSession dispatch: the interactive
 * Enter path while streaming calls `session.prompt(text, { streamingBehavior: "steer" })`,
 * Alt+Enter passes "followUp", and an idle submit is a plain `session.prompt(text)`.
 */
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "omk-agent-core";
import { type AssistantMessage, type AssistantMessageEvent, EventStream, getModel } from "omk-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSession } from "../src/core/agent-session.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import {
	type ShownSuggestionMeta,
	SuggestionAcceptTracker,
	type SuggestionOutcomeRecord,
} from "../src/core/next-suggestion-accept-trace.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import {
	installNextSuggestions,
	type SuggestionEditorPort,
	type SuggestionSessionPort,
} from "../src/modes/interactive/next-suggestion-controller.ts";
import { createHarness, type Harness } from "./suite/harness.ts";
import { createTestExtensionsResult, createTestResourceLoader } from "./utilities.ts";

// Mock stream that mimics AssistantMessageEventStream
class MockAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor() {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") return event.message;
				if (event.type === "error") return event.error;
				throw new Error("Unexpected event type");
			},
		);
	}
}

function createAssistantMessage(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "mock",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

const meta: ShownSuggestionMeta = {
	parentTurnIndex: 0,
	provider: "anthropic",
	model: "m",
	settledAtEpochMs: 1,
	quotaCheckedAtEpochMs: 2,
	shownAtEpochMs: 3,
};

describe("accept trace sentVia: real AgentSession dispatch path", () => {
	let session: AgentSession;
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `omk-sentvia-${Date.now()}-${Math.random()}`);
		mkdirSync(tempDir, { recursive: true });
	});
	afterEach(() => {
		session?.dispose();
		if (existsSync(tempDir)) rmSync(tempDir, { recursive: true });
	});

	async function setup(extensions: Parameters<typeof createTestExtensionsResult>[0] = []) {
		const model = getModel("anthropic", "claude-sonnet-4-5")!;
		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: { model, systemPrompt: "Test", tools: [] },
			streamFn: (_model, _context, options) => {
				const signal = options?.signal;
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					stream.push({ type: "start", partial: createAssistantMessage("") });
					const check = () => {
						if (signal?.aborted)
							stream.push({ type: "error", reason: "aborted", error: createAssistantMessage("Aborted") });
						else setTimeout(check, 5);
					};
					check();
				});
				return stream;
			},
		});
		const authStorage = AuthStorage.create(join(tempDir, "auth.json"));
		authStorage.setRuntimeApiKey("anthropic", "test-key");
		session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(),
			settingsManager: SettingsManager.create(tempDir, tempDir),
			cwd: tempDir,
			modelRegistry: ModelRegistry.create(authStorage, tempDir),
			resourceLoader: createTestResourceLoader({ extensionsResult: await createTestExtensionsResult(extensions) }),
		});
		const records: Array<Omit<SuggestionOutcomeRecord, "schemaVersion" | "sessionHash">> = [];
		const trace = new SuggestionAcceptTracker((r) => records.push(r));
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
			env: { OMK_NEXT_SUGGESTIONS: "1" },
			quotaUsage: async () => "no_quota",
			acceptTrace: trace,
		})!;
		return { trace, records, controller };
	}

	const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

	it("idle submit goes through the prompt path ⇒ sentVia 'prompt'", async () => {
		const { trace, records, controller } = await setup();
		trace.shown(meta, "run tests");
		trace.accepted(4);
		const run = session.prompt("run tests");
		await tick();
		expect(session.isStreaming).toBe(true);
		expect(records.map((r) => [r.sentAs, r.sentVia])).toEqual([["exact", "prompt"]]);
		await session.abort();
		await run.catch(() => {});
		controller.dispose();
	});

	it("submit while streaming goes through the steer branch ⇒ sentVia 'steer', recorded once", async () => {
		const { trace, records, controller } = await setup();
		const run = session.prompt("first");
		await tick();
		expect(session.isStreaming).toBe(true);
		trace.shown(meta, "run tests");
		trace.accepted(4);
		await session.prompt("run tests", { streamingBehavior: "steer" });
		expect(session.pendingMessageCount).toBe(1);
		expect(records.map((r) => [r.sentAs, r.sentVia])).toEqual([["exact", "steer"]]);
		await session.abort();
		await run.catch(() => {});
		controller.dispose();
		expect(records).toHaveLength(1);
	});

	it("Alt+Enter while streaming goes through the follow-up queue ⇒ sentVia 'followUp'", async () => {
		const { trace, records, controller } = await setup();
		const run = session.prompt("first");
		await tick();
		trace.shown(meta, "run tests");
		trace.accepted(4);
		await session.prompt("run tests now", { streamingBehavior: "followUp" });
		expect(records.map((r) => [r.sentAs, r.sentVia])).toEqual([["edited", "followUp"]]);
		await session.abort();
		await run.catch(() => {});
		controller.dispose();
	});

	it("extension command or input hook that handles input while streaming ⇒ nothing recorded as sent", async () => {
		const ran: string[] = [];
		const { trace, records, controller } = await setup([
			(omk) => {
				omk.registerCommand("ping", {
					handler: async () => {
						ran.push("ping");
					},
				});
				omk.on("input", async (event) =>
					event.text === "swallow me" ? { action: "handled" as const } : undefined,
				);
			},
		]);
		const run = session.prompt("first");
		await tick();
		expect(session.isStreaming).toBe(true);
		const sent = vi.spyOn(trace, "sent");
		trace.shown(meta, "/ping");
		trace.accepted(4);
		await session.prompt("/ping", { streamingBehavior: "steer" });
		await session.prompt("swallow me", { streamingBehavior: "followUp" });
		expect(ran).toEqual(["ping"]);
		expect(session.pendingMessageCount).toBe(0);
		expect(sent).not.toHaveBeenCalled();
		expect(records).toEqual([]);
		await session.abort();
		await run.catch(() => {});
		controller.dispose();
		expect(records.map((r) => [r.outcome, r.sentAs])).toEqual([["accepted", "abandoned"]]);
	});

	it("compaction flush re-sends through prompt(): queued while a run streams ⇒ its mode; idle ⇒ 'prompt'; once each", async () => {
		// flushCompactionQueue calls session.prompt(text, { streamingBehavior: mode }) for each held message.
		const { trace, records, controller } = await setup();
		const sent = vi.spyOn(trace, "sent");
		const run = session.prompt("first");
		await tick();
		trace.shown(meta, "held steer");
		trace.accepted(4);
		await session.prompt("held steer", { streamingBehavior: "steer" });
		trace.shown(meta, "held follow");
		trace.accepted(5);
		await session.prompt("held follow", { streamingBehavior: "followUp" });
		expect(session.pendingMessageCount).toBe(2);
		session.clearQueue();
		await session.abort();
		await run.catch(() => {});
		expect(records.map((r) => [r.sentAs, r.sentVia])).toEqual([
			["exact", "steer"],
			["exact", "followUp"],
		]);
		expect(sent).toHaveBeenCalledTimes(3); // "first" (nothing pending) + the two held messages
		controller.dispose();
	});

	it("compaction flush at idle: a held steer message starts a run ⇒ 'prompt', recorded once", async () => {
		const { trace, records, controller } = await setup();
		const sent = vi.spyOn(trace, "sent");
		trace.shown(meta, "held idle");
		trace.accepted(6);
		const idle = session.prompt("held idle", { streamingBehavior: "steer" });
		await tick();
		expect(session.isStreaming).toBe(true);
		expect(records.map((r) => [r.sentAs, r.sentVia])).toEqual([["exact", "prompt"]]);
		expect(sent).toHaveBeenCalledTimes(1);
		await session.abort();
		await idle.catch(() => {});
		controller.dispose();
	});

	it("dispose restores the session's own prompt", async () => {
		const { controller } = await setup();
		const original = AgentSession.prototype.prompt;
		expect(session.prompt).not.toBe(original);
		controller.dispose();
		expect(session.prompt).toBe(original);
	});
});

describe("accept trace sentVia: input deferred while another prompt is in preflight", () => {
	let harness: Harness | undefined;
	afterEach(() => harness?.cleanup());

	it("deferred follow-up ⇒ labeled with its requested behavior at deferral, recorded once even when it later runs", async () => {
		harness = await createHarness({ settings: { retry: { enabled: false } } });
		harness.setResponses(Array.from({ length: 4 }, () => () => createAssistantMessage("ok")));
		const records: Array<Omit<SuggestionOutcomeRecord, "schemaVersion" | "sessionHash">> = [];
		const trace = new SuggestionAcceptTracker((r) => records.push(r));
		const editor: SuggestionEditorPort = {
			getText: () => "",
			setText: () => {},
			setPlaceholder: () => {},
			isShowingAutocomplete: () => false,
		};
		const session = harness.session;
		const controller = installNextSuggestions(session as unknown as SuggestionSessionPort, editor, "base", {
			env: { OMK_NEXT_SUGGESTIONS: "1" },
			quotaUsage: async () => "no_quota",
			acceptTrace: trace,
		})!;
		const sent = vi.spyOn(trace, "sent");
		const admission = (session as unknown as { _turnAdmission: { admit(...args: unknown[]): Promise<void> } })
			._turnAdmission;
		const realAdmit = admission.admit.bind(admission);
		let delivery: Promise<void> | undefined;
		let streamingAtDefer: boolean | undefined;
		vi.spyOn(admission, "admit").mockImplementation(async (...args: unknown[]) => {
			if (delivery === undefined) {
				streamingAtDefer = session.isStreaming;
				trace.shown(meta, "background done");
				trace.accepted(4);
				delivery = session.prompt("background done", { streamingBehavior: "followUp" });
				await delivery;
				throw new Error("admission refused");
			}
			return realAdmit(...args);
		});
		await session.prompt("start").catch(() => undefined);
		await delivery;
		await vi.waitFor(() => expect(session.isStreaming).toBe(false));
		await vi.waitFor(() => expect(harness!.session.runJournalRecords.at(-1)?.event).toBe("run_finished"), {
			timeout: 3000,
		});
		expect(streamingAtDefer).toBe(false);
		expect(records.map((r) => [r.sentAs, r.sentVia])).toEqual([["exact", "followUp"]]);
		expect(sent).toHaveBeenCalledTimes(1);
		controller.dispose();
	});
});
