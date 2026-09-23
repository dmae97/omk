import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRunCoordinator } from "../src/core/agent-session-services.ts";
import { planVerifiedRun } from "../src/core/run-execution-api.ts";
import { canonicalJson } from "../src/core/run-journal.ts";
import { acquireSessionOwnerLeaseSync } from "../src/core/session-owner-lease.ts";
import { journalPath, readRunJournal } from "../src/core/verified-run/journal.ts";
import * as recoveryClock from "../src/core/verified-run/recovery-clock.ts";
import { digestObject } from "../src/core/verified-run/storage.ts";

let root: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "writer-restart-"));
});
afterEach(() => {
	vi.restoreAllMocks();
	rmSync(root, { recursive: true, force: true });
});

async function interrupted(maxRequests = 8, at: "request" | "dispatch" | "ready" = "request", commandOnly = false) {
	const workspace = join(root, "workspace");
	const stateRoot = join(root, "state");
	mkdirSync(workspace);
	writeFileSync(join(workspace, "input"), "original");
	const contract = {
		schemaVersion: "omk.verified-run.v1",
		profile: commandOnly ? "linux-command-v1" : "linux-scripted-agent-v1",
		runId: "writer",
		goal: "copy",
		workspace: { root: workspace, baseDigest: "0".repeat(64) },
		writablePaths: ["output"],
		writer: commandOnly
			? ["/bin/cp", "input", "output"]
			: {
					kind: "scripted-agent",
					steps: [
						["/bin/cp", "input", "output"],
						["/bin/cat", "output"],
					],
					maxRequests,
				},
		checks: [{ claimId: "copy", argv: ["/bin/cat", "output"], stdout: "original" }],
		budget: { workMs: 20000, verifyMs: 5000, cleanupMs: 15000, maxOutputBytes: 4096, maxFiles: 100, maxBytes: 65536 },
		apply: "artifact-only",
	};
	contract.workspace.baseDigest = planVerifiedRun(contract).baseDigest;
	const plan = planVerifiedRun(contract);
	const coordinator = createRunCoordinator(stateRoot);
	const approval = { approvedContractDigest: plan.contractDigest };
	await coordinator.start(
		contract,
		{
			schemaVersion: "omk.verified-command.v1",
			kind: "start",
			runId: "writer",
			commandId: "start",
			expectedRevision: 0,
			expectedGeneration: 0,
			contractDigest: plan.contractDigest,
		},
		approval,
	);
	const runPath = join(stateRoot, "writer");
	const journal = readRunJournal(runPath);
	if (!journal) throw new Error("missing fixture");
	const kind = at === "request" ? "model_request" : at === "dispatch" ? "dispatch" : "process_ready";
	const end = journal.records.findIndex(({ event }) => event.kind === kind);
	writeFileSync(
		journalPath(runPath),
		`${journal.records
			.slice(0, end + 1)
			.map(canonicalJson)
			.join("\n")}\n`,
	);
	const state = coordinator.inspect("writer");
	const command = {
		schemaVersion: "omk.verified-command.v1",
		kind: "restart_writer",
		runId: "writer",
		commandId: "restart-1",
		expectedRevision: state.revision,
		expectedGeneration: state.generation,
		contractDigest: plan.contractDigest,
		baseDigest: contract.workspace.baseDigest,
	};
	return { coordinator, command, approval, state, runPath, workspace };
}

