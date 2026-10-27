import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRunContract, parseRunStartCommand } from "omk-protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireSessionOwnerLeaseSync, type SessionOwnerLease } from "../src/core/session-owner-lease.ts";
import { cancelVerifiedRun } from "../src/core/verified-run/cancel-request.ts";
import { readRunExplanation } from "../src/core/verified-run/explanation.ts";
import {
	JOURNAL_READ_RETRIES,
	journalPath,
	readJournalBytes,
	readRunJournal,
	VerifiedRunJournal,
} from "../src/core/verified-run/journal.ts";
import { collectVerifiedRuns } from "../src/core/verified-run/run-gc.ts";
import type { AuthorityStatus } from "../src/core/verified-run/run-status.ts";
import { digestObject, VerifiedRunConcurrentChangeError, VerifiedRunError } from "../src/core/verified-run/storage.ts";

const RUN_ID = "run-1";
const authority = {
	epoch: null,
	reconciledEpoch: null,
	pendingReconcile: false,
	blockingGrants: [],
	settledGrantCount: 0,
	tombstoneCount: 0,
	incarnations: [],
} as unknown as AuthorityStatus;

function created() {
	const contract = parseRunContract({
		schemaVersion: "omk.verified-run.v1",
		profile: "linux-command-v1",
		runId: RUN_ID,
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
		runId: RUN_ID,
		commandId: "command-1",
		expectedRevision: 0,
		expectedGeneration: 0,
		contractDigest: digestObject(contract),
	});
	return { kind: "created" as const, contract, command };
}

describe("journal read retry (spec 056)", () => {
	const changed = () => new VerifiedRunConcurrentChangeError();

	it("retries only a concurrent change and reports the attempt that succeeded", () => {
		for (const failures of [0, 1, 2, JOURNAL_READ_RETRIES]) {
			let calls = 0;
			const result = readJournalBytes("journal", () => {
				calls += 1;
				if (calls <= failures) throw changed();
				return Buffer.from("ok\n");
			});
			expect(result.attempts).toBe(failures + 1);
			expect(calls).toBe(failures + 1);
		}
	});

	it("surfaces the current integrity error after the retries are used up", () => {
		// 2 assertions before the try/catch + 2 inside the catch: fails if the second read does not throw.
		expect.assertions(4);
		let calls = 0;
		const read = () => {
			calls += 1;
			throw changed();
		};
		expect(() => readJournalBytes("journal", read)).toThrow(VerifiedRunConcurrentChangeError);
		expect(calls).toBe(JOURNAL_READ_RETRIES + 1);
		try {
			readJournalBytes("journal", read);
		} catch (error) {
			expect((error as VerifiedRunError).code).toBe("integrity");
			expect((error as Error).message).toBe("verified-run: integrity");
		}
	});

	it("never retries real corruption or other read failures", () => {
		for (const error of [
			new VerifiedRunError("integrity"),
			new VerifiedRunError("file_type"),
			new VerifiedRunError("storage_limit"),
			new Error("EIO"),
		]) {
			let calls = 0;
			expect(() =>
				readJournalBytes("journal", () => {
					calls += 1;
					throw error;
				}),
			).toThrow(error);
			expect(calls).toBe(1);
		}
	});
});

