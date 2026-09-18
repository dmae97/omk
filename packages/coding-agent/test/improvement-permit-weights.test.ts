import { describe, expect, it } from "vitest";
import { WorkloadPermitPool, type WorkloadPermitRequest } from "../src/core/workload-permit-pool.ts";

function request(requestId: string, weight: unknown): WorkloadPermitRequest {
	return { requestId, promptRunId: "r07", workloadClass: "heavy", weight } as WorkloadPermitRequest;
}

describe("R07 runtime permit weights", () => {
	it.each([-1, 0, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 3, "1", undefined, null])(
		"rejects weight %s before changing an idle pool",
		async (weight) => {
			const pool = new WorkloadPermitPool({ capacity: 4 });
			const before = pool.snapshot();
			const result = pool.acquire(request("invalid", weight));
			expect(pool.snapshot()).toEqual(before);
			await expect(result).rejects.toMatchObject({ code: "invalid_weight", requestId: "invalid" });
		},
	);

	it("rejects invalid weights without entering the queue or letting valid weight 1 overtake weight 2", async () => {
		const pool = new WorkloadPermitPool({ capacity: 2 });
		const held = await pool.acquire(request("held", 1));
		const order: string[] = [];
		const head = pool.acquire(request("head", 2)).then((permit) => {
			order.push("head");
			return permit;
		});
		const before = pool.snapshot();
		const invalid = pool.acquire(request("invalid", 0));
		expect(pool.snapshot()).toEqual(before);
		await expect(invalid).rejects.toMatchObject({ code: "invalid_weight" });
		const tail = pool.acquire(request("tail", 1)).then((permit) => {
			order.push("tail");
			return permit;
		});
		expect(order).toEqual([]);
		held.release();
		const first = await head;
		expect(order).toEqual(["head"]);
		first.release();
		(await tail).release();
		expect(order).toEqual(["head", "tail"]);
		expect(pool.snapshot()).toEqual({ capacity: 2, activeWeight: 0, queuedCount: 0 });
	});
});
