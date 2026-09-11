import type { RunEvent, WriterReduction } from "./run-types.ts";
import { VerifiedRunError } from "./storage.ts";

type WriterEvent = Extract<RunEvent, { kind: "writer_opened" | "model_request" | "writer_closed" }>;

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
						state.modelRequests < scripted.steps.length + 1))
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
