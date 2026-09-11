import type { RunDagTask, RunDagWriter } from "omk-protocol";
import type { DagEvent, RunTaskProjection } from "./dag-types.ts";
import type { RunProjection, WriterReduction } from "./run-types.ts";
import { VerifiedRunError } from "./storage.ts";

export function readyDagTasks(writer: RunDagWriter, state: RunProjection): readonly RunDagTask[] {
	const states = new Map(state.tasks.map((task) => [task.taskId, task]));
	return writer.tasks.filter(
		(task) =>
			states.get(task.id)?.status === "pending" &&
			task.dependsOn.every((id) => {
				const dependency = states.get(id);
				return dependency?.status === "succeeded" && dependency.generation === state.generation;
			}),
	);
}

/** Task outputs are execution checkpoints, never verifier receipts or completion authority. */
export function reduceDagEvent(context: WriterReduction, event: DagEvent): void {
	const { state, contract } = context;
	if (
		contract.profile !== "linux-command-dag-v1" ||
		!state.inputDigest ||
		!state.budget ||
		state.candidateDigest ||
		state.writerOpen ||
		state.activeExecutionIds.length ||
		state.execution === "paused"
	)
		throw new VerifiedRunError("integrity");
	if (event.kind === "tasks_paused") {
		if (
			state.tasks.some((task) => task.status === "running") ||
			!state.tasks.some((task) => task.status === "failed") ||
			readyDagTasks(contract.writer, state).length
		)
			throw new VerifiedRunError("integrity");
		context.state = { ...state, execution: "paused", settlement: "settled" };
		return;
	}
	if (
		event.observedMs < (state.lastClockMs ?? state.budget.startedMs) ||
		event.observedMs >= state.budget.workDeadlineMs
	)
		throw new VerifiedRunError("deadline");
	const task = state.tasks.find((task) => task.taskId === event.taskId);
	const definition = contract.writer.tasks.find((task) => task.id === event.taskId);
	if (!task || !definition) throw new VerifiedRunError("integrity");
	let next: RunTaskProjection;
	switch (event.kind) {
		case "task_started":
			if (
				task.status !== "pending" ||
				state.tasks.some((task) => task.status === "running") ||
				event.attempt !== task.attempt + 1 ||
				event.attempt > definition.attempts.length ||
				!readyDagTasks(contract.writer, state).some((task) => task.id === event.taskId)
			)
				throw new VerifiedRunError("task_not_ready");
			next = {
				taskId: task.taskId,
				generation: state.generation,
				attempt: event.attempt,
				status: "running",
				inputDigest: event.inputDigest,
				outputDigest: null,
				failure: null,
			};
			context.writerStarted = false;
			context.writerFinished = false;
			break;
		case "task_finished":
			if (
				task.status !== "running" ||
				task.generation !== state.generation ||
				task.attempt !== event.attempt ||
				!context.writerStarted
			)
				throw new VerifiedRunError("integrity");
			if (event.outputDigest !== null) {
				if (event.failure !== null || state.failure || !context.writerFinished)
					throw new VerifiedRunError("integrity");
				next = { ...task, status: "succeeded", outputDigest: event.outputDigest };
			} else {
				if (!event.failure || (state.failure && event.failure !== state.failure))
					throw new VerifiedRunError("integrity");
				next = { ...task, status: "failed", failure: event.failure };
			}
			break;
		default: {
			const exhaustive: never = event;
			throw new VerifiedRunError(String(exhaustive));
		}
	}
	const tasks = state.tasks.map((task) => (task.taskId === next.taskId ? next : task));
	context.writerFinished = tasks.every((task) => task.status === "succeeded" && task.generation === state.generation);
	context.state = {
		...state,
		tasks,
		execution: "running",
		settlement: "settled",
		failure: null,
		lastClockMs: event.observedMs,
	};
}
