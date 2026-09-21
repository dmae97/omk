import { MAX_VERIFIED_RUN_GENERATIONS } from "omk-protocol";
import { retryTaskProjection } from "./dag-retry-projection.ts";
import type { RunEvent, WriterReduction } from "./run-types.ts";
import { digestObject, VerifiedRunError } from "./storage.ts";

type RecoveryEvent = Extract<RunEvent, { kind: "resumed" | "writer_restarted" | "tasks_retried" }>;

/** Shared generation/command fence; only the writer variant resets attempt-local progress. */
export function reduceRecoveryEvent(
	context: WriterReduction,
	event: RecoveryEvent,
	progress: {
		readonly commands: Set<string>;
		readonly checked: Set<string>;
		readonly activeRole: "writer" | "verifier";
	},
): void {
	const state = context.state;
	const command = event.command;
	if (!state.budget) throw new VerifiedRunError("resume_unavailable");
	if (state.generation >= MAX_VERIFIED_RUN_GENERATIONS) throw new VerifiedRunError("recovery_limit");
	if (command.expectedRevision !== state.revision || command.expectedGeneration !== state.generation)
		throw new VerifiedRunError("stale_revision");
	if (
		command.runId !== state.runId ||
		command.contractDigest !== digestObject(context.contract) ||
		progress.commands.has(command.commandId)
	)
		throw new VerifiedRunError("command_conflict");
	if (
		event.reconciledExecutionIds.length !== state.activeExecutionIds.length ||
		event.reconciledExecutionIds.some((id, index) => id !== state.activeExecutionIds[index])
	)
		throw new VerifiedRunError("integrity");
	let deadline: number;
	let tasks = state.tasks;
	switch (event.kind) {
		case "resumed":
			if (
				!state.candidateDigest ||
				state.writerOpen ||
				state.verificationDeadlineMs === null ||
				event.command.candidateDigest !== state.candidateDigest
			)
				throw new VerifiedRunError("resume_unavailable");
			if (state.activeExecutionIds.length && progress.activeRole !== "verifier")
				throw new VerifiedRunError("integrity");
			deadline = state.verificationDeadlineMs;
			break;
		case "tasks_retried":
			if (state.activeExecutionIds.length && progress.activeRole !== "writer")
				throw new VerifiedRunError("integrity");
			tasks = retryTaskProjection(context, event);
			deadline = state.budget.workDeadlineMs;
			context.writerStarted = false;
			context.writerFinished = tasks.every((task) => task.status === "succeeded");
			context.producerStarted = false;
			context.writerCommands = 0;
			context.requestBaseline = state.modelRequests;
			break;
		case "writer_restarted":
			if (context.contract.profile === "linux-command-dag-v1") throw new VerifiedRunError("task_recovery_required");
			if (
				!state.inputDigest ||
				state.candidateDigest ||
				event.command.baseDigest !== state.inputDigest ||
				state.inputDigest !== context.contract.workspace.baseDigest
			)
				throw new VerifiedRunError("input_checkpoint_missing");
			if (state.activeExecutionIds.length && progress.activeRole !== "writer")
				throw new VerifiedRunError("integrity");
			if (
				context.contract.profile === "linux-scripted-agent-v1" &&
				context.contract.writer.maxRequests - state.modelRequests < context.contract.writer.steps.length + 1
			)
				throw new VerifiedRunError("model_request_limit");
			deadline = state.budget.workDeadlineMs;
			context.writerStarted = false;
			context.writerFinished = false;
			context.producerStarted = false;
			context.writerCommands = 0;
			context.requestBaseline = state.modelRequests;
			break;
		default: {
			const exhaustive: never = event;
			throw new VerifiedRunError(String(exhaustive));
		}
	}
	if (event.observedMs < (state.lastClockMs ?? state.budget.startedMs) || event.observedMs >= deadline)
		throw new VerifiedRunError("deadline");
	progress.commands.add(command.commandId);
	progress.checked.clear();
	context.state = {
		...state,
		generation: state.generation + 1,
		tasks,
		execution: "running",
		settlement: "settled",
		verification: "not_requested",
		writerOpen: false,
		activeExecutionIds: [],
		processes: [],
		failure: null,
		lastRecovery: {
			kind: event.kind,
			commandId: command.commandId,
			generation: state.generation + 1,
		},
		lastClockMs: event.observedMs,
	};
}
