import { VERIFIED_COMMAND_VERSION } from "./run-contract.ts";
import { RunContractError, runDigest, runId, runLimit, runObject } from "./run-parsing.ts";

/** Restart intent for an isolated writer, bound to its durable input checkpoint, not partial output. */
export interface RunWriterRestartCommand {
	readonly schemaVersion: typeof VERIFIED_COMMAND_VERSION;
	readonly kind: "restart_writer";
	readonly runId: string;
	readonly commandId: string;
	readonly expectedRevision: number;
	readonly expectedGeneration: number;
	readonly contractDigest: string;
	readonly baseDigest: string;
}

export function parseRunWriterRestartCommand(value: unknown): RunWriterRestartCommand {
	const input = runObject(value, [
		"schemaVersion",
		"kind",
		"runId",
		"commandId",
		"expectedRevision",
		"expectedGeneration",
		"contractDigest",
		"baseDigest",
	]);
	if (input.schemaVersion !== VERIFIED_COMMAND_VERSION || input.kind !== "restart_writer")
		throw new RunContractError("writer restart version/kind");
	return Object.freeze({
		schemaVersion: VERIFIED_COMMAND_VERSION,
		kind: "restart_writer",
		runId: runId(input.runId),
		commandId: runId(input.commandId),
		expectedRevision: runLimit(input.expectedRevision, "expectedRevision", Number.MAX_SAFE_INTEGER),
		expectedGeneration: runLimit(input.expectedGeneration, "expectedGeneration", Number.MAX_SAFE_INTEGER),
		contractDigest: runDigest(input.contractDigest),
		baseDigest: runDigest(input.baseDigest),
	});
}
