/**
 * Deterministic emergency compaction — the quota/auth stranding fix.
 *
 * Mechanism this pins: `compact()` rethrows the provider error when the
 * compaction model's quota is exhausted and every failover candidate is also
 * blocked (or none is authenticated). The session is then over its context
 * window with no way to shrink it — auto-compaction can never succeed until the
 * billing cycle resets, so the run is stranded.
 *
 * The fallback builds the summary from what `prepareCompaction()` already
 * derived deterministically (previous summary, source-bound user rules, file
 * operations) and never claims to be a model summary. No provider call, no
 * model argument — the signature itself proves the model path is not taken.
 */

import type { AgentMessage } from "omk-agent-core";
import { type AssistantMessage, createAssistantMessageEventStream, fauxAssistantMessage } from "omk-ai";
import { afterEach, describe, expect, it } from "vitest";
import type { CompactionPreparation, CompactionSettings } from "../src/core/compaction/compaction.ts";
import { compactDeterministic, type DeterministicCompactionDetails } from "../src/core/compaction/fallback.ts";
import { createFileOps } from "../src/core/compaction/utils.ts";
import type { SessionEntry } from "../src/core/session-manager.ts";
import { createHarness, type Harness } from "./suite/harness.ts";

const SETTINGS: CompactionSettings = {
	enabled: true,
	reserveTokens: 1000,
	keepRecentTokens: 100,
};

const QUOTA_REASON = "Codex error: The usage limit has been reached";

function user(content: string): AgentMessage {
	return { role: "user", content, timestamp: 0 } as unknown as AgentMessage;
}

function userEntry(id: string, content: string): SessionEntry {
	return {
		type: "message",
		id,
		parentId: null,
		timestamp: "2026-09-20T00:00:00.000Z",
		message: user(content),
	} as unknown as SessionEntry;
}

function makePreparation(overrides: Partial<CompactionPreparation> = {}): CompactionPreparation {
	return {
		firstKeptEntryId: "kept-1",
		messagesToSummarize: [user("hello")],
		turnPrefixMessages: [],
		isSplitTurn: false,
		tokensBefore: 4242,
		fileOps: createFileOps(),
		settings: SETTINGS,
		...overrides,
	};
}

function details(result: { details?: unknown }): DeterministicCompactionDetails {
	return result.details as DeterministicCompactionDetails;
}

describe("compactDeterministic", () => {
	it("produces a committable result with no model and no provider call", () => {
		const result = compactDeterministic(makePreparation(), QUOTA_REASON);

		expect(result.firstKeptEntryId).toBe("kept-1");
		expect(result.tokensBefore).toBe(4242);
		expect(result.summary.length).toBeGreaterThan(0);
	});

	it("marks itself as a deterministic trim instead of impersonating a summary", () => {
		const result = compactDeterministic(makePreparation(), QUOTA_REASON);

		expect(result.summary).toMatch(/deterministic emergency compaction/i);
		expect(details(result).deterministicEmergency).toBe(true);
	});

	it("records the triggering reason so the operator can act on it", () => {
		const result = compactDeterministic(makePreparation(), QUOTA_REASON);

		expect(details(result).deterministicReason).toContain("usage limit");
		expect(result.summary).toContain("usage limit");
	});

	it("carries the previous compaction summary forward", () => {
		const result = compactDeterministic(
			makePreparation({ previousSummary: "## Goal\nShip the observation kernel." }),
			QUOTA_REASON,
		);

		expect(result.summary).toContain("Ship the observation kernel.");
	});

	it("preserves source-bound user rules through the same triage as the model path", () => {
		const direct = "ordinary chatter\nRULE: keep deterministic gates authoritative";
		const result = compactDeterministic(
			makePreparation({
				messagesToSummarize: [user(direct)],
				currentRuleEntries: [userEntry("entry-1", direct)],
			}),
			QUOTA_REASON,
		);

		expect(result.summary).toContain("RULE: keep deterministic gates authoritative");
		expect(details(result).preservedRules?.map((rule) => rule.text)).toEqual([
			"RULE: keep deterministic gates authoritative",
		]);
		expect(result.summary).not.toContain("ordinary chatter");
	});

	it("keeps the deterministic file lists the model path would have emitted", () => {
		const fileOps = createFileOps();
		fileOps.read.add("src/read-only.ts");
		fileOps.edited.add("src/changed.ts");

		const result = compactDeterministic(makePreparation({ fileOps }), QUOTA_REASON);

		expect(details(result).readFiles).toEqual(["src/read-only.ts"]);
		expect(details(result).modifiedFiles).toEqual(["src/changed.ts"]);
		expect(result.summary).toContain("src/changed.ts");
	});

	it("redacts a credential-shaped reason instead of persisting it", () => {
		// Assembled at runtime so the fixture never lands in source as a literal
		// credential shape for the secret scanner to flag.
		const fakeSecret = `sk-${"x".repeat(24)}`;
		const result = compactDeterministic(
			makePreparation(),
			`provider rejected api_key=${fakeSecret} while summarizing`,
		);

		expect(result.summary).not.toContain(fakeSecret);
		expect(details(result).deterministicReason).not.toContain(fakeSecret);
	});

	it("bounds an unreasonably long reason", () => {
		const result = compactDeterministic(makePreparation(), "x".repeat(5000));

		expect((details(result).deterministicReason ?? "").length).toBeLessThanOrEqual(512);
	});

	it("still works when the session has no prior summary, rules, or file ops", () => {
		const result = compactDeterministic(
			makePreparation({ messagesToSummarize: [], currentRuleEntries: [] }),
			QUOTA_REASON,
		);

		expect(result.summary).toMatch(/deterministic emergency compaction/i);
		expect(details(result).readFiles).toEqual([]);
		expect(details(result).modifiedFiles).toEqual([]);
	});
});

