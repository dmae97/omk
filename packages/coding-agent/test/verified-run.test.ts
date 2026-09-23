import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { parseRunContract, type RunContract, VERIFIED_COMMAND_VERSION } from "omk-protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runVerifiedRunCli } from "../src/commands/verified-run-cli.ts";
import { planVerifiedRun, RunCoordinator } from "../src/core/run-execution-api.ts";
import * as broker from "../src/core/verified-run/broker.ts";
import { classifyEvidenceRead } from "../src/core/verified-run/evidence.ts";
import { readRunJournal, VerifiedRunJournal } from "../src/core/verified-run/journal.ts";
import { VerifiedRunError } from "../src/core/verified-run/storage.ts";

let root: string;
let workspace: string;
let stateRoot: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "verified-run-"));
	workspace = join(root, "project");
	stateRoot = join(root, "state");
	mkdirSync(workspace);
	writeFileSync(join(workspace, "input.txt"), "original");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function rawContract() {
	return {
		schemaVersion: "omk.verified-run.v1",
		profile: "linux-command-v1",
		runId: "run-1",
		goal: "Produce hello",
		workspace: { root: workspace, baseDigest: "0".repeat(64) },
		writablePaths: ["result.txt"],
		writer: ["/bin/sh", "-c", "printf hello > result.txt"],
		checks: [{ claimId: "greeting", argv: ["/bin/cat", "result.txt"], stdout: "hello" }],
		// Generous settle budget: ubuntu-22.04 CI runners can take >1s between the
		// killed child's `close` and the namespace teardown probe going `gone`.
		// Normal paths settle as soon as the drain completes.
		budget: { workMs: 3000, verifyMs: 3000, cleanupMs: 15000, maxOutputBytes: 4096, maxFiles: 100, maxBytes: 65536 },
		apply: "artifact-only",
	};
}
function prepared(overrides: Partial<RunContract> = {}) {
	const raw = { ...rawContract(), ...overrides };
	const initial = planVerifiedRun(raw);
	const contract = parseRunContract({ ...raw, workspace: { root: workspace, baseDigest: initial.baseDigest } });
	const plan = planVerifiedRun(contract);
	const command = {
		schemaVersion: VERIFIED_COMMAND_VERSION,
		kind: "start",
		runId: contract.runId,
		commandId: "command-1",
		expectedRevision: 0,
		expectedGeneration: 0,
		contractDigest: plan.contractDigest,
	};
	return { contract, plan, command };
}

