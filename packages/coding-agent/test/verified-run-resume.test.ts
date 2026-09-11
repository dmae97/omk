import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as durableIo from "../src/core/durable-file-io.ts";
import { planVerifiedRun, RunCoordinator } from "../src/core/run-execution-api.ts";
import { canonicalJson } from "../src/core/run-journal.ts";
import { acquireSessionOwnerLeaseSync } from "../src/core/session-owner-lease.ts";
import { journalPath, readRunJournal, VerifiedRunJournal } from "../src/core/verified-run/journal.ts";
import * as recoveryClock from "../src/core/verified-run/recovery-clock.ts";

let root: string;
let workspace: string;
let stateRoot: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "resume-run-"));
	workspace = join(root, "workspace");
	stateRoot = join(root, "state");
	mkdirSync(workspace);
	writeFileSync(join(workspace, "input.txt"), "hello");
});
afterEach(() => {
	vi.restoreAllMocks();
	rmSync(root, { recursive: true, force: true });
});

async function frozen() {
	const contract = {
		schemaVersion: "omk.verified-run.v1",
		profile: "linux-command-v1",
		runId: "resume-run",
		goal: "copy",
		workspace: { root: workspace, baseDigest: "0".repeat(64) },
		writablePaths: ["result.txt"],
		writer: ["/bin/cp", "input.txt", "result.txt"],
		checks: [{ claimId: "answer", argv: ["/bin/cat", "result.txt"], stdout: "hello" }],
		budget: { workMs: 5000, verifyMs: 15000, cleanupMs: 1000, maxOutputBytes: 4096, maxFiles: 100, maxBytes: 65536 },
		apply: "artifact-only",
	};
	contract.workspace.baseDigest = planVerifiedRun(contract).baseDigest;
	const plan = planVerifiedRun(contract);
	const coordinator = new RunCoordinator(stateRoot);
	const approval = { approvedContractDigest: plan.contractDigest };
	await coordinator.start(
		contract,
		{
			schemaVersion: "omk.verified-command.v1",
			kind: "start",
			runId: contract.runId,
			commandId: "start",
			expectedRevision: 0,
			expectedGeneration: 0,
			contractDigest: plan.contractDigest,
		},
		approval,
	);
	const runPath = join(stateRoot, contract.runId);
	const journal = readRunJournal(runPath);
	if (!journal) throw new Error("missing fixture journal");
	const end = journal.records.findIndex((record) => record.event.kind === "candidate");
	writeFileSync(
		journalPath(runPath),
		`${journal.records
			.slice(0, end + 1)
			.map(canonicalJson)
			.join("\n")}\n`,
	);
	const state = coordinator.inspect(contract.runId);
	const command = {
		schemaVersion: "omk.verified-command.v1",
		kind: "resume",
		runId: contract.runId,
		commandId: "resume-1",
		expectedRevision: state.revision,
		expectedGeneration: state.generation,
		contractDigest: plan.contractDigest,
		candidateDigest: state.candidateDigest,
	};
	return { coordinator, command, approval, state, runPath };
}

