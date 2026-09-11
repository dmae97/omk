import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkloadPermitPool, type WorkloadPermitRequest } from "../src/core/workload-permit-pool.ts";

function request(requestId: string, weight: 1 | 2 = 1): WorkloadPermitRequest {
	return { requestId, promptRunId: "run", workloadClass: "heavy", weight };
}

afterEach(() => vi.useRealTimers());

describe("workload admission ownership", () => {
	it("starts no work when capacity is explicitly zero", async () => {
		const pool = new WorkloadPermitPool({ capacity: 0 });
		await expect(pool.acquire(request("blocked"))).rejects.toMatchObject({ code: "over_capacity_weight" });
		expect(pool.snapshot()).toEqual({ capacity: 0, activeWeight: 0, queuedCount: 0 });
	});

	it("preserves active ownership when capacity drops to zero", async () => {
		const pool = new WorkloadPermitPool({ capacity: 1 });
		const held = await pool.acquire(request("held"));
		const waiting = pool.acquire(request("waiting"));
		pool.setCapacity(0);
		const paused = pool.snapshot();
		held.release();
		await expect(waiting).rejects.toMatchObject({ code: "over_capacity_weight" });
		expect(paused).toEqual({ capacity: 0, activeWeight: 1, queuedCount: 0 });
		pool.setCapacity(1);
		const resumed = await pool.acquire(request("resumed"));
		expect(pool.snapshot().activeWeight).toBe(1);
		resumed.release();
	});

	it("rejects waiting when the queue is explicitly disabled", async () => {
		const pool = new WorkloadPermitPool({ capacity: 1, maxQueue: 0 });
		const held = await pool.acquire(request("held"));
		const waiting = pool.acquire(request("waiting"));
		held.release();
		await expect(waiting).rejects.toMatchObject({ code: "queue_overflow" });
	});

	it.each(["abort", "timeout"] as const)("wakes a fitting follower when the FIFO head leaves by %s", async (cause) => {
		vi.useFakeTimers();
		const pool = new WorkloadPermitPool({ capacity: 2 });
		const held = await pool.acquire(request("held"));
		const controller = new AbortController();
		const head = pool.acquire({ ...request("wide", 2), signal: controller.signal, timeoutMs: 10 });
		const rejected = expect(head).rejects.toMatchObject({ code: cause === "abort" ? "aborted" : "timeout" });
		const follower = pool.acquire(request("follower"));

		if (cause === "abort") controller.abort();
		else await vi.advanceTimersByTimeAsync(10);
		await rejected;
		const snapshot = pool.snapshot();
		held.release();
		(await follower).release();
		expect(snapshot).toEqual({ capacity: 2, activeWeight: 2, queuedCount: 0 });
	});

	it("releases the weight it acquired, not a caller's mutated request", async () => {
		const pool = new WorkloadPermitPool({ capacity: 2 });
		const mutable = { ...request("mutable") };
		const first = await pool.acquire(mutable);
		const second = await pool.acquire(request("second"));
		mutable.weight = 2;
		first.release();
		expect(pool.snapshot().activeWeight).toBe(1);
		first.release();
		expect(pool.snapshot().activeWeight).toBe(1);
		expect(pool.doubleReleaseCount).toBe(1);
		second.release();
	});

	it("pins queued request identity and weight before returning control", async () => {
		const pool = new WorkloadPermitPool({ capacity: 2 });
		const held = await pool.acquire(request("held", 2));
		const mutable = { ...request("original") };
		const queued = pool.acquire(mutable);
		mutable.requestId = "changed";
		mutable.weight = 2;
		held.release();
		const permit = await queued;
		expect(permit.requestId).toBe("original");
		expect(pool.snapshot().activeWeight).toBe(1);
		permit.release();
	});
});
