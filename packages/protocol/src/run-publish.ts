import { VERIFIED_COMMAND_VERSION } from "./run-contract.ts";
import { RunContractError, runDigest, runId, runLimit, runObject, runText } from "./run-parsing.ts";

/** Full git object name in either supported object format; an all-zero value marks an unborn ref. */
export function runOid(value: unknown): string {
	const oid = runText(value, "oid", 64);
	if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(oid)) throw new RunContractError("oid");
	return oid;
}

/**
 * Explicit publish intent for one sealed candidate. The host authenticates approval
 * separately; `parentOid` is the caller's expectation of the acceptance ref's value
 * (all zeros when the ref is still unborn) and is used as the CAS old value.
 */
export interface RunPublishCommand {
	readonly schemaVersion: typeof VERIFIED_COMMAND_VERSION;
	readonly kind: "publish";
	readonly runId: string;
	readonly commandId: string;
	readonly expectedRevision: number;
	readonly expectedGeneration: number;
	readonly contractDigest: string;
	readonly candidateDigest: string;
	readonly parentOid: string;
	readonly receiptDigest: string;
	readonly policyDigest: string;
}

export function parseRunPublishCommand(value: unknown): RunPublishCommand {
	const input = runObject(value, [
		"schemaVersion",
		"kind",
		"runId",
		"commandId",
		"expectedRevision",
		"expectedGeneration",
		"contractDigest",
		"candidateDigest",
		"parentOid",
		"receiptDigest",
		"policyDigest",
	]);
	if (input.schemaVersion !== VERIFIED_COMMAND_VERSION || input.kind !== "publish")
		throw new RunContractError("publish version/kind");
	return Object.freeze({
		schemaVersion: VERIFIED_COMMAND_VERSION,
		kind: "publish",
		runId: runId(input.runId),
		commandId: runId(input.commandId),
		expectedRevision: runLimit(input.expectedRevision, "expectedRevision", Number.MAX_SAFE_INTEGER),
		expectedGeneration: runLimit(input.expectedGeneration, "expectedGeneration", Number.MAX_SAFE_INTEGER),
		contractDigest: runDigest(input.contractDigest),
		candidateDigest: runDigest(input.candidateDigest),
		parentOid: runOid(input.parentOid),
		receiptDigest: runDigest(input.receiptDigest),
		policyDigest: runDigest(input.policyDigest),
	});
}
