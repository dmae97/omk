import type { AgentMessage } from "omk-agent-core";
import type { TokenCounterAdapter } from "./context-budget-token-counter.ts";
import { legacyMemoryContextPair } from "./verified-memory-context-legacy.ts";
import type { VerifiedMemoryRecord } from "./verified-memory-record.ts";
import { selectMemoryContext } from "./verified-memory-selection.ts";

export interface MemorySelectionOptions {
	readonly mode?: "legacy" | "v2";
	readonly fits?: (messages: AgentMessage[]) => boolean;
}
export function memoryContextPair(
	records: readonly VerifiedMemoryRecord[],
	budget: number,
	query: string,
	counter: TokenCounterAdapter,
	modelId: string,
	options: MemorySelectionOptions = {},
): { messages: AgentMessage[]; selected: number } {
	if (options.mode !== undefined && options.mode !== "legacy" && options.mode !== "v2")
		throw new RangeError("memory.invalid_selection_mode");
	return options.mode === "v2"
		? selectMemoryContext(records, budget, query, counter, modelId, options.fits)
		: legacyMemoryContextPair(records, budget, query, counter, modelId);
}
