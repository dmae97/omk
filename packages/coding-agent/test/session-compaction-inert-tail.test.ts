/**
 * Compaction commit over an inert extension-state tail.
 *
 * Regression: background-task extensions (pi-landstrip persists
 * `landstrip.task` snapshots through `pi.appendEntry` every few seconds) moved
 * the durable session revision while the summary LLM call was in flight, so
 * every threshold, overflow and manual compaction was discarded with
 * `revision_mismatch` and a ~1M-token session could never recover.
 *
 * A `custom` entry that preserved provenance never cites is invisible to the
 * built-in summarizer, so the commit may rebase onto such an append-only tail.
 * Every other concurrent change must still discard the summary.
 *
 * Direct service-level tests: no model calls, no API keys.
 */

import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Api, AssistantMessage, Message, Model } from "omk-ai";
import { fauxAssistantMessage } from "omk-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runSessionDoctorCli } from "../src/commands/session-doctor-cli.ts";
import {
	type CompactionPreparation,
	DEFAULT_COMPACTION_SETTINGS,
	prepareCompaction,
} from "../src/core/compaction/compaction.ts";
import { rebaseOverInertTail } from "../src/core/compaction/inert-tail.ts";
import { SessionCompactionService } from "../src/core/session-compaction-service.ts";
import { SessionManager } from "../src/core/session-manager.ts";

const compactionModel = { provider: "test", id: "compaction-model" } as Model<Api>;

function userMessage(text: string): Message {
	return { role: "user", content: text, timestamp: Date.now() } as Message;
}

function assistantMessage(text: string): AssistantMessage {
	return { ...fauxAssistantMessage(text), timestamp: Date.now() };
}

function serviceFor(sessionManager: SessionManager): SessionCompactionService {
	return new SessionCompactionService({
		sessionManager,
		pendingToolCallIds: () => new Set<string>(),
		getUserMessageText: (message: Message) => (typeof message.content === "string" ? message.content : ""),
		cwd: process.cwd(),
		invalidateContextBudget: () => {},
		refreshAgentMessages: () => {},
		recordCommit: () => {},
	});
}

function seed(sessionManager: SessionManager): string {
	sessionManager.appendMessage(userMessage("please fix the failing check"));
	return sessionManager.appendMessage(assistantMessage("I will update the implementation."));
}

function appendTaskSnapshots(sessionManager: SessionManager, count: number): string[] {
	const ids: string[] = [];
	for (let index = 0; index < count; index += 1) {
		ids.push(sessionManager.appendCustomEntry("landstrip.task", { id: "task-1", state: "running", tick: index }));
	}
	return ids;
}

function result(firstKeptEntryId: string) {
	return { summary: "compacted summary", firstKeptEntryId, tokensBefore: 0 };
}

function hasCompaction(sessionManager: SessionManager): boolean {
	return sessionManager.getEntries().some((entry) => entry.type === "compaction");
}