/**
 * Real entry point: `_runAutoCompaction`. A unit-green helper does not prove the
 * stranded session recovers, so these drive the same method the runtime calls.
 */
type SessionWithCompactionInternals = {
	_runAutoCompaction: (reason: "overflow" | "threshold", willRetry: boolean) => Promise<boolean>;
};

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

/**
 * Per-model stream outcomes: `quotaFor` ids fail with an exhaustion error, every
 * other model returns `summary`. Lets a test prove which model actually rescued
 * the compaction rather than just that one happened.
 */
function useModelKeyedStreamFn(
	harness: Harness,
	options: { readonly quotaFor: readonly string[]; readonly summary: string },
): () => string[] {
	const used: string[] = [];
	harness.session.agent.streamFn = (model) => {
		used.push(`${model.provider}/${model.id}`);
		const stream = createAssistantMessageEventStream();
		const failing = options.quotaFor.includes(model.id);
		queueMicrotask(() => {
			const base = failing
				? fauxAssistantMessage("", {
						stopReason: "error",
						errorMessage: "Codex error: The usage limit has been reached",
					})
				: fauxAssistantMessage(options.summary, { stopReason: "stop" });
			const message: AssistantMessage = {
				...base,
				api: model.api,
				provider: model.provider,
				model: model.id,
				usage: createUsage(failing ? 0 : 10),
			};
			if (failing) stream.push({ type: "error", reason: "error", error: message });
			else stream.push({ type: "done", reason: "stop", message });
		});
		return stream;
	};
	return () => used;
}

/** Every summarization attempt fails with `errorMessage`, including failover models. */
function useFailingSummaryStreamFn(harness: Harness, errorMessage: string): () => number {
	let callCount = 0;
	harness.session.agent.streamFn = (model) => {
		callCount++;
		const stream = createAssistantMessageEventStream();
		queueMicrotask(() => {
			const message: AssistantMessage = {
				...fauxAssistantMessage("", { stopReason: "error", errorMessage }),
				api: model.api,
				provider: model.provider,
				model: model.id,
				usage: createUsage(0),
			};
			stream.push({ type: "error", reason: "error", error: message });
		});
		return stream;
	};
	return () => callCount;
}

function assistant(harness: Harness, text: string, tokens: number, timestamp: number): AssistantMessage {
	const model = harness.getModel();
	return {
		...fauxAssistantMessage(text, { stopReason: "stop", timestamp }),
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: createUsage(tokens),
	};
}

