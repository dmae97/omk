import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CompactionEnvelope, validateCompactionEnvelope } from "../src/core/compaction/transaction.ts";
import { rebindBranchedCompactionEnvelopes } from "../src/core/session-file-compaction.ts";
import {
	buildSessionContext,
	type CompactionEntry,
	type SessionEntry,
	type SessionHeader,
	SessionManager,
} from "../src/core/session-manager.ts";
import { assistantMsg, userMsg } from "./utilities.ts";

function sourceDigest(entries: readonly SessionEntry[]): string {
	return createHash("sha256")
		.update(entries.map((entry) => JSON.stringify(entry)).join("\n"), "utf8")
		.digest("hex");
}

function envelopeForEntries(
	session: SessionManager,
	entries: readonly SessionEntry[],
	summary: string,
): CompactionEnvelope {
	const first = entries[0];
	const last = entries.at(-1);
	if (!first || !last) throw new Error("expected compaction source entries");
	return validateCompactionEnvelope({
		schemaVersion: 2,
		transactionId: `txn-${last.id}`,
		baseRevision: session.getDurableHeadToken(),
		source: {
			sessionId: session.getSessionId(),
			entryIds: entries.map((entry) => entry.id),
			firstEntryId: first.id,
			lastEntryId: last.id,
			sourceSha256: sourceDigest(entries),
			activeLeafId: last.id,
			messageCount: session.buildSessionContext().messages.length,
		},
		createdAt: "2026-07-19T00:00:00.000Z",
		model: { provider: "test", id: "model" },
		summary,
		summarySha256: createHash("sha256").update(summary, "utf8").digest("hex"),
		preserved: {
			latestIntent: "continue",
			openTasks: [],
			laneIds: [],
			acceptancePredicateIds: [],
			evidenceReceiptIds: [],
			blockerReasons: [],
			repairEventIds: [],
			branch: null,
			worktree: null,
			modelHistory: [],
			nextAction: "continue",
		},
	});
}

function makeMessageEntry(id: string, parentId: string | null, text: string, ts: number): SessionEntry {
	return {
		type: "message",
		id,
		parentId,
		timestamp: new Date(ts).toISOString(),
		message: { role: "user", content: text, timestamp: ts },
	};
}

describe("N09: multi-compaction fork aligns with reopen source window contract", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "omk-n09-fork-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("forks a twice-compacted session whose second compaction attested the kept window and reopens cleanly", () => {
		const session = SessionManager.create(dir, dir);
		session.appendMessage(userMsg("one"));
		const m2 = session.appendMessage(assistantMsg("two"));
		const branch1 = session.getBranch();
		session.appendCompaction("first summary", m2, 100, {
			compactionEnvelope: envelopeForEntries(session, branch1, "first summary"),
		});
		session.appendMessage(userMsg("three"));
		const m4 = session.appendMessage(assistantMsg("four"));
		const branch2 = session.getBranch();
		const windowStart = branch2.findIndex((entry) => entry.id === m2);
		const windowed = branch2.slice(windowStart);
		expect(windowed.length).toBeLessThan(branch2.length);
		session.appendCompaction("second summary", m4, 200, {
			compactionEnvelope: envelopeForEntries(session, windowed, "second summary"),
		});
		const leafId = session.appendMessage(userMsg("five"));
		const sessionFile = session.getSessionFile()!;

		// Reopen succeeds
		const reopened = SessionManager.open(sessionFile, dir);
		expect(reopened.getLeafId()).toBe(leafId);

		// Fork must also succeed and produce a verifiable forked session
		const forkedPath = reopened.createBranchedSession(leafId);
		expect(forkedPath).toBeTruthy();
		const reopenedFork = SessionManager.open(forkedPath!, dir);
		expect(reopenedFork.buildSessionContext().messages.length).toBeGreaterThan(0);
	});

	it("still rejects a tampered second compaction during fork rebinding", () => {
		const session = SessionManager.create(dir, dir);
		session.appendMessage(userMsg("one"));
		const m2 = session.appendMessage(assistantMsg("two"));
		session.appendCompaction("first summary", m2, 100, {
			compactionEnvelope: envelopeForEntries(session, session.getBranch(), "first summary"),
		});
		session.appendMessage(userMsg("three"));
		const m4 = session.appendMessage(assistantMsg("four"));
		const branch2 = session.getBranch();
		const windowed = branch2.slice(branch2.findIndex((entry) => entry.id === m2));
		const c2Id = session.appendCompaction("second summary", m4, 200, {
			compactionEnvelope: envelopeForEntries(session, windowed, "second summary"),
		});

		const branchEntries = session.getBranch();
		const tamperedEntries = branchEntries.map((entry) => {
			if (entry.id !== c2Id || entry.type !== "compaction") return entry;
			const env = (entry.details as { compactionEnvelope: CompactionEnvelope }).compactionEnvelope;
			return {
				...entry,
				details: {
					compactionEnvelope: {
						...env,
						source: { ...env.source, sourceSha256: "0".repeat(64) },
					},
				},
			} satisfies CompactionEntry;
		});
		const forkHeader: SessionHeader = {
			type: "session",
			version: 3,
			id: "forked-tampered",
			timestamp: "2026-07-19T00:00:01.000Z",
			cwd: dir,
		};
		expect(() => rebindBranchedCompactionEnvelopes(forkHeader, tamperedEntries)).toThrow(
			/Invalid compaction envelope source/i,
		);
	});
});

describe("N10: corrupted session parent cycles fail fast without infinite loops and preserve original JSONL", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "omk-n10-cycle-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("rejects self-parent cycle in buildSessionContext and getBranch while preserving the original file", () => {
		const header: SessionHeader = {
			type: "session",
			version: 3,
			id: "sess-self-cycle",
			timestamp: new Date(2000).toISOString(),
			cwd: dir,
		};
		const selfEntry = makeMessageEntry("e1", "e1", "self-loop", 2001);
		const file = join(dir, "self-cycle.jsonl");
		const raw = `${[header, selfEntry].map((e) => JSON.stringify(e)).join("\n")}\n`;
		writeFileSync(file, raw, "utf8");

		expect(() => buildSessionContext([selfEntry], "e1")).toThrow(/cycle/i);
		const sm = SessionManager.open(file, dir);
		expect(() => sm.buildSessionContext()).toThrow(/cycle/i);
		expect(() => sm.getBranch("e1")).toThrow(/cycle/i);
		expect(readFileSync(file, "utf8")).toBe(raw);
	});

	it("rejects mutual A<->B parent cycle in buildSessionContext, getBranch, and terminates safely in getTree", () => {
		const header: SessionHeader = {
			type: "session",
			version: 3,
			id: "sess-mutual-cycle",
			timestamp: new Date(3000).toISOString(),
			cwd: dir,
		};
		const a = makeMessageEntry("a", "b", "node-a", 3001);
		const b = makeMessageEntry("b", "a", "node-b", 3002);
		const file = join(dir, "mutual-cycle.jsonl");
		const raw = `${[header, a, b].map((e) => JSON.stringify(e)).join("\n")}\n`;
		writeFileSync(file, raw, "utf8");

		expect(() => buildSessionContext([a, b], "b")).toThrow(/cycle/i);
		const sm = SessionManager.open(file, dir);
		expect(() => sm.buildSessionContext()).toThrow(/cycle/i);
		expect(() => sm.getBranch("b")).toThrow(/cycle/i);
		expect(() => sm.getTree()).not.toThrow();
		expect(readFileSync(file, "utf8")).toBe(raw);
	});
});
