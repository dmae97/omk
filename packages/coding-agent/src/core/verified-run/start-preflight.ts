import { parseRunContract, parseRunStartCommand } from "omk-protocol";
import type { VerifiedRunApproval } from "./run-plan.ts";
import { digestObject, VerifiedRunError } from "./storage.ts";

/** Shared input/approval gate only; workspace, ownership and execution checks follow separately. */
export function parseApprovedRunStart(input: unknown, request: unknown, approval: VerifiedRunApproval) {
	const contract = parseRunContract(input);
	const command = parseRunStartCommand(request);
	const contractDigest = digestObject(contract);
	if (approval.approvedContractDigest !== contractDigest) throw new VerifiedRunError("approval");
	if (command.contractDigest !== contractDigest || command.runId !== contract.runId)
		throw new VerifiedRunError("command_conflict");
	if (approval.signal?.aborted) throw new VerifiedRunError("cancelled");
	return { contract, command, contractDigest };
}
