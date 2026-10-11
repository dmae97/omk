import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { planVerifiedRun, RunCoordinator } from "../src/core/run-execution-api.ts";
import { journalPath, VerifiedRunJournal } from "../src/core/verified-run/journal.ts";
import type { RunEvent } from "../src/core/verified-run/run-types.ts";
import { createRunCoordinator } from "../src/core/verified-run-session.ts";
import { dagFixture } from "./verified-run-dag-fixture.ts";

type Dispatch = Extract<RunEvent, { kind: "dispatch" }>;

let root: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "cancel-resume-"));
});
afterEach(() => {
	vi.restoreAllMocks();
	rmSync(root, { recursive: true, force: true });
});

/** Abort exactly once, right after the first matching execution is witnessed as spawned. */
function abortWhenSpawned(controller: AbortController, match: (dispatch: Dispatch) => boolean) {
	const append = VerifiedRunJournal.prototype.append;
	const dispatched = new Map<string, Dispatch>();
	let armed = true;
	return vi.spyOn(VerifiedRunJournal.prototype, "append").mockImplementation(function (
		this: VerifiedRunJournal,
		event,
	) {
		const result = append.call(this, event);
		if (event.kind === "dispatch") dispatched.set(event.executionId, event);
		const dispatch = event.kind === "process_ready" ? dispatched.get(event.executionId) : undefined;
		if (armed && dispatch && match(dispatch)) {
			armed = false;
			controller.abort();
		}
		return result;
	});
}

function commandRun(writer: string[], check: string[]) {
	const workspace = join(root, "workspace");
	const stateRoot = join(root, "state");
	mkdirSync(workspace);
	writeFileSync(join(workspace, "input"), "original");
	const contract = {
		schemaVersion: "omk.verified-run.v1",
		profile: "linux-command-v1",
		runId: "cancel",
		goal: "copy",
		workspace: { root: workspace, baseDigest: "0".repeat(64) },
		writablePaths: ["output"],
		writer,
		checks: [{ claimId: "copy", argv: check, stdout: "original" }],
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
		runId: "cancel",
		commandId: "start",
		expectedRevision: 0,
		expectedGeneration: 0,
		contractDigest: plan.contractDigest,
	};
	return { contract, plan, command, coordinator: new RunCoordinator(stateRoot) };
}

