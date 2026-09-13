import type { RunEvent, WriterReduction } from "./run-types.ts";
import { VerifiedRunError } from "./storage.ts";

/** Associate a process with exactly one current attempt, including old serial journals without taskId. */
export function bindTaskExecution(context: WriterReduction, event: Extract<RunEvent, { kind: "dispatch" }>): void {
	const { contract, state } = context;
	if (contract.profile !== "linux-command-dag-v1") throw new VerifiedRunError("integrity");
	const running = state.tasks.filter((task) => task.status === "running");
	if (event.taskId === undefined && ((contract.writer.maxConcurrentTasks ?? 1) !== 1 || running.length !== 1))
		throw new VerifiedRunError("task_not_ready");
	const task = event.taskId === undefined ? running[0] : running.find((task) => task.taskId === event.taskId);
	if (!task || task.status !== "running" || task.generation !== state.generation || task.execution.kind !== "ready")
		throw new VerifiedRunError("task_not_ready");
	const next = { ...task, execution: Object.freeze({ kind: "running" as const, executionId: event.executionId }) };
	context.state = { ...state, tasks: state.tasks.map((item) => (item.taskId === next.taskId ? next : item)) };
}

export function endTaskExecution(context: WriterReduction, event: Extract<RunEvent, { kind: "exited" }>): void {
	const state = context.state;
	const task = state.tasks.find(
		(task) =>
			task.status === "running" &&
			task.execution.kind === "running" &&
			task.execution.executionId === event.executionId,
	);
	if (!task || task.status !== "running") throw new VerifiedRunError("integrity");
	const next = {
		...task,
		execution: Object.freeze({ kind: "exited" as const, executionId: event.executionId, failure: event.failure }),
	};
	context.state = { ...state, tasks: state.tasks.map((item) => (item.taskId === next.taskId ? next : item)) };
}
