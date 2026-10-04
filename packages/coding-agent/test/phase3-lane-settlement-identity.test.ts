import { describe, expect, it, vi } from "vitest";
import { createSubagentLaneAuthority } from "../src/core/subagent-lane-authority.ts";
import { WorkloadPermitPool } from "../src/core/workload-permit-pool.ts";
import { phase3Gate } from "./fixtures/phase3-gate.ts";

function fixture() {
	const pool = new WorkloadPermitPool({ capacity: 1 });
	const release = vi.fn();
	const binding = {
		runId: "settlement",
		decision: null,
		permitPool: pool,
		inventory: { tools: [], skills: [], mcp: [], hooks: [] },
		noteDetachedChild: () => release,
	};
	const authority = () => createSubagentLaneAuthority(binding);
	const lanes = [{ id: "a", role: "security" as const, task: "inspect local fixture" }];
	return { pool, release, authority, lanes };
}

describe("lane settlement identity", () => {
	it("releases the originally observed settlement even if the returned object changes", async () => {
		const { pool, release, authority, lanes } = fixture();
		const original = phase3Gate<void>();
		const replacement = phase3Gate<void>();
		const result = { status: "unsettled" as const, settlement: original.promise };
		const first = await authority().dispatchLanes({
			lanes,
			heavyLaneIds: new Set(["a"]),
			launchLane: async () => result,
		});
		expect(first.outcomes).toEqual([{ laneId: "a", status: "unsettled" }]);
		expect(pool.snapshot().activeWeight).toBe(1);
		result.settlement = replacement.promise;
		try {
			original.resolve();
			await original.promise;
			expect(release).toHaveBeenCalledTimes(1);
			expect(pool.snapshot().activeWeight).toBe(0);
			const launchLane = vi.fn(async () => {});
			const second = await authority().dispatchLanes({ lanes, heavyLaneIds: new Set(), launchLane });
			expect(second.blockers).toEqual([]);
			expect(launchLane).toHaveBeenCalledTimes(1);
		} finally {
			replacement.resolve();
		}
	});

	it("reads settlement once and shares that observation with the permit owner", async () => {
		const { pool, release, authority, lanes } = fixture();
		const original = phase3Gate<void>();
		let reads = 0;
		const result = {
			status: "unsettled" as const,
			get settlement() {
				reads++;
				return reads === 1 ? original.promise : Promise.resolve();
			},
		};
		try {
			await authority().dispatchLanes({ lanes, heavyLaneIds: new Set(["a"]), launchLane: async () => result });
			expect(reads).toBe(1);
			expect(pool.snapshot().activeWeight).toBe(1);
			expect(release).not.toHaveBeenCalled();
		} finally {
			original.resolve();
			await original.promise;
		}
		expect(pool.snapshot().activeWeight).toBe(0);
		expect(release).toHaveBeenCalledTimes(1);
	});

	it("does not use a substituted fulfilled promise as proof while the original is pending", async () => {
		const { pool, release, authority, lanes } = fixture();
		const original = phase3Gate<void>();
		const result = { status: "unsettled" as const, settlement: original.promise };
		await authority().dispatchLanes({ lanes, heavyLaneIds: new Set(["a"]), launchLane: async () => result });
		result.settlement = Promise.resolve();
		try {
			await result.settlement;
			const launchLane = vi.fn(async () => {});
			const retry = await authority().dispatchLanes({ lanes, launchLane });
			expect(retry.blockers).toEqual(["ownership.unsettled"]);
			expect(launchLane).not.toHaveBeenCalled();
			expect(pool.snapshot().activeWeight).toBe(1);
			expect(release).not.toHaveBeenCalled();
		} finally {
			original.resolve();
			await original.promise;
		}
	});

	it("retains ownership after a rejected original settlement despite a fulfilled replacement", async () => {
		const { pool, release, authority, lanes } = fixture();
		const original = phase3Gate<void>();
		const result = { status: "unsettled" as const, settlement: original.promise };
		await authority().dispatchLanes({ lanes, heavyLaneIds: new Set(["a"]), launchLane: async () => result });
		result.settlement = Promise.resolve();
		original.reject(new Error("termination is unknown"));
		await expect(original.promise).rejects.toThrow("termination is unknown");
		const launchLane = vi.fn(async () => {});
		const retry = await authority().dispatchLanes({ lanes, launchLane });
		expect(retry.blockers).toEqual(["ownership.unsettled"]);
		expect(launchLane).not.toHaveBeenCalled();
		expect(pool.snapshot().activeWeight).toBe(1);
		expect(release).not.toHaveBeenCalled();
	});
});
