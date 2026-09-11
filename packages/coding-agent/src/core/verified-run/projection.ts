import { MAX_VERIFIED_RUN_GENERATIONS } from "omk-protocol";
import type { RunEvent, RunProjection, WriterReduction } from "./run-types.ts";
import { digestObject, VerifiedRunError } from "./storage.ts";
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
		requests: new Set(),
		state: {
			runId: first.contract.runId,
			revision: 1,
			generation: 1,
			execution: "ready",
			settlement: "open",
			verification: "not_requested",
			application: "not_requested",
			candidateDigest: null,
			receiptDigest: null,
			failure: null,
			activeExecutionIds: [],
			writerOpen: false,
			modelRequests: 0,
			budget: null,
			environmentDigest: null,
			verificationDeadlineMs: null,
			lastClockMs: null,
			processes: [],
		},
	};
	const dispatched = new Set<string>();
	const checked = new Set<string>();
	const commands = new Set([first.command.commandId]);
	let activeRole: "writer" | "verifier" = "writer";
	const scripted = first.contract.profile === "linux-scripted-agent-v1" ? first.contract.writer : undefined;
	for (const event of events.slice(1)) {
		const state = context.state;
		if (state.execution === "failed" || state.receiptDigest) throw new VerifiedRunError("integrity");
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
			case "writer_opened":
			case "model_request":
			case "writer_closed":
				reduceWriterEvent(context, event);
				break;
			case "dispatch": {
				if (state.failure || state.activeExecutionIds.length || dispatched.has(event.executionId))
					throw new VerifiedRunError("integrity");
				if (event.role === "writer") {
					if (
						event.claimId !== null ||
						state.candidateDigest ||
						(scripted
							? !state.writerOpen ||
								context.writerCommands >= scripted.steps.length ||
								state.modelRequests <= context.writerCommands
							: context.writerStarted)
					)
						throw new VerifiedRunError("integrity");
					context.writerStarted = true;
					context.writerCommands += 1;
				} else {
					if (
						!context.writerFinished ||
						state.writerOpen ||
						!state.candidateDigest ||
						event.claimId === null ||
						!first.contract.checks.some((check) => check.claimId === event.claimId) ||
						checked.has(event.claimId)
					)
						throw new VerifiedRunError("integrity");
					checked.add(event.claimId);
				}
				dispatched.add(event.executionId);
				activeRole = event.role;
				context.state = {
					...state,
					execution: "running",
					settlement: "draining",
					activeExecutionIds: [event.executionId],
				};
				break;
			}
			case "process_ready":
				if (
					!state.budget ||
					state.activeExecutionIds[0] !== event.executionId ||
					event.identity.bootId !== state.budget.bootId ||
					state.processes.some((item) => item.executionId === event.executionId)
				)
					throw new VerifiedRunError("integrity");
				context.state = {
					...state,
					processes: [...state.processes, { executionId: event.executionId, identity: event.identity }],
				};
				break;
			case "exited":
				if (
					state.activeExecutionIds[0] !== event.executionId ||
					(state.budget &&
						event.failure === null &&
						!state.processes.some((item) => item.executionId === event.executionId))
				)
					throw new VerifiedRunError("integrity");
				if (activeRole === "writer") context.writerFinished = event.failure === null;
				context.state = {
					...state,
					settlement: state.writerOpen ? "open" : "settled",
					activeExecutionIds: [],
					failure: event.failure,
				};
				break;
			case "candidate": {
				if (
					!context.writerFinished ||
					state.writerOpen ||
					state.failure ||
					state.activeExecutionIds.length ||
					state.candidateDigest
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
			case "resumed": {
				const command = event.command;
				if (!state.budget || !state.candidateDigest || state.writerOpen || state.verificationDeadlineMs === null)
					throw new VerifiedRunError("resume_unavailable");
				if (state.generation >= MAX_VERIFIED_RUN_GENERATIONS) throw new VerifiedRunError("recovery_limit");
				if (command.expectedRevision !== state.revision || command.expectedGeneration !== state.generation)
					throw new VerifiedRunError("stale_revision");
				if (
					command.runId !== state.runId ||
					command.contractDigest !== digestObject(first.contract) ||
					command.candidateDigest !== state.candidateDigest ||
					commands.has(command.commandId)
				)
					throw new VerifiedRunError("command_conflict");
				if (
					event.observedMs < (state.lastClockMs ?? state.budget.startedMs) ||
					event.observedMs >= state.verificationDeadlineMs
				)
					throw new VerifiedRunError("deadline");
				if (
					event.reconciledExecutionIds.length !== state.activeExecutionIds.length ||
					event.reconciledExecutionIds.some((id, index) => id !== state.activeExecutionIds[index]) ||
					(state.activeExecutionIds.length && activeRole !== "verifier")
				)
					throw new VerifiedRunError("integrity");
				commands.add(command.commandId);
				checked.clear();
				context.state = {
					...state,
					generation: state.generation + 1,
					execution: "running",
					settlement: "settled",
					verification: "not_requested",
					activeExecutionIds: [],
					processes: [],
					failure: null,
					lastClockMs: event.observedMs,
				};
				break;
			}
			case "evaluated":
				if (
					!state.candidateDigest ||
					state.writerOpen ||
					state.activeExecutionIds.length ||
					checked.size !== first.contract.checks.length ||
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
			default: {
				const exhaustive: never = event;
				throw new VerifiedRunError(String(exhaustive));
			}
		}
		context.state = { ...context.state, revision: state.revision + 1 };
	}
	return Object.freeze({
		...context.state,
		activeExecutionIds: Object.freeze([...context.state.activeExecutionIds]),
		processes: Object.freeze(context.state.processes.map((item) => Object.freeze(item))),
	});
}
