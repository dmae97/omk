import { describe, expect, it } from "vitest";
import { createMonotonicNow } from "./setup-env.ts";

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

describe("installed test clock", () => {
	it("Date.now is non-decreasing across calls", () => {
		const a = Date.now();
		const b = Date.now();
		expect(b).toBeGreaterThanOrEqual(a);
	});
});
