import type { RunEvent, WriterReduction } from "./run-types.ts";
import { VerifiedRunError } from "./storage.ts";
import { bindTaskExecution } from "./task-execution.ts";

type WriterEvent = Extract<RunEvent, { kind: "writer_opened" | "model_request" | "writer_closed" }>;

export function acceptWriterDispatch(context: WriterReduction, event: Extract<RunEvent, { kind: "dispatch" }>): void {
	const { state, contract } = context;
	if (
		event.claimId !== null ||
		state.candidateDigest ||
		(event.taskId !== undefined && contract.profile !== "linux-command-dag-v1")
	)
		throw new VerifiedRunError("integrity");
	switch (contract.profile) {
		case "linux-command-v1":
			if (context.writerStarted) throw new VerifiedRunError("integrity");
			break;
		case "linux-scripted-agent-v1":
			if (
				!state.writerOpen ||
				context.writerCommands >= contract.writer.steps.length ||
				state.modelRequests - context.requestBaseline <= context.writerCommands
			)
				throw new VerifiedRunError("integrity");
			break;
		case "linux-command-dag-v1":
			bindTaskExecution(context, event);
			return;
		default: {
			const exhaustive: never = contract;
			throw new VerifiedRunError(String(exhaustive));
		}
	}
	context.writerStarted = true;
	context.writerCommands += 1;
}

/** Mutates only the private replay accumulator; no work, clocks, or caller data are consulted. */
export function reduceWriterEvent(context: WriterReduction, event: WriterEvent): void {
	const state = context.state;
	const scripted = context.contract.profile === "linux-scripted-agent-v1" ? context.contract.writer : undefined;
	switch (event.kind) {
		case "writer_opened":
			if (!scripted || context.producerStarted || context.writerStarted || state.candidateDigest)
				throw new VerifiedRunError("integrity");
			context.producerStarted = true;
			context.state = { ...state, writerOpen: true, execution: "running", settlement: "open" };
			return;
		case "model_request":
			if (
				!scripted ||
				!state.writerOpen ||
				context.requests.has(event.requestId) ||
				state.activeExecutionIds.length ||
				state.modelRequests >= scripted.maxRequests
			)
				throw new VerifiedRunError("model_request_limit");
			context.requests.add(event.requestId);
			context.state = { ...state, modelRequests: state.modelRequests + 1 };
			return;
		case "writer_closed":
			if (
				!scripted ||
				!state.writerOpen ||
				state.activeExecutionIds.length ||
				(event.completed &&
					(!context.writerFinished ||
						state.failure ||
						context.writerCommands !== scripted.steps.length ||
						state.modelRequests - context.requestBaseline < scripted.steps.length + 1))
			)
				throw new VerifiedRunError("integrity");
			context.writerFinished = event.completed;
			context.state = { ...state, writerOpen: false, settlement: "settled" };
			return;
		default: {
			const exhaustive: never = event;
			throw new VerifiedRunError(String(exhaustive));
		}
	}
}
