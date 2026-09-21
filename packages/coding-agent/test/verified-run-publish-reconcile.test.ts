import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRunContract, parseRunPublishCommand, type RunContract, type RunPublishCommand } from "omk-protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { planVerifiedRun, RunCoordinator } from "../src/core/run-execution-api.ts";
import { readRunJournal } from "../src/core/verified-run/journal.ts";
import { OMK_ACCEPTED_REF, publishPolicyDigest, publishVerifiedRun } from "../src/core/verified-run/run-publish.ts";
import { digestObject } from "../src/core/verified-run/storage.ts";

let root: string;
let workspace: string;
let stateRoot: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "publish-reconcile-"));
	workspace = join(root, "workspace");
	stateRoot = join(root, "state");
	mkdirSync(workspace);
	writeFileSync(join(workspace, "input.txt"), "hello");
	git(["init", "--initial-branch=main"], workspace);
	git(["config", "--local", "user.email", "fixture@localhost"], workspace);
	git(["config", "--local", "user.name", "fixture"], workspace);
	git(["add", "input.txt"], workspace);
	git(["commit", "-m", "base"], workspace);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function git(args: readonly string[], cwd: string): string {
	const result = spawnSync("git", args, { cwd, encoding: "utf-8", timeout: 30000 });
	if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
	return result.stdout.trim();
}

async function startRun(runId: string) {
	const contract = {
		schemaVersion: "omk.verified-run.v1",
		profile: "linux-command-v1",
		runId,
		goal: "copy",
		workspace: { root: workspace, baseDigest: "0".repeat(64) },
		writablePaths: ["result.txt"],
		writer: ["/bin/cp", "input.txt", "result.txt"],
		checks: [{ claimId: "answer", argv: ["/bin/cat", "result.txt"], stdout: "hello" }],
		budget: {
			workMs: 5000,
			verifyMs: 15000,
			cleanupMs: 1000,
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
		{ approvedContractDigest: plan.contractDigest },
	);
	return { contract: parsed, coordinator };
}

function publishCommand(
	coordinator: RunCoordinator,
	contract: RunContract,
	commandId: string,
	parentOid: string,
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
		candidateDigest: state.candidateDigest,
		parentOid,
		receiptDigest: state.receiptDigest,
		policyDigest: publishPolicyDigest(contract),
	});
}

const ZERO40 = "0".repeat(40);

