import { join } from "node:path";
import { MAX_VERIFIED_RUN_GENERATIONS, type RunResumeCommand } from "omk-protocol";
import type { RunAuthority } from "./authority-runtime.ts";
import { commandEnvironmentDigest, probeVerifiedSandbox } from "./broker.ts";
import { loadCandidate } from "./candidate.ts";
import { preflightCheckReceipts } from "./check-receipt.ts";
import type { JournalSnapshot } from "./journal.ts";
import { probeNamespace } from "./namespace-identity.ts";
import { readRunClock, remainingVerification } from "./recovery-clock.ts";
import { requireRunJournal, withRecoveryLease } from "./recovery-command.ts";
import type { RunProjection } from "./run-types.ts";
import { readRegularFile, VerifiedRunError } from "./storage.ts";
import { verifyCandidate } from "./verification-phase.ts";

export interface RecoveryInspection {
	readonly state: RunProjection;
	readonly readiness:
		| "ready"
		| "terminal"
		| "legacy"
		| "candidate_missing"
		| "unsettled"
		| "expired"
		| "clock_changed"
		| "clock_rollback"
		| "clock_unavailable"
		| "recovery_limit"
		| "integrity";
	readonly remainingVerifyMs: number | null;
	/** A ready inspection is advisory; exclusive ownership is acquired only by resume. */
	readonly ownership: "lease_required";
}

function assertCandidateRecoverable(runPath: string, journal: JournalSnapshot): number {
	const state = journal.state;
	if (state.receiptDigest || state.execution === "failed") throw new VerifiedRunError("resume_terminal");
	if (!state.budget || !state.environmentDigest) throw new VerifiedRunError("recovery_legacy");
	if (!state.candidateDigest || state.writerOpen || state.verificationDeadlineMs === null)
		throw new VerifiedRunError("candidate_missing");
	if (state.generation >= MAX_VERIFIED_RUN_GENERATIONS) throw new VerifiedRunError("recovery_limit");
	const clock = readRunClock();
	const remaining = remainingVerification(state.budget, state.verificationDeadlineMs, clock);
	if (clock.nowMs < (state.lastClockMs ?? state.budget.startedMs)) throw new VerifiedRunError("clock_rollback");
	if (remaining <= 0) throw new VerifiedRunError("deadline");
	for (const id of state.activeExecutionIds) {
		const dispatch = journal.records.find(
			(record) =>
				record.generation === state.generation &&
				record.event.kind === "dispatch" &&
				record.event.executionId === id,
		)?.event;
		const identity = state.processes.find((process) => process.executionId === id)?.identity;
		if (
			dispatch?.kind !== "dispatch" ||
			dispatch.role !== "verifier" ||
			!identity ||
			probeNamespace(identity) !== "gone"
		)
			throw new VerifiedRunError("unsettled");
	}
	const first = journal.records[0]?.event;
	if (first?.kind !== "created") throw new VerifiedRunError("integrity");
	if (readRegularFile(join(runPath, "issuer.key"), 32).length !== 32) throw new VerifiedRunError("integrity");
	loadCandidate(runPath, state.candidateDigest, first.contract.budget);
	if (commandEnvironmentDigest(first.contract, "gated-v1") !== state.environmentDigest)
		throw new VerifiedRunError("integrity");
	return remaining;
}

export function inspectRunRecovery(runPath: string): RecoveryInspection {
	const journal = requireRunJournal(runPath);
	let readiness: RecoveryInspection["readiness"] = "ready";
	let remainingVerifyMs: number | null = null;
	try {
		remainingVerifyMs = assertCandidateRecoverable(runPath, journal);
	} catch (error) {
		if (!(error instanceof Error)) throw error;
		switch (error instanceof VerifiedRunError ? error.code : "integrity") {
			case "resume_terminal":
				readiness = "terminal";
				break;
			case "recovery_legacy":
				readiness = "legacy";
				break;
			case "deadline":
				readiness = "expired";
				remainingVerifyMs = 0;
				break;
			case "candidate_missing":
				readiness = "candidate_missing";
				break;
			case "unsettled":
				readiness = "unsettled";
				break;
			case "clock_changed":
				readiness = "clock_changed";
				break;
			case "clock_rollback":
				readiness = "clock_rollback";
				break;
			case "clock_unavailable":
				readiness = "clock_unavailable";
				break;
			case "recovery_limit":
				readiness = "recovery_limit";
				break;
			default:
				readiness = "integrity";
		}
	}
	return Object.freeze({ state: journal.state, readiness, remainingVerifyMs, ownership: "lease_required" });
}

export async function resumeFrozenCandidate(
	runPath: string,
	command: RunResumeCommand,
	options: { readonly signal?: AbortSignal; readonly authority: RunAuthority },
): Promise<RunProjection> {
	if (options.signal?.aborted) throw new VerifiedRunError("cancelled");
	return withRecoveryLease(runPath, command, async ({ snapshot, journal }) => {
		assertCandidateRecoverable(runPath, snapshot);
		const first = snapshot.records[0]?.event;
		if (first?.kind !== "created") throw new VerifiedRunError("integrity");
		preflightCheckReceipts(first.contract);
		probeVerifiedSandbox();
		assertCandidateRecoverable(runPath, snapshot);
		if (options.signal?.aborted) throw new VerifiedRunError("cancelled");
		journal.append({
			kind: "resumed",
			command,
			observedMs: readRunClock().nowMs,
			reconciledExecutionIds: snapshot.state.activeExecutionIds,
		});
		return verifyCandidate({
			runPath,
			journal,
			contract: first.contract,
			authority: options.authority,
			...(options.signal ? { signal: options.signal } : {}),
		});
	});
}
