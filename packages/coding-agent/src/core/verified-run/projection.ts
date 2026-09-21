import { reduceDagEvent } from "./dag-projection.ts";
import type { RunTaskProjection } from "./dag-types.ts";
import { type ProcessReduction, reduceProcessEvent } from "./process-projection.ts";
import { reduceRecoveryEvent } from "./recovery-projection.ts";
import type { RunEvent, RunProjection, WriterReduction } from "./run-types.ts";
import { VerifiedRunError } from "./storage.ts";
import { reduceWriterEvent } from "./writer-projection.ts";

/** Deterministic replay only. Recovery observations are supplied by the trusted host adapter. */
export function projectRun(events: readonly RunEvent[]): RunProjection {
	const first = events[0];
	if (first?.kind !== "created" || first.contract.runId !== first.command.runId)
		throw new VerifiedRunError("integrity");
	const context: WriterReduction = {
		contract: first.contract,
		writerFinished: false,
		writerStarted: false,
		producerStarted: false,
		writerCommands: 0,
		requestBaseline: 0,
		requests: new Set(),
		state: {
			runId: first.contract.runId,
			revision: 1,
			generation: 1,
			execution: "ready",
			settlement: "open",
			verification: "not_requested",
			application: "not_requested",
			publication: "none",
			publicationCandidateOid: null,
			publicationRef: null,
			publicationCommandId: null,
			publicationFailure: null,
			candidateDigest: null,
			inputDigest: null,
			receiptDigest: null,
			failure: null,
			lastRecovery: null,
			activeExecutionIds: [],
			writerOpen: false,
			modelRequests: 0,
			tasks:
				first.contract.profile === "linux-command-dag-v1"
					? first.contract.writer.tasks.map(
							(task): RunTaskProjection => ({
								taskId: task.id,
								attempt: 0,
								generation: 1,
								status: "pending",
								inputDigest: null,
								outputDigest: null,
								failure: null,
							}),
						)
					: [],
			budget: null,
			environmentDigest: null,
			verificationDeadlineMs: null,
			lastClockMs: null,
			processes: [],
		},
	};
	const progress: ProcessReduction = { dispatched: new Set(), checked: new Set(), activeRole: "writer" };
	const commands = new Set([first.command.commandId]);
	for (const event of events.slice(1)) {
		const state = context.state;
		if (state.execution === "failed") throw new VerifiedRunError("integrity");
		if (
			state.receiptDigest &&
			event.kind !== "publish_intent" &&
			event.kind !== "published" &&
			event.kind !== "publish_failed"
		)
			throw new VerifiedRunError("integrity");
		switch (event.kind) {
			case "created":
				throw new VerifiedRunError("integrity");
			case "budget_anchored": {
				const budget = event.budget;
				const limits = first.contract.budget;
				if (
					state.revision !== 1 ||
					state.budget ||
					budget.workDeadlineMs - budget.startedMs !== limits.workMs ||
					budget.verifyCapMs - budget.workDeadlineMs !== limits.verifyMs ||
					budget.cleanupDeadlineMs - budget.verifyCapMs !== limits.cleanupMs
				)
					throw new VerifiedRunError("integrity");
				context.state = {
					...state,
					budget,
					environmentDigest: event.environmentDigest,
					lastClockMs: budget.startedMs,
				};
				break;
			}
			case "input_checkpoint":
				if (
					state.revision !== 2 ||
					!state.budget ||
					state.inputDigest ||
					event.digest !== first.contract.workspace.baseDigest
				)
					throw new VerifiedRunError("integrity");
				context.state = { ...state, inputDigest: event.digest };
				break;
			case "task_started":
			case "task_finished":
			case "tasks_paused":
				reduceDagEvent(context, event);
				break;
			case "writer_opened":
			case "model_request":
			case "writer_closed":
				reduceWriterEvent(context, event);
				break;
			case "dispatch":
			case "process_ready":
			case "exited":
				reduceProcessEvent(context, event, progress);
				break;
			case "candidate": {
				if (
					!context.writerFinished ||
					state.writerOpen ||
					state.failure ||
					state.activeExecutionIds.length ||
					state.candidateDigest ||
					state.tasks.some((task) => task.status !== "succeeded" || task.generation !== state.generation)
				)
					throw new VerifiedRunError("integrity");
				if (state.budget) {
					if (
						event.observedMs === undefined ||
						event.verificationDeadlineMs === undefined ||
						event.observedMs < state.budget.startedMs ||
						event.observedMs > state.budget.workDeadlineMs ||
						event.verificationDeadlineMs !==
							Math.min(event.observedMs + first.contract.budget.verifyMs, state.budget.verifyCapMs)
					)
						throw new VerifiedRunError("integrity");
				} else if (event.observedMs !== undefined || event.verificationDeadlineMs !== undefined)
					throw new VerifiedRunError("integrity");
				context.state = {
					...state,
					candidateDigest: event.digest,
					verificationDeadlineMs: event.verificationDeadlineMs ?? null,
					lastClockMs: event.observedMs ?? null,
				};
				break;
			}
			case "resumed":
			case "tasks_retried":
			case "writer_restarted":
				reduceRecoveryEvent(context, event, {
					commands,
					checked: progress.checked,
					activeRole: progress.activeRole,
				});
				break;
			case "evaluated":
				if (
					!state.candidateDigest ||
					state.writerOpen ||
					state.activeExecutionIds.length ||
					progress.checked.size !== first.contract.checks.length ||
					(event.verified && state.failure)
				)
					throw new VerifiedRunError("integrity");
				context.state = {
					...state,
					receiptDigest: event.receiptDigest,
					execution: "succeeded",
					verification: event.verified ? "verified" : "violated",
					application: event.verified ? "candidate_ready" : "not_requested",
				};
				break;
			case "failed":
				context.state = {
					...state,
					execution: "failed",
					failure: event.code,
					verification: "inconclusive",
					settlement: state.activeExecutionIds.length || state.writerOpen ? "quarantined" : "settled",
				};
				break;
			case "publish_intent":
				if (
					state.verification !== "verified" ||
					state.application !== "candidate_ready" ||
					state.settlement !== "settled" ||
					!state.receiptDigest ||
					state.receiptDigest !== event.receiptDigest ||
					state.candidateDigest !== event.candidateDigest ||
					state.generation !== event.generation ||
					event.targetRef !== "refs/omk/accepted" ||
					state.publication === "intent" ||
					state.publication === "accepted"
				)
					throw new VerifiedRunError("integrity");
				context.state = {
					...state,
					publication: "intent",
					publicationCandidateOid: event.candidateOid,
					publicationRef: event.targetRef,
					publicationCommandId: event.commandId,
					publicationFailure: null,
				};
				break;
			case "published":
				if (
					state.publication !== "intent" ||
					state.publicationCommandId !== event.commandId ||
					state.publicationCandidateOid !== event.candidateOid
				)
					throw new VerifiedRunError("integrity");
				context.state = { ...state, publication: "accepted", publicationCommandId: null };
				break;
			case "publish_failed":
				if (state.publication !== "intent" || state.publicationCommandId !== event.commandId)
					throw new VerifiedRunError("integrity");
				context.state = {
					...state,
					publication: event.code === "reconciliation-required" ? "reconciliation_required" : "failed",
					publicationCommandId: null,
					publicationFailure: event.code,
				};
				break;
			default: {
				const exhaustive: never = event;
				throw new VerifiedRunError(String(exhaustive));
			}
		}
		context.state = { ...context.state, revision: state.revision + 1 };
	}
	return Object.freeze({
		...context.state,
		lastRecovery: context.state.lastRecovery ? Object.freeze(context.state.lastRecovery) : null,
		activeExecutionIds: Object.freeze([...context.state.activeExecutionIds]),
		processes: Object.freeze(context.state.processes.map((item) => Object.freeze(item))),
		tasks: Object.freeze(context.state.tasks.map((task) => Object.freeze(task))),
	});
}