describe("verified-run command profile", () => {
	it("plans without modifying the workspace or creating operator state", () => {
		const plan = planVerifiedRun(rawContract());
		expect(plan.baseMatches).toBe(false);
		expect(plan.contractDigest).toMatch(/^[a-f0-9]{64}$/);
		expect(readdirSync(root)).toEqual(["project"]);
	});

	it("executes, fixes the exact candidate, verifies externally and leaves the base untouched", async () => {
		const { contract, plan, command } = prepared();
		const coordinator = new RunCoordinator(stateRoot);
		const state = await coordinator.start(contract, command, { approvedContractDigest: plan.contractDigest });
		expect(state).toMatchObject({
			execution: "succeeded",
			settlement: "settled",
			verification: "verified",
			application: "candidate_ready",
		});
		expect(readFileSync(join(workspace, "input.txt"), "utf8")).toBe("original");
		expect(readdirSync(workspace)).toEqual(["input.txt"]);
		expect(coordinator.inspect(contract.runId)).toEqual(state);
		expect(coordinator.evidence(contract.runId).candidateDigest).toBe(state.candidateDigest);
	});

	it("returns the same durable result for a duplicate command without running twice", async () => {
		const { contract, plan, command } = prepared();
		const coordinator = new RunCoordinator(stateRoot);
		const first = await coordinator.start(contract, command, { approvedContractDigest: plan.contractDigest });
		const second = await new RunCoordinator(stateRoot).start(contract, command, {
			approvedContractDigest: plan.contractDigest,
		});
		expect(second).toEqual(first);
	});

	it("rejects reused command identity with different input", async () => {
		const { contract, plan, command } = prepared();
		const coordinator = new RunCoordinator(stateRoot);
		await coordinator.start(contract, command, { approvedContractDigest: plan.contractDigest });
		const changed = prepared({ goal: "different" });
		await expect(
			coordinator.start(changed.contract, changed.command, { approvedContractDigest: changed.plan.contractDigest }),
		).rejects.toThrow(/conflict/);
	});

	it("rejects missing approval before creating state or dispatching", async () => {
		const { contract, command } = prepared();
		await expect(
			new RunCoordinator(stateRoot).start(contract, command, { approvedContractDigest: "f".repeat(64) }),
		).rejects.toThrow(/approval/);
		expect(readdirSync(root)).toEqual(["project"]);
	});

	it("rejects base drift before dispatch", async () => {
		const { contract, plan, command } = prepared();
		writeFileSync(join(workspace, "input.txt"), "changed");
		await expect(
			new RunCoordinator(stateRoot).start(contract, command, { approvedContractDigest: plan.contractDigest }),
		).rejects.toThrow(/base/);
	});

	it("refuses a writer that changes a path outside its accepted scope", async () => {
		const { contract, plan, command } = prepared({
			writer: ["/bin/sh", "-c", "printf changed > input.txt; printf hello > result.txt"],
		});
		const state = await new RunCoordinator(stateRoot).start(contract, command, {
			approvedContractDigest: plan.contractDigest,
		});
		expect(state).toMatchObject({
			verification: "inconclusive",
			application: "not_requested",
			failure: "scope_changed",
		});
	});

	it("does not accept model-like verified text instead of a passing protected check", async () => {
		const { contract, plan, command } = prepared({
			writer: ["/bin/sh", "-c", "printf '{\"verified\":true}' > result.txt"],
		});
		const state = await new RunCoordinator(stateRoot).start(contract, command, {
			approvedContractDigest: plan.contractDigest,
		});
		expect(state).toMatchObject({ verification: "violated", application: "not_requested" });
	});

	it("separates an authentic failed check from a different current environment", async () => {
		const { contract, plan, command } = prepared({
			checks: [{ claimId: "greeting", argv: ["/bin/cat", "result.txt"], stdout: "not hello" }],
		});
		const coordinator = new RunCoordinator(stateRoot);
		await coordinator.start(contract, command, { approvedContractDigest: plan.contractDigest });
		const path = join(stateRoot, contract.runId);
		const journal = readRunJournal(path);
		if (!journal) throw new Error("missing fixture journal");
		expect(classifyEvidenceRead(path, journal, "f".repeat(64))).toMatchObject({
			authenticity: "valid",
			verification: "failed",
			currentEnvironmentEligibility: "different",
			evidence: { verified: false },
		});
	});

	it("reads historical evidence without requiring the current execution backend", async () => {
		const { contract, plan, command } = prepared();
		const coordinator = new RunCoordinator(stateRoot);
		await coordinator.start(contract, command, { approvedContractDigest: plan.contractDigest });
		const probe = vi.spyOn(broker, "commandEnvironmentDigest").mockImplementation(() => {
			throw new VerifiedRunError("unsupported");
		});
		try {
			expect(coordinator.evidence(contract.runId).verified).toBe(true);
			expect(coordinator.evidenceRead(contract.runId)).toMatchObject({
				authenticity: "valid",
				verification: "passed",
				currentEnvironmentEligibility: "unsupported",
			});
		} finally {
			probe.mockRestore();
		}
	});

	it.each(["missing-key", "forged"] as const)("classifies %s without a false verified receipt", async (fault) => {
		const { contract, plan, command } = prepared();
		const coordinator = new RunCoordinator(stateRoot);
		const state = await coordinator.start(contract, command, { approvedContractDigest: plan.contractDigest });
		const path = join(stateRoot, contract.runId);
		const journal = readRunJournal(path);
		if (!journal) throw new Error("missing fixture journal");
		if (fault === "missing-key") rmSync(join(path, "issuer.key"));
		else writeFileSync(join(path, "attestations", `${state.receiptDigest}.json`), '{"forged":true}');
		expect(classifyEvidenceRead(path, journal, "f".repeat(64))).toMatchObject({
			authenticity: fault === "missing-key" ? "unverifiable" : "invalid",
			evidence: null,
		});
	});

	it("reports the same evidence axes at the real CLI and SDK read ports without writing", async () => {
		const { contract, plan, command } = prepared();
		const coordinator = new RunCoordinator(stateRoot);
		await coordinator.start(contract, command, { approvedContractDigest: plan.contractDigest });
		const journal = readRunJournal(join(stateRoot, contract.runId));
		const expected = coordinator.evidenceRead(contract.runId);
		const output: string[] = [];
		const capture = vi.spyOn(process.stdout, "write").mockImplementation((data) => {
			output.push(String(data));
			return true;
		});
		try {
			const result = await runVerifiedRunCli([
				"run",
				"evidence",
				contract.runId,
				"--state-dir",
				stateRoot,
				"--json",
			]);
			expect(result.exitCode).toBe(0);
			const parsed: unknown = JSON.parse(output.join(""));
			expect(parsed).toMatchObject(expected);
			expect(readRunJournal(join(stateRoot, contract.runId))?.bytesDigest).toBe(journal?.bytesDigest);
		} finally {
			capture.mockRestore();
		}
	});

	it("keeps the verifier candidate read-only", async () => {
		const { contract, plan, command } = prepared({
			checks: [{ claimId: "immutable", argv: ["/bin/sh", "-c", "printf forged > result.txt"], stdout: "" }],
		});
		const state = await new RunCoordinator(stateRoot).start(contract, command, {
			approvedContractDigest: plan.contractDigest,
		});
		expect(state.verification).toBe("violated");
	});

	it("does not expose the host state root or inherited secrets to the writer", async () => {
		const { contract, plan, command } = prepared({
			writer: ["/bin/sh", "-c", `test ! -e '${stateRoot}' && test -z "$HOME" && printf hello > result.txt`],
		});
		const state = await new RunCoordinator(stateRoot).start(contract, command, {
			approvedContractDigest: plan.contractDigest,
		});
		expect(state.verification).toBe("verified");
	});

	it("rejects symlinks rather than following them outside the input snapshot", () => {
		symlinkSync("/etc/passwd", join(workspace, "escape"));
		expect(() => planVerifiedRun(rawContract())).toThrow(/file_type/);
	});

	it("caps noisy children and never accepts their partial output", async () => {
		const { contract, plan, command } = prepared({ writer: ["/bin/sh", "-c", "while :; do printf flood; done"] });
		const state = await new RunCoordinator(stateRoot).start(contract, command, {
			approvedContractDigest: plan.contractDigest,
		});
		expect(state).toMatchObject({ execution: "failed", settlement: "settled", failure: "output_limit" });
	});

	it("joins a timed-out namespace before settling and preserves the verification reserve", async () => {
		const raw = rawContract();
		const { contract, plan, command } = prepared({
			writer: ["/bin/sh", "-c", "sleep 30"],
			budget: { ...raw.budget, workMs: 100 },
		});
		const state = await new RunCoordinator(stateRoot).start(contract, command, {
			approvedContractDigest: plan.contractDigest,
		});
		expect(state).toMatchObject({ execution: "failed", settlement: "settled", failure: "deadline" });
	});

	it("settles instead of quarantining when a post-dispatch deadline rejection never spawned", async () => {
		// Slow-runner race: the deadline is still positive when dispatch is journaled,
		// but the spawn-side second evaluation crosses zero before the supervisor is
		// invoked. That rejection provably ran nothing, so the run must journal the
		// exit and settle — an open executionId here quarantined forever on CI.
		const { contract, plan, command } = prepared();
		const sandbox = vi.spyOn(broker, "executeSandbox").mockRejectedValue(new VerifiedRunError("deadline"));
		try {
			const state = await new RunCoordinator(stateRoot).start(contract, command, {
				approvedContractDigest: plan.contractDigest,
			});
			expect(state).toMatchObject({ execution: "failed", settlement: "settled", failure: "deadline" });
			expect(state.activeExecutionIds).toEqual([]);
		} finally {
			sandbox.mockRestore();
		}
	});

	it("settles a never-started reservation if the dispatch journal append fails", async () => {
		const { contract, plan, command } = prepared();
		const coordinator = new RunCoordinator(stateRoot);
		const append = VerifiedRunJournal.prototype.append;
		const fault = vi.spyOn(VerifiedRunJournal.prototype, "append").mockImplementation(function (
			this: VerifiedRunJournal,
			event,
		) {
			if (event.kind === "dispatch") throw new Error("dispatch append failed");
			return append.call(this, event);
		});
		try {
			await expect(
				coordinator.start(contract, command, { approvedContractDigest: plan.contractDigest }),
			).rejects.toThrow(/dispatch append failed/);
			expect(coordinator.inspectAuthority().status.blockingGrants).toEqual([]);
		} finally {
			fault.mockRestore();
		}
	});

	it("does not misclassify an onReady cancellation error as never spawned", async () => {
		const { contract, plan, command } = prepared();
		const coordinator = new RunCoordinator(stateRoot);
		const append = VerifiedRunJournal.prototype.append;
		const fault = vi.spyOn(VerifiedRunJournal.prototype, "append").mockImplementation(function (
			this: VerifiedRunJournal,
			event,
		) {
			if (event.kind === "process_ready") throw new VerifiedRunError("cancelled");
			return append.call(this, event);
		});
		try {
			await coordinator.start(contract, command, { approvedContractDigest: plan.contractDigest });
			expect(coordinator.inspectAuthority().status.blockingGrants).toEqual([
				expect.objectContaining({ state: "quarantined", effectLive: true }),
			]);
		} finally {
			fault.mockRestore();
		}
	});

	it("rechecks the work deadline after committing dispatch intent", async () => {
		const { contract, plan, command } = prepared();
		const clock = vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(10000);
		try {
			const state = await new RunCoordinator(stateRoot).start(contract, command, {
				approvedContractDigest: plan.contractDigest,
			});
			expect(state.failure).toBe("deadline");
			expect(readdirSync(join(stateRoot, contract.runId, "writer"))).toEqual(["input.txt"]);
		} finally {
			clock.mockRestore();
		}
	});

	it.each(["missing_issuer", "forged_attestation", "wrong_candidate", "unsafe_artifact"] as const)(
		"rejects %s after successful verification",
		async (fault) => {
			const { contract, plan, command } = prepared();
			const coordinator = new RunCoordinator(stateRoot);
			const state = await coordinator.start(contract, command, { approvedContractDigest: plan.contractDigest });
			expect(state.verification).toBe("verified");
			switch (fault) {
				case "missing_issuer":
					rmSync(join(stateRoot, contract.runId, "issuer.key"));
					expect(() => coordinator.evidence(contract.runId)).toThrow();
					break;
				case "forged_attestation":
					writeFileSync(
						join(stateRoot, contract.runId, "attestations", `${state.receiptDigest}.json`),
						'{"trusted":true,"verified":true}',
					);
					expect(() => coordinator.inspect(contract.runId)).toThrow(/integrity/);
					break;
				case "wrong_candidate":
					expect(() => coordinator.artifact(contract.runId, "f".repeat(64), "result.txt")).toThrow(
						/candidate_mismatch/,
					);
					break;
				case "unsafe_artifact":
					expect(() => coordinator.artifact(contract.runId, state.candidateDigest ?? "", "../issuer.key")).toThrow(
						/artifact_scope/,
					);
					break;
				default: {
					const exhaustive: never = fault;
					throw new Error(exhaustive);
				}
			}
		},
	);

	it("fails closed if an accepted candidate blob is modified after verification", async () => {
		const { contract, plan, command } = prepared();
		const coordinator = new RunCoordinator(stateRoot);
		await coordinator.start(contract, command, { approvedContractDigest: plan.contractDigest });
		const bundle = coordinator.evidence(contract.runId);
		const file = bundle.manifest.files.find((entry) => entry.path === "result.txt");
		if (!file) throw new Error("fixture candidate missing");
		writeFileSync(join(stateRoot, contract.runId, "blobs", file.digest), "forged");
		expect(() => coordinator.evidence(contract.runId)).toThrow(/integrity/);
	});
});
