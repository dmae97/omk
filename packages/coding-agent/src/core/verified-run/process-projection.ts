import type { RunEvent, RunProjection, WriterReduction } from "./run-types.ts";
import { VerifiedRunError } from "./storage.ts";
import { endTaskExecution } from "./task-execution.ts";
import { acceptWriterDispatch } from "./writer-projection.ts";

/** Replay-only mutable bookkeeping; active processes always share one role/phase. */
export interface ProcessReduction {
	readonly dispatched: Set<string>;
	readonly checked: Set<string>;
	activeRole: "writer" | "verifier";
}
type ProcessEvent = Extract<RunEvent, { kind: "dispatch" | "process_ready" | "exited" }>;

export function reduceProcessEvent(context: WriterReduction, event: ProcessEvent, progress: ProcessReduction): void {
	const { contract, state } = context;
	switch (event.kind) {
		case "dispatch": {
			const limit =
				event.role === "writer" && contract.profile === "linux-command-dag-v1"
					? (contract.writer.maxConcurrentTasks ?? 1)
					: 1;
			if (
				state.failure ||
				state.execution === "paused" ||
				state.activeExecutionIds.length >= limit ||
				progress.dispatched.has(event.executionId)
			)
				throw new VerifiedRunError("integrity");
			if (event.role === "writer") {
				acceptWriterDispatch(context, event);
			} else {
				if (
					event.taskId !== undefined ||
					!context.writerFinished ||
					state.writerOpen ||
					!state.candidateDigest ||
					event.claimId === null ||
					!contract.checks.some((check) => check.claimId === event.claimId) ||
					progress.checked.has(event.claimId)
				)
					throw new VerifiedRunError("integrity");
				progress.checked.add(event.claimId);
			}
			progress.dispatched.add(event.executionId);
			progress.activeRole = event.role;
			context.state = {
				...context.state,
				execution: "running",
				settlement: "draining",
				activeExecutionIds: [...state.activeExecutionIds, event.executionId],
			};
			return;
		}
		case "process_ready":
			if (
				!state.budget ||
				!state.activeExecutionIds.includes(event.executionId) ||
				event.identity.bootId !== state.budget.bootId ||
				state.processes.some((item) => item.executionId === event.executionId)
			)
				throw new VerifiedRunError("integrity");
			context.state = {
				...state,
				processes: [...state.processes, { executionId: event.executionId, identity: event.identity }],
			};
			return;
		case "exited": {
			if (
				!state.activeExecutionIds.includes(event.executionId) ||
				(state.budget &&
					event.failure === null &&
					!state.processes.some((item) => item.executionId === event.executionId))
			)
				throw new VerifiedRunError("integrity");
			const taskWriter = progress.activeRole === "writer" && contract.profile === "linux-command-dag-v1";
			if (taskWriter) endTaskExecution(context, event);
			else if (progress.activeRole === "writer") context.writerFinished = event.failure === null;
			const activeExecutionIds = state.activeExecutionIds.filter((id) => id !== event.executionId);
			let settlement: RunProjection["settlement"] = "settled";
			if (context.state.writerOpen || context.state.tasks.some((task) => task.status === "running"))
				settlement = "open";
			if (activeExecutionIds.length) settlement = "draining";
			context.state = {
				...context.state,
				activeExecutionIds,
				settlement,
				failure: taskWriter ? state.failure : event.failure,
			};
			return;
		}
		default: {
			const exhaustive: never = event;
			throw new VerifiedRunError(String(exhaustive));
		}
	}
}
