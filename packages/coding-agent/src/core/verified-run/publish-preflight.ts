import type { RunContract, RunPublishCommand } from "omk-protocol";
import { commandEnvironmentDigest } from "./broker.ts";
import { readRunEvidence } from "./evidence.ts";
import type { JournalSnapshot } from "./journal.ts";
import { publishPolicyDigest } from "./run-publish.ts";
import type { RunProjection } from "./run-types.ts";
import { VerifiedRunError } from "./storage.ts";

export function assertPublishable(
	snapshot: JournalSnapshot,
	command: RunPublishCommand,
	runPath: string,
): {
	readonly contract: RunContract;
	readonly state: RunProjection & { readonly candidateDigest: string; readonly receiptDigest: string };
} {
	const first = snapshot.records[0]?.event;
	if (first?.kind !== "created") throw new VerifiedRunError("missing_run");
	const contract = first.contract;
	const state = snapshot.state;
	if (
		state.verification !== "verified" ||
		state.application !== "candidate_ready" ||
		state.settlement !== "settled" ||
		!state.receiptDigest ||
		!state.candidateDigest ||
		state.activeExecutionIds.length !== 0 ||
		state.writerOpen
	)
		throw new VerifiedRunError("unverified");
	if (
		command.candidateDigest !== state.candidateDigest ||
		command.receiptDigest !== state.receiptDigest ||
		command.policyDigest !== publishPolicyDigest(contract)
	)
		throw new VerifiedRunError("invalid_binding");
	const evidence = readRunEvidence(runPath, snapshot, commandEnvironmentDigest(contract, "gated-v1"));
	if (
		!evidence.verified ||
		evidence.candidateDigest !== state.candidateDigest ||
		evidence.receiptDigest !== state.receiptDigest
	)
		throw new VerifiedRunError("invalid_binding");
	return { contract, state: { ...state, candidateDigest: state.candidateDigest, receiptDigest: state.receiptDigest } };
}
