import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withRunSignal } from "../src/commands/verified-run-signal.ts";
import { planVerifiedRun, RunCoordinator } from "../src/core/run-execution-api.ts";
import { acquireSessionOwnerLeaseSync, inspectSessionOwnerLeaseSync } from "../src/core/session-owner-lease.ts";
import {
	CANCEL_REQUEST_FILE,
	cancelVerifiedRun,
	readRunCancelRequest,
	requestRunCancel,
	watchRunCancelRequest,
	withdrawRunCancelRequest,
} from "../src/core/verified-run/cancel-request.ts";
import { journalPath, readRunJournal } from "../src/core/verified-run/journal.ts";

let root: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "remote-cancel-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function fixture(writer: string[]) {
	const workspace = join(root, "workspace");
	const stateRoot = join(root, "state");
	mkdirSync(workspace);
	writeFileSync(join(workspace, "input"), "original");
	const contract = {
		schemaVersion: "omk.verified-run.v1",
		profile: "linux-command-v1",
		runId: "remote",
		goal: "copy",
		workspace: { root: workspace, baseDigest: "0".repeat(64) },
		writablePaths: ["output"],
		writer,
		checks: [{ claimId: "copy", argv: ["/bin/cat", "output"], stdout: "original" }],
		budget: {
			workMs: 30000,
			verifyMs: 10000,
			cleanupMs: 15000,
			maxOutputBytes: 4096,
			maxFiles: 100,
			maxBytes: 65536,
		},
		apply: "artifact-only",
	};
	contract.workspace.baseDigest = planVerifiedRun(contract).baseDigest;
	const plan = planVerifiedRun(contract);
	const command = {
		schemaVersion: "omk.verified-command.v1",
		kind: "start",
		runId: "remote",
		commandId: "start",
		expectedRevision: 0,
		expectedGeneration: 0,
		contractDigest: plan.contractDigest,
	};
	const runPath = join(stateRoot, "remote");
	const coordinator = new RunCoordinator(stateRoot);
	const start = () =>
		withRunSignal(runPath, (signal) =>
			coordinator.start(contract, command, { approvedContractDigest: plan.contractDigest, signal }),
		);
	return { runPath, stateRoot, coordinator, start };
}

async function until(condition: () => boolean, timeoutMs = 20000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!condition()) {
		if (Date.now() > deadline) throw new Error("condition not reached");
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}

describe("durable cancel request", () => {
	it("is idempotent while pending and withdrawn only by its own request id", () => {
		const runPath = join(root, "run");
		mkdirSync(runPath);
		const first = requestRunCancel(runPath);
		expect(first.requestId).toMatch(/^[0-9a-f-]{36}$/);
		expect(requestRunCancel(runPath).requestId).toBe(first.requestId);
		expect(readRunCancelRequest(runPath)).toEqual(first);
		expect(withdrawRunCancelRequest(runPath, "00000000-0000-4000-8000-000000000000")).toBe(false);
		expect(readRunCancelRequest(runPath)).toEqual(first);
		expect(withdrawRunCancelRequest(runPath, first.requestId)).toBe(true);
		expect(readRunCancelRequest(runPath)).toBeNull();
	});

	it("is consumed by the owner watcher, which aborts exactly once", async () => {
		const runPath = join(root, "run");
		mkdirSync(runPath);
		let cancelled = 0;
		const stop = watchRunCancelRequest(runPath, () => cancelled++, 10);
		try {
			requestRunCancel(runPath);
			await until(() => cancelled > 0, 5000);
			expect(existsSync(join(runPath, CANCEL_REQUEST_FILE))).toBe(false);
			requestRunCancel(runPath);
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(cancelled).toBe(1);
		} finally {
			stop();
		}
	});
});

describe("omk run cancel", () => {
	it("cancels a live run from another caller and leaves it resumable", async () => {
		const f = fixture(["/bin/sleep", "30"]);
		const started = f.start();
		await until(
			() =>
				existsSync(journalPath(f.runPath)) &&
				inspectSessionOwnerLeaseSync(journalPath(f.runPath)).status === "live" &&
				(readRunJournal(f.runPath)?.state.activeExecutionIds.length ?? 0) > 0,
		);
		const outcome = await cancelVerifiedRun(f.runPath, { waitMs: 20000, pollMs: 20 });
		expect(outcome).toMatchObject({ runId: "remote", outcome: "observed" });
		const state = await started;
		expect(state).toMatchObject({ execution: "paused", failure: "cancelled", settlement: "settled" });
		expect(readRunCancelRequest(f.runPath)).toBeNull();
		expect(f.coordinator.status("remote")).toMatchObject({ lifecycle: "cancelled", terminal: false });
	});

	it("reports not_running and leaves no request when nothing owns the run", async () => {
		const f = fixture(["/bin/cp", "input", "output"]);
		const state = await f.start();
		expect(state).toMatchObject({ verification: "verified" });
		const outcome = await cancelVerifiedRun(f.runPath, { waitMs: 1000, pollMs: 20 });
		expect(outcome).toEqual({ runId: "remote", outcome: "not_running", requestId: null });
		expect(readRunCancelRequest(f.runPath)).toBeNull();
	});

	it("reports pending while the owner keeps the run, and leaves the request for it", async () => {
		const f = fixture(["/bin/cp", "input", "output"]);
		await f.start();
		const owner = acquireSessionOwnerLeaseSync(journalPath(f.runPath));
		try {
			const outcome = await cancelVerifiedRun(f.runPath, { waitMs: 150, pollMs: 20 });
			expect(outcome).toMatchObject({ outcome: "pending" });
			expect(readRunCancelRequest(f.runPath)?.requestId).toBe(outcome.requestId);
		} finally {
			owner.release();
		}
	});

	it("withdraws its request when the owner releases the run without consuming it", async () => {
		const f = fixture(["/bin/cp", "input", "output"]);
		await f.start();
		const owner = acquireSessionOwnerLeaseSync(journalPath(f.runPath));
		const release = setTimeout(() => owner.release(), 150);
		try {
			const outcome = await cancelVerifiedRun(f.runPath, { waitMs: 10000, pollMs: 20 });
			expect(outcome).toMatchObject({ outcome: "not_observed" });
			expect(readRunCancelRequest(f.runPath)).toBeNull();
		} finally {
			clearTimeout(release);
		}
	});

	it("refuses an unknown run", async () => {
		await expect(cancelVerifiedRun(join(root, "missing"), { waitMs: 100 })).rejects.toThrow(/missing_run/);
	});

	it("drops a stale request when a new owner starts, so it cannot cancel unrelated work", async () => {
		const f = fixture(["/bin/cp", "input", "output"]);
		mkdirSync(f.runPath, { recursive: true });
		requestRunCancel(f.runPath);
		const state = await f.start();
		expect(state).toMatchObject({ execution: "succeeded", verification: "verified" });
		expect(readRunCancelRequest(f.runPath)).toBeNull();
	});
});
