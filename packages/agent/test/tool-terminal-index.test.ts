import { describe, expect, it } from "vitest";
import type { FinalizedToolCallOutcome } from "../src/tool-execution-boundary.ts";
import { indexFinalizedToolCalls } from "../src/tool-terminal-index.ts";

function finalized(id: string, committed: string[]): FinalizedToolCallOutcome {
	return {
		toolCall: { id, name: "fixture", arguments: {} },
		commitTerminal: () => committed.push(id),
	} as unknown as FinalizedToolCallOutcome;
}

describe("finalized tool-call terminal index", () => {
	it("indexes identity once and commits source-ordered messages exactly once", () => {
		const committed: string[] = [];
		const calls = Array.from({ length: 256 }, (_, index) => finalized(`call-${index}`, committed));
		const index = indexFinalizedToolCalls(calls);
		expect(index.size).toBe(calls.length);
		for (const call of calls) index.get(call.toolCall.id)?.commitTerminal?.();
		expect(committed).toEqual(calls.map((call) => call.toolCall.id));
	});

	it("fails closed if duplicate tool-call identity reaches the index", () => {
		const calls = [finalized("duplicate", []), finalized("duplicate", [])];
		expect(() => indexFinalizedToolCalls(calls)).toThrow(/duplicate finalized tool call/u);
	});
});
