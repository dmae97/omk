import { VERIFIED_COMMAND_VERSION } from "./run-contract.ts";
import { RunContractError, runDigest, runId, runLimit, runObject } from "./run-parsing.ts";

export const MAX_VERIFIED_RUN_GENERATIONS = 3;

/** Explicit execution intent; the host authenticates approval separately from this JSON. */
export interface RunResumeCommand {
	readonly schemaVersion: typeof VERIFIED_COMMAND_VERSION;
	readonly kind: "resume";
	readonly runId: string;
	readonly commandId: string;
	readonly expectedRevision: number;
	readonly expectedGeneration: number;
	readonly contractDigest: string;
	readonly candidateDigest: string;
}

export function parseRunResumeCommand(value: unknown): RunResumeCommand {
	const input = runObject(value, [
		"schemaVersion",
		"kind",
		"runId",
		"commandId",
		"expectedRevision",
		"expectedGeneration",
		"contractDigest",
		"candidateDigest",
	]);
	if (input.schemaVersion !== VERIFIED_COMMAND_VERSION || input.kind !== "resume")
		throw new RunContractError("resume version/kind");
	return Object.freeze({
		schemaVersion: VERIFIED_COMMAND_VERSION,
		kind: "resume",
		runId: runId(input.runId),
		commandId: runId(input.commandId),
		expectedRevision: runLimit(input.expectedRevision, "expectedRevision", Number.MAX_SAFE_INTEGER),
		expectedGeneration: runLimit(input.expectedGeneration, "expectedGeneration", Number.MAX_SAFE_INTEGER),
		contractDigest: runDigest(input.contractDigest),
		candidateDigest: runDigest(input.candidateDigest),
	});
}
