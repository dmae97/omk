import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
	parseRunContract,
	parseRunResumeCommand,
	parseRunStartCommand,
	parseRunWriterRestartCommand,
	type RunContract,
} from "omk-protocol";
import { ensureDurableDirectorySync } from "../durable-file-io.ts";
import { acquireSessionOwnerLeaseSync } from "../session-owner-lease.ts";
import { commandEnvironmentDigest, probeVerifiedSandbox } from "./broker.ts";
import { captureCandidate, materializeCandidate, storeCandidate } from "./candidate.ts";
import { preflightCheckReceipts } from "./check-receipt.ts";
import { createRunIssuer, readRunEvidence, type VerifiedRunEvidence } from "./evidence.ts";
import { journalPath, readRunJournal, VerifiedRunJournal } from "./journal.ts";
import type { RunPhaseContext } from "./phase-context.ts";
import { inspectRunRecovery, type RecoveryInspection, resumeFrozenCandidate } from "./recovery.ts";
import { anchorRunBudget, readRunClock } from "./recovery-clock.ts";
import type { RunProjection } from "./run-types.ts";
import type { VerifiedRunRuntime } from "./session-port.ts";
import {
	assertStateOutsideWorkspace,
	digestBytes,
	digestObject,
	readRegularFile,
	stateRunPath,
	VerifiedRunError,
} from "./storage.ts";
import { verifyCandidate } from "./verification-phase.ts";
import { publishWriterCandidate } from "./writer-completion.ts";
import { executeWriter } from "./writer-phase.ts";
import { inspectWriterRecovery, restartIsolatedWriter, type WriterRecoveryInspection } from "./writer-recovery.ts";

export interface VerifiedRunApproval {
	/** Trusted host grant, not a JSON field in the model-authored contract or command. */
	readonly approvedContractDigest: string;
	readonly signal?: AbortSignal;
}
export interface VerifiedRunPlan {
	readonly profile: RunContract["profile"];
	readonly contractDigest: string;
	readonly baseDigest: string;
	readonly baseMatches: boolean;
	readonly environmentDigest: string;
	readonly checks: readonly string[];
	readonly executionRequested: false;
}

export function planVerifiedRun(input: unknown): VerifiedRunPlan {
	const contract = parseRunContract(input);
	const snapshot = captureCandidate(contract.workspace.root, contract.budget);
	return Object.freeze({
		profile: contract.profile,
		contractDigest: digestObject(contract),
		baseDigest: snapshot.digest,
		baseMatches: snapshot.digest === contract.workspace.baseDigest,
		environmentDigest: commandEnvironmentDigest(contract, "gated-v1"),
		checks: Object.freeze(contract.checks.map((check) => check.claimId)),
		executionRequested: false,
	});
}

/** Owns the opt-in single-host run; session capabilities come only from trusted host composition. */
export class RunCoordinator {
	private readonly stateRoot: string;
	private readonly runtime: VerifiedRunRuntime | undefined;
	constructor(stateRoot: string, runtime?: VerifiedRunRuntime) {
		this.stateRoot = resolve(stateRoot);
		this.runtime = runtime;
	}

	inspect(runId: string): RunProjection {
		const journal = readRunJournal(stateRunPath(this.stateRoot, runId));
		if (!journal || journal.state.runId !== runId) throw new VerifiedRunError("missing_run");
		if (journal.state.receiptDigest) this.evidence(runId);
		return journal.state;
	}

	inspectRecovery(runId: string): RecoveryInspection {
		const report = inspectRunRecovery(stateRunPath(this.stateRoot, runId));
		if (report.state.runId !== runId) throw new VerifiedRunError("missing_run");
		if (report.state.receiptDigest) this.evidence(runId);
		return report;
	}

	inspectWriterRecovery(runId: string): WriterRecoveryInspection {
		const report = inspectWriterRecovery(stateRunPath(this.stateRoot, runId));
		if (report.state.runId !== runId) throw new VerifiedRunError("missing_run");
		if (report.state.receiptDigest) this.evidence(runId);
		return report;
	}

	evidence(runId: string): VerifiedRunEvidence {
		const runPath = stateRunPath(this.stateRoot, runId);
		const journal = readRunJournal(runPath);
		const first = journal?.records[0]?.event;
		if (!journal || first?.kind !== "created" || first.contract.runId !== runId)
			throw new VerifiedRunError("missing_run");
		return readRunEvidence(
			runPath,
			journal,
			commandEnvironmentDigest(first.contract, journal.state.budget ? "gated-v1" : "legacy"),
		);
	}