describe("immutable-input writer restart", () => {
	it("restarts from the pinned input, not the changed original or old partial output", async () => {
		const { coordinator, command, approval, state, runPath, workspace } = await interrupted();
		writeFileSync(join(workspace, "input"), "changed after crash");
		writeFileSync(join(runPath, "writer", "output"), "discard this partial output");
		const result = await coordinator.restartWriter(command, approval);
		expect(result).toMatchObject({
			generation: 2,
			verification: "verified",
			modelRequests: 4,
			inputDigest: command.baseDigest,
		});
		expect(result.budget).toEqual(state.budget);
		expect(readFileSync(join(runPath, "writer-2", "output"), "utf8")).toBe("original");
		expect(readFileSync(join(runPath, "writer", "output"), "utf8")).toBe("discard this partial output");
		expect(readFileSync(join(workspace, "input"), "utf8")).toBe("changed after crash");
	});

	it("does not refund logical requests spent before the crash", async () => {
		const { coordinator, command, approval, runPath } = await interrupted(3);
		await expect(coordinator.restartWriter(command, approval)).rejects.toThrow(/model_request_limit/);
		expect(coordinator.inspect("writer")).toMatchObject({ generation: 1, modelRequests: 1 });
		expect(existsSync(join(runPath, "writer-2"))).toBe(false);
	});

	it("reconciles an ended writer namespace but not an unobserved launch", async () => {
		const { coordinator, command, approval } = await interrupted(8, "ready");
		expect(await coordinator.restartWriter(command, approval)).toMatchObject({
			generation: 2,
			verification: "verified",
		});
	});

	it("refuses a dispatch that has no namespace identity", async () => {
		const { coordinator, command, approval } = await interrupted(8, "dispatch");
		await expect(coordinator.restartWriter(command, approval)).rejects.toThrow(/unsettled/);
	});

	it("requires exact input, generation and command identity", async () => {
		const { coordinator, command, approval } = await interrupted();
		await expect(coordinator.restartWriter({ ...command, baseDigest: "f".repeat(64) }, approval)).rejects.toThrow(
			/input/,
		);
		await expect(coordinator.restartWriter({ ...command, expectedGeneration: 2 }, approval)).rejects.toThrow(/stale/);
		await expect(coordinator.restartWriter({ ...command, commandId: "start" }, approval)).rejects.toThrow(/conflict/);
	});

	it("also restarts a command-only writer without creating model requests", async () => {
		const { coordinator, command, approval } = await interrupted(8, "ready", true);
		expect(await coordinator.restartWriter(command, approval)).toMatchObject({
			generation: 2,
			verification: "verified",
			modelRequests: 0,
		});
	});

	it("refuses a legacy run even when its input bytes still exist", async () => {
		const { coordinator, command, approval, runPath } = await interrupted();
		const journal = readRunJournal(runPath);
		if (!journal) throw new Error("missing fixture");
		let previous = "0".repeat(64);
		const records = journal.records
			.filter(({ event }) => event.kind !== "input_checkpoint")
			.map((record, index) => {
				const material = { version: 2, generation: 1, seq: index + 1, previous, event: record.event };
				const hash = digestObject(material);
				previous = hash;
				return { ...material, hash };
			});
		writeFileSync(journalPath(runPath), `${records.map(canonicalJson).join("\n")}\n`);
		const state = coordinator.inspect("writer");
		await expect(
			coordinator.restartWriter({ ...command, expectedRevision: state.revision }, approval),
		).rejects.toThrow(/input_checkpoint_missing/);
	});

	it("does not replace a damaged input checkpoint with the current workspace", async () => {
		const { coordinator, command, approval, runPath } = await interrupted();
		writeFileSync(join(runPath, "candidates", `${command.baseDigest}.json`), "{}");
		await expect(coordinator.restartWriter(command, approval)).rejects.toThrow(/integrity/);
		expect(coordinator.inspect("writer").generation).toBe(1);
	});

	it("refuses a live owner and an expired original work deadline", async () => {
		const { coordinator, command, approval, state, runPath } = await interrupted();
		const owner = acquireSessionOwnerLeaseSync(journalPath(runPath));
		try {
			await expect(coordinator.restartWriter(command, approval)).rejects.toThrow(/owner/);
		} finally {
			owner.release();
		}
		if (!state.budget) throw new Error("missing budget");
		vi.spyOn(recoveryClock, "readRunClock").mockReturnValue({
			bootId: state.budget.bootId,
			nowMs: state.budget.workDeadlineMs + 1,
		});
		await expect(coordinator.restartWriter(command, approval)).rejects.toThrow(/deadline/);
		expect(coordinator.inspect("writer").generation).toBe(1);
	});

	it("returns a duplicate command result without another writer attempt", async () => {
		const { coordinator, command, approval, runPath } = await interrupted();
		const result = await coordinator.restartWriter(command, approval);
		const bytes = readFileSync(journalPath(runPath));
		expect(await coordinator.restartWriter(command, approval)).toEqual(result);
		expect(readFileSync(journalPath(runPath))).toEqual(bytes);
	});
});