describe("frozen candidate recovery", () => {
	it("acquires a new generation, preserves the original budget and rechecks only the candidate", async () => {
		const { coordinator, command, approval, state: before, runPath } = await frozen();
		const key = readFileSync(join(runPath, "issuer.key"));
		const state = await coordinator.resume(command, approval);
		expect(state).toMatchObject({
			generation: 2,
			candidateDigest: before.candidateDigest,
			verification: "verified",
			application: "candidate_ready",
		});
		expect(state.budget).toEqual(before.budget);
		expect(state.verificationDeadlineMs).toBe(before.verificationDeadlineMs);
		const records = readRunJournal(runPath)?.records ?? [];
		expect(
			records
				.filter((record) => record.generation === 2 && record.event.kind === "dispatch")
				.map((record) => record.event),
		).toEqual([expect.objectContaining({ role: "verifier" })]);
		expect(readFileSync(join(runPath, "issuer.key"))).toEqual(key);
		expect(coordinator.evidence(command.runId).receiptFormat).toBe("v3");
	});

	it("does not execute a duplicate resume command twice", async () => {
		const { coordinator, command, approval, runPath } = await frozen();
		const first = await coordinator.resume(command, approval);
		const bytes = readFileSync(journalPath(runPath));
		expect(await coordinator.resume(command, approval)).toEqual(first);
		expect(readFileSync(journalPath(runPath))).toEqual(bytes);
	});

	it("rejects stale revision, generation, candidate or conflicting command identity", async () => {
		const { coordinator, command, approval } = await frozen();
		await expect(
			coordinator.resume({ ...command, expectedRevision: command.expectedRevision - 1 }, approval),
		).rejects.toThrow(/stale/);
		await expect(coordinator.resume({ ...command, expectedGeneration: 2 }, approval)).rejects.toThrow(/stale/);
		await expect(coordinator.resume({ ...command, candidateDigest: "f".repeat(64) }, approval)).rejects.toThrow(
			/candidate/,
		);
		await expect(coordinator.resume({ ...command, commandId: "start" }, approval)).rejects.toThrow(/conflict/);
	});

	it("does not compete with an existing live owner", async () => {
		const { coordinator, command, approval, runPath } = await frozen();
		const lease = acquireSessionOwnerLeaseSync(journalPath(runPath));
		try {
			await expect(coordinator.resume(command, approval)).rejects.toThrow(/owner/);
		} finally {
			lease.release();
		}
	});

	it("does not reset uncertainty when a dispatch has no observed namespace identity", async () => {
		const { coordinator, command, approval, runPath } = await frozen();
		const owner = acquireSessionOwnerLeaseSync(journalPath(runPath));
		try {
			new VerifiedRunJournal(runPath, owner).append({
				kind: "dispatch",
				executionId: "unobserved",
				role: "verifier",
				claimId: "answer",
			});
		} finally {
			owner.release();
		}
		const state = coordinator.inspect(command.runId);
		await expect(coordinator.resume({ ...command, expectedRevision: state.revision }, approval)).rejects.toThrow(
			/unsettled/,
		);
		expect(coordinator.inspect(command.runId).activeExecutionIds).toEqual(["unobserved"]);
	});

	it("reports a reboot as a changed clock basis even when uptime reset", async () => {
		const { coordinator, command, approval } = await frozen();
		vi.spyOn(recoveryClock, "readRunClock").mockReturnValue({
			bootId: "00000000-0000-0000-0000-000000000000",
			nowMs: 0,
		});
		await expect(coordinator.resume(command, approval)).rejects.toThrow(/clock_changed/);
	});

	it.each([false, true])("does not dispatch when resume persistence fails (visible bytes: %s)", async (visible) => {
		const { coordinator, command, approval, runPath } = await frozen();
		const before = readFileSync(journalPath(runPath));
		const persist = durableIo.appendFileDurablySync;
		vi.spyOn(durableIo, "appendFileDurablySync").mockImplementation((path, bytes) => {
			if (Buffer.from(bytes).toString().includes('"kind":"resumed"')) {
				if (visible) persist(path, bytes);
				throw new Error("resume fsync failure");
			}
			persist(path, bytes);
		});
		await expect(coordinator.resume(command, approval)).rejects.toThrow(/fsync/);
		expect(existsSync(join(runPath, "candidate-2"))).toBe(false);
		if (visible) {
			expect(await coordinator.resume(command, approval)).toMatchObject({
				generation: 2,
				verification: "not_requested",
			});
		} else expect(readFileSync(journalPath(runPath))).toEqual(before);
	});

	it("bounds generation acquisition without resetting the deadline", async () => {
		const { coordinator, command, approval, runPath } = await frozen();
		for (const id of ["resume-1", "resume-2"]) {
			const state = coordinator.inspect(command.runId);
			await coordinator.resume(
				{ ...command, commandId: id, expectedGeneration: state.generation, expectedRevision: state.revision },
				approval,
			);
			const journal = readRunJournal(runPath);
			if (!journal) throw new Error("missing fixture");
			const end = journal.records.map(({ event }) => event.kind === "resumed").lastIndexOf(true);
			writeFileSync(
				journalPath(runPath),
				`${journal.records
					.slice(0, end + 1)
					.map(canonicalJson)
					.join("\n")}\n`,
			);
		}
		const state = coordinator.inspect(command.runId);
		await expect(
			coordinator.resume(
				{
					...command,
					commandId: "resume-3",
					expectedGeneration: state.generation,
					expectedRevision: state.revision,
				},
				approval,
			),
		).rejects.toThrow(/recovery_limit/);
	});

	it("requires the original approval and cannot recreate a missing issuer", async () => {
		const { coordinator, command, approval, runPath } = await frozen();
		await expect(coordinator.resume(command, { approvedContractDigest: "0".repeat(64) })).rejects.toThrow(/approval/);
		rmSync(join(runPath, "issuer.key"));
		await expect(coordinator.resume(command, approval)).rejects.toThrow();
	});
});
