import type { RunTaskProjection } from "./dag-types.ts";
import type { RunEvent, RunProjection, WriterReduction } from "./run-types.ts";
import { VerifiedRunError } from "./storage.ts";

/**
 * Operator cancellation of a live run pauses it instead of ending it. Every other stop code
 * stays terminal. The pause issues no verdict: recovery still requires each recorded namespace
 * to be proven gone, and the anchored budget keeps running.
 */
export function stopEvent(state: RunProjection, code: string): RunEvent {
	return code === "cancelled" && (state.execution === "ready" || state.execution === "running")
		? { kind: "interrupted", cause: "cancelled" }
		: { kind: "failed", code };
}

/**
 * A DAG attempt whose cancellation was witnessed (`exited` with `cancelled`) ran only in its own
 * discarded workspace, so it is released rather than spent: the same approved command can run
 * again after an explicit `retry-tasks`. An attempt without witnessed exit stays `running` and is
 * reconciled like a crash.
 */
function releaseCancelledAttempt(task: RunTaskProjection, generation: number): RunTaskProjection {
	if (
		task.status !== "running" ||
		task.generation !== generation ||
		task.execution.kind !== "exited" ||
		task.execution.failure !== "cancelled"
	)
		return task;
	return {
		taskId: task.taskId,
		generation: task.generation,
		attempt: task.attempt - 1,
		status: "failed",
		inputDigest: task.inputDigest,
		outputDigest: null,
		failure: "cancelled",
	};
}

export function reduceInterruptedEvent(context: WriterReduction): void {
	const state = context.state;
	if ((state.execution !== "ready" && state.execution !== "running") || state.receiptDigest)
		throw new VerifiedRunError("integrity");
	context.state = {
		...state,
		tasks: state.tasks.map((task) => releaseCancelledAttempt(task, state.generation)),
		execution: "paused",
		failure: "cancelled",
		settlement: state.activeExecutionIds.length || state.writerOpen ? "quarantined" : "settled",
	};
}
