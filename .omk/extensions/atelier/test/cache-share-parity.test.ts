import { cacheReadShare } from "omk-ai";
import { describe, expect, it } from "vitest";
import { aggregateMetrics } from "../vendor/src/metrics.ts";

const options = { subscription: false, autoCompact: null };
const usage = (input: number, cacheRead: number, cacheWrite: number) => ({
	usage: { input, output: 1, cacheRead, cacheWrite, cost: { total: 0 } },
});

describe("Atelier last-request cache hit matches the shared omk-ai helper", () => {
	it("shows exactly 80% for input 100, read 800, write 100", () => {
		expect(aggregateMetrics([usage(100, 800, 100)], options).cacheHitPercent).toBe(80);
	});

	it("agrees with cacheReadShare on the latest request", () => {
		for (const [input, read, write] of [
			[100, 800, 100],
			[11, 989, 0],
			[0, 0, 0],
			[5000, 0, 250],
		] as const) {
			const percent = aggregateMetrics([usage(1, 1, 1), usage(input, read, write)], options).cacheHitPercent;
			const share = cacheReadShare({ input, cacheRead: read, cacheWrite: write });
			if (share === undefined) expect(percent).toBeUndefined();
			else expect(percent).toBeCloseTo(share * 100, 10);
		}
	});
});
