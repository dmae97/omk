import { parseRunReconnectCommand } from "omk-protocol";
import { sequence } from "../../coordination/types.ts";
import type { RunEvent, WriterReduction } from "./run-types.ts";
import { digestObject, VerifiedRunError } from "./storage.ts";

type Reconnected = Extract<RunEvent, { kind: "reconnected" }>;

export function parseReconnectEvent(value: Readonly<Record<string, unknown>>): Reconnected {
	if (typeof value.observedMs !== "number" || !Number.isSafeInteger(value.observedMs) || value.observedMs < 0)
		throw new VerifiedRunError("integrity");
	return {
		kind: "reconnected",
		command: parseRunReconnectCommand(value.command),
		observedMs: value.observedMs,
		grantSequence: sequence(value.grantSequence),
		authorityEpoch: sequence(value.authorityEpoch),
	};
}

/** Reconnection is observation of the same dispatch, not a recovery generation or retry. */
export function reduceReconnectEvent(
	context: WriterReduction,
	event: Reconnected,
	commands: Set<string>,
	dispatch?: Extract<RunEvent, { kind: "dispatch" }>,
): void {
	const { state, contract } = context;
	const { command } = event;
	if (
		contract.profile !== "linux-command-v1" ||
		command.runId !== state.runId ||
		command.contractDigest !== digestObject(contract) ||
		command.expectedRevision !== state.revision ||
		command.expectedGeneration !== state.generation ||
		commands.has(command.commandId) ||
		dispatch?.executionId !== command.executionId ||
		(dispatch.role === "verifier"
			? !state.candidateDigest || !dispatch.timeoutMs
			: state.activeExecutionIds.length !== 1 || state.candidateDigest !== null) ||
		state.activeExecutionIds.some((id) => id !== command.executionId) ||
		!state.processes.some((p) => p.executionId === command.executionId) ||
		!state.budget ||
		state.writerOpen ||
		state.failure ||
		state.execution !== "running" ||
		event.observedMs < (state.lastClockMs ?? state.budget.startedMs)
	)
		throw new VerifiedRunError("integrity");
	commands.add(command.commandId);
	context.state = { ...state, lastClockMs: event.observedMs };
}
