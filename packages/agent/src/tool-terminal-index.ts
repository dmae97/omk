import type { FinalizedToolCallOutcome } from "./tool-execution-boundary.ts";

/** Bind terminal callbacks to the transcript gate's unique tool-call IDs. */
export function indexFinalizedToolCalls(
	calls: readonly FinalizedToolCallOutcome[],
): ReadonlyMap<string, FinalizedToolCallOutcome> {
	const index = new Map<string, FinalizedToolCallOutcome>();
	for (const call of calls) {
		const id = call.toolCall.id;
		if (index.has(id)) throw new Error(`duplicate finalized tool call id: ${id}`);
		index.set(id, call);
	}
	return index;
}
