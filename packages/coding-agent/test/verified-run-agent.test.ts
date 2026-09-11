import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSession } from "../src/core/agent-session.ts";
import { planVerifiedRun, RunCoordinator } from "../src/core/run-execution-api.ts";
import { readRunJournal } from "../src/core/verified-run/journal.ts";
import { createRunCoordinator } from "../src/index.ts";

let root: string;
let workspace: string;
let stateRoot: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "run-agent-"));
	workspace = join(root, "workspace");
	stateRoot = join(root, "state");
	mkdirSync(workspace);
	writeFileSync(join(workspace, "input.txt"), "hello");
});
afterEach(() => {
	vi.restoreAllMocks();
	rmSync(root, { recursive: true, force: true });
});

function prepare(options: { runId?: string; maxRequests?: number; steps?: string[][] } = {}) {
	const contract = {
		schemaVersion: "omk.verified-run.v1",
		profile: "linux-scripted-agent-v1",
		runId: options.runId ?? "agent-run",
		goal: "Produce the greeting using the contracted steps",
		workspace: { root: workspace, baseDigest: "0".repeat(64) },
		writablePaths: ["result.txt"],
		writer: {
			kind: "scripted-agent",
			steps: options.steps ?? [
				["/bin/cp", "input.txt", "result.txt"],
				["/bin/cat", "result.txt"],
			],
			maxRequests: options.maxRequests ?? 3,
		},
		checks: [{ claimId: "answer", argv: ["/bin/cat", "result.txt"], stdout: "hello" }],
		budget: { workMs: 10000, verifyMs: 5000, cleanupMs: 1000, maxOutputBytes: 4096, maxFiles: 100, maxBytes: 65536 },
		apply: "artifact-only",
	};
	contract.workspace.baseDigest = planVerifiedRun(contract).baseDigest;
	const plan = planVerifiedRun(contract);
	const command = {
		schemaVersion: "omk.verified-command.v1",
		kind: "start",
		runId: contract.runId,
		commandId: "start",
		expectedRevision: 0,
		expectedGeneration: 0,
		contractDigest: plan.contractDigest,
	};
	return { contract, command, approval: { approvedContractDigest: plan.contractDigest } };
}

describe("offline AgentSession writer integration", () => {
	it("drives real AgentSession tool turns before accepting native verifier receipts", async () => {
		const prompt = vi.spyOn(AgentSession.prototype, "prompt");
		const { contract, command, approval } = prepare();
		const coordinator = createRunCoordinator(stateRoot);
		const state = await coordinator.start(contract, command, approval);
		expect(prompt).toHaveBeenCalledOnce();
		expect(state).toMatchObject({
			verification: "verified",
			application: "candidate_ready",
			writerOpen: false,
			modelRequests: 3,
		});
		const journal = readRunJournal(join(stateRoot, contract.runId));
		expect(journal?.records.filter(({ event }) => event.kind === "dispatch" && event.role === "writer")).toHaveLength(
			2,
		);
		expect(coordinator.evidence(contract.runId).receiptFormat).toBe("v3");
		expect(readdirSync(workspace)).toEqual(["input.txt"]);
	});

	it("cannot turn a failed command into success with a final model message", async () => {
		const { contract, command, approval } = prepare({
			steps: [["/bin/false"], ["/bin/cp", "input.txt", "result.txt"]],
		});
		const state = await createRunCoordinator(stateRoot).start(contract, command, approval);
		expect(state).toMatchObject({
			execution: "failed",
			verification: "inconclusive",
			application: "not_requested",
			writerOpen: false,
		});
		expect(readdirSync(join(stateRoot, contract.runId, "writer"))).not.toContain("result.txt");
	});

	it("shares one logical request cap across every tool turn", async () => {
		const { contract, command, approval } = prepare({ maxRequests: 1 });
		const state = await createRunCoordinator(stateRoot).start(contract, command, approval);
		expect(state).toMatchObject({ execution: "failed", verification: "inconclusive", modelRequests: 1 });
	});

	it("does not mix the reference adapters of concurrent runs", async () => {
		const coordinator = createRunCoordinator(stateRoot);
		const first = prepare({ runId: "first" });
		const second = prepare({ runId: "second" });
		const results = await Promise.all([
			coordinator.start(first.contract, first.command, first.approval),
			coordinator.start(second.contract, second.command, second.approval),
		]);
		expect(results.map((state) => [state.runId, state.modelRequests, state.verification])).toEqual([
			["first", 3, "verified"],
			["second", 3, "verified"],
		]);
	});

	it("fails closed when the host has not supplied a session runtime", async () => {
		const { contract, command, approval } = prepare();
		const state = await new RunCoordinator(stateRoot).start(contract, command, approval);
		expect(state).toMatchObject({ execution: "failed", failure: "writer_backend_missing", modelRequests: 0 });
	});

	it("rejects an unbounded model budget before any session is created", () => {
		expect(() => prepare({ maxRequests: 0 })).toThrow();
	});
});
