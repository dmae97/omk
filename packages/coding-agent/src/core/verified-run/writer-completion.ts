import { performance } from "node:perf_hooks";
import { assertCandidateScope, captureCandidate, loadCandidate, storeCandidate } from "./candidate.ts";
import type { RunPhaseContext } from "./phase-context.ts";
import { readRunClock } from "./recovery-clock.ts";
import { VerifiedRunError } from "./storage.ts";

/** Seal output only against the input that was durably pinned before this run's first writer. */
export function publishWriterCandidate(context: RunPhaseContext, workspace: string, workDeadline: number): void {
	const { contract, journal, runPath } = context;
	const state = journal.state;
	if (!state.inputDigest || !state.budget) throw new VerifiedRunError("input_checkpoint_missing");
	const base = loadCandidate(runPath, state.inputDigest, contract.budget);
	const candidate = captureCandidate(workspace, contract.budget);
	assertCandidateScope(base.manifest, candidate.manifest, contract.writablePaths);
	storeCandidate(candidate, runPath);
	const observed = readRunClock();
	if (
		observed.bootId !== state.budget.bootId ||
		observed.nowMs > state.budget.workDeadlineMs ||
		performance.now() >= workDeadline
	)
		throw new VerifiedRunError("deadline");
	journal.append({
		kind: "candidate",
		digest: candidate.digest,
		observedMs: observed.nowMs,
		verificationDeadlineMs: Math.min(observed.nowMs + contract.budget.verifyMs, state.budget.verifyCapMs),
	});
}
