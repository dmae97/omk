import { describe, expect, it, vi } from "vitest";
import { createSubagentLaneAuthority } from "../src/core/subagent-lane-authority.ts";
import { WorkloadPermitPool } from "../src/core/workload-permit-pool.ts";

const lanes = ["a", "b"].map((id) => ({ id, role: "executor" as const, task: id, agentName: "test-agent" }));

function authority(signal?: AbortSignal) {
	return createSubagentLaneAuthority({
		runId: "r04",
		decision: null,
		permitPool: new WorkloadPermitPool({ capacity: 2 }),
		inventory: { tools: [], skills: [], mcp: [], hooks: [] },
		signal,
		noteDetachedChild: () => vi.fn(),
	});
}

describe("R04 parent cancellation composition", () => {
	it("does not let a fresh caller signal replace an already aborted parent", async () => {
		const parent = new AbortController();
		parent.abort("parent stopped");
		const launchLane = vi.fn(async () => {});
		const result = await authority(parent.signal).dispatchLanes({
			lanes,
			signal: new AbortController().signal,
			configuredMaxParallelLanes: 1,
			launchLane,
		});
		expect(result.blockers).toEqual([]);
		expect(launchLane).not.toHaveBeenCalled();
		expect(result.outcomes.map(({ status }) => status)).toEqual(["skipped-abort", "skipped-abort"]);
	});

	it.each(["parent", "caller"] as const)("propagates %s abort and prevents the next lane", async (source) => {
		const parent = new AbortController();
		const caller = new AbortController();
		const reason = new Error(`${source} stopped`);
		const seen: AbortSignal[] = [];
		const result = await authority(parent.signal).dispatchLanes({
			lanes,
			signal: caller.signal,
			configuredMaxParallelLanes: 1,
			launchLane: async ({ signal }) => {
				expect(signal).toBeDefined();
				if (signal) seen.push(signal);
				(source === "parent" ? parent : caller).abort(reason);
			},
		});
		expect(result.blockers).toEqual([]);
		expect(seen).toHaveLength(1);
		expect(seen[0].aborted).toBe(true);
		expect(seen[0].reason).toBe(reason);
		expect(result.outcomes.map(({ status }) => status)).toEqual(["cancelled", "skipped-abort"]);
		expect((source === "parent" ? caller : parent).signal.aborted).toBe(false);
	});

	it("preserves a caller signal when there is no parent signal", async () => {
		const caller = new AbortController();
		let seen: AbortSignal | undefined;
		await authority().dispatchLanes({
			lanes: lanes.slice(0, 1),
			signal: caller.signal,
			launchLane: async ({ signal }) => {
				seen = signal;
			},
		});
		expect(seen).toBe(caller.signal);
	});
});
