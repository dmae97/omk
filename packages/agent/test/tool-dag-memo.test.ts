import { describe, expect, it } from "vitest";
import { scheduleDagLevelsMemo } from "../src/tool-dag-memo.ts";
import type { ClaimableToolCall } from "../src/tool-resource-claims.ts";

/**
 * T-DAG-M01 (audit §9): the DAG schedule memo must not replay a plan built
 * from claims a dynamic resourceClaims closure would answer differently on an
 * identical batch. Two identical batches whose stateful claims differ must
 * produce different plans — a cached plan would silently reuse the old ones.
 */

function writeCall(id: string): ClaimableToolCall {
	return { id, name: "write", arguments: { path: "input" } };
}

describe("scheduleDagLevelsMemo dynamic-claim bypass", () => {
	it("re-resolves claims when a registered resourceClaims closure is stateful", async () => {
		const calls = [writeCall("w1"), writeCall("w2")];
		const cache = new Map();

		// The closure reads a mutable version flag: w1 always claims write(y),
		// w2 claims write(y) at version 0 but write(z) at version 1. Identical
		// batch shape, different claim answers.
		let version = 0;
		const options = {
			cwd: "/tmp",
			registeredTools: [
				{
					name: "write",
					resourceClaims: async (_args: unknown, context: { toolCallId: string }) => [
						{
							kind: "path" as const,
							key: context.toolCallId === "w2" && version === 1 ? "z" : "y",
							access: "write" as const,
						},
					],
				},
			],
		};

		// Version 0: both calls claim write(y) → serialized into two levels.
		const first = await scheduleDagLevelsMemo(calls, options, undefined, cache);
		expect(first).not.toBeNull();
		expect(first!.levels).toEqual([[0], [1]]);

		// Version 1, identical batch: w2 now claims write(z), independent of
		// w1's y, so both belong to level 0. A memo keyed on call shape would
		// replay the y-plan; bypassing it must observe z.
		version = 1;
		const second = await scheduleDagLevelsMemo(calls, options, undefined, cache);
		expect(second).not.toBeNull();
		expect(second!.levels).toEqual([[0, 1]]);
	});

	it("does not let a returned nested claim corrupt the cached schedule", async () => {
		const cache = new Map();
		const calls = [{ name: "write", arguments: { path: "/audit/file", content: "x" } }];
		const options = { cwd: "/audit" };
		const first = await scheduleDagLevelsMemo(calls, options, undefined, cache);
		if (!first || first.entries[0].resolution.kind !== "claims") throw new Error("Expected path claims");
		const original = first.entries[0].resolution.claims[0].key;
		(first.entries[0].resolution.claims[0] as { key: string }).key = "/poisoned";
		const second = await scheduleDagLevelsMemo(calls, options, undefined, cache);
		if (!second || second.entries[0].resolution.kind !== "claims") throw new Error("Expected path claims");
		expect(second.entries[0].resolution.claims[0].key).toBe(original);
	});
});
