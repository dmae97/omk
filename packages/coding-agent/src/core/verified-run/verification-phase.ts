import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { commandEnvironmentDigest } from "./broker.ts";
import { captureCandidate, loadCandidate, materializeCandidate } from "./candidate.ts";
import { storeCheckReceipt } from "./check-receipt.ts";
import { type CheckObservation, issueRunEvidence } from "./evidence.ts";
import { executeRunCommand } from "./owned-execution.ts";
import type { RunPhaseContext } from "./phase-context.ts";
import { localVerificationDeadline } from "./recovery-clock.ts";
import type { RunProjection } from "./run-types.ts";
import { digestBytes, VerifiedRunError } from "./storage.ts";

/** Both start and resume use this same verification path; no writer/model code is reachable here. */
export async function verifyCandidate(context: RunPhaseContext): Promise<RunProjection> {
	const { contract, journal, runPath } = context;
	const state = journal.state;
	if (!state.candidateDigest || !state.budget || state.verificationDeadlineMs === null || !state.environmentDigest)
		throw new VerifiedRunError("resume_unavailable");
	const deadline = localVerificationDeadline(state.budget, state.verificationDeadlineMs);
	if (commandEnvironmentDigest(contract, "gated-v1") !== state.environmentDigest)
		throw new VerifiedRunError("environment_changed");
	const candidate = loadCandidate(runPath, state.candidateDigest, contract.budget);
	const fixed = join(runPath, state.generation === 1 ? "candidate" : `candidate-${state.generation}`);
	materializeCandidate(candidate, fixed);
	const checks: CheckObservation[] = [];
	for (const check of contract.checks) {
		const { executionId, result, timeoutMs } = await executeRunCommand(
			journal,
			{ role: "verifier", argv: check.argv, workspace: fixed, deadline, claimId: check.claimId },
			{ ...contract.budget, ...(context.signal ? { signal: context.signal } : {}) },
		);
		checks.push({
			claimId: check.claimId,
			executionId,
			stdoutDigest: digestBytes(result.stdout),
			stderrDigest: digestBytes(result.stderr),
			exitCode: result.exitCode,
			failure: result.failure,
			receiptCoreDigest: storeCheckReceipt(runPath, contract, {
				check,
				executionId,
				result,
				timeoutMs,
				manifest: candidate.manifest,
			}),
		});
	}
	if (
		captureCandidate(fixed, contract.budget).digest !== state.candidateDigest ||
		commandEnvironmentDigest(contract, "gated-v1") !== state.environmentDigest
	)
		throw new VerifiedRunError("integrity");
	if (performance.now() >= deadline) throw new VerifiedRunError("deadline");
	const receipt = issueRunEvidence(runPath, contract, {
		generation: state.generation,
		candidateDigest: state.candidateDigest,
		environmentDigest: state.environmentDigest,
		checks,
	});
	if (performance.now() >= deadline || journal.state.generation !== state.generation)
		throw new VerifiedRunError("deadline");
	return journal.append({ kind: "evaluated", receiptDigest: receipt.digest, verified: receipt.verified });
}