/**
 * Enough history that the cut point actually drops the rule-bearing turn.
 * With only two entries `findCutPoint` keeps both, nothing is summarized, and
 * a preservation assertion would pass vacuously.
 */
function seedCompactableSession(harness: Harness): void {
	const now = Date.now();
	harness.sessionManager.appendMessage({
		role: "user",
		content: [{ type: "text", text: "RULE: never drop the acceptance gate" }],
		timestamp: now - 5000,
	});
	for (let index = 0; index < 3; index += 1) {
		harness.sessionManager.appendMessage(
			assistant(harness, `work ${index}`, 100 * (index + 1), now - 4000 + index * 100),
		);
		harness.sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: `next ${index}` }],
			timestamp: now - 3900 + index * 100,
		});
	}
	harness.sessionManager.appendMessage(assistant(harness, "", 1000, now - 500));
	harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
}

function compactionEntries(harness: Harness) {
	return harness.sessionManager.getEntries().filter((entry) => entry.type === "compaction");
}

describe("auto-compaction under exhausted quota", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	it("commits a deterministic entry instead of stranding the session", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		seedCompactableSession(harness);
		const getCalls = useFailingSummaryStreamFn(harness, "Codex error: The usage limit has been reached");

		const resumed = await (harness.session as unknown as SessionWithCompactionInternals)._runAutoCompaction(
			"threshold",
			false,
		);

		const entries = compactionEntries(harness);
		expect(entries).toHaveLength(1);
		expect(entries[0]?.summary).toMatch(/deterministic emergency compaction/i);
		expect(entries[0]?.summary).toContain("usage limit");
		expect(getCalls()).toBeGreaterThan(0);
		expect(typeof resumed).toBe("boolean");
	});

	it("keeps source-bound user rules across the deterministic trim", async () => {
		// keepRecentTokens: 1 forces the cut past the rule message, so the rule is
		// actually summarized away rather than surviving in the retained window —
		// otherwise this asserts nothing about preservation.
		const harness = await createHarness({ settings: { compaction: { keepRecentTokens: 1 } } });
		harnesses.push(harness);
		seedCompactableSession(harness);
		useFailingSummaryStreamFn(harness, "Codex error: The usage limit has been reached");

		await (harness.session as unknown as SessionWithCompactionInternals)._runAutoCompaction("threshold", false);

		expect(compactionEntries(harness)[0]?.summary).toContain("RULE: never drop the acceptance gate");
	});

	it("rescues a quota-blocked pinned compaction model with the live session model", async () => {
		// The pinned model is dead, but the model the user is actively talking to
		// still works. Falling back to it beats degrading to a deterministic trim.
		const harness = await createHarness({
			models: [{ id: "faux-1" }, { id: "pinned-compactor" }],
			settings: { compaction: { model: "faux/pinned-compactor", keepRecentTokens: 1 } },
		});
		harnesses.push(harness);
		seedCompactableSession(harness);
		const usedModels = useModelKeyedStreamFn(harness, {
			quotaFor: ["pinned-compactor"],
			summary: "summary from the live session model",
		});

		await (harness.session as unknown as SessionWithCompactionInternals)._runAutoCompaction("threshold", false);

		const entries = compactionEntries(harness);
		expect(entries).toHaveLength(1);
		expect(entries[0]?.summary).toContain("summary from the live session model");
		expect(entries[0]?.summary).not.toMatch(/deterministic emergency compaction/i);
		expect(usedModels()).toContain("faux/pinned-compactor");
		expect(usedModels()).toContain("faux/faux-1");
	});

	it("does not degrade a transient failure that should retry the model", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		seedCompactableSession(harness);
		useFailingSummaryStreamFn(harness, "provider returned error 503 service unavailable");

		const resumed = await (harness.session as unknown as SessionWithCompactionInternals)._runAutoCompaction(
			"threshold",
			false,
		);

		expect(compactionEntries(harness)).toHaveLength(0);
		expect(resumed).toBe(false);
	});
});