	artifact(runId: string, candidateDigest: string, path: string): Buffer {
		const evidence = this.evidence(runId);
		if (!evidence.verified || candidateDigest !== evidence.candidateDigest)
			throw new VerifiedRunError("candidate_mismatch");
		const file = evidence.manifest.files.find((entry) => entry.path === path);
		if (!file) throw new VerifiedRunError("artifact_scope");
		const bytes = readRegularFile(join(stateRunPath(this.stateRoot, runId), "blobs", file.digest), file.size);
		if (digestBytes(bytes) !== file.digest || bytes.length !== file.size) throw new VerifiedRunError("integrity");
		return bytes;
	}

	async resume(input: unknown, approval: VerifiedRunApproval): Promise<RunProjection> {
		const command = parseRunResumeCommand(input);
		if (approval.approvedContractDigest !== command.contractDigest) throw new VerifiedRunError("approval");
		await resumeFrozenCandidate(stateRunPath(this.stateRoot, command.runId), command, approval.signal);
		return this.inspect(command.runId);
	}

	async restartWriter(input: unknown, approval: VerifiedRunApproval): Promise<RunProjection> {
		const command = parseRunWriterRestartCommand(input);
		if (approval.approvedContractDigest !== command.contractDigest) throw new VerifiedRunError("approval");
		await restartIsolatedWriter(stateRunPath(this.stateRoot, command.runId), command, {
			...(approval.signal ? { signal: approval.signal } : {}),
			...(this.runtime ? { runtime: this.runtime } : {}),
		});
		return this.inspect(command.runId);
	}

	async start(input: unknown, request: unknown, approval: VerifiedRunApproval): Promise<RunProjection> {
		const began = performance.now();
		const clock = readRunClock();
		const contract = parseRunContract(input);
		const command = parseRunStartCommand(request);
		const contractDigest = digestObject(contract);
		if (approval.approvedContractDigest !== contractDigest) throw new VerifiedRunError("approval");
		if (command.contractDigest !== contractDigest || command.runId !== contract.runId)
			throw new VerifiedRunError("command_conflict");
		if (approval.signal?.aborted) throw new VerifiedRunError("cancelled");
		assertStateOutsideWorkspace(this.stateRoot, contract.workspace.root);
		const runPath = stateRunPath(this.stateRoot, contract.runId);
		const existing = readRunJournal(runPath);
		if (existing) {
			const first = existing.records[0]?.event;
			if (
				first?.kind !== "created" ||
				digestObject(first.command) !== digestObject(command) ||
				digestObject(first.contract) !== contractDigest
			)
				throw new VerifiedRunError("command_conflict");
			return this.inspect(contract.runId);
		}
		const base = captureCandidate(contract.workspace.root, contract.budget);
		if (base.digest !== contract.workspace.baseDigest) throw new VerifiedRunError("base_conflict");
		const environmentDigest = commandEnvironmentDigest(contract, "gated-v1");
		preflightCheckReceipts(contract);
		probeVerifiedSandbox();
		ensureDurableDirectorySync(runPath);
		const owner = acquireSessionOwnerLeaseSync(journalPath(runPath));
		try {
			if (readRunJournal(runPath)) throw new VerifiedRunError("command_conflict");
			const journal = new VerifiedRunJournal(runPath, owner);
			journal.append({ kind: "created", contract, command });
			const budget = anchorRunBudget(contract.budget, clock);
			journal.append({ kind: "budget_anchored", budget, environmentDigest, driver: "linux-pidns-gate-v1" });
			const context: RunPhaseContext = {
				runPath,
				contract,
				journal,
				...(approval.signal ? { signal: approval.signal } : {}),
			};
			try {
				createRunIssuer(runPath);
				storeCandidate(base, runPath);
				journal.append({ kind: "input_checkpoint", digest: base.digest });
				const work = join(runPath, "writer");
				materializeCandidate(base, work);
				const workDeadline = began + contract.budget.workMs;
				await executeWriter(context, {
					workspace: work,
					deadline: workDeadline,
					...(this.runtime ? { runtime: this.runtime } : {}),
				});
				publishWriterCandidate(context, work, workDeadline);
				await verifyCandidate(context);
				return this.inspect(contract.runId);
			} catch (error) {
				if (error instanceof VerifiedRunError && !journal.state.receiptDigest)
					return journal.append({ kind: "failed", code: error.code });
				throw error;
			}
		} finally {
			owner.release();
		}
	}
}