describe("compaction commit over an inert extension-state tail", () => {
	it("commits when only extension state entries were appended during summarization", () => {
		const sessionManager = SessionManager.inMemory();
		const service = serviceFor(sessionManager);
		const kept = seed(sessionManager);

		const begun = service.beginTransaction(compactionModel, false);
		const appended = appendTaskSnapshots(sessionManager, 3);
		const committed = service.commit(begun, result(kept), false);

		expect(committed.entry.parentId).toBe(appended.at(-1));
		expect(committed.envelope.transactionId).toBe(begun.transaction.transactionId);
		expect(committed.envelope.source.activeLeafId).toBe(appended.at(-1));
		expect(committed.envelope.source.entryIds).toEqual([...begun.transaction.source.entryIds, ...appended]);
		expect(committed.envelope.baseRevision.lastEntryId).toBe(appended.at(-1));
		expect(sessionManager.buildSessionContext().messages[0]?.role).toBe("compactionSummary");
	});

	it("compacts a window dominated by more than 4096 extension state entries", () => {
		// The livelocked session had 4,388 branch entries, 3,196 of them landstrip.task
		// snapshots: token thresholds never bound an entry count that costs no tokens.
		const sessionManager = SessionManager.inMemory();
		const service = serviceFor(sessionManager);
		const kept = seed(sessionManager);
		appendTaskSnapshots(sessionManager, 4200);

		const begun = service.beginTransaction(compactionModel, false);
		appendTaskSnapshots(sessionManager, 3);
		const committed = service.commit(begun, result(kept), false);

		expect(committed.envelope.source.entryIds.length).toBe(2 + 4200 + 3);
	});

	it("still discards the summary when a message was appended during summarization", () => {
		const sessionManager = SessionManager.inMemory();
		const service = serviceFor(sessionManager);
		const kept = seed(sessionManager);

		const begun = service.beginTransaction(compactionModel, false);
		appendTaskSnapshots(sessionManager, 1);
		sessionManager.appendMessage(userMessage("a new instruction the summary never saw"));

		expect(() => service.commit(begun, result(kept), false)).toThrow(/revision_mismatch/);
		expect(hasCompaction(sessionManager)).toBe(false);
	});

	it("still discards the summary when an extension custom message entered the context", () => {
		const sessionManager = SessionManager.inMemory();
		const service = serviceFor(sessionManager);
		const kept = seed(sessionManager);

		const begun = service.beginTransaction(compactionModel, false);
		appendTaskSnapshots(sessionManager, 1);
		// Same extension, but a delivered task result is LLM-visible context, not state.
		sessionManager.appendCustomMessageEntry("landstrip.task.result", "task finished", true, { taskId: "task-1" });

		expect(() => service.commit(begun, result(kept), false)).toThrow(/revision_mismatch/);
		expect(hasCompaction(sessionManager)).toBe(false);
	});

	it("still discards the summary when a provenance-bearing custom entry was appended", () => {
		const sessionManager = SessionManager.inMemory();
		const service = serviceFor(sessionManager);
		const kept = seed(sessionManager);

		const begun = service.beginTransaction(compactionModel, false);
		sessionManager.appendCustomEntry("evidence_receipt", { receipt: "r1" });

		expect(() => service.commit(begun, result(kept), false)).toThrow(/revision_mismatch/);
		expect(hasCompaction(sessionManager)).toBe(false);
	});

	it("still discards the summary when the model changed during summarization", () => {
		const sessionManager = SessionManager.inMemory();
		const service = serviceFor(sessionManager);
		const kept = seed(sessionManager);

		const begun = service.beginTransaction(compactionModel, false);
		sessionManager.appendModelChange("test", "another-model");

		expect(() => service.commit(begun, result(kept), false)).toThrow(/revision_mismatch/);
		expect(hasCompaction(sessionManager)).toBe(false);
	});

	it("still discards the summary when the branch moved before extension state was appended", () => {
		const sessionManager = SessionManager.inMemory();
		const service = serviceFor(sessionManager);
		const kept = seed(sessionManager);
		const firstUser = sessionManager.getEntries()[0];
		if (firstUser === undefined) throw new Error("expected a seeded entry");

		const begun = service.beginTransaction(compactionModel, false);
		// Tree navigation writes nothing, so the file stays append-only and all-custom,
		// but the summary covers a branch that is no longer active.
		sessionManager.branch(firstUser.id);
		appendTaskSnapshots(sessionManager, 1);

		expect(() => service.commit(begun, result(kept), false)).toThrow(/revision_mismatch/);
		expect(hasCompaction(sessionManager)).toBe(false);
	});

	it("does not rebase an extension-provided summary, which may read its own custom state", () => {
		const sessionManager = SessionManager.inMemory();
		const service = serviceFor(sessionManager);
		const kept = seed(sessionManager);

		const begun = service.beginTransaction(compactionModel, false);
		appendTaskSnapshots(sessionManager, 2);

		expect(() => service.commit(begun, result(kept), true)).toThrow(/revision_mismatch/);
		expect(hasCompaction(sessionManager)).toBe(false);
	});
});

