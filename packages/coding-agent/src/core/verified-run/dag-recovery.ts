import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { type RunTaskRetryCommand, runDagAncestors } from "omk-protocol";
import { probeVerifiedSandbox } from "./broker.ts";
import { assertCandidateScope, loadCandidate } from "./candidate.ts";
import { preflightCheckReceipts } from "./check-receipt.ts";
import { composeDagCandidate } from "./dag-candidates.ts";
import { executeDag } from "./dag-phase.ts";
import { assertTaskSelection, taskCheckpoints } from "./dag-retry-projection.ts";
import type { JournalSnapshot } from "./journal.ts";
import { readRunClock, remainingRunTime } from "./recovery-clock.ts";
import { requireRunJournal, withRecoveryLease } from "./recovery-command.ts";
import type { RunProjection } from "./run-types.ts";
import { VerifiedRunError } from "./storage.ts";
import { verifyCandidate } from "./verification-phase.ts";
import { assertWorkRecoverable } from "./work-recovery.ts";
import { publishWriterCandidate } from "./writer-completion.ts";

export interface TaskRecoveryInspection {
	readonly state: RunProjection;
	readonly readiness: "ready" | "blocked";
	readonly reason: string | null;
	readonly retryableTaskIds: readonly string[];
	readonly remainingWorkMs: number | null;
	readonly ownership: "lease_required";
}

function assertDagRecoverable(runPath: string, snapshot: JournalSnapshot) {
	const recovery = assertWorkRecoverable(runPath, snapshot);
	const { contract } = recovery;
	if (contract.profile !== "linux-command-dag-v1") throw new VerifiedRunError("task_recovery_unavailable");
	for (const task of snapshot.state.tasks) {
		if (task.status === "pending") continue;
		const definition = contract.writer.tasks.find((item) => item.id === task.taskId);
		if (!definition) throw new VerifiedRunError("integrity");
		const expected = composeDagCandidate(
			{ runPath, contract, journal: snapshot },
			runDagAncestors(contract.writer.tasks, task.taskId),
		);
		const input = loadCandidate(runPath, task.inputDigest, contract.budget);
		if (input.digest !== expected.digest) throw new VerifiedRunError("task_checkpoint_mismatch");
		if (task.status === "succeeded")
			assertCandidateScope(
				input.manifest,
				loadCandidate(runPath, task.outputDigest, contract.budget).manifest,
				definition.writablePaths,
			);
	}
	return { contract, remainingMs: recovery.remainingMs };
}

export function inspectTaskRecovery(runPath: string): TaskRecoveryInspection {
	const snapshot = requireRunJournal(runPath);
	try {
		const { contract, remainingMs } = assertDagRecoverable(runPath, snapshot);
		const taskIds = snapshot.state.tasks
			.filter(
				(task) =>
					(task.status === "failed" || task.status === "running") &&
					task.attempt < (contract.writer.tasks.find((item) => item.id === task.taskId)?.attempts.length ?? 0),
			)
			.map((task) => task.taskId);
		assertTaskSelection(contract, snapshot.state, taskIds);
		return Object.freeze({
			state: snapshot.state,
			readiness: "ready",
			reason: null,
			retryableTaskIds: Object.freeze(taskIds),
			remainingWorkMs: remainingMs,
			ownership: "lease_required",
		});
	} catch (error) {
		if (!(error instanceof Error)) throw error;
		return Object.freeze({
			state: snapshot.state,
			readiness: "blocked",
			reason: error instanceof VerifiedRunError ? error.code : "integrity",
			retryableTaskIds: Object.freeze([]),
			remainingWorkMs: null,
			ownership: "lease_required",
		});
	}
}

export async function retryDagTasks(
	runPath: string,
	command: RunTaskRetryCommand,
	signal?: AbortSignal,
): Promise<RunProjection> {
	if (signal?.aborted) throw new VerifiedRunError("cancelled");
	return withRecoveryLease(runPath, command, async ({ snapshot, journal }) => {
		const { contract } = assertDagRecoverable(runPath, snapshot);
		assertTaskSelection(contract, snapshot.state, command.taskIds);
		preflightCheckReceipts(contract);
		probeVerifiedSandbox();
		assertDagRecoverable(runPath, snapshot);
		if (signal?.aborted) throw new VerifiedRunError("cancelled");
		journal.append({
			kind: "tasks_retried",
			command,
			observedMs: readRunClock().nowMs,
			reconciledExecutionIds: snapshot.state.activeExecutionIds,
			adopted: taskCheckpoints(snapshot.state),
		});
		const budget = journal.state.budget;
		if (!budget) throw new VerifiedRunError("integrity");
		const deadline = performance.now() + remainingRunTime(budget, budget.workDeadlineMs);
		const workspace = join(runPath, `writer-${journal.state.generation}`);
		const context = { runPath, contract, journal, ...(signal ? { signal } : {}) };
		await executeDag(context, { workspace, deadline });
		if (journal.state.execution === "paused") return journal.state;
		publishWriterCandidate(context, workspace, deadline);
		return verifyCandidate(context);
	});
}
