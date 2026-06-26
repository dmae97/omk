import { describe, expect, it } from "vitest";
import { HeadroomManager, HeadroomMonitor } from "../src/core/headroom.ts";

describe("headroom manager", () => {
	it("predicts increasing token pressure with trend-aware projection", () => {
		const manager = new HeadroomManager(10_000);

		manager.check(1_000);
		manager.check(1_800);
		manager.check(2_600);
		manager.check(3_400);

		const prediction = manager.predict();
		expect(prediction.trend).toBe("increasing");
		expect(prediction.predictedTokens).toBeGreaterThan(3_400);
		expect(prediction.recommendedAction).toBe("compress context");
		expect(prediction.confidence).toBeGreaterThan(0);
	});

	it("keeps zero-token prediction confidence numeric", () => {
		const manager = new HeadroomManager(10_000);

		manager.check(0);
		manager.check(0);
		manager.check(0);

		const prediction = manager.predict();
		expect(prediction.predictedTokens).toBe(0);
		expect(Number.isNaN(prediction.confidence)).toBe(false);
		expect(prediction.trend).toBe("stable");
	});

	it("keeps malformed maxTokens and input tokens finite on the check path", () => {
		const manager = new HeadroomManager(Number.NaN);
		const snapshot = manager.check(Number.POSITIVE_INFINITY, Number.NaN, -5);
		const allocation = manager.getAllocation(Number.POSITIVE_INFINITY);

		for (const value of [
			snapshot.promptTokens,
			snapshot.toolOutputTokens,
			snapshot.responseTokens,
			snapshot.totalTokens,
			snapshot.headroomRemaining,
			allocation.maxTokens,
		]) {
			expect(Number.isFinite(value)).toBe(true);
		}
		expect(snapshot).toEqual(expect.objectContaining({ totalTokens: 0, headroomRemaining: 0, status: "idle" }));
		expect(allocation).toEqual({ maxTokens: 0, canAddAgents: false });
	});

	it("returns deterministic repeated predictions for unchanged history", () => {
		const manager = new HeadroomManager(10_000);

		manager.check(1_000);
		manager.check(1_500);
		manager.check(2_000);
		manager.check(2_500);

		expect(manager.predict()).toEqual(manager.predict());
	});

	it("uses hysteresis to avoid oscillating down immediately after critical pressure", () => {
		const monitor = new HeadroomMonitor();

		const critical = monitor.getStatus(8_500, 10_000);
		monitor.record({
			timestamp: 1,
			promptTokens: 8_500,
			toolOutputTokens: 0,
			responseTokens: 0,
			totalTokens: 8_500,
			headroomRemaining: 1_500,
			status: critical,
		});

		expect(critical).toBe("critical");
		expect(monitor.getStatus(7_600, 10_000)).toBe("critical");
		expect(monitor.getStatus(7_000, 10_000)).toBe("stressed");
		expect(monitor.getStatus(6_300, 10_000)).toBe("active");
	});
});
