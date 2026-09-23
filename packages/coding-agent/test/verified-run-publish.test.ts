import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRunContract, parseRunPublishCommand, type RunContract, type RunPublishCommand } from "omk-protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { planVerifiedRun, RunCoordinator } from "../src/core/run-execution-api.ts";
import { journalPath, readRunJournal } from "../src/core/verified-run/journal.ts";
import { OMK_ACCEPTED_REF, publishPolicyDigest } from "../src/core/verified-run/run-publish.ts";
import { digestObject } from "../src/core/verified-run/storage.ts";

let root: string;
let workspace: string;
let stateRoot: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "publish-run-"));
	workspace = join(root, "workspace");
	stateRoot = join(root, "state");
	mkdirSync(workspace);
	writeFileSync(join(workspace, "input.txt"), "hello");
	writeFileSync(join(workspace, "extra.txt"), "different");
	git(["init", "--initial-branch=main"], workspace);
	git(["config", "--local", "user.email", "fixture@localhost"], workspace);
	git(["config", "--local", "user.name", "fixture"], workspace);
	git(["add", "input.txt", "extra.txt"], workspace);
	git(["commit", "-m", "base"], workspace);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function git(args: readonly string[], cwd: string): string {
	const result = spawnSync("git", args, { cwd, encoding: "utf-8", timeout: 30000 });
	if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
	return result.stdout.trim();
}

function gitOk(args: readonly string[], cwd: string): boolean {
	return spawnSync("git", args, { cwd, encoding: "utf-8", timeout: 30000 }).status === 0;
}

