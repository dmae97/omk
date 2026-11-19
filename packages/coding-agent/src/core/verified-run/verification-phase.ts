import { join } from "node:path";
import { performance } from "node:perf_hooks";
import type { SessionOwnerLease } from "../session-owner-lease.ts";
import { commandEnvironmentDigest } from "./broker.ts";
import { captureCandidate, loadCandidate, materializeCandidate } from "./candidate.ts";
import { storeCheckReceipt } from "./check-receipt.ts";
import { type CheckObservation, issueRunEvidence } from "./evidence.ts";
import { recoverVerifierCheck } from "./native-verifier-check.ts";
import { executeRunCommand, type OwnedRunResult } from "./owned-execution.ts";
import type { RunPhaseContext } from "./phase-context.ts";
import { localVerificationDeadline } from "./recovery-clock.ts";
import { requireRunJournal } from "./recovery-command.ts";
import type { RunProjection } from "./run-types.ts";
import { rustHostReconnectEnabled } from "./rust-host-binding.ts";
import { digestBytes, VerifiedRunError } from "./storage.ts";

/** Both start and resume use this same verification path; no writer/model code is reachable here. */
export async function verifyCandidate(
	context: RunPhaseContext,
	reconnectOwner?: SessionOwnerLease,
): Promise<RunProjection> {
	const { contract, journal, runPath } = context;
	const state = journal.state;
	if (!state.candidateDigest || !state.budget || state.verificationDeadlineMs === null || !state.environmentDigest)
		throw new VerifiedRunError("resume_unavailable");
	const deadline = localVerificationDeadline(state.budget, state.verificationDeadlineMs);
	if (commandEnvironmentDigest(contract, "gated-v1") !== state.environmentDigest)
		throw new VerifiedRunError("environment_changed");
	const candidate = loadCandidate(runPath, state.candidateDigest, contract.budget);
	const fixed = join(runPath, state.generation === 1 ? "candidate" : `candidate-${state.generation}`);
	if (!reconnectOwner) materializeCandidate(candidate, fixed);
	else if (captureCandidate(fixed, contract.budget).digest !== state.candidateDigest)
		throw new VerifiedRunError("integrity");
	const previous = reconnectOwner
		? requireRunJournal(runPath).records.filter(
				(record) =>
					record.generation === state.generation &&
					record.event.kind === "dispatch" &&
					record.event.role === "verifier",
			)
		: [];
	const checks: CheckObservation[] = [];
	for (const check of contract.checks) {
		const dispatched = previous.find(
			({ event }) => event.kind === "dispatch" && event.claimId === check.claimId,
		)?.event;
		let execution: OwnedRunResult;
		if (dispatched && reconnectOwner) {
			if (dispatched.kind !== "dispatch" || !dispatched.timeoutMs) throw new VerifiedRunError("recovery_legacy");
			execution = {
				executionId: dispatched.executionId,
				result: await recoverVerifierCheck(context, dispatched.executionId, reconnectOwner),
				timeoutMs: dispatched.timeoutMs,
			};
		} else
			execution = await executeRunCommand(
				journal,
				{
					role: "verifier",
					argv: check.argv,
					workspace: fixed,
					deadline,
					claimId: check.claimId,
					...(contract.profile === "linux-command-v1" && rustHostReconnectEnabled()
						? { detachable: true as const }
						: {}),
				},
				{
					...contract.budget,
					authority: context.authority,
					...(context.signal ? { signal: context.signal } : {}),
				},
			);
		const { executionId, result, timeoutMs } = execution;
		// An operator cancellation says nothing about the candidate: never sign it as a failed check.
		if (result.failure === "cancelled") throw new VerifiedRunError("cancelled");
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