describe("operator cancellation is a resumable pause", () => {
	it("pauses a cancelled writer and restarts it from the input checkpoint without refunding time", async () => {
		const f = commandRun(["/bin/sh", "-c", "cp input output && sleep 2"], ["/bin/cat", "output"]);
		const controller = new AbortController();
		const spy = abortWhenSpawned(controller, (dispatch) => dispatch.role === "writer");
		const state = await f.coordinator.start(f.contract, f.command, {
			approvedContractDigest: f.plan.contractDigest,
			signal: controller.signal,
		});
		spy.mockRestore();
		expect(state).toMatchObject({
			execution: "paused",
			failure: "cancelled",
			settlement: "settled",
			activeExecutionIds: [],
			candidateDigest: null,
			receiptDigest: null,
		});
		const status = f.coordinator.status("cancel");
		expect(status).toMatchObject({
			lifecycle: "cancelled",
			terminal: false,
			cleanSuccess: false,
			cause: "cancelled",
		});
		expect(status.recoveryCommands.map((item) => item.command)).toContain("restart_writer");
		expect(f.coordinator.inspectWriterRecovery("cancel")).toMatchObject({ readiness: "ready" });

		const restarted = await f.coordinator.restartWriter(
			{
				...f.command,
				kind: "restart_writer",
				commandId: "restart-1",
				expectedRevision: state.revision,
				expectedGeneration: state.generation,
				baseDigest: f.contract.workspace.baseDigest,
			},
			{ approvedContractDigest: f.plan.contractDigest },
		);
		expect(restarted).toMatchObject({ generation: 2, execution: "succeeded", verification: "verified" });
		expect(restarted.budget).toEqual(state.budget);
	});

	it("rejects a journal whose interruption record was altered", async () => {
		const f = commandRun(["/bin/sh", "-c", "cp input output && sleep 2"], ["/bin/cat", "output"]);
		const controller = new AbortController();
		const spy = abortWhenSpawned(controller, (dispatch) => dispatch.role === "writer");
		await f.coordinator.start(f.contract, f.command, {
			approvedContractDigest: f.plan.contractDigest,
			signal: controller.signal,
		});
		spy.mockRestore();
		const path = journalPath(join(root, "state", "cancel"));
		const original = readFileSync(path, "utf8");
		expect(original).toContain('"cause":"cancelled"');
		writeFileSync(path, original.replace('"cause":"cancelled"', '"cause":"timeout"'));
		expect(() => f.coordinator.inspect("cancel")).toThrow(/integrity/);
	});

	it("pauses a cancelled verification and resumes the same frozen candidate", async () => {
		const f = commandRun(["/bin/cp", "input", "output"], ["/bin/sh", "-c", "sleep 2; cat output"]);
		const controller = new AbortController();
		const spy = abortWhenSpawned(controller, (dispatch) => dispatch.role === "verifier");
		const state = await f.coordinator.start(f.contract, f.command, {
			approvedContractDigest: f.plan.contractDigest,
			signal: controller.signal,
		});
		spy.mockRestore();
		expect(state).toMatchObject({ execution: "paused", failure: "cancelled", settlement: "settled" });
		expect(state.candidateDigest).toMatch(/^[a-f0-9]{64}$/);
		const status = f.coordinator.status("cancel");
		expect(status.recoveryCommands.map((item) => item.command)).toContain("resume");
		expect(status.recoveryCommands.map((item) => item.command)).not.toContain("restart_writer");
		expect(f.coordinator.inspectRecovery("cancel")).toMatchObject({ readiness: "ready" });

		const resumed = await f.coordinator.resume(
			{
				...f.command,
				kind: "resume",
				commandId: "resume-1",
				expectedRevision: state.revision,
				expectedGeneration: state.generation,
				candidateDigest: state.candidateDigest,
			},
			{ approvedContractDigest: f.plan.contractDigest },
		);
		expect(resumed).toMatchObject({
			generation: 2,
			execution: "succeeded",
			verification: "verified",
			candidateDigest: state.candidateDigest,
		});
	});

	it("releases a witnessed-cancelled DAG attempt so the same approved command can run again", async () => {
		const f = dagFixture(root);
		mkdirSync(f.stateRoot);
		f.contract.writer.tasks[0].attempts[0] = ["/bin/sh", "-c", "cp input left && sleep 2"];
		const contractDigest = planVerifiedRun(f.contract).contractDigest;
		const controller = new AbortController();
		const spy = abortWhenSpawned(controller, (dispatch) => dispatch.taskId === "left");
		const state = await f.coordinator.start(
			f.contract,
			{ ...f.command, contractDigest },
			{ approvedContractDigest: contractDigest, signal: controller.signal },
		);
		spy.mockRestore();
		expect(state).toMatchObject({ execution: "paused", failure: "cancelled", settlement: "settled" });
		expect(state.tasks.find((task) => task.taskId === "left")).toMatchObject({
			status: "failed",
			failure: "cancelled",
			attempt: 0,
		});
		expect(f.coordinator.inspectTaskRecovery("dag")).toMatchObject({
			readiness: "ready",
			retryableTaskIds: ["left"],
		});
		const retried = await f.coordinator.retryTasks(
			{
				...f.command,
				contractDigest,
				kind: "retry_tasks",
				commandId: "retry-1",
				expectedRevision: state.revision,
				expectedGeneration: state.generation,
				baseDigest: f.contract.workspace.baseDigest,
				taskIds: ["left"],
			},
			{ approvedContractDigest: contractDigest },
		);
		expect(retried).toMatchObject({ generation: 2, execution: "succeeded", verification: "verified" });
		expect(retried.tasks.find((task) => task.taskId === "left")).toMatchObject({ status: "succeeded", attempt: 1 });
	});

	it("pauses a scripted-agent writer cancelled between model requests and restarts it", async () => {
		const workspace = join(root, "workspace");
		mkdirSync(workspace);
		writeFileSync(join(workspace, "input"), "original");
		const contract = {
			schemaVersion: "omk.verified-run.v1",
			profile: "linux-scripted-agent-v1",
			runId: "agent",
			goal: "copy",
			workspace: { root: workspace, baseDigest: "0".repeat(64) },
			writablePaths: ["output"],
			writer: {
				kind: "scripted-agent",
				steps: [
					["/bin/cp", "input", "output"],
					["/bin/cat", "output"],
				],
				maxRequests: 8,
			},
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
		const coordinator = createRunCoordinator(join(root, "state"));
		const command = {
			schemaVersion: "omk.verified-command.v1",
			kind: "start",
			runId: "agent",
			commandId: "start",
			expectedRevision: 0,
			expectedGeneration: 0,
			contractDigest: plan.contractDigest,
		};
		const controller = new AbortController();
		const append = VerifiedRunJournal.prototype.append;
		let requests = 0;
		const spy = vi.spyOn(VerifiedRunJournal.prototype, "append").mockImplementation(function (
			this: VerifiedRunJournal,
			event,
		) {
			const result = append.call(this, event);
			// Abort while the second model request is in flight: no command is running.
			if (event.kind === "model_request" && ++requests === 2) controller.abort();
			return result;
		});
		const state = await coordinator.start(contract, command, {
			approvedContractDigest: plan.contractDigest,
			signal: controller.signal,
		});
		spy.mockRestore();
		expect(state).toMatchObject({
			execution: "paused",
			failure: "cancelled",
			settlement: "settled",
			writerOpen: false,
			candidateDigest: null,
		});
		const restarted = await coordinator.restartWriter(
			{
				...command,
				kind: "restart_writer",
				commandId: "restart-1",
				expectedRevision: state.revision,
				expectedGeneration: state.generation,
				baseDigest: contract.workspace.baseDigest,
			},
			{ approvedContractDigest: plan.contractDigest },
		);
		expect(restarted).toMatchObject({ generation: 2, execution: "succeeded", verification: "verified" });
	});

	it("keeps a non-cancel writer failure terminal and does not advertise a restart", async () => {
		const f = commandRun(["/bin/sh", "-c", "exit 3"], ["/bin/cat", "output"]);
		const state = await f.coordinator.start(f.contract, f.command, { approvedContractDigest: f.plan.contractDigest });
		expect(state).toMatchObject({ execution: "failed" });
		expect(state.failure).not.toBe("cancelled");
		const status = f.coordinator.status("cancel");
		expect(status).toMatchObject({ lifecycle: "failed", terminal: true });
		expect(status.recoveryCommands).toEqual([]);
		expect(f.coordinator.inspectWriterRecovery("cancel")).toMatchObject({ readiness: "terminal" });
	});
});