async function startRun(runId: string, writer: readonly string[], stdout: string) {
	const contract = {
		schemaVersion: "omk.verified-run.v1",
		profile: "linux-command-v1",
		runId,
		goal: "copy",
		workspace: { root: workspace, baseDigest: "0".repeat(64) },
		writablePaths: ["result.txt"],
		writer,
		checks: [{ claimId: "answer", argv: ["/bin/cat", "result.txt"], stdout }],
		budget: {
			workMs: 5000,
			verifyMs: 15000,
			cleanupMs: 15000,
			maxOutputBytes: 4096,
			maxFiles: 100,
			maxBytes: 65536,
		},
		apply: "artifact-only",
	};
	contract.workspace.baseDigest = planVerifiedRun(contract).baseDigest;
	const plan = planVerifiedRun(contract);
	const parsed = parseRunContract(contract);
	const coordinator = new RunCoordinator(stateRoot);
	const approval = { approvedContractDigest: plan.contractDigest };
	await coordinator.start(
		parsed,
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
	return { contract: parsed, coordinator, approval, plan };
}

function publishCommand(
	coordinator: RunCoordinator,
	contract: RunContract,
	commandId: string,
	parentOid: string,
	overrides: Record<string, unknown> = {},
): RunPublishCommand {
	const state = coordinator.inspect(contract.runId);
	if (!state.candidateDigest || !state.receiptDigest) throw new Error("fixture run not verified");
	return parseRunPublishCommand({
		schemaVersion: "omk.verified-command.v1",
		kind: "publish",
		runId: contract.runId,
		commandId,
		expectedRevision: state.revision,
		expectedGeneration: state.generation,
		contractDigest: digestObject(contract),
		candidateDigest: state.candidateDigest as string,
		parentOid,
		receiptDigest: state.receiptDigest,
		policyDigest: publishPolicyDigest(contract),
		...overrides,
	});
}

const ZERO40 = "0".repeat(40);

describe("verified candidate publication", () => {
	it("accepts a sealed candidate on an unborn ref without touching the working branch or index", async () => {
		const { contract, coordinator, approval } = await startRun(
			"pub-1",
			["/bin/cp", "input.txt", "result.txt"],
			"hello",
		);
		const headBefore = git(["rev-parse", "HEAD"], workspace);
		const branchesBefore = git(["for-each-ref", "refs/heads"], workspace);
		const command = publishCommand(coordinator, contract, "publish-1", ZERO40);
		const state = await coordinator.publish(command, approval);
		expect(state.publication).toBe("accepted");
		const accepted = git(["rev-parse", OMK_ACCEPTED_REF], workspace);
		expect(accepted).toBe(state.publicationCandidateOid);
		// The sealed commit carries the exact candidate bytes, not the live workspace.
		expect(git(["show", `${accepted}:result.txt`], workspace)).toBe("hello");
		expect(git(["rev-list", "--parents", "-1", accepted], workspace).split(/\s+/)).toHaveLength(1);
		const message = git(["cat-file", "-p", accepted], workspace);
		expect(message).toContain(`run: ${contract.runId}`);
		expect(message).toContain(`candidate: ${state.candidateDigest}`);
		expect(message).toContain(`receipt: ${state.receiptDigest}`);
		// The user's HEAD, branches, index and worktree are untouched.
		expect(git(["rev-parse", "HEAD"], workspace)).toBe(headBefore);
		expect(git(["for-each-ref", "refs/heads"], workspace)).toBe(branchesBefore);
		expect(git(["status", "--porcelain"], workspace)).toBe("");
		expect(gitOk(["rev-parse", "--verify", "--quiet", `${accepted}^{commit}`], workspace)).toBe(true);
		expect(readRunJournal(join(stateRoot, contract.runId))?.state.publication).toBe("accepted");
	});

	it("lets exactly one of two competing publishers win the CAS", async () => {
		const a = await startRun("pub-a", ["/bin/cp", "input.txt", "result.txt"], "hello");
		const b = await startRun("pub-b", ["/bin/cp", "extra.txt", "result.txt"], "different");
		const winner = await a.coordinator.publish(
			publishCommand(a.coordinator, a.contract, "publish-a", ZERO40),
			a.approval,
		);
		expect(winner.publication).toBe("accepted");
		const loser = await b.coordinator.publish(
			publishCommand(b.coordinator, b.contract, "publish-b", ZERO40),
			b.approval,
		);
		expect(loser.publication).toBe("failed");
		expect(loser.publicationFailure).toBe("stale-parent");
		const accepted = git(["rev-parse", OMK_ACCEPTED_REF], workspace);
		expect(accepted).toBe(winner.publicationCandidateOid);
		expect(accepted).not.toBe(loser.publicationCandidateOid);
		// The losing candidate remains an orphan object only; it is never reachable from the ref.
		expect(git(["rev-list", OMK_ACCEPTED_REF], workspace)).not.toContain(loser.publicationCandidateOid);
		expect(gitOk(["cat-file", "-e", `${loser.publicationCandidateOid}^{commit}`], workspace)).toBe(true);
		// A replay of the losing command returns the recorded failure without re-executing.
		const replayed = await b.coordinator.publish(
			publishCommand(b.coordinator, b.contract, "publish-b", ZERO40),
			b.approval,
		);
		expect(replayed.publication).toBe("failed");
		expect(git(["rev-parse", OMK_ACCEPTED_REF], workspace)).toBe(accepted);
	});

	it("rejects publication when the sealed bytes changed after evaluation and ignores workspace drift", async () => {
		const { contract, coordinator, approval } = await startRun(
			"pub-2",
			["/bin/cp", "input.txt", "result.txt"],
			"hello",
		);
		const state = coordinator.inspect(contract.runId);
		const runPath = join(stateRoot, contract.runId);
		const command = publishCommand(coordinator, contract, "publish-2", ZERO40);
		const manifest = JSON.parse(
			readFileSync(join(runPath, "candidates", `${state.candidateDigest}.json`), "utf-8"),
		) as { files: { path: string; digest: string }[] };
		const blob = manifest.files.find((file) => file.path === "result.txt");
		if (!blob) throw new Error("fixture missing result.txt");
		writeFileSync(join(runPath, "blobs", blob.digest), "tampered");
		await expect(coordinator.publish(command, approval)).rejects.toThrow(/integrity/);
		expect(gitOk(["rev-parse", "--verify", "--quiet", `${OMK_ACCEPTED_REF}^{commit}`], workspace)).toBe(false);
	});

	it("seals the stored candidate bytes, not a workspace file that drifted after evaluation", async () => {
		const { contract, coordinator, approval } = await startRun(
			"pub-2b",
			["/bin/cp", "input.txt", "result.txt"],
			"hello",
		);
		writeFileSync(join(workspace, "input.txt"), "user typed over this after the run");
		writeFileSync(join(workspace, "untracked.txt"), "new file appeared later");
		const state = await coordinator.publish(publishCommand(coordinator, contract, "publish-2b", ZERO40), approval);
		expect(state.publication).toBe("accepted");
		const accepted = git(["rev-parse", OMK_ACCEPTED_REF], workspace);
		expect(git(["show", `${accepted}:result.txt`], workspace)).toBe("hello");
		expect(git(["show", `${accepted}:input.txt`], workspace)).toBe("hello");
		expect(gitOk(["show", `${accepted}:untracked.txt`], workspace)).toBe(false);
	});

	it("replays a completed publish command idempotently and rejects a new command", async () => {
		const { contract, coordinator, approval } = await startRun(
			"pub-3",
			["/bin/cp", "input.txt", "result.txt"],
			"hello",
		);
		const command = publishCommand(coordinator, contract, "publish-3", ZERO40);
		const first = await coordinator.publish(command, approval);
		expect(first.publication).toBe("accepted");
		const bytes = readFileSync(journalPath(join(stateRoot, contract.runId)));
		const second = await coordinator.publish(command, approval);
		expect(second.publication).toBe("accepted");
		expect(readFileSync(journalPath(join(stateRoot, contract.runId)))).toEqual(bytes);
		await expect(
			coordinator.publish(publishCommand(coordinator, contract, "publish-3b", ZERO40), approval),
		).rejects.toThrow(/already_published/);
	});

	it("rejects a reused commandId carrying a different payload", async () => {
		const { contract, coordinator, approval } = await startRun(
			"pub-4",
			["/bin/cp", "input.txt", "result.txt"],
			"hello",
		);
		const command = publishCommand(coordinator, contract, "publish-4", ZERO40);
		await coordinator.publish(command, approval);
		await expect(
			coordinator.publish(
				publishCommand(coordinator, contract, "publish-4", ZERO40, { parentOid: "1".repeat(40) }),
				approval,
			),
		).rejects.toThrow(/command_conflict/);
	});

	it("refuses to publish an unverified run", async () => {
		const { contract, coordinator, approval } = await startRun(
			"pub-5",
			["/bin/cp", "input.txt", "result.txt"],
			"wrong",
		);
		expect(coordinator.inspect(contract.runId).verification).toBe("violated");
		const state = coordinator.inspect(contract.runId);
		const command = parseRunPublishCommand({
			schemaVersion: "omk.verified-command.v1",
			kind: "publish",
			runId: contract.runId,
			commandId: "publish-5",
			expectedRevision: state.revision,
			expectedGeneration: state.generation,
			contractDigest: digestObject(contract),
			candidateDigest: state.candidateDigest ?? "0".repeat(64),
			parentOid: ZERO40,
			receiptDigest: state.receiptDigest ?? "0".repeat(64),
			policyDigest: publishPolicyDigest(contract),
		});
		await expect(coordinator.publish(command, approval)).rejects.toThrow(/unverified/);
		expect(gitOk(["rev-parse", "--verify", "--quiet", `${OMK_ACCEPTED_REF}^{commit}`], workspace)).toBe(false);
	});

	it("rejects candidate, receipt and policy binding mismatches", async () => {
		const { contract, coordinator, approval } = await startRun(
			"pub-6",
			["/bin/cp", "input.txt", "result.txt"],
			"hello",
		);
		for (const override of [
			{ candidateDigest: "f".repeat(64) },
			{ receiptDigest: "e".repeat(64) },
			{ policyDigest: "d".repeat(64) },
		]) {
			await expect(
				coordinator.publish(publishCommand(coordinator, contract, "publish-6", ZERO40, override), approval),
			).rejects.toThrow(/invalid_binding|command_conflict/);
		}
		expect(gitOk(["rev-parse", "--verify", "--quiet", `${OMK_ACCEPTED_REF}^{commit}`], workspace)).toBe(false);
	});

	it("refuses publish on a workspace that is not a git top level", async () => {
		const plain = join(root, "plain");
		mkdirSync(plain);
		writeFileSync(join(plain, "input.txt"), "hello");
		const contract = {
			schemaVersion: "omk.verified-run.v1",
			profile: "linux-command-v1",
			runId: "pub-7",
			goal: "copy",
			workspace: { root: plain, baseDigest: "0".repeat(64) },
			writablePaths: ["result.txt"],
			writer: ["/bin/cp", "input.txt", "result.txt"],
			checks: [{ claimId: "answer", argv: ["/bin/cat", "result.txt"], stdout: "hello" }],
			budget: {
				workMs: 5000,
				verifyMs: 15000,
				cleanupMs: 15000,
				maxOutputBytes: 4096,
				maxFiles: 100,
				maxBytes: 65536,
			},
			apply: "artifact-only",
		};
		contract.workspace.baseDigest = planVerifiedRun(contract).baseDigest;
		const plan = planVerifiedRun(contract);
		const parsed = parseRunContract(contract);
		const coordinator = new RunCoordinator(stateRoot);
		const approval = { approvedContractDigest: plan.contractDigest };
		await coordinator.start(
			parsed,
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
		const command = publishCommand(coordinator, parsed, "publish-7", ZERO40);
		await expect(coordinator.publish(command, approval)).rejects.toThrow(/unsupported/);
	});
});
