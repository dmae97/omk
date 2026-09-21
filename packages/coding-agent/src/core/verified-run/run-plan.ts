import { parseRunContract, type RunContract } from "omk-protocol";
import { commandEnvironmentDigest } from "./broker.ts";
import { captureCandidate } from "./candidate.ts";
import { digestObject } from "./storage.ts";

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
