import { appendFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectRunJournal, RunJournal } from "../src/core/run-journal.ts";
import { appendRunJournalRecordDurably, RunJournalStore } from "../src/core/run-journal-store.ts";
import { classifySessionTermination } from "../src/core/session-termination.ts";

const SESSION = "performance-session";
const NOW = "2026-09-30T00:00:00.000Z";
const temporaryRoots: string[] = [];

function auditInput(index: number) {
	return {
		event: "tool_timeout" as const,
		details: { toolCallId: `call-${index}`, timeoutMs: 1, executionStarted: false },
		sessionRevision: index,
		timestamp: NOW,
	};
}

function temporaryJournalPath() {
	const root = join(tmpdir(), `omk-journal-performance-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(root, { recursive: true });
	temporaryRoots.push(root);
	return join(root, "session.runjournal");
}

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("run journal append cost and snapshot invariants", () => {
	it("hashes each new memory-only record once instead of replaying the accepted prefix", () => {
		let hashes = 0;
		const store = RunJournalStore.open({
			sessionId: SESSION,
			hashFn: (bytes) => {
				hashes += 1;
				return RunJournalStore.sha256(bytes);
			},
		});
		for (let index = 0; index < 128; index += 1) store.audit(auditInput(index));
		expect(hashes).toBe(128);
		const bytes = new TextEncoder().encode(`${store.records.map((record) => JSON.stringify(record)).join("\n")}\n`);
		expect(inspectRunJournal(bytes, RunJournalStore.sha256).ok).toBe(true);
	});

	it("retains immutable snapshots across later appends and reuses snapshots between reads", () => {
		const journal = new RunJournal({
			hashFn: RunJournalStore.sha256,
			sessionId: SESSION,
			runId: "seed",
			sessionRevision: 0,
			timestamp: NOW,
			openInitialRun: false,
		});
		const empty = journal.records;
		journal.audit(auditInput(0));
		const first = journal.records;
		expect(journal.records).toBe(first);
		journal.audit(auditInput(1));
		const second = journal.records;
		expect(empty).toHaveLength(0);
		expect(first).toHaveLength(1);
		expect(second).toHaveLength(2);
		expect(second[0]).toBe(first[0]);
		expect(Object.isFrozen(first)).toBe(true);
		if (!("details" in first[0])) throw new Error("Expected an audit record");
		expect(Object.isFrozen(first[0].details)).toBe(true);
		expect(() => (first as unknown[]).push("mutation")).toThrow();
	});

	it("retains store snapshots when the memory-only accepted journal advances", () => {
		const store = RunJournalStore.open({ sessionId: SESSION });
		store.audit(auditInput(0));
		const first = store.records;
		store.audit(auditInput(1));
		expect(first).toHaveLength(1);
		expect(store.records).toHaveLength(2);
		expect(store.records[0]).toBe(first[0]);
		expect(store.records).toBe(store.records);
	});

	it("keeps memory-only writer state unchanged when validation or sealing fails", () => {
		let throwHash = false;
		const store = RunJournalStore.open({
			sessionId: SESSION,
			hashFn: (bytes) => {
				if (throwHash) throw new Error("synthetic hash failure");
				return RunJournalStore.sha256(bytes);
			},
		});
		store.audit(auditInput(0));
		const first = store.records;
		expect(() => store.audit({ ...auditInput(1), sessionRevision: -1 })).toThrow();
		expect(store.records).toBe(first);
		throwHash = true;
		expect(() => store.audit(auditInput(1))).toThrow("failing closed");
		expect(store.records).toBe(first);
		throwHash = false;
		const next = store.audit(auditInput(1));
		expect(next.seq).toBe(1);
		expect(next.prevHash).toBe(first[0].hash);
	});

	it("retries failed persistence without exposing the rejected candidate in accepted snapshots", () => {
		const path = temporaryJournalPath();
		let failNext = true;
		const store = RunJournalStore.open({
			journalPath: path,
			sessionId: SESSION,
			persistRecord: (target, line) => {
				if (failNext) {
					failNext = false;
					throw new Error("synthetic persistence failure");
				}
				appendRunJournalRecordDurably(target, line);
			},
		});
		const empty = store.records;
		expect(() => store.start({ runId: "run-1", sessionRevision: 0, timestamp: NOW })).toThrow();
		expect(store.records).toBe(empty);
		expect(store.openRunId).toBeNull();
		store.start({ runId: "run-1", sessionRevision: 0, timestamp: NOW });
		const first = store.records;
		failNext = true;
		const terminal = {
			termination: classifySessionTermination({
				sessionId: SESSION,
				runId: "run-1",
				timestamp: NOW,
				source: "observed" as const,
				message: "Completed.",
				cause: { area: "completed" as const },
				sideEffects: "none" as const,
			}),
			sessionRevision: 1,
			timestamp: NOW,
		};
		expect(() => store.finish(terminal)).toThrow();
		expect(store.records).toBe(first);
		expect(store.openRunId).toBe("run-1");
		store.finish(terminal);
		expect(first).toHaveLength(1);
		expect(inspectRunJournal(readFileSync(path), RunJournalStore.sha256).ok).toBe(true);
	});

	it("keeps accepted state unchanged after an indeterminate persistent append", () => {
		const path = temporaryJournalPath();
		const store = RunJournalStore.open({
			journalPath: path,
			sessionId: SESSION,
			persistRecord: (target, line) => {
				appendRunJournalRecordDurably(target, line);
				appendFileSync(target, "indeterminate");
				throw new Error("post-append failure");
			},
		});
		const first = store.records;
		expect(() => store.audit(auditInput(0))).toThrow("post-append failure");
		expect(store.records).toBe(first);
		expect(first).toHaveLength(0);
		expect(() => store.audit(auditInput(1))).toThrow(/corrupt/);
		expect(readFileSync(path, "utf8")).toContain("indeterminate");
	});
});
