import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
	parseRunContract,
	parseRunPublishCommand,
	parseRunResumeCommand,
	parseRunStartCommand,
	parseRunTaskRetryCommand,
	parseRunWriterRestartCommand,
} from "omk-protocol";
import { ensureDurableDirectorySync } from "../durable-file-io.ts";
import { acquireSessionOwnerLeaseSync } from "../session-owner-lease.ts";
import {
	type AuthorityStoreView,
	inspectRunAuthority,
	type RunAuthority,
	RunAuthorityPool,
} from "./authority-runtime.ts";
import { commandEnvironmentDigest, probeVerifiedSandbox } from "./broker.ts";
import { captureCandidate, materializeCandidate, storeCandidate } from "./candidate.ts";
import { preflightCheckReceipts } from "./check-receipt.ts";
import { inspectTaskRecovery, retryDagTasks, type TaskRecoveryInspection } from "./dag-recovery.ts";
import { createRunIssuer, readRunEvidence, type VerifiedRunEvidence } from "./evidence.ts";
import { journalPath, type RunJournalRecord, readRunJournal, VerifiedRunJournal } from "./journal.ts";
import type { RunPhaseContext } from "./phase-context.ts";
import { inspectRunRecovery, type RecoveryInspection, resumeFrozenCandidate } from "./recovery.ts";
import { anchorRunBudget, readRunClock } from "./recovery-clock.ts";
import type { VerifiedRunApproval } from "./run-plan.ts";
import { type PublishOptions, publishVerifiedRun } from "./run-publish.ts";
import { deriveRunStatus, type RunStatus } from "./run-status.ts";
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

export type { AuthorityStoreView } from "./authority-runtime.ts";
export { planVerifiedRun, type VerifiedRunApproval, type VerifiedRunPlan } from "./run-plan.ts";

/** Owns the opt-in single-host run; session capabilities come only from trusted host composition. */
export class RunCoordinator {
	private readonly stateRoot: string;
	private readonly runtime: VerifiedRunRuntime | undefined;
	/**
	 * One shared authority store while dispatch-capable work is in flight: the
	 * authority lease is fail-fast cross-process, so concurrent operations on
	 * this coordinator pool a single open store rather than open their own.
	 * The open is the restart boundary — epoch advance plus reconciliation
	 * complete before any new dispatch may be admitted.
	 */
	private readonly authorityPool = new RunAuthorityPool();
	constructor(stateRoot: string, runtime?: VerifiedRunRuntime) {
		this.stateRoot = resolve(stateRoot);
		this.runtime = runtime;
	}

	/** Run `work` under the shared, reconciled authority store for this run's state root. */
	private withAuthority<T>(runId: string, work: (runPath: string, authority: RunAuthority) => T | Promise<T>) {
		const runPath = stateRunPath(this.stateRoot, runId);
		return this.authorityPool.run(runPath, runId, (authority) => work(runPath, authority));
	}

	inspect(runId: string): RunProjection {
		const journal = readRunJournal(stateRunPath(this.stateRoot, runId));
		if (!journal || journal.state.runId !== runId) throw new VerifiedRunError("missing_run");
		if (journal.state.receiptDigest) this.evidence(runId);
		return journal.state;
	}

	/**
	 * Derived lifecycle/recovery status of a run — same journal truth as
	 * `inspect`, projected into the machine-readable `RunStatus` view
	 * (lifecycle token, completion ladder, unresolved concerns, recovery
	 * command hints). Never reports a recovered/quarantined run as clean.
	 */
	status(runId: string): RunStatus {
		return deriveRunStatus(this.inspect(runId));
	}

	/** The run's hashed journal records — the event stream the projection replays. */
	events(runId: string): readonly RunJournalRecord[] {
		const journal = readRunJournal(stateRunPath(this.stateRoot, runId));
		if (!journal || journal.state.runId !== runId) throw new VerifiedRunError("missing_run");
		if (journal.state.receiptDigest) this.evidence(runId);
		return journal.records;
	}

	/**
	 * The durable authority store under this state root: which grant holds
	 * which claims, why it is quarantined, and whether termination was
	 * witnessed. Read-only; a missing store reads as an empty projection.
	 */
	inspectAuthority(): AuthorityStoreView {
		return inspectRunAuthority(this.stateRoot);
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

	inspectTaskRecovery(runId: string): TaskRecoveryInspection {
		const report = inspectTaskRecovery(stateRunPath(this.stateRoot, runId));
		if (report.state.runId !== runId) throw new VerifiedRunError("missing_run");
		if (report.state.receiptDigest) this.evidence(runId);
		return report;
	}

	async retryTasks(input: unknown, approval: VerifiedRunApproval): Promise<RunProjection> {
		const command = parseRunTaskRetryCommand(input);
		if (approval.approvedContractDigest !== command.contractDigest) throw new VerifiedRunError("approval");
		await this.withAuthority(command.runId, (runPath, authority) =>
			retryDagTasks(runPath, command, { ...(approval.signal ? { signal: approval.signal } : {}), authority }),
		);
		return this.inspect(command.runId);
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

	async publish(input: unknown, approval: VerifiedRunApproval, options: PublishOptions = {}): Promise<RunProjection> {
		const command = parseRunPublishCommand(input);
		if (approval.approvedContractDigest !== command.contractDigest) throw new VerifiedRunError("approval");
		if (approval.signal?.aborted) throw new VerifiedRunError("cancelled");
		return this.withAuthority(command.runId, (runPath, authority) =>
			publishVerifiedRun(runPath, command, {
				...options,
				authority,
				...(approval.signal ? { signal: approval.signal } : {}),
			}),
		);
	}

	async resume(input: unknown, approval: VerifiedRunApproval): Promise<RunProjection> {
		const command = parseRunResumeCommand(input);
		if (approval.approvedContractDigest !== command.contractDigest) throw new VerifiedRunError("approval");
		await this.withAuthority(command.runId, (runPath, authority) =>
			resumeFrozenCandidate(runPath, command, {
				...(approval.signal ? { signal: approval.signal } : {}),
				authority,
			}),
		);
		return this.inspect(command.runId);
	}

	async restartWriter(input: unknown, approval: VerifiedRunApproval): Promise<RunProjection> {
		const command = parseRunWriterRestartCommand(input);
		if (approval.approvedContractDigest !== command.contractDigest) throw new VerifiedRunError("approval");
		await this.withAuthority(command.runId, (runPath, authority) =>
			restartIsolatedWriter(runPath, command, {
				...(approval.signal ? { signal: approval.signal } : {}),
				...(this.runtime ? { runtime: this.runtime } : {}),
				authority,
			}),
		);
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
		return this.authorityPool.run(runPath, contract.runId, async (authority: RunAuthority) => {
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
					authority,
					...(approval.signal ? { signal: approval.signal } : {}),
				};
				try {
					createRunIssuer(runPath);
					storeCandidate(base, runPath);
					journal.append({ kind: "input_checkpoint", digest: base.digest });
					const work = join(runPath, "writer");
					if (contract.profile !== "linux-command-dag-v1") materializeCandidate(base, work);
					const workDeadline = began + contract.budget.workMs;
					await executeWriter(context, {
						workspace: work,
						deadline: workDeadline,
						...(this.runtime ? { runtime: this.runtime } : {}),
					});
					if (journal.state.execution === "paused") return this.inspect(contract.runId);
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
		});
	}
}
