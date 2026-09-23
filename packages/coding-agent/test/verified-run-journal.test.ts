import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRunContract, parseRunStartCommand } from "omk-protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireSessionOwnerLeaseSync, type SessionOwnerLease } from "../src/core/session-owner-lease.ts";
import type { RunEvent } from "../src/core/verified-run/events.ts";
import { journalPath, readRunJournal, VerifiedRunJournal } from "../src/core/verified-run/journal.ts";
import { digestObject } from "../src/core/verified-run/storage.ts";

let root: string;
let owner: SessionOwnerLease;
const creation = (): RunEvent => {
	const contract = parseRunContract({
		schemaVersion: "omk.verified-run.v1",
		profile: "linux-command-v1",
		runId: "run-1",
		goal: "test",
		workspace: { root: "/workspace", baseDigest: "a".repeat(64) },
		writablePaths: ["answer"],
		writer: ["/bin/true"],
		checks: [{ claimId: "answer", argv: ["/bin/true"], stdout: "" }],
		budget: { workMs: 1000, verifyMs: 1000, cleanupMs: 15000, maxOutputBytes: 1024, maxFiles: 10, maxBytes: 1024 },
		apply: "artifact-only",
	});
	const command = parseRunStartCommand({
		schemaVersion: "omk.verified-command.v1",
		kind: "start",
		runId: contract.runId,
		commandId: "command-1",
		expectedRevision: 0,
		expectedGeneration: 0,
		contractDigest: digestObject(contract),
	});
	return { kind: "created", contract, command };
};
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "verified-journal-"));
	owner = acquireSessionOwnerLeaseSync(journalPath(root));
});
afterEach(() => {
	owner.release();
	rmSync(root, { recursive: true, force: true });
});

describe("verified-run durable commit", () => {
	it("does not advance its accepted state when durable append fails", () => {
		new VerifiedRunJournal(root, owner).append(creation());
		const journal = new VerifiedRunJournal(root, owner, () => {
			throw new Error("injected fsync failure");
		});
		const before = journal.state;
		expect(() =>
			journal.append({ kind: "dispatch", executionId: "execution-1", role: "writer", claimId: null }),
		).toThrow(/fsync/);
		expect(journal.state).toEqual(before);
		expect(() => journal.append({ kind: "failed", code: "failure" })).toThrow(/stale_owner/);
		expect(readRunJournal(root)?.state).toEqual(before);
	});

	it("refuses another writer while the owner is alive", () => {
		expect(() => acquireSessionOwnerLeaseSync(journalPath(root))).toThrow(/owner/);
	});

	it("fences a released owner even if it retained the journal object", () => {
		const journal = new VerifiedRunJournal(root, owner);
		journal.append(creation());
		owner.release();
		expect(() => journal.append({ kind: "failed", code: "failure" })).toThrow(/stale_owner/);
	});

	it("fences stale durable heads held by the same owner", () => {
		const first = new VerifiedRunJournal(root, owner);
		const stale = new VerifiedRunJournal(root, owner);
		first.append(creation());
		expect(() => stale.append(creation())).toThrow(/stale_revision/);
	});

	it("replays without dispatching and retains unresolved execution ownership", () => {
		const journal = new VerifiedRunJournal(root, owner);
		journal.append(creation());
		journal.append({ kind: "dispatch", executionId: "execution-1", role: "writer", claimId: null });
		const before = readFileSync(journalPath(root));
		const replayed = readRunJournal(root);
		expect(replayed?.state).toMatchObject({
			execution: "running",
			settlement: "draining",
			activeExecutionIds: ["execution-1"],
		});
		expect(readFileSync(journalPath(root))).toEqual(before);
	});

	it("rejects duplicate and foreign completions without settling the active execution", () => {
		const journal = new VerifiedRunJournal(root, owner);
		journal.append(creation());
		journal.append({ kind: "dispatch", executionId: "execution-1", role: "writer", claimId: null });
		expect(() => journal.append({ kind: "exited", executionId: "other", failure: null })).toThrow(/integrity/);
		journal.append({ kind: "exited", executionId: "execution-1", failure: null });
		expect(() => journal.append({ kind: "exited", executionId: "execution-1", failure: null })).toThrow(/integrity/);
	});

	it("refuses forged completion before candidate and checks exist", () => {
		const journal = new VerifiedRunJournal(root, owner);
		journal.append(creation());
		expect(() => journal.append({ kind: "evaluated", receiptDigest: "a".repeat(64), verified: true })).toThrow(
			/integrity/,
		);
	});

	it("quarantines unsettled work rather than clearing execution reservations", () => {
		const journal = new VerifiedRunJournal(root, owner);
		journal.append(creation());
		journal.append({ kind: "dispatch", executionId: "execution-1", role: "writer", claimId: null });
		const state = journal.append({ kind: "failed", code: "unsettled" });
		expect(state).toMatchObject({
			settlement: "quarantined",
			activeExecutionIds: ["execution-1"],
			verification: "inconclusive",
		});
	});

	it("refuses torn tails without repairing during inspection", () => {
		new VerifiedRunJournal(root, owner).append(creation());
		appendFileSync(journalPath(root), '{"version":2');
		const before = readFileSync(journalPath(root));
		expect(() => readRunJournal(root)).toThrow(/journal_truncated/);
		expect(readFileSync(journalPath(root))).toEqual(before);
	});

	it("refuses middle corruption and does not read legacy v1 as v2", () => {
		new VerifiedRunJournal(root, owner).append(creation());
		const bytes = readFileSync(journalPath(root), "utf8");
		writeFileSync(journalPath(root), bytes.replace('"version":2', '"version":1'));
		expect(() => readRunJournal(root)).toThrow(/integrity/);
	});

	it("treats a missing run as missing without creating directories", () => {
		const absent = join(root, "absent");
		expect(readRunJournal(absent)).toBeNull();
		mkdirSync(absent);
	});
});