describe("inert-tail soundness preconditions", () => {
	it("leaves the built-in summarizer input unchanged when extension state is appended", () => {
		// The rebase is sound only while this holds: if the summarizer ever reads
		// custom entries, this fails and the inert-tail definition must be revisited.
		const sessionManager = SessionManager.inMemory();
		for (let turn = 0; turn < 6; turn += 1) {
			sessionManager.appendMessage(userMessage(`turn ${turn}: ${"please continue the work ".repeat(20)}`));
			sessionManager.appendMessage(assistantMessage(`reply ${turn}: ${"progress report ".repeat(25)}`));
		}
		const settings = { ...DEFAULT_COMPACTION_SETTINGS, keepRecentTokens: 150 };
		const summarizerInput = (preparation: CompactionPreparation | undefined) => ({
			firstKeptEntryId: preparation?.firstKeptEntryId,
			messagesToSummarize: preparation?.messagesToSummarize,
			turnPrefixMessages: preparation?.turnPrefixMessages,
			isSplitTurn: preparation?.isSplitTurn,
			tokensBefore: preparation?.tokensBefore,
			fileOps: preparation?.fileOps,
			ruleEntryIds: preparation?.currentRuleEntries?.map((entry) => entry.id),
		});

		const before = prepareCompaction(sessionManager.getBranch(), settings);
		appendTaskSnapshots(sessionManager, 5);
		const after = prepareCompaction(sessionManager.getBranch(), settings);

		expect(before?.messagesToSummarize.length).toBeGreaterThan(0);
		expect(summarizerInput(after)).toEqual(summarizerInput(before));
	});

	function gateFixture() {
		const sessionManager = SessionManager.inMemory();
		const service = serviceFor(sessionManager);
		seed(sessionManager);
		const { transaction } = service.beginTransaction(compactionModel, false);
		appendTaskSnapshots(sessionManager, 2);
		const current = service.captureState();
		const records = [sessionManager.getHeader(), ...sessionManager.getEntries()];
		const bytes = new TextEncoder().encode(`${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
		return { transaction, bytes, head: current.revision, headSource: current.source };
	}
	type GateFixture = ReturnType<typeof gateFixture>;

	it("rebases a genuine inert tail onto the head", () => {
		const { transaction, bytes, head, headSource } = gateFixture();
		expect(rebaseOverInertTail(transaction, bytes, head, headSource)?.baseRevision).toEqual(head);
	});

	const mutations: ReadonlyArray<readonly [string, (fixture: GateFixture) => GateFixture]> = [
		["another session id", (f) => ({ ...f, head: { ...f.head, sessionId: "another-session" } })],
		["a replaced file identity", (f) => ({ ...f, head: { ...f.head, fileIdentity: { dev: "1", ino: "2" } } })],
		[
			"a byte length the head does not attest",
			(f) => ({ ...f, head: { ...f.head, completeBytes: f.head.completeBytes + 1 } }),
		],
		[
			"a digest the head does not attest",
			(f) => ({ ...f, head: { ...f.head, completePrefixSha256: "0".repeat(64) } }),
		],
		[
			"a record count the tail does not match",
			(f) => ({ ...f, head: { ...f.head, recordCount: f.head.recordCount + 1 } }),
		],
	];
	it.each(mutations)("rejects %s", (_label, mutate) => {
		const { transaction, bytes, head, headSource } = mutate(gateFixture());
		expect(rebaseOverInertTail(transaction, bytes, head, headSource)).toBeNull();
	});
});

describe("compaction commit over an inert tail in a persisted session", () => {
	let tempDir: string;
	let cwd: string;
	let sessionDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `omk-inert-tail-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		cwd = join(tempDir, "project");
		sessionDir = join(tempDir, "sessions");
		mkdirSync(cwd, { recursive: true });
		mkdirSync(sessionDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("binds the rebased envelope to the real file position so the session reopens", async () => {
		const sessionManager = SessionManager.create(cwd, sessionDir);
		const service = serviceFor(sessionManager);
		// Real sessions record their model at start; the session doctor requires it.
		sessionManager.appendModelChange("test", "compaction-model");
		const kept = seed(sessionManager);
		const sessionFile = sessionManager.getSessionFile();
		if (!sessionFile) throw new Error("expected a persisted session file");

		const begun = service.beginTransaction(compactionModel, false);
		const appended = appendTaskSnapshots(sessionManager, 4);
		const committed = service.commit(begun, result(kept), false);
		expect(committed.entry.parentId).toBe(appended.at(-1));

		// Reopening runs validatePersistedCompactionEnvelopes against the bytes on disk.
		const reopened = SessionManager.open(sessionFile, sessionDir);
		const reopenedCompaction = reopened.getEntries().find((entry) => entry.type === "compaction");
		expect(reopenedCompaction?.id).toBe(committed.entry.id);
		expect(reopened.buildSessionContext().messages[0]?.role).toBe("compactionSummary");

		// The session doctor independently re-validates the persisted envelope.
		const lines: string[] = [];
		const doctor = await runSessionDoctorCli(["session", "doctor", "--session", sessionFile], {
			cwd,
			sessionDir,
			writeLine: (line) => lines.push(line),
		});
		expect(doctor.exitCode, lines.join("\n")).toBe(0);
	});

	it("discards the summary when captured bytes were rewritten in place, even with an inert tail", () => {
		const sessionManager = SessionManager.create(cwd, sessionDir);
		const service = serviceFor(sessionManager);
		const kept = seed(sessionManager);
		const sessionFile = sessionManager.getSessionFile();
		if (!sessionFile) throw new Error("expected a persisted session file");

		const begun = service.beginTransaction(compactionModel, false);
		appendTaskSnapshots(sessionManager, 1);
		// Same length, same inode: only the captured-prefix digest can notice this edit.
		const offset = readFileSync(sessionFile).indexOf("please fix");
		expect(offset).toBeGreaterThan(0);
		const fd = openSync(sessionFile, "r+");
		try {
			writeSync(fd, "please fax", offset);
		} finally {
			closeSync(fd);
		}

		expect(() => service.commit(begun, result(kept), false)).toThrow(/revision_mismatch/);
		expect(readFileSync(sessionFile, "utf8")).not.toContain('"type":"compaction"');
	});
});