describe("live journal readers under a concurrent writer (spec 056)", () => {
	let stateRoot: string;
	let runPath: string;
	let owner: SessionOwnerLease;
	let mutator: ChildProcess | undefined;

	beforeEach(() => {
		stateRoot = mkdtempSync(join(tmpdir(), "journal-retry-"));
		runPath = join(stateRoot, RUN_ID);
		mkdirSync(runPath);
		owner = acquireSessionOwnerLeaseSync(journalPath(runPath));
		const journal = new VerifiedRunJournal(runPath, owner);
		journal.append(created());
		journal.append({ kind: "dispatch", executionId: "execution-1", role: "writer", claimId: null });
	});
	afterEach(async () => {
		if (mutator && mutator.exitCode === null) {
			const closed = new Promise((resolve) => mutator?.once("close", resolve));
			mutator.kill("SIGKILL");
			await closed;
		}
		mutator = undefined;
		owner.release();
		rmSync(stateRoot, { recursive: true, force: true });
	});

	/**
	 * Keeps the live journal moving between two valid states (with and without one more
	 * record) about every millisecond, so every complete read is a valid journal but size
	 * and ctime keep changing, far more often than a real writer appends.
	 */
	/**
	 * `burst` instead changes the journal back to back for `burstMs`, then holds it for `holdMs`.
	 * A strict read's 12 ms retry window fits inside one burst; a reader-mode read's 250 ms budget
	 * (attempts at about 0, 2, 6, 14, 30, 62, 126 and 250 ms) always reaches a stable hold.
	 */
	async function startMutator(burst?: { readonly burstMs: number; readonly holdMs: number }): Promise<void> {
		const path = journalPath(runPath);
		const base = readFileSync(path);
		const probe = new VerifiedRunJournal(runPath, owner);
		probe.append({ kind: "exited", executionId: "execution-1", failure: null });
		const tail = readFileSync(path).subarray(base.length);
		const script = `
			const fs = require("node:fs");
			const [path, baseLength, tail] = [process.argv[1], Number(process.argv[2]), Buffer.from(process.argv[3], "base64")];
			const fd = fs.openSync(path, "r+");
			fs.ftruncateSync(fd, baseLength);
			process.stdout.write("ready\\n");
			const pause = new Int32Array(new SharedArrayBuffer(4));
			// The two valid states the test names: the base prefix, and base + one complete record.
			// Each transition is one write of the whole record, so the file never holds a partial
			// line; only the size/ctime window between a reader's check and its read is racy.
			const [burstMs, holdMs] = [Number(process.argv[4]), Number(process.argv[5])];
			for (;;) {
				if (burstMs > 0) {
					const until = performance.now() + burstMs;
					while (performance.now() < until) {
						fs.writeSync(fd, tail, 0, tail.length, baseLength);
						fs.ftruncateSync(fd, baseLength);
					}
					Atomics.wait(pause, 0, 0, holdMs);
					continue;
				}
				fs.writeSync(fd, tail, 0, tail.length, baseLength);
				Atomics.wait(pause, 0, 0, 1);
				fs.ftruncateSync(fd, baseLength);
				Atomics.wait(pause, 0, 0, 1);
			}
		`;
		mutator = spawn(
			process.execPath,
			[
				"-e",
				script,
				path,
				String(base.length),
				tail.toString("base64"),
				String(burst?.burstMs ?? 0),
				String(burst?.holdMs ?? 0),
			],
			{
				stdio: ["ignore", "pipe", "inherit"],
			},
		);
		await new Promise<void>((resolve, reject) => {
			mutator?.stdout?.once("data", () => resolve());
			mutator?.once("error", reject);
		});
	}

	function hammer(read: () => unknown, ms = 1500): { reads: number; failures: string[] } {
		const failures: string[] = [];
		let reads = 0;
		const deadline = performance.now() + ms;
		while (performance.now() < deadline) {
			reads += 1;
			try {
				read();
			} catch (error) {
				failures.push(error instanceof VerifiedRunError ? error.code : String(error));
			}
		}
		return { reads, failures };
	}

	async function hammerAsync(read: () => Promise<unknown>, ms = 1500): Promise<{ reads: number; failures: string[] }> {
		const failures: string[] = [];
		let reads = 0;
		const deadline = performance.now() + ms;
		while (performance.now() < deadline) {
			reads += 1;
			try {
				await read();
			} catch (error) {
				failures.push(error instanceof VerifiedRunError ? error.code : String(error));
			}
		}
		return { reads, failures };
	}

	it("cancel's journal read survives a writer appending mid-read", async () => {
		await startMutator();
		// Without a live owner, cancel reads the journal and returns not_running: only the read is timed,
		// not the durable (fsync) cancel request a live owner would get.
		owner.release();
		const { reads, failures } = await hammerAsync(() => cancelVerifiedRun(runPath, { waitMs: 0 }));
		expect(failures).toEqual([]);
		// Only proves the loop ran; a cancel costs about 25 ms here and more under load.
		expect(reads).toBeGreaterThan(5);
	});

	it("cancel's journal read outlasts a burst of appends longer than the strict retry window", async () => {
		// A strict read fails for about a third of the start times here; a 250 ms reader never does.
		await startMutator({ burstMs: 50, holdMs: 50 });
		owner.release();
		const { reads, failures } = await hammerAsync(() => cancelVerifiedRun(runPath, { waitMs: 0 }), 3000);
		expect(failures).toEqual([]);
		expect(reads).toBeGreaterThan(5);
	});

	it("explain's journal read survives a writer appending mid-read", async () => {
		await startMutator();
		const { reads, failures } = hammer(() => readRunExplanation(runPath, RUN_ID, authority));
		expect(reads).toBeGreaterThan(100);
		expect(failures).toEqual([]);
	});

	it("gc never reads a journal whose owner is alive", async () => {
		await startMutator();
		const { failures } = hammer(() => {
			const report = collectVerifiedRuns(stateRoot, { olderThanMs: 0, execute: false });
			expect(report.runs).toEqual([
				expect.objectContaining({ runId: RUN_ID, action: "kept", reason: "owner_live" }),
			]);
		}, 300);
		expect(failures).toEqual([]);
		expect(readRunJournal(runPath)?.state.runId).toBe(RUN_ID);
	});
});
