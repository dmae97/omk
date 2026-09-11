import { join } from "node:path";
import { MAX_VERIFIED_RUN_GENERATIONS, type RunContract } from "omk-protocol";
import { commandEnvironmentDigest } from "./broker.ts";
import { loadCandidate } from "./candidate.ts";
import type { JournalSnapshot } from "./journal.ts";
import { probeNamespace } from "./namespace-identity.ts";
import { readRunClock, remainingRunTime } from "./recovery-clock.ts";
import { readRegularFile, VerifiedRunError } from "./storage.ts";

/** Common immutable-input, original-budget and observed-process boundary for local work recovery. */
export function assertWorkRecoverable(
	runPath: string,
	snapshot: JournalSnapshot,
): { readonly contract: RunContract; readonly remainingMs: number } {
	const state = snapshot.state;
	const first = snapshot.records[0]?.event;
	if (state.execution === "failed" || state.receiptDigest) throw new VerifiedRunError("resume_terminal");
	if (first?.kind !== "created" || !state.inputDigest || !state.budget || !state.environmentDigest)
		throw new VerifiedRunError("input_checkpoint_missing");
	if (state.candidateDigest || state.verificationDeadlineMs !== null) throw new VerifiedRunError("candidate_present");
	if (state.generation >= MAX_VERIFIED_RUN_GENERATIONS) throw new VerifiedRunError("recovery_limit");
	const clock = readRunClock();
	const remainingMs = remainingRunTime(state.budget, state.budget.workDeadlineMs, clock);
	if (clock.nowMs < (state.lastClockMs ?? state.budget.startedMs)) throw new VerifiedRunError("clock_rollback");
	if (remainingMs <= 0) throw new VerifiedRunError("deadline");
	for (const id of state.activeExecutionIds) {
		const dispatch = snapshot.records.find(
			(record) =>
				record.generation === state.generation &&
				record.event.kind === "dispatch" &&
				record.event.executionId === id,
		)?.event;
		const identity = state.processes.find((item) => item.executionId === id)?.identity;
		if (
			dispatch?.kind !== "dispatch" ||
			dispatch.role !== "writer" ||
			!identity ||
			probeNamespace(identity) !== "gone"
		)
			throw new VerifiedRunError("unsettled");
	}
	if (readRegularFile(join(runPath, "issuer.key"), 32).length !== 32) throw new VerifiedRunError("integrity");
	loadCandidate(runPath, state.inputDigest, first.contract.budget);
	if (commandEnvironmentDigest(first.contract, "gated-v1") !== state.environmentDigest)
		throw new VerifiedRunError("integrity");
	return { contract: first.contract, remainingMs };
}
