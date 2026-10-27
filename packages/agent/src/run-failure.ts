/**
 * How `Agent.runWithLifecycle` ends a run whose executor threw.
 *
 * A throw while building the run's context (for example a `prepareTools` hook
 * rejecting the turn with spec 104 RequiredCapabilityUnavailable) happens before
 * the agent loop emits `agent_start`. Such a throw is tagged by `prepareRun`, and
 * `endFailedRun` then opens the run (`agent_start`) before ending it, so lifecycle
 * observers (the session run journal) always see `agent_start` before `agent_end`,
 * and hands the real cause back for the caller to rethrow.
 */

import { planFailureTermination } from "./agent-loop.ts";
import type { MutableAgentState } from "./agent-state.ts";
import type { AgentEvent } from "./types.ts";

class RunPreparationFailure extends Error {
	constructor(cause: unknown) {
		super("run preparation failed", { cause });
		this.name = "RunPreparationFailure";
	}
}

/** Build a run's context; any throw is tagged as a preparation failure. */
export function prepareRun<T>(build: () => T): T {
	try {
		return build();
	} catch (error) {
		throw new RunPreparationFailure(error);
	}
}

/**
 * Emit the failure-termination events for a thrown run. Returns `{ cause }` when
 * the run failed during preparation, so the caller rethrows the original error.
 */
export async function endFailedRun(
	thrown: unknown,
	state: Pick<MutableAgentState, "messages" | "model">,
	aborted: boolean,
	emit: (event: AgentEvent) => Promise<void>,
): Promise<{ cause: unknown } | undefined> {
	const preparation = thrown instanceof RunPreparationFailure ? { cause: thrown.cause } : undefined;
	if (preparation) await emit({ type: "agent_start" });
	const cause = preparation ? preparation.cause : thrown;
	const error = cause instanceof Error ? cause : new Error(String(cause));
	// Apply the same failure-termination contract as the low-level loop so the
	// disposition of any unresolved tool calls matches transcript repair:
	// an unambiguous open turn is closed with exactly one synthetic result per
	// missing call before a single coherent failure assistant, and an ambiguous
	// transcript fails closed without fabricating a turn over corruption.
	const plan = planFailureTermination(state.messages, state.model, error, aborted);

	for (const result of plan.closureResults) {
		await emit({ type: "message_start", message: result });
		await emit({ type: "message_end", message: result });
	}

	if (plan.failureMessage) {
		await emit({ type: "message_start", message: plan.failureMessage });
		await emit({ type: "message_end", message: plan.failureMessage });
		await emit({ type: "turn_end", message: plan.failureMessage, toolResults: [] });
	}

	await emit({ type: "agent_end", messages: plan.messages });
	return preparation;
}
