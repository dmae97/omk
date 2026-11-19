import { VERIFIED_COMMAND_VERSION } from "./run-contract.ts";
import { RunContractError, runDigest, runId, runLimit, runObject } from "./run-parsing.ts";

/** Observe an already-dispatched writer or verifier; never authorizes its replacement. */
export interface RunReconnectCommand {
	readonly schemaVersion: typeof VERIFIED_COMMAND_VERSION;
	readonly kind: "reconnect";
	readonly runId: string;
	readonly commandId: string;
	readonly executionId: string;
	readonly expectedRevision: number;
	readonly expectedGeneration: number;
	readonly contractDigest: string;
}

export function parseRunReconnectCommand(value: unknown): RunReconnectCommand {
	const input = runObject(value, [
		"schemaVersion",
		"kind",
		"runId",
		"commandId",
		"executionId",
		"expectedRevision",
		"expectedGeneration",
		"contractDigest",
	]);
	if (input.schemaVersion !== VERIFIED_COMMAND_VERSION || input.kind !== "reconnect")
		throw new RunContractError("reconnect version/kind");
	const executionId = runId(input.executionId);
	if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(executionId)) throw new RunContractError("executionId");
	return Object.freeze({
		schemaVersion: VERIFIED_COMMAND_VERSION,
		kind: "reconnect",
		runId: runId(input.runId),
		commandId: runId(input.commandId),
		executionId,
		expectedRevision: runLimit(input.expectedRevision, "expectedRevision", Number.MAX_SAFE_INTEGER),
		expectedGeneration: runLimit(input.expectedGeneration, "expectedGeneration", Number.MAX_SAFE_INTEGER),
		contractDigest: runDigest(input.contractDigest),
	});
}