describe("publish outbox reconciliation", () => {
	it("reconciles a crash after a successful CAS without re-publishing", async () => {
		const { contract, coordinator } = await startRun("crash-1");
		const runPath = join(stateRoot, contract.runId);
		const command = publishCommand(coordinator, contract, "publish-1", ZERO40);
		let casCalls = 0;
		expect(() =>
			publishVerifiedRun(runPath, command, {
				afterCas: () => {
					casCalls += 1;
					throw new Error("simulated crash after CAS");
				},
			}),
		).toThrow(/simulated crash/);
		expect(casCalls).toBe(1);
		// The durable intent exists, the ref moved, but no result was recorded.
		const crashed = readRunJournal(runPath);
		expect(crashed?.state.publication).toBe("intent");
		expect(crashed?.state.publicationCandidateOid).toBe(git(["rev-parse", OMK_ACCEPTED_REF], workspace));
		const recordsBefore = crashed?.records.length ?? 0;
		// The replay finds the ref already at the candidate OID and only records the result.
		const healed = publishVerifiedRun(runPath, command);
		expect(healed.publication).toBe("accepted");
		expect(casCalls).toBe(1);
		const records = readRunJournal(runPath)?.records ?? [];
		expect(records.length).toBe(recordsBefore + 1);
		expect(records.at(-1)?.event.kind).toBe("published");
		expect(records.filter(({ event }) => event.kind === "published")).toHaveLength(1);
		expect(git(["rev-parse", OMK_ACCEPTED_REF], workspace)).toBe(healed.publicationCandidateOid);
	});

	it("resumes an intent-only crash by running the CAS once", async () => {
		const { contract, coordinator } = await startRun("crash-2");
		const runPath = join(stateRoot, contract.runId);
		const command = publishCommand(coordinator, contract, "publish-2", ZERO40);
		// Simulate a crash between the durable intent and the CAS: append the intent
		// through the normal gate, then drop the in-memory journal before resolving.
		const { acquireSessionOwnerLeaseSync } = await import("../src/core/session-owner-lease.ts");
		const { journalPath, VerifiedRunJournal } = await import("../src/core/verified-run/journal.ts");
		const { loadCandidate } = await import("../src/core/verified-run/candidate.ts");
		const { sealCandidateCommit } = await import("../src/core/verified-run/git-plumbing.ts");
		const owner = acquireSessionOwnerLeaseSync(journalPath(runPath));
		try {
			const journal = new VerifiedRunJournal(runPath, owner);
			const state = journal.state;
			const candidate = loadCandidate(runPath, state.candidateDigest ?? "", contract.budget);
			const candidateOid = sealCandidateCommit(workspace, {
				manifest: candidate.manifest,
				contents: candidate.contents,
				parentOid: ZERO40,
				zeroOid: ZERO40,
				runId: contract.runId,
				candidateDigest: state.candidateDigest ?? "",
				receiptDigest: state.receiptDigest ?? "",
			});
			journal.append({
				kind: "publish_intent",
				commandId: command.commandId,
				candidateDigest: state.candidateDigest ?? "",
				candidateOid,
				parentOid: ZERO40,
				targetRef: OMK_ACCEPTED_REF,
				receiptDigest: state.receiptDigest ?? "",
				policyDigest: publishPolicyDigest(contract),
				generation: state.generation,
			});
		} finally {
			owner.release();
		}
		expect(readRunJournal(runPath)?.state.publication).toBe("intent");
		const healed = publishVerifiedRun(runPath, command);
		expect(healed.publication).toBe("accepted");
		expect(git(["rev-parse", OMK_ACCEPTED_REF], workspace)).toBe(healed.publicationCandidateOid);
	});

	it("records reconciliation-required when a third party moved the ref during an open intent", async () => {
		const { contract, coordinator } = await startRun("crash-3");
		const runPath = join(stateRoot, contract.runId);
		const command = publishCommand(coordinator, contract, "publish-3", ZERO40);
		let casCalls = 0;
		expect(() =>
			publishVerifiedRun(runPath, command, {
				afterCas: () => {
					casCalls += 1;
					throw new Error("simulated crash after CAS");
				},
			}),
		).toThrow(/simulated crash/);
		expect(casCalls).toBe(1);
		// A third party replaces the accepted commit while our intent is still open.
		const tree = git(["rev-parse", `${OMK_ACCEPTED_REF}^{tree}`], workspace);
		const other = git(
			["commit-tree", tree, "-p", git(["rev-parse", OMK_ACCEPTED_REF], workspace), "-m", "manual"],
			workspace,
		);
		git(["update-ref", OMK_ACCEPTED_REF, other], workspace);
		const healed = publishVerifiedRun(runPath, command);
		expect(healed.publication).toBe("reconciliation_required");
		expect(healed.publicationFailure).toBe("reconciliation-required");
		expect(git(["rev-parse", OMK_ACCEPTED_REF], workspace)).toBe(other);
	});

	it("records ref-rejected when update-ref is refused and keeps the receipt unpublished", async () => {
		const { contract, coordinator } = await startRun("crash-4");
		const runPath = join(stateRoot, contract.runId);
		const command = publishCommand(coordinator, contract, "publish-4", ZERO40);
		// A file at refs/omk makes refs/omk/accepted un-creatable (D/F conflict).
		const blocker = git(["rev-parse", "HEAD"], workspace);
		git(["update-ref", "refs/omk", blocker], workspace);
		const state = publishVerifiedRun(runPath, command);
		expect(state.publication).toBe("failed");
		expect(state.publicationFailure).toBe("ref-rejected");
		expect(
			spawnSync("git", ["rev-parse", "--verify", "--quiet", `${OMK_ACCEPTED_REF}^{commit}`], {
				cwd: workspace,
				encoding: "utf-8",
			}).status,
		).toBe(1);
		// The recorded failure is terminal for this commandId: replay returns it, never re-executes.
		const replayed = publishVerifiedRun(runPath, command);
		expect(replayed.publication).toBe("failed");
	});
});
