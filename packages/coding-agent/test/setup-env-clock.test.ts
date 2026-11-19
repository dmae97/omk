import { afterEach, describe, expect, it, vi } from "vitest";
import { createMonotonicNow, createStableNow } from "./setup-env.ts";

describe("createMonotonicNow", () => {
	it("passes through a well-behaved source unchanged", () => {
		const samples = [100, 101, 102, 103];
		let i = 0;
		const now = createMonotonicNow(() => samples[i++]);
		expect([now(), now(), now(), now()]).toEqual([100, 101, 102, 103]);
	});

	it("clamps a rolled-back source so output never decreases", () => {
		// A WSL host clock observed rolling back mid-test (see verified-run
		// flakes): the authority clock treats a decreasing source as a fatal
		// anomaly, so tests that only need a sane clock must not see host noise.
		const samples = [1000, 999, 998, 1001, 1000, 1002];
		let i = 0;
		const now = createMonotonicNow(() => samples[i++]);
		expect([now(), now(), now(), now(), now(), now()]).toEqual([1000, 1000, 1000, 1001, 1001, 1002]);
	});
});

describe("createStableNow", () => {
	it("advances with elapsed time despite forward and backward wall-clock resyncs", () => {
		let wall = 1_000;
		let elapsed = 50;
		const now = createStableNow(
			() => wall,
			() => elapsed,
		);
		expect(now()).toBe(1_000);
		wall += 14_700;
		elapsed += 10;
		expect(now()).toBe(1_010);
		wall -= 29_400;
		elapsed += 10;
		expect(now()).toBe(1_020);
	});
});

describe("installed test clock", () => {
	afterEach(() => vi.restoreAllMocks());

	it("Date construction and function calls use the same clock as Date.now", () => {
		const timestamp = 1_600_000_000_000;
		vi.spyOn(Date, "now").mockReturnValue(timestamp);
		const constructed = new Date();
		expect(constructed.getTime()).toBe(timestamp);
		expect(Date()).toBe(new Date(timestamp).toString());
	});

	it("preserves explicit date arguments, parsing and native instances", () => {
		const timestamp = 1_600_000_000_000;
		expect(new Date(timestamp).getTime()).toBe(timestamp);
		expect(new Date("2020-09-13T12:26:40.000Z").getTime()).toBe(timestamp);
		expect(Date.parse("2020-09-13T12:26:40.000Z")).toBe(timestamp);
		expect(Date.UTC(2020, 8, 13, 12, 26, 40)).toBe(timestamp);
		expect(new Date()).toBeInstanceOf(Date);
	});

	it("Date.now is non-decreasing across calls", () => {
		const a = Date.now();
		const b = Date.now();
		expect(b).toBeGreaterThanOrEqual(a);
	});
});
