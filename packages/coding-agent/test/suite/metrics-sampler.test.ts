import { cpus } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MetricsSampler } from "../../src/core/metrics-sampler.ts";

describe("MetricsSampler", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("returns null before the first sample", () => {
		const sampler = new MetricsSampler();
		sampler.start(1000);

		expect(sampler.getCpuPercent()).toBeNull();
		expect(sampler.getMemoryRssBytes()).toBeNull();
		expect(sampler.getCpuPeak()).toBeNull();
		expect(sampler.getCpuRollingAvg()).toBeNull();
		expect(sampler.getCpuSpikeCount()).toBe(0);

		sampler.stop();
	});

	it("computes CPU percent from cpuUsage deltas and memory from memoryUsage", () => {
		const sampler = new MetricsSampler();
		const cpuUsageSpy = vi
			.spyOn(process, "cpuUsage")
			.mockReturnValueOnce({ user: 0, system: 0 } as NodeJS.CpuUsage)
			.mockReturnValueOnce({ user: 100_000, system: 50_000 } as NodeJS.CpuUsage);

		const memoryUsageSpy = vi.spyOn(process, "memoryUsage").mockReturnValue({
			rss: 123_456_789,
		} as NodeJS.MemoryUsage);

		sampler.start(1000);
		vi.advanceTimersByTime(1000);

		const cpuCount = Math.max(1, cpus().length);
		const expectedPercent = (150_000 / (1000 * 1000) / cpuCount) * 100;
		// First sample seeds the EMA, so smoothed equals the raw value.
		expect(sampler.getCpuPercent()).toBeCloseTo(expectedPercent, 4);
		expect(sampler.getMemoryRssBytes()).toBe(123_456_789);
		expect(sampler.getCpuPeak()).toBeCloseTo(expectedPercent, 4);
		expect(sampler.getCpuRollingAvg(1)).toBeCloseTo(expectedPercent, 4);

		sampler.stop();
		cpuUsageSpy.mockRestore();
		memoryUsageSpy.mockRestore();
	});

	it("clamps CPU percent to the 0-100 range", () => {
		const sampler = new MetricsSampler();
		vi.spyOn(process, "cpuUsage")
			.mockReturnValueOnce({ user: 0, system: 0 } as NodeJS.CpuUsage)
			.mockReturnValueOnce({ user: Number.MAX_SAFE_INTEGER, system: 0 } as NodeJS.CpuUsage);
		vi.spyOn(process, "memoryUsage").mockReturnValue({ rss: 0 } as NodeJS.MemoryUsage);

		sampler.start(1000);
		vi.advanceTimersByTime(1000);

		expect(sampler.getCpuPercent()).toBe(100);
		expect(sampler.getCpuPeak()).toBe(100);

		sampler.stop();
	});

	it("does not report negative CPU percent", () => {
		const sampler = new MetricsSampler();
		vi.spyOn(process, "cpuUsage")
			.mockReturnValueOnce({ user: 1_000_000, system: 0 } as NodeJS.CpuUsage)
			.mockReturnValueOnce({ user: 0, system: 0 } as NodeJS.CpuUsage);
		vi.spyOn(process, "memoryUsage").mockReturnValue({ rss: 0 } as NodeJS.MemoryUsage);

		sampler.start(1000);
		vi.advanceTimersByTime(1000);

		expect(sampler.getCpuPercent()).toBe(0);
		expect(sampler.getCpuPeak()).toBe(0);

		sampler.stop();
	});

	it("resets values to null after stop", () => {
		const sampler = new MetricsSampler();
		vi.spyOn(process, "cpuUsage")
			.mockReturnValueOnce({ user: 0, system: 0 } as NodeJS.CpuUsage)
			.mockReturnValueOnce({ user: 100_000, system: 0 } as NodeJS.CpuUsage);
		vi.spyOn(process, "memoryUsage").mockReturnValue({ rss: 100 } as NodeJS.MemoryUsage);

		sampler.start(1000);
		vi.advanceTimersByTime(1000);
		expect(sampler.getCpuPercent()).not.toBeNull();
		expect(sampler.getMemoryRssBytes()).not.toBeNull();
		expect(sampler.getCpuPeak()).not.toBeNull();
		expect(sampler.getCpuRollingAvg(1)).not.toBeNull();

		sampler.stop();
		expect(sampler.getCpuPercent()).toBeNull();
		expect(sampler.getMemoryRssBytes()).toBeNull();
		expect(sampler.getCpuPeak()).toBeNull();
		expect(sampler.getCpuRollingAvg()).toBeNull();
		expect(sampler.getCpuSpikeCount()).toBe(0);
	});

	it("unrefs the interval timer so it does not block process exit", () => {
		const sampler = new MetricsSampler();
		sampler.start(1000);

		const timer = (sampler as unknown as { timer: NodeJS.Timeout | null }).timer;
		expect(timer).not.toBeNull();
		expect(timer!.hasRef()).toBe(false);

		sampler.stop();
	});

	it("smooths CPU percent with EMA and seeds on first sample", () => {
		let time = 0;
		const rawValues = [10, 50, 50, 50, 50];
		let idx = 0;
		const sampler = new MetricsSampler({
			now: () => {
				time += 1000;
				return time;
			},
			readCpu: (prev?) => {
				if (!prev) {
					return { user: 0, system: 0 };
				}
				const p = rawValues[idx++];
				return { user: p * 10_000, system: 0 };
			},
			readMemory: () => ({ rss: 0 }),
			cpuCount: 1,
		});

		sampler.start(1000);
		expect(sampler.getCpuPercent()).toBeNull();

		vi.advanceTimersByTime(1000);
		// First sample seeds the EMA.
		expect(sampler.getCpuPercent()).toBeCloseTo(10, 4);

		vi.advanceTimersByTime(1000);
		// 0.3 * 50 + 0.7 * 10 = 22
		expect(sampler.getCpuPercent()).toBeCloseTo(22, 4);

		vi.advanceTimersByTime(1000);
		// 0.3 * 50 + 0.7 * 22 = 30.4
		expect(sampler.getCpuPercent()).toBeCloseTo(30.4, 4);

		vi.advanceTimersByTime(1000);
		// 0.3 * 50 + 0.7 * 30.4 = 36.28
		expect(sampler.getCpuPercent()).toBeCloseTo(36.28, 4);

		vi.advanceTimersByTime(1000);
		// 0.3 * 50 + 0.7 * 36.28 = 40.396
		expect(sampler.getCpuPercent()).toBeCloseTo(40.396, 4);

		sampler.stop();
	});

	it("tracks CPU peak", () => {
		let time = 0;
		const rawValues = [10, 20, 50, 30, 20];
		let idx = 0;
		const sampler = new MetricsSampler({
			now: () => {
				time += 1000;
				return time;
			},
			readCpu: (prev?) => {
				if (!prev) {
					return { user: 0, system: 0 };
				}
				const p = rawValues[idx++];
				return { user: p * 10_000, system: 0 };
			},
			readMemory: () => ({ rss: 0 }),
			cpuCount: 1,
		});

		sampler.start(1000);
		expect(sampler.getCpuPeak()).toBeNull();

		for (let i = 0; i < rawValues.length; i++) {
			vi.advanceTimersByTime(1000);
		}

		// Smoothed sequence: 10, 13, 24.1, 25.87, 24.109
		expect(sampler.getCpuPeak()).toBeCloseTo(25.87, 4);

		sampler.stop();
	});

	it("computes rolling average over a window of smoothed samples", () => {
		let time = 0;
		const rawValues = [10, 20, 30, 40, 50, 60, 70];
		let idx = 0;
		const sampler = new MetricsSampler({
			now: () => {
				time += 1000;
				return time;
			},
			readCpu: (prev?) => {
				if (!prev) {
					return { user: 0, system: 0 };
				}
				const p = rawValues[idx++];
				return { user: p * 10_000, system: 0 };
			},
			readMemory: () => ({ rss: 0 }),
			cpuCount: 1,
		});

		sampler.start(1000);
		expect(sampler.getCpuRollingAvg()).toBeNull();

		for (let i = 0; i < rawValues.length; i++) {
			vi.advanceTimersByTime(1000);
		}

		// Smoothed: 10, 13, 18.1, 24.67, 32.269, 40.5883, 49.41181
		// Last 5 mean: (18.1 + 24.67 + 32.269 + 40.5883 + 49.41181) / 5 = 33.007822
		expect(sampler.getCpuRollingAvg(5)).toBeCloseTo(33.0078, 3);
		expect(sampler.getCpuRollingAvg()).toBeCloseTo(33.0078, 3);
		expect(sampler.getCpuRollingAvg(100)).toBeNull();
		expect(sampler.getCpuRollingAvg(0)).toBeNull();

		sampler.stop();
		expect(sampler.getCpuRollingAvg()).toBeNull();
	});

	it("supports configurable EMA alpha, rolling window history, and spike counting", () => {
		let time = 0;
		const rawValues = [10, 50, 50, 10, 50];
		let idx = 0;
		const sampler = new MetricsSampler({
			now: () => {
				time += 1000;
				return time;
			},
			readCpu: (prev?) => {
				if (!prev) {
					return { user: 0, system: 0 };
				}
				const p = rawValues[idx++];
				return { user: p * 10_000, system: 0 };
			},
			readMemory: () => ({ rss: 0 }),
			cpuCount: 1,
			emaAlpha: 0.5,
			historySize: 3,
			rollingWindowSize: 3,
			spikeThreshold: 30,
		});

		sampler.start(1000);

		for (let i = 0; i < rawValues.length; i++) {
			vi.advanceTimersByTime(1000);
		}

		expect(sampler.getCpuPercent()).toBeCloseTo(37.5, 4);
		expect(sampler.getCpuSpikeCount()).toBe(2);
		expect(sampler.getCpuRollingAvg()).toBeCloseTo((40 + 25 + 37.5) / 3, 4);
		expect(sampler.getCpuRollingAvg(4)).toBeNull();

		sampler.stop();
		expect(sampler.getCpuSpikeCount()).toBe(0);
	});

	it("clamps malformed options to safe defaults", () => {
		let time = 0;
		const rawValues = [10, 50, 50, 50, 50];
		let idx = 0;
		const sampler = new MetricsSampler({
			now: () => {
				time += 1000;
				return time;
			},
			readCpu: (prev?) => {
				if (!prev) {
					return { user: 0, system: 0 };
				}
				const p = rawValues[idx++];
				return { user: p * 10_000, system: 0 };
			},
			readMemory: () => ({ rss: 0 }),
			cpuCount: 1,
			emaAlpha: Number.NaN,
			historySize: Number.NaN,
			rollingWindowSize: Number.NaN,
			spikeThreshold: Number.NaN,
		});

		sampler.start(1000);

		for (let i = 0; i < rawValues.length; i++) {
			vi.advanceTimersByTime(1000);
		}

		expect(sampler.getCpuPercent()).toBeCloseTo(40.396, 4);
		expect(sampler.getCpuRollingAvg()).toBeCloseTo(27.8152, 4);
		expect(sampler.getCpuSpikeCount()).toBe(0);

		sampler.stop();
	});

	it("clamps out-of-range option bounds", () => {
		let time = 0;
		const rawValues = [10, 50, 100, 100];
		let idx = 0;
		const sampler = new MetricsSampler({
			now: () => {
				time += 1000;
				return time;
			},
			readCpu: (prev?) => {
				if (!prev) {
					return { user: 0, system: 0 };
				}
				const p = rawValues[idx++];
				return { user: p * 10_000, system: 0 };
			},
			readMemory: () => ({ rss: 0 }),
			cpuCount: 1,
			emaAlpha: -5,
			historySize: 2,
			rollingWindowSize: 2,
			spikeThreshold: 150,
		});

		sampler.start(1000);

		for (let i = 0; i < rawValues.length; i++) {
			vi.advanceTimersByTime(1000);
		}

		expect(sampler.getCpuPercent()).toBeCloseTo(10, 4);
		expect(sampler.getCpuSpikeCount()).toBe(0);
		expect(sampler.getCpuRollingAvg()).toBeCloseTo(10, 4);
		expect(sampler.getCpuRollingAvg(3)).toBeNull();

		sampler.stop();
	});

	it("supports deterministic dependency injection", () => {
		let time = 0;
		let call = 0;
		const sampler = new MetricsSampler({
			now: () => {
				time += 1000;
				return time;
			},
			readCpu: (prev?) => {
				call++;
				if (!prev) {
					return { user: 0, system: 0 };
				}
				return { user: 100_000 * call, system: 0 };
			},
			readMemory: () => ({ rss: 999 }),
			cpuCount: 2,
		});

		sampler.start(1000);
		expect(sampler.getCpuPercent()).toBeNull();
		expect(sampler.getMemoryRssBytes()).toBeNull();

		vi.advanceTimersByTime(1000);
		// elapsed = 1000ms, delta = 200_000us (call was 2 at first sample),
		// cpuCount=2 -> raw = (200_000 / 1_000_000 / 2) * 100 = 10
		expect(sampler.getCpuPercent()).toBeCloseTo(10, 4);
		expect(sampler.getMemoryRssBytes()).toBe(999);
		expect(sampler.getCpuPeak()).toBeCloseTo(10, 4);

		sampler.stop();
	});
});
