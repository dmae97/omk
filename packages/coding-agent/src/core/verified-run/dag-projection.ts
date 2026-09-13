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
		state.execution === "paused"
	)
		throw new VerifiedRunError("integrity");
	if (event.kind === "tasks_paused") {
		if (
			state.activeExecutionIds.length ||
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
				state.tasks.filter((task) => task.status === "running").length >=
					(contract.writer.maxConcurrentTasks ?? 1) ||
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
				execution: Object.freeze({ kind: "ready" }),
				inputDigest: event.inputDigest,
				outputDigest: null,
				failure: null,
			};
			break;
		case "task_finished": {
			if (
				task.status !== "running" ||
				task.generation !== state.generation ||
				task.attempt !== event.attempt ||
				task.execution.kind !== "exited"
			)
				throw new VerifiedRunError("integrity");
			// Keep checkpoint shape stable: process state belongs only to an in-flight task.
			const checkpoint = {
				taskId: task.taskId,
				generation: task.generation,
				attempt: task.attempt,
				inputDigest: task.inputDigest,
			};
			if (event.outputDigest !== null) {
				if (event.failure !== null || task.execution.failure) throw new VerifiedRunError("integrity");
				next = { ...checkpoint, status: "succeeded", outputDigest: event.outputDigest, failure: null };
			} else {
				if (!event.failure || (task.execution.failure && event.failure !== task.execution.failure))
					throw new VerifiedRunError("integrity");
				next = { ...checkpoint, status: "failed", outputDigest: null, failure: event.failure };
			}
			break;
		}
		default: {
			const exhaustive: never = event;
			throw new VerifiedRunError(String(exhaustive));
		}
	}
	const tasks = state.tasks.map((task) => (task.taskId === next.taskId ? next : task));
	context.writerFinished = tasks.every((task) => task.status === "succeeded" && task.generation === state.generation);
	let settlement: RunProjection["settlement"] = "settled";
	if (tasks.some((task) => task.status === "running")) settlement = "open";
	if (state.activeExecutionIds.length) settlement = "draining";
	context.state = {
		...state,
		tasks,
		execution: "running",
		settlement,
		failure: null,
		lastClockMs: event.observedMs,
	};
}
