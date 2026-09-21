import { join } from "node:path";
import { orderRunDag, type RunDagTask, runDagAncestors } from "omk-protocol";
import { ensureDurableDirectorySync } from "../durable-file-io.ts";
import { assertCandidateScope, captureCandidate, materializeCandidate, storeCandidate } from "./candidate.ts";
import { composeDagCandidate } from "./dag-candidates.ts";
import { readyDagTasks } from "./dag-projection.ts";
import { executeRunCommand } from "./owned-execution.ts";
import type { RunPhaseContext } from "./phase-context.ts";
import { readRunClock, remainingRunTime } from "./recovery-clock.ts";
import { VerifiedRunError } from "./storage.ts";

function observeWork(context: RunPhaseContext): number {
	const budget = context.journal.state.budget;
	if (!budget) throw new VerifiedRunError("input_checkpoint_missing");
	const clock = readRunClock();
	if (remainingRunTime(budget, budget.workDeadlineMs, clock) <= 0) throw new VerifiedRunError("deadline");
	return clock.nowMs;
}

async function executeTask(context: RunPhaseContext, task: RunDagTask, deadline: number): Promise<void> {
	const { contract, journal, runPath } = context;
	if (contract.profile !== "linux-command-dag-v1") throw new VerifiedRunError("unsupported");
	if (context.signal?.aborted) throw new VerifiedRunError("cancelled");
	const previous = journal.state.tasks.find((item) => item.taskId === task.id);
	if (previous?.status !== "pending") throw new VerifiedRunError("task_not_ready");
	const attempt = previous.attempt + 1;
	const argv = task.attempts[previous.attempt];
	if (!argv) throw new VerifiedRunError("task_attempt_limit");
	const input = composeDagCandidate(context, runDagAncestors(contract.writer.tasks, task.id));
	storeCandidate(input, runPath);
	const workspace = join(runPath, "tasks", `${task.id}-${attempt}-g${journal.state.generation}`);
	materializeCandidate(input, workspace);
	journal.append({
		kind: "task_started",
		taskId: task.id,
		attempt,
		inputDigest: input.digest,
		observedMs: observeWork(context),
	});
	const { result } = await executeRunCommand(
		journal,
		{ role: "writer", argv, workspace, deadline, claimId: null, taskId: task.id },
		{ ...contract.budget, authority: context.authority, ...(context.signal ? { signal: context.signal } : {}) },
	);
	if (result.failure === "deadline" || result.failure === "cancelled") throw new VerifiedRunError(result.failure);
	let outputDigest: string | null = null;
	let failure = result.failure;
	if (!failure) {
		try {
			const output = captureCandidate(workspace, contract.budget);
			assertCandidateScope(input.manifest, output.manifest, task.writablePaths);
			storeCandidate(output, runPath);
			outputDigest = output.digest;
		} catch (error) {
			if (
				!(error instanceof VerifiedRunError) ||
				!["scope_changed", "file_type", "storage_limit"].includes(error.code)
			)
				throw error;
			failure = error.code;
		}
	}
	journal.append({
		kind: "task_finished",
		taskId: task.id,
		attempt,
		outputDigest,
		failure,
		observedMs: observeWork(context),
	});
}

type TaskCompletion =
	| { readonly kind: "done"; readonly taskId: string }
	| { readonly kind: "failed"; readonly taskId: string; readonly error: unknown };

/** Bounded ready frontier; every started task is drained before this phase returns or throws. */
export async function executeDag(
	context: RunPhaseContext,
	options: { readonly workspace: string; readonly deadline: number },
): Promise<void> {
	const { contract, journal, runPath } = context;
	if (contract.profile !== "linux-command-dag-v1") throw new VerifiedRunError("unsupported");
	ensureDurableDirectorySync(join(runPath, "tasks"));
	const order = orderRunDag(contract.writer.tasks);
	const limit = contract.writer.maxConcurrentTasks ?? 1;
	const stop = new AbortController();
	const signal = context.signal ? AbortSignal.any([context.signal, stop.signal]) : stop.signal;
	const work = { ...context, signal };
	const inFlight = new Map<string, Promise<TaskCompletion>>();
	let firstFailure: { readonly error: unknown } | undefined;
	try {
		for (;;) {
			if (firstFailure) throw firstFailure.error;
			if (signal.aborted) throw new VerifiedRunError("cancelled");
			const ready = new Set(readyDagTasks(contract.writer, journal.state).map((task) => task.id));
			for (const task of order) {
				if (inFlight.size >= limit) break;
				if (!ready.has(task.id) || inFlight.has(task.id)) continue;
				const completion = executeTask(work, task, options.deadline).then<TaskCompletion, TaskCompletion>(
					() => ({ kind: "done", taskId: task.id }),
					(error: unknown) => {
						firstFailure ??= { error };
						stop.abort();
						return { kind: "failed", taskId: task.id, error };
					},
				);
				inFlight.set(task.id, completion);
			}
			if (!inFlight.size) break;
			const completed = await Promise.race(inFlight.values());
			inFlight.delete(completed.taskId);
			switch (completed.kind) {
				case "failed":
					throw completed.error;
				case "done":
					break;
				default: {
					const exhaustive: never = completed;
					throw new VerifiedRunError(String(exhaustive));
				}
			}
		}
	} finally {
		stop.abort();
		await Promise.all(inFlight.values());
	}
	if (
		journal.state.tasks.some((task) => task.status !== "succeeded" || task.generation !== journal.state.generation)
	) {
		journal.append({ kind: "tasks_paused" });
		return;
	}
	observeWork(context);
	materializeCandidate(composeDagCandidate(context, order), options.workspace);
}
