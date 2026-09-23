/**
 * Compaction under concurrent extension state writes, per model the user runs.
 *
 * The commit race is not model-specific: every model's summary call outlasts the
 * few seconds between pi-landstrip task snapshots. What does differ per model is
 * how compaction is triggered — each provider signals context overflow its own
 * way, and the context window sets the threshold. Each profile below drives the
 * real AgentSession trigger path with that model's identity, window and overflow
 * signal, while an extension persists state through the public appendEntry API.
 */

import {
	type AssistantMessage,
	createAssistantMessageEventStream,
	fauxAssistantMessage,
	type StopReason,
} from "omk-ai";
import { afterEach, describe, expect, it } from "vitest";
import type { ExtensionFactory } from "../../src/index.ts";
import { createHarness, type Harness } from "./harness.ts";

type SessionWithCompactionInternals = {
	_checkCompaction: (assistantMessage: AssistantMessage, skipAbortedCheck?: boolean) => Promise<boolean>;
};

interface ModelProfile {
	readonly provider: string;
	readonly id: string;
	/** The window the user's registry resolves (swe-2 is overridden to 262k in models.json). */
	readonly contextWindow: number;
	/** How this provider's context overflow reaches OMK. */
	readonly overflow: {
		readonly stopReason: StopReason;
		readonly errorMessage?: string;
		readonly inputTokens: number;
	};
}

const PROFILES: readonly ModelProfile[] = [
	{
		provider: "anthropic",
		id: "claude-opus-5-5",
		contextWindow: 1_000_000,
		// Verbatim shape of the error in the user's session.
		overflow: {
			stopReason: "error",
			errorMessage:
				'400 {"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long: 1028748 tokens > 1000000 maximum"},"request_id":"req_redacted"}',
			inputTokens: 0,
		},
	},
	{
		provider: "opencode-go",
		id: "mimo-v2.6-pro",
		contextWindow: 1_048_576,
		// MiMo truncates to the window and stops for length with no output (omk-ai overflow.ts, case 3).
		overflow: { stopReason: "length", inputTokens: 1_048_576 },
	},
	{
		provider: "devin",
		id: "swe-2",
		contextWindow: 262_000,
		// omk-ai devin-connect-stream.ts maps Devin's invalid_argument overflow to this message.
		overflow: { stopReason: "error", errorMessage: "Devin context_length_exceeded", inputTokens: 0 },
	},
];

/** Stands in for pi-landstrip: persists task state while the compaction is in flight. */
const extensionStateWriter: ExtensionFactory = (omk) => {
	omk.on("session_before_compact", async () => {
		// Emitted after the transaction captured its revision, so this lands mid-compaction.
		omk.appendEntry("landstrip.task", { id: "task-1", state: "running" });
	});
};

function usage(input: number, output: number) {
	return {
		input,
		output,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: input + output,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function assistantFrom(profile: ModelProfile, fields: Partial<AssistantMessage>): AssistantMessage {
	return {
		...fauxAssistantMessage("progress report"),
		api: "openai-completions",
		provider: profile.provider,
		model: profile.id,
		usage: usage(1_000, 50),
		...fields,
	};
}

async function harnessFor(profile: ModelProfile): Promise<Harness> {
	const harness = await createHarness({
		provider: profile.provider,
		models: [{ id: profile.id, contextWindow: profile.contextWindow, reasoning: true }],
		withConfiguredAuth: false,
		persistSession: true,
		extensionFactories: [extensionStateWriter],
	});
	harness.session.agent.streamFn = (model) => {
		const stream = createAssistantMessageEventStream();
		queueMicrotask(() => {
			const message: AssistantMessage = {
				...fauxAssistantMessage(`summary by ${model.provider}/${model.id}`),
				api: model.api,
				provider: model.provider,
				model: model.id,
				usage: usage(10, 10),
			};
			stream.push({ type: "done", reason: "stop", message });
		});
		return stream;
	};
	const now = Date.now();
	harness.sessionManager.appendMessage({ role: "user", content: "continue the task", timestamp: now - 2_000 });
	harness.sessionManager.appendMessage(assistantFrom(profile, { stopReason: "stop", timestamp: now - 1_500 }));
	harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
	return harness;
}

function compactionErrors(harness: Harness): string[] {
	return harness
		.eventsOfType("compaction_end")
		.map((event) => event.errorMessage)
		.filter((message): message is string => message !== undefined);
}

function expectCommittedOverExtensionState(harness: Harness): void {
	const errors = compactionErrors(harness);
	// The message carries the discarded-summary reason verbatim into any reporter.
	expect(errors, errors.join("\n")).toEqual([]);
	const entries = harness.sessionManager.getEntries();
	const compaction = entries.find((entry) => entry.type === "compaction");
	const parent = entries.find((entry) => entry.id === compaction?.parentId);
	expect(parent?.type === "custom" && parent.customType).toBe("landstrip.task");
}

describe.each(PROFILES)("compaction while an extension writes state: $provider/$id", (profile) => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	it("recovers from this model's own context-overflow signal", async () => {
		const harness = await harnessFor(profile);
		harnesses.push(harness);
		const overflow = assistantFrom(profile, {
			stopReason: profile.overflow.stopReason,
			errorMessage: profile.overflow.errorMessage,
			usage: usage(profile.overflow.inputTokens, 0),
			timestamp: Date.now(),
		});
		harness.sessionManager.appendMessage(overflow);
		harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;

		const willRetry = await (harness.session as unknown as SessionWithCompactionInternals)._checkCompaction(overflow);

		expectCommittedOverExtensionState(harness);
		expect(willRetry).toBe(true);
		expect(harness.eventsOfType("compaction_start").map((event) => event.reason)).toEqual(["overflow"]);
	});

	it("compacts at this model's context-window threshold", async () => {
		const harness = await harnessFor(profile);
		harnesses.push(harness);
		const nearFull = assistantFrom(profile, {
			stopReason: "stop",
			usage: usage(Math.round(profile.contextWindow * 0.95), 50),
			timestamp: Date.now(),
		});
		harness.sessionManager.appendMessage(nearFull);
		harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;

		await (harness.session as unknown as SessionWithCompactionInternals)._checkCompaction(nearFull);

		expectCommittedOverExtensionState(harness);
		expect(harness.eventsOfType("compaction_start").map((event) => event.reason)).toEqual(["threshold"]);
	});
});
