import type { RunContract } from "omk-protocol";
import { readyDagTasks } from "./dag-projection.ts";
import type { RunTaskCheckpoint, RunTaskProjection } from "./dag-types.ts";
import type { RunEvent, RunProjection, WriterReduction } from "./run-types.ts";
import { digestObject, VerifiedRunError } from "./storage.ts";

export function taskCheckpoints(state: RunProjection): readonly RunTaskCheckpoint[] {
	return state.tasks.filter((task): task is RunTaskCheckpoint => task.status === "succeeded");
}

export function assertTaskSelection(contract: RunContract, state: RunProjection, taskIds: readonly string[]): void {
	if (contract.profile !== "linux-command-dag-v1" || !state.inputDigest || state.candidateDigest || state.writerOpen)
		throw new VerifiedRunError("task_recovery_unavailable");
	for (const id of taskIds) {
		const task = state.tasks.find((task) => task.taskId === id);
		const definition = contract.writer.tasks.find((task) => task.id === id);
		if (!task || !definition || (task.status !== "failed" && task.status !== "running"))
			throw new VerifiedRunError("task_not_retryable");
		if (task.attempt >= definition.attempts.length) throw new VerifiedRunError("task_attempt_limit");
	}
	if (
		state.tasks.some(
			(task) =>
				task.generation !== state.generation || (task.status === "running" && !taskIds.includes(task.taskId)),
		)
	)
		throw new VerifiedRunError("task_selection");
	if (
		!taskIds.length &&
		!readyDagTasks(contract.writer, state).length &&
		!state.tasks.every((task) => task.status === "succeeded")
	)
		throw new VerifiedRunError("task_selection");
}

export function retryTaskProjection(
	context: WriterReduction,
	event: Extract<RunEvent, { kind: "tasks_retried" }>,
): readonly RunTaskProjection[] {
	const { state, contract } = context;
	assertTaskSelection(contract, state, event.command.taskIds);
	if (
		event.command.baseDigest !== state.inputDigest ||
		state.inputDigest !== contract.workspace.baseDigest ||
		digestObject(event.adopted) !== digestObject(taskCheckpoints(state))
	)
		throw new VerifiedRunError("task_checkpoint_mismatch");
	return state.tasks.map(
		(task): RunTaskProjection =>
			event.command.taskIds.includes(task.taskId)
				? {
						taskId: task.taskId,
						attempt: task.attempt,
						generation: state.generation + 1,
						status: "pending",
						inputDigest: null,
						outputDigest: null,
						failure: null,
					}
				: { ...task, generation: state.generation + 1 },
	);
}
